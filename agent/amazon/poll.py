"""
Read recent Amazon orders with the saved session and write data/packages.json.

The board never logs into Amazon; login.py does that once and leaves a session
behind, and this reuses it headlessly. If the session has expired it says so and
exits without prompting — a scheduled task must never block on stdin — and you
re-run login.py.

WHAT COMES FROM WHERE (checked against a real account, amazon-orders 4.6.0):

- The order-history card gives, per shipment: Amazon's status line ("Delivered
  September 11"), a second line ("Your package was left in the mail room."), the
  items with title / link / image, the return window ("Eligible through October
  5, 2026") and a link to the package tracker. No extra requests.
- The tracker page (/progress-tracker/package, one GET per shipment) gives the
  tracking ID, the carrier, and the scan timeline with times and places. Fetched
  only for rows the tab will actually show, and capped.

WE READ THE HTML OURSELVES rather than through the library's Shipment fields for
the tracker link, the second line and the return window: the library's own
selectors for those are stale (it still looks for "ship-track?itemId=", which
Amazon no longer renders), and its Shipment has no carrier at all. Item price and
quantity are stale there too, which is why this doesn't use them.

STILL DEFENSIVE. Every order and every tracker fetch is wrapped so one odd row
cannot empty the panel. The in-transit wording ("Arriving tomorrow", "Now
expected…") had no live example when this was written — nothing was shipping —
so parse_status() covers the likely phrasings and always keeps Amazon's own words
in `detail`. Set AMAZON_DEBUG_DIR to capture raw HTML when something reads oddly.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

try:
    from zoneinfo import ZoneInfo

    NY = ZoneInfo("America/New_York")
except Exception:  # no tz database — the machine's own clock is New York anyway
    NY = None

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from _settings import section as settings_section, get as setting  # noqa: E402
REPO = HERE.parents[1]  # agent/amazon -> agent -> repo root
OUT = REPO / "data" / "packages.json"
SCHEMA = 2
BASE = "https://www.amazon.com"

IN_FLIGHT = {"ordered", "shipped", "out_for_delivery", "delayed", "problem", "unknown"}

MONTHS = {
    m: i
    for i, names in enumerate(
        [
            ("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"),
            ("may",), ("jun", "june"), ("jul", "july"), ("aug", "august"),
            ("sep", "sept", "september"), ("oct", "october"), ("nov", "november"), ("dec", "december"),
        ],
        start=1,
    )
    for m in names
}
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTH_DAY = re.compile(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b")

# Ordered most-specific first: the first phrase found in the (lowercased) status
# text wins. Anything matching nothing is "unknown" and still shows, in Amazon's
# own words.
STATUS_RULES = [
    ("cancel", "cancelled"),
    ("return", "returned"),  # "Return started / received / complete", "Refunded"
    ("refund", "returned"),
    ("delivery attempt", "problem"),
    ("attempted", "problem"),
    ("undeliverable", "problem"),
    ("unable to deliver", "problem"),
    ("returning to sender", "problem"),
    ("lost", "problem"),
    ("damaged", "problem"),
    ("delivered", "delivered"),
    ("out for delivery", "out_for_delivery"),
    ("stops away", "out_for_delivery"),
    ("arriving today", "out_for_delivery"),
    ("delayed", "delayed"),
    ("running late", "delayed"),
    ("not yet shipped", "ordered"),
    ("preparing", "ordered"),
    ("ordered", "ordered"),
    ("arriving", "shipped"),
    ("expected", "shipped"),
    ("shipped", "shipped"),
    ("on its way", "shipped"),
    ("on the way", "shipped"),
    ("in transit", "shipped"),
]


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def env_int(name: str, default: int) -> int:
    try:
        return int(env(name, str(default)) or default)
    except ValueError:
        return default


def today_ny() -> date:
    return datetime.now(NY).date() if NY else date.today()


def attr(obj: object, *names: str, default=None):
    """First present, non-None attribute among names."""
    for name in names:
        value = getattr(obj, name, None)
        if value is not None:
            return value
    return default


def squash(text: str | None) -> str:
    return " ".join(str(text or "").split())


def fix_text(s: str) -> str:
    """Undo UTF-8-decoded-as-cp1252 mojibake ("Â®", "â„¢") the scraper sometimes
    hands back. Only when it cleanly round-trips, so real text is never mangled."""
    if not s:
        return s
    if any(marker in s for marker in ("Ã", "Â", "â€", "â„", " Â")):
        try:
            return s.encode("cp1252").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return s
    return s


# ---- dates in Amazon's prose -------------------------------------------------


def month_day(text: str, today: date, past: bool) -> date | None:
    """First "September 11" / "Sep 11, 2026" in text. With no year, pick the one
    that makes sense: a delivery lies in the past, an estimate in the future —
    which is what makes December orders arriving in January come out right."""
    for match in MONTH_DAY.finditer(text):
        month = MONTHS.get(match.group(1).lower())
        if not month:
            continue
        day = int(match.group(2))
        year = int(match.group(3)) if match.group(3) else today.year
        try:
            found = date(year, month, day)
        except ValueError:
            continue
        if not match.group(3):
            if past and found > today + timedelta(days=7):
                found = found.replace(year=year - 1)
            elif not past and found < today - timedelta(days=60):
                found = found.replace(year=year + 1)
        return found
    return None


def prose_date(text: str, today: date, past: bool) -> date | None:
    low = text.lower()
    if "today" in low:
        return today
    if "tomorrow" in low:
        return today + timedelta(days=1)
    if "yesterday" in low:
        return today - timedelta(days=1)
    found = month_day(text, today, past)
    if found:
        return found
    for index, name in enumerate(WEEKDAYS):
        if re.search(rf"\b{name}\b", low):
            delta = (index - today.weekday()) % 7
            return today - timedelta(days=(7 - delta) % 7) if past else today + timedelta(days=delta)
    return None


def parse_status(text: str | None, today: date) -> tuple[str, str | None, str | None]:
    """Amazon's status line -> (status, eta ISO, deliveredAt ISO)."""
    if not text:
        return "unknown", None, None
    low = text.lower()
    status = next((s for phrase, s in STATUS_RULES if phrase in low), "unknown")
    if status == "delivered":
        when = prose_date(text, today, past=True)
        return status, None, when.isoformat() if when else None
    if status in ("cancelled", "returned"):
        return status, None, None
    when = prose_date(text, today, past=False)
    if status == "out_for_delivery" and not when:
        when = today
    return status, when.isoformat() if when else None, None


