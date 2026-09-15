import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * The Packages tab's data: one file, `data/packages.json`, written by the agent
 * in agent/amazon at the end of every poll.
 *
 * The board never logs into Amazon — the agent does, once, and reuses the saved
 * session on a schedule (see agent/amazon/README.md). The password and the OTP
 * dance stay in the Python, off the render path, the same rule the mail
 * scraper and the mail poller keep. This file validates the document and answers
 * "is anything arriving soon".
 *
 * ONE ROW IS ONE SHIPMENT (one box), not one order: an order that ships in two
 * boxes is two rows, and two orders Amazon packed in one box are one.
 *
 * STATUS IS A CLOSED SET so the widget can style it. Anything the scraper cannot
 * map lands as "unknown" rather than as free text, which would render as a blank
 * pill instead of an honest one; Amazon's own words ride along in `detail`.
 *
 * Everything past schema 1 is optional, so a file written by the older agent
 * still renders until the next poll replaces it.
 */

export const PACKAGE_STATUSES = [
  "ordered",
  "shipped",
  "out_for_delivery",
  "delivered",
  "delayed",
  "problem",
  "unknown",
] as const;

const ItemSchema = z.object({
  title: z.string(),
  /** A small product thumbnail on Amazon's image CDN. */
  image: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  asin: z.string().nullable().optional(),
});

const EventSchema = z.object({
  /** New York local time, "2026-09-11T20:02", or just a date when Amazon gave no time. */
  at: z.string().nullable(),
  text: z.string(),
  place: z.string().nullable().optional(),
});

const PackageSchema = z.object({
  /** The order id plus Amazon's shipment id. */
  id: z.string(),
  orderId: z.string().optional(),
  orderUrl: z.string().nullable().optional(),
  /** What it is — the first item's title, with a "+N more" the agent appends. */
  title: z.string(),
  items: z.array(ItemSchema).default([]),
  /** ISO date the order was placed. */
  orderedAt: z.string().nullable(),
  status: z.enum(PACKAGE_STATUSES),
  /** ISO date Amazon expects it, when its prose named one. */
  eta: z.string().nullable().optional(),
  /** ISO date it was delivered. */
  deliveredAt: z.string().nullable().optional(),
  /** Amazon's own status line ("Arriving tomorrow by 10 PM"). */
  detail: z.string().nullable().optional(),
  /** Amazon's second line ("Your package was left in the mail room."). */
  note: z.string().nullable().optional(),
  carrier: z.string().nullable().optional(),
  trackingId: z.string().nullable().optional(),
  /** Amazon's package tracker page. */
  trackingUrl: z.string().nullable().optional(),
  /** Newest scan first. Only filled for the rows the agent fetched a tracker for. */
  events: z.array(EventSchema).default([]),
  lastEvent: EventSchema.nullable().optional(),
  /** Last day to return or replace, when a window is open. */
  returnBy: z.string().nullable().optional(),
  /** That window closes within the agent's warning days. */
  returnSoon: z.boolean().optional(),
});

export const PackagesFileSchema = z.object({
  schema: z.number().int(),
  /** When the agent last polled, ISO. */
  fetchedAt: z.string(),
  /** Already ordered (coming first) and capped by the agent. */
  packages: z.array(PackageSchema).default([]),
});

export type PackagesFile = z.infer<typeof PackagesFileSchema>;
export type Package = z.infer<typeof PackageSchema>;
export type PackageEvent = z.infer<typeof EventSchema>;

const FILE = path.join(process.cwd(), "data", "packages.json");

/** Read fresh — the agent rewrites it from another process on its own poll. */
export function loadPackages(): PackagesFile | null {
  try {
    return PackagesFileSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error(`dayboard: packages.json unreadable — ${(err as Error).message.split("\n")[0]}`);
    return null;
  }
}

const IN_FLIGHT = new Set<Package["status"]>([
  "ordered",
  "shipped",
  "out_for_delivery",
  "delayed",
  "problem",
  "unknown",
]);

/** Not yet arrived, whatever state it is in. */
export function isInFlight(pkg: Package): boolean {
  return IN_FLIGHT.has(pkg.status);
}

/** How many are on the way. */
export function inFlight(file: PackagesFile | null): number {
  return file ? file.packages.filter(isInFlight).length : 0;
}

/** Delivered things whose return window is about to close. */
export function returnsClosingSoon(file: PackagesFile | null): number {
  return file ? file.packages.filter((p) => p.returnSoon).length : 0;
}
