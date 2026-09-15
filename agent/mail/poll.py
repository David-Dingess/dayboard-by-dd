"""
Poll a mailbox over IMAP and write data/mail.json for the board, and act on the
board's delete queue.

Any IMAP server — Gmail by default, Outlook.com, iCloud, Fastmail — read with an
app password, writing the small JSON the Mail widget renders. It never logs into
anything at render time: the board reads the file, this writes it.

WHERE THE CREDENTIALS COME FROM. data/settings.json, the file the board's setup
guide writes (the `mail` section); agent/mail/.env still works as a fallback for
anyone who set up the old way. See agent/_settings.py.

MESSAGE IDS ARE IMAP UIDs, not sequence numbers, so the board can name a specific
message to open or delete and mean the same one this saw. Reading never marks a
message seen (every fetch is BODY.PEEK); `unread` is whatever Gmail last said.

THE DELETE QUEUE. The board cannot touch the mailbox, so an X on a message writes
its UID into data/mail-queue.json; this processes that FIRST, before the fetch, by
moving each one to the trash folder — reversible, not a permanent delete — and then
the re-fetch below naturally omits it. Doing it in that order is what stops a
just-deleted message reappearing on the next poll.

Zero third-party code but python-dotenv — imaplib and email are standard library.
"""

from __future__ import annotations

import email
import imaplib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - a missing dep is a setup problem, said plainly
    load_dotenv = None

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]  # agent/mail -> agent -> repo root
OUT = REPO / "data" / "mail.json"
QUEUE = REPO / "data" / "mail-queue.json"

sys.path.insert(0, str(HERE.parent))
from _settings import section as settings_section, get as setting  # noqa: E402

SCHEMA = 1
TRASH = "[Gmail]/Trash"
BODY_LIMIT = 8000


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def decode(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value))).strip()
    except Exception:
        return value.strip()


def _decode_part(part: email.message.Message) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def _strip_html(html: str) -> str:
    html = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    # A few entities are common enough in forwarded mail to be worth undoing.
    for entity, char in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&#39;", "'"), ("&quot;", '"')):
        html = html.replace(entity, char)
    return html


def body_text(msg: email.message.Message) -> str:
    """The message as readable plain text — the text/plain part, or HTML stripped."""
    text = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                text = _decode_part(part)
                if text.strip():
                    break
        if not text.strip():
            for part in msg.walk():
                if part.get_content_type() == "text/html" and not part.get_filename():
                    text = _strip_html(_decode_part(part))
                    break
    else:
        raw = _decode_part(msg)
        text = _strip_html(raw) if msg.get_content_type() == "text/html" else raw

    # Collapse runs of blank lines but keep paragraph breaks, then cap.
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text).strip()
    return text[:BODY_LIMIT]


def received_iso(msg: email.message.Message) -> str:
    raw = msg.get("Date")
    if raw:
        try:
            dt = parsedate_to_datetime(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except Exception:
            pass
    return datetime.now(timezone.utc).isoformat()


def write_atomic(path: Path, data) -> None:
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


def read_queue() -> list[str]:
    try:
        with open(QUEUE, encoding="utf-8") as fh:
            data = json.load(fh)
        ids = data.get("delete", []) if isinstance(data, dict) else []
        return [str(x) for x in ids if str(x).strip()]
    except FileNotFoundError:
        return []
    except Exception as err:
        print(f"mail: delete queue unreadable — {err}", file=sys.stderr)
        return []


def process_deletes(conn: imaplib.IMAP4_SSL, uids: list[str]) -> int:
    """Move each queued UID to Trash. Reversible — Gmail keeps Trash 30 days."""
    done = 0
    for uid in uids:
        if not uid.isdigit():
            continue  # only ever our own numeric UIDs; ignore anything else
        try:
            typ, _ = conn.uid("COPY", uid, TRASH)
            if typ == "OK":
                done += 1
            else:
                print(f"mail: could not trash uid {uid}", file=sys.stderr)
        except Exception as err:
            print(f"mail: trashing uid {uid} failed — {err}", file=sys.stderr)
    return done


def main() -> int:
    if load_dotenv is not None:
        load_dotenv(HERE / ".env")

    conf = settings_section("mail")
    e = dict(os.environ)
    user = setting(conf, "user", "GMAIL_USER", None, e)
    password = setting(conf, "appPassword", "GMAIL_APP_PASSWORD", None, e)
    mailbox = setting(conf, "mailbox", "GMAIL_MAILBOX", "INBOX", e)
    limit = int(setting(conf, "limit", "MAIL_LIMIT", 15, e) or 15)
    host = setting(conf, "host", "IMAP_HOST", "imap.gmail.com", e)
    port = int(setting(conf, "port", "IMAP_PORT", 993, e) or 993)
    global TRASH
    TRASH = setting(conf, "trash", "IMAP_TRASH", "[Gmail]/Trash", e)

    if not user or not password:
        print("mail: no address and app password — Settings -> Email on the board (or agent/mail/.env)", file=sys.stderr)
        return 2

    conn = imaplib.IMAP4_SSL(host, port)
    try:
        conn.login(user, password)
        # NOT readonly: a delete has to move a message. Reading still leaves
        # nothing marked seen because every fetch below is BODY.PEEK.
        conn.select(f'"{mailbox}"', readonly=False)

        # Deletes FIRST, so the fetch that follows already excludes them.
        queued = read_queue()
        if queued:
            trashed = process_deletes(conn, queued)
            try:
                conn.expunge()
            except Exception:
                pass
            write_atomic(QUEUE, {"delete": []})
            print(f"mail: trashed {trashed}/{len(queued)} queued message(s)")

        unseen_ok, unseen_data = conn.uid("SEARCH", None, "UNSEEN")
        unseen = set(unseen_data[0].split()) if unseen_ok == "OK" and unseen_data[0] else set()

        all_ok, all_data = conn.uid("SEARCH", None, "ALL")
        all_uids = all_data[0].split() if all_ok == "OK" and all_data[0] else []
        recent = all_uids[-limit:][::-1]  # newest first

        messages = []
        for uid in recent:
            fetch_ok, fetch_data = conn.uid("FETCH", uid, "(BODY.PEEK[])")
            if fetch_ok != "OK" or not fetch_data or not isinstance(fetch_data[0], tuple):
                continue
            msg = email.message_from_bytes(fetch_data[0][1])
            body = body_text(msg)
            messages.append(
                {
                    "id": uid.decode() if isinstance(uid, bytes) else str(uid),
                    "from": decode(msg.get("From")),
                    "subject": decode(msg.get("Subject")),
                    "snippet": re.sub(r"\s+", " ", body)[:160],
                    "body": body,
                    "receivedAt": received_iso(msg),
                    "unread": uid in unseen,
                }
            )

        write_atomic(
            OUT,
            {
                "schema": SCHEMA,
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
                "unreadCount": len(unseen),
                "mailbox": mailbox,
                "messages": messages,
            },
        )
        print(f"mail: wrote {len(messages)} message(s), {len(unseen)} unread -> {OUT}")
        return 0
    finally:
        try:
            conn.logout()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