# ---- the history card ----------------------------------------------------------


def absolute(href: str | None) -> str | None:
    if not href:
        return None
    return href if href.startswith("http") else f"{BASE}{href}"


def tracker_url(shipment) -> str | None:
    tag = shipment.parsed.select_one("a[href*='progress-tracker'], a[href*='ship-track']")
    return absolute(tag.get("href")) if tag else None


def shipment_id(url: str | None) -> str | None:
    match = re.search(r"[?&]shipmentId=([^&]+)", url or "")
    return match.group(1) if match else None


def note_of(shipment) -> str | None:
    # The inner span sits inside the outer div, so read one or the other, not both.
    tag = shipment.parsed.select_one(".delivery-box__secondary-text") or shipment.parsed.select_one(
        ".yohtmlc-shipment-status-secondaryText"
    )
    text = fix_text(squash(tag.get_text(" ", strip=True))) if tag else ""
    return text or None


def return_by(shipment, items) -> str | None:
    """The earliest "Eligible through …" in the shipment, else the library's own
    per-item date. A closed window reads as no window."""
    text = squash(shipment.parsed.get_text(" ", strip=True))
    dates = []
    for match in re.finditer(r"Eligible through ([A-Za-z]+ \d{1,2}, \d{4})", text):
        try:
            dates.append(datetime.strptime(match.group(1), "%B %d, %Y").date())
        except ValueError:
            pass
    if not dates:
        dates = [d for d in (attr(it, "return_eligible_date") for it in items) if isinstance(d, date)]
    return min(dates).isoformat() if dates else None


