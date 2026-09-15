"use client";

import { useState } from "react";
import { DateTime } from "luxon";
import type { Package, PackageEvent } from "@/lib/packages";
import { zone } from "@/lib/time";

/**
 * The package rows, made openable.
 *
 * A row is a button: click it to see the scan timeline, the tracking ID and the
 * links out; click again to close. The list is server-rendered on the board's
 * refresh; this only owns which row is open, the same split MailList keeps.
 *
 * TYPES ONLY from lib/packages — that module reads the file with node:fs, which
 * has no business in a client bundle. The labels live here for the same reason.
 */

const STATUS_LABEL: Record<Package["status"], string> = {
  ordered: "Ordered",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  delayed: "Delayed",
  problem: "Problem",
  unknown: "In progress",
};

/** The agent writes New York wall time with no offset; read it as that. */
function at(iso: string | null | undefined): DateTime | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: zone() });
  return dt.isValid ? dt : null;
}

function hasTime(iso: string | null | undefined): boolean {
  return !!iso && iso.includes("T");
}

/** "today", "tomorrow", else "Mon 14 Sep". */
function day(iso: string | null | undefined): string {
  const dt = at(iso);
  if (!dt) return "";
  const today = DateTime.now().setZone(zone()).startOf("day");
  const diff = Math.round(dt.startOf("day").diff(today, "days").days);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return dt.toFormat("ccc d LLL");
}

function whenLabel(pkg: Package): string | null {
  if (pkg.status === "delivered") {
    const d = day(pkg.deliveredAt);
    return d ? `Delivered ${d}` : null;
  }
  const d = day(pkg.eta);
  if (d) return `Due ${d}`;
  // No date in Amazon's prose — show the prose rather than nothing.
  return pkg.detail ?? null;
}

function eventLine(event: PackageEvent): string {
  const time = hasTime(event.at) ? at(event.at)?.toFormat("h:mm a") : null;
  return [time, event.text, event.place].filter(Boolean).join(" · ");
}

function secondLine(pkg: Package): string | null {
  if (pkg.lastEvent) return eventLine(pkg.lastEvent);
  return pkg.note ?? (pkg.status === "delivered" ? null : pkg.detail) ?? null;
}

/** Past this many, the box's remaining items fold into one "+N more" line. */
const MAX_ITEM_LINES = 4;

/**
 * ONE LINE PER ITEM, each with its own thumbnail, rather than the first title
 * and a "+1 more" — a box with a calendar and wax sticks in it should say both.
 * A file from the older agent has no items, so it falls back to its title.
 */
function Items({ pkg }: { pkg: Package }) {
  if (pkg.items.length === 0) {
    return (
      <span className="pkgitems">
        <span className="pkgitem">
          <span className="pkgitem-thumb is-empty" aria-hidden="true" />
          <span className="pkgitem-title">{pkg.title}</span>
        </span>
      </span>
    );
  }
  const shown = pkg.items.length > MAX_ITEM_LINES ? pkg.items.slice(0, MAX_ITEM_LINES - 1) : pkg.items;
  const rest = pkg.items.length - shown.length;
  return (
    <span className="pkgitems">
      {shown.map((item, i) => (
        <span key={item.asin ?? i} className="pkgitem">
          {item.image ? (
            /* NOT loading="lazy": this panel sits hidden behind its tab, and a lazy
               image that was hidden at load never fetched. A dozen 160px
               thumbnails is nothing to load up front. */
            /* eslint-disable-next-line @next/next/no-img-element -- Amazon's CDN thumbnail, 160px */
            <img className="pkgitem-thumb" src={item.image} alt="" />
          ) : (
            <span className="pkgitem-thumb is-empty" aria-hidden="true" />
          )}
          <span className="pkgitem-title">{item.title}</span>
        </span>
      ))}
      {rest > 0 && <span className="pkgitem-more">+{rest} more</span>}
    </span>
  );
}

export function PackageList({ packages }: { packages: Package[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <ul className="pkglist">
      {packages.map((pkg) => {
        const open = openId === pkg.id;
        const when = whenLabel(pkg);
        const line = secondLine(pkg);
        const returnDay = pkg.status === "delivered" ? day(pkg.returnBy) : "";
        const classes = [
          "pkgrow",
          `is-${pkg.status}`,
          pkg.status === "out_for_delivery" ? "is-arriving" : "",
          pkg.returnSoon ? "is-returnsoon" : "",
          open ? "is-open" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <li key={pkg.id} className={classes}>
            <button
              type="button"
              className="pkgrow-main"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : pkg.id)}
            >
              <span className="pkgrow-top">
                <span className={`pkgstatus is-${pkg.status}`}>{STATUS_LABEL[pkg.status]}</span>
                {when && <span className="pkgrow-eta">{when}</span>}
              </span>
              <Items pkg={pkg} />
              {line && <span className="pkgrow-detail">{line}</span>}
              {returnDay && (
                <span className={`pkgreturn${pkg.returnSoon ? " is-soon" : ""}`}>Return by {returnDay}</span>
              )}
            </button>

            {open && (
              <div className="pkgrow-more">
                {(pkg.carrier || pkg.trackingId) && (
                  <div className="pkgrow-meta">
                    {[pkg.carrier, pkg.trackingId].filter(Boolean).join(" · ")}
                  </div>
                )}

                {/* Amazon's words add a delivery window in transit ("by 10 PM");
                    once delivered they only repeat the row's own heading. */}
                {pkg.detail && pkg.detail !== when && pkg.status !== "delivered" && (
                  <div className="pkgrow-said">{pkg.detail}</div>
                )}
                {pkg.note && pkg.lastEvent && <div className="pkgrow-said">{pkg.note}</div>}

                {pkg.events.length > 0 ? (
                  <ol className="pkgtimeline">
                    {pkg.events.map((event, i) => (
                      <li key={`${event.at}-${i}`}>
                        <span className="pkgtimeline-when">
                          {day(event.at)}
                          {hasTime(event.at) ? ` ${at(event.at)?.toFormat("h:mm a")}` : ""}
                        </span>
                        <span className="pkgtimeline-text">
                          {event.text}
                          {event.place && <span className="pkgtimeline-place"> · {event.place}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="pkgrow-said is-faint">No scan history fetched for this one.</div>
                )}

                <div className="pkgrow-links">
                  {pkg.trackingUrl && (
                    <a href={pkg.trackingUrl} target="_blank" rel="noreferrer">
                      Track ↗
                    </a>
                  )}
                  {pkg.orderUrl && (
                    <a href={pkg.orderUrl} target="_blank" rel="noreferrer">
                      Order ↗
                    </a>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