def image_of(item) -> str | None:
    """Amazon's image URLs carry a per-experiment path and a big size; the image id
    alone gives a small, stable thumbnail."""
    link = attr(item, "image_link")
    if not link:
        return None
    match = re.search(r"/images/I/([A-Za-z0-9+%-]+)\.", link)
    return f"https://m.media-amazon.com/images/I/{match.group(1)}._SL160_.jpg" if match else link


def item_of(item) -> dict:
    asin = attr(item, "asin")
    title = fix_text(squash(attr(item, "title", default="")))
    return {
        "title": title or "Item",
        "image": image_of(item),
        "url": f"{BASE}/dp/{asin}" if asin else absolute(attr(item, "link")),
        "asin": asin,
    }


def title_of(items: list[dict]) -> str:
    if not items:
        return "Amazon order"
    first = items[0]["title"]
    if len(first) > 90:
        first = first[:87] + "..."
    return first if len(items) == 1 else f"{first} · +{len(items) - 1} more"


def packages_from_order(order, today: date) -> list[dict]:
    order_number = str(attr(order, "order_number", default="?"))
    placed = attr(order, "order_placed_date")
    ordered_at = placed.isoformat() if isinstance(placed, (date, datetime)) else None

    out = []
    for index, shipment in enumerate(attr(order, "shipments", default=[]) or []):
        status_text = fix_text(squash(attr(shipment, "delivery_status")))
        status, eta, delivered_at = parse_status(status_text, today)
        if status in ("cancelled", "returned"):
            continue
        track = tracker_url(shipment)
        raw_items = attr(shipment, "items", default=[]) or []
        items = [item_of(it) for it in raw_items]
        sid = shipment_id(track)
        out.append(
            {
                "id": f"{order_number}-{sid or index}",
                "orderId": order_number,
                "orderUrl": attr(order, "order_details_link"),
                "title": title_of(items),
                "items": items,
                "orderedAt": ordered_at,
                "status": status,
                "eta": eta,
                "deliveredAt": delivered_at,
                "detail": status_text or None,
                "note": note_of(shipment),
                "carrier": None,
                "trackingId": None,
                "trackingUrl": track,
                "lastEvent": None,
                "events": [],
                "returnBy": return_by(shipment, raw_items) if status == "delivered" else None,
                "returnSoon": False,
                "_card": shipment.parsed,
            }
        )
    return out


# ---- the tracker page ----------------------------------------------------------


def parse_tracker(parsed, today: date) -> dict:
    """Tracking ID, carrier, the tracker's own headline, and the scan timeline."""
    out: dict = {"trackingId": None, "carrier": None, "headline": None, "headlineDetail": None, "events": []}

    tag = parsed.select_one(".pt-delivery-card-trackingId, .tracking-event-trackingId-text")
    if tag:
        out["trackingId"] = squash(tag.get_text(" ", strip=True)).split(":", 1)[-1].strip() or None

    tag = parsed.select_one(".tracking-event-carrier-header, .carrierRelatedInfo-mfn-carrierNameTitle")
    if tag:
        carrier = squash(tag.get_text(" ", strip=True))
        carrier = re.sub(r"^(delivery facilitated by|shipped with|delivered by|carrier:?)\s*", "", carrier, flags=re.I)
        out["carrier"] = carrier or None

    tag = parsed.select_one(".pt-promise-main-slot")
    if tag:
        out["headline"] = fix_text(squash(tag.get_text(" ", strip=True))) or None
    tag = parsed.select_one(".pt-promise-details-slot")
    if tag:
        out["headlineDetail"] = fix_text(squash(tag.get_text(" ", strip=True))) or None

    events = []
    for date_tag in parsed.select("#tracking-events-container .tracking-event-date"):
        day = month_day(squash(date_tag.get_text(" ", strip=True)), today, past=True)
        header = date_tag.find_parent(class_="tracking-event-date-header")
        group = header.parent if header else None
        if group is None:
            continue
        for left in group.select(".tracking-event-time-left"):
            right = left.find_next_sibling(class_="tracking-event-time-right")
            if right is None:
                continue
            text = squash(right.select_one(".tracking-event-message").get_text(" ", strip=True)) if right.select_one(
                ".tracking-event-message"
            ) else ""
            if not text:
                continue
            place = right.select_one(".tracking-event-location")
            place = re.sub(r",?\s+US$", "",squash(place.get_text(" ", strip=True))) if place else ""
            clock = squash(left.select_one(".tracking-event-time").get_text(" ", strip=True)) if left.select_one(
                ".tracking-event-time"
            ) else ""
            at = day.isoformat() if day else None
            if day and clock:
                try:
                    at = datetime.combine(day, datetime.strptime(clock, "%I:%M %p").time()).isoformat(timespec="minutes")
                except ValueError:
                    pass
            events.append({"at": at, "text": fix_text(text.rstrip(".")), "place": place or None})
    out["events"] = events[:15]  # the page lists newest first already
    return out


def enrich(session, pkg: dict, today: date, debug_dir: Path | None) -> None:
    response = session.get(pkg["trackingUrl"])
    if debug_dir:
        (debug_dir / f"tracker-{pkg['id']}.html").write_text(response.response.text, encoding="utf-8")
    info = parse_tracker(response.parsed, today)
    pkg["trackingId"] = info["trackingId"]
    pkg["carrier"] = info["carrier"]
    pkg["events"] = info["events"]
    pkg["lastEvent"] = info["events"][0] if info["events"] else None
    # The tracker is the fresher source; prefer its headline when it says
    # something the status parser understands.
    if info["headline"]:
        status, eta, delivered_at = parse_status(info["headline"], today)
        if status not in ("unknown", "cancelled", "returned"):
            pkg["status"], pkg["detail"] = status, info["headline"]
            pkg["eta"] = eta or (pkg["eta"] if status != "delivered" else None)
            pkg["deliveredAt"] = delivered_at or pkg["deliveredAt"]
    if info["headlineDetail"] and not pkg["note"]:
        pkg["note"] = info["headlineDetail"]


def merge_same_box(packages: list[dict]) -> list[dict]:
    """Amazon sometimes packs two orders in one box: same tracking ID, one row."""
    seen: dict[str, dict] = {}
    out = []
    for pkg in packages:
        tid = pkg.get("trackingId")
        if tid and tid in seen:
            keep = seen[tid]
            asins = {it.get("asin") for it in keep["items"]}
            keep["items"].extend(it for it in pkg["items"] if it.get("asin") not in asins)
            keep["title"] = title_of(keep["items"])
            if pkg.get("returnBy") and (not keep.get("returnBy") or pkg["returnBy"] < keep["returnBy"]):
                keep["returnBy"] = pkg["returnBy"]
            continue
        if tid:
            seen[tid] = pkg
        out.append(pkg)
    return out


def write_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def main() -> int:
    if load_dotenv is not None:
        load_dotenv(HERE / ".env")

    conf = settings_section("amazon")
    e = dict(os.environ)
    username = setting(conf, "username", "AMAZON_USERNAME", None, e)
    password = setting(conf, "password", "AMAZON_PASSWORD", None, e)
    max_orders = int(setting(conf, "maxOrders", "AMAZON_MAX_ORDERS", 12, e))
    within_days = int(setting(conf, "withinDays", "AMAZON_WITHIN_DAYS", 45, e))
    delivered_days = int(setting(conf, "deliveredDays", "AMAZON_DELIVERED_DAYS", 3, e))
    return_warn_days = int(setting(conf, "returnWarnDays", "AMAZON_RETURN_WARN_DAYS", 7, e))
    max_tracker = env_int("AMAZON_MAX_TRACKER_FETCHES", 10)
    debug_dir = Path(env("AMAZON_DEBUG_DIR")) if env("AMAZON_DEBUG_DIR") else None
    if debug_dir:
        debug_dir.mkdir(parents=True, exist_ok=True)

    if not username or not password:
        print("amazon: no Amazon email and password — Settings -> Packages on the board (or agent/amazon/.env)", file=sys.stderr)
        return 2

    try:
        from browser_auth import configured_session
        from amazonorders.orders import AmazonOrders
        session = configured_session(username, password)
    except ImportError:
        print("amazon: pip install -r requirements.txt first", file=sys.stderr)
        return 2

    # get_order_history refuses to run unless session.is_authenticated is True,
    # and that flag is only ever set by login() inside this process — a fresh
    # session with a perfectly good saved cookie starts False. So gate on the
    # persisted cookies, then call login() to flip the flag.
    #
    # THIS login() DOES NOT PROMPT AND DOES NOT OPEN A BROWSER when a valid
    # session is on disk: it does one GET, sees auth_cookies_stored(), sets
    # is_authenticated and returns (session.py ~line 283). We only reach it when
    # the cookies are present, so the headless poll never blocks on a form. An
    # expired-but-present cookie slips past and the history fetch below simply
    # fails — re-run run_login.cmd then.
    if not (hasattr(session, "auth_cookies_stored") and session.auth_cookies_stored()):
        print("amazon: no valid session. Run run_login.cmd once to sign in.", file=sys.stderr)
        return 3
    try:
        session.login()
    except Exception as err:
        print(f"amazon: session refresh failed — {err}. Run run_login.cmd.", file=sys.stderr)
        return 3

    amazon = AmazonOrders(session)
    today = today_ny()

    # Three months covers every open return window and any slow shipment, in a
    # handful of history pages rather than two whole years of them.
    try:
        orders = amazon.get_order_history(time_filter="months-3") or []
    except Exception as err:
        print(f"amazon: order history failed — {err}", file=sys.stderr)
        return 1

    cutoff = today - timedelta(days=within_days)
    candidates: list[dict] = []
    for order in orders:
        try:
            # Whole Foods pickups and Fresh/in-store purchases have no shipments
            # to track; cancelled orders have nothing coming.
            if attr(order, "is_whole_foods", default=False) or attr(order, "cancelled", default=False):
                continue
            for pkg in packages_from_order(order, today):
                if debug_dir:
                    (debug_dir / f"card-{pkg['id']}.html").write_text(str(pkg["_card"]), encoding="utf-8")
                if pkg["status"] == "delivered":
                    returns = pkg["returnBy"]
                    pkg["returnSoon"] = bool(
                        returns and 0 <= (date.fromisoformat(returns) - today).days <= return_warn_days
                    )
                    recent = pkg["deliveredAt"] and date.fromisoformat(pkg["deliveredAt"]) >= today - timedelta(
                        days=delivered_days
                    )
                    if recent or pkg["returnSoon"]:
                        candidates.append(pkg)
                elif pkg["orderedAt"] and date.fromisoformat(pkg["orderedAt"]) >= cutoff:
                    candidates.append(pkg)
        except Exception as err:
            print(f"amazon: skipped an order — {err}", file=sys.stderr)

    # What is coming first (out for delivery, then soonest), then what just
    # arrived, then older deliveries only there for a closing return window.
    def rank(pkg: dict):
        if pkg["status"] in IN_FLIGHT:
            return (0, 0 if pkg["status"] == "out_for_delivery" else 1, pkg["eta"] or "9999", pkg["orderedAt"] or "")
        if pkg["deliveredAt"] and date.fromisoformat(pkg["deliveredAt"]) >= today - timedelta(days=delivered_days):
            return (1, -date.fromisoformat(pkg["deliveredAt"]).toordinal(), "", "")
        return (2, 0, pkg["returnBy"] or "", "")

    candidates.sort(key=rank)
    packages = candidates[:max_orders]

    fetched = 0
    for pkg in packages:
        if fetched >= max_tracker or not pkg["trackingUrl"]:
            continue
        # Older deliveries kept only for a return window don't need a timeline.
        if pkg["status"] == "delivered" and rank(pkg)[0] == 2:
            continue
        fetched += 1
        try:
            enrich(session, pkg, today, debug_dir)
        except Exception as err:
            print(f"amazon: tracker for {pkg['id']} failed — {err}", file=sys.stderr)

    packages = merge_same_box(packages)
    for pkg in packages:
        pkg.pop("_card", None)

    write_atomic(
        OUT,
        {
            "schema": SCHEMA,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "packages": packages,
        },
    )
    print(f"amazon: wrote {len(packages)} package(s), {fetched} tracked -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
