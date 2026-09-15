import { createHash, randomUUID } from "node:crypto";
import type { DayboardEvent } from "./schema";

/**
 * UIDs are the whole ballgame for a subscribed calendar: iOS matches events by
 * UID, so a UID that changes between refreshes shows up as a DUPLICATE rather
 * than an update. Every id minted here must therefore be a pure function of
 * things that do not drift — never of a title we might reword, never of a
 * fetch timestamp, never of array position.
 */

/**
 * The UID suffix on every event the .ics feed emits. A fixed, non-routable name
 * on purpose: a UID is an identity, not an address, and iOS only needs it to
 * be stable. Changing it would make every subscribed phone see every event as
 * new.
 */
export const UID_DOMAIN = "dayboard.local";

export function slug(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

/** Curated + personal events: minted once by scripts/event.mts, then immutable. */
export function curatedId(layer: string, title: string, date: string): string {
  return `${layer}:${slug(title)}-${date}`;
}

/** Upstream feeds with stable UIDs of their own. */
export function upstreamId(layer: string, upstreamUid: string): string {
  return `${layer}:u-${sha1(upstreamUid).slice(0, 12)}`;
}

/** Upstream feeds that regenerate their UIDs on every build. */
export function titleDateId(layer: string, title: string, localDate: string): string {
  return `${layer}:${slug(title)}-${localDate}`;
}

export function birthdayId(name: string): string {
  return `birthdays:${slug(name)}`;
}

/**
 * A to-do id, and the one id in this file that is deliberately NOT derived from
 * its content. `curatedId` would spell two "milk" to-dos on the same day the
 * same way, and rewording a to-do must not move its id either — the UI holds
 * these in flight while a Server Action runs. Nothing subscribes to to-dos, so
 * the "pure function of things that do not drift" rule above buys nothing here;
 * randomness is simply correct.
 */
export function todoId(now = new Date()): string {
  return `todo-${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
}

/**
 * A walk or a session id. Random for the same reason `todoId` is: two 30-minute
 * walks on one Saturday are a real thing and would collide under any content
 * hash, and nothing subscribes to these.
 */
export function healthId(prefix: "walk" | "day" | "chair", now = new Date()): string {
  return `${prefix}-${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
}

export function uidFor(event: Pick<DayboardEvent, "id">): string {
  return `${event.id}@${UID_DOMAIN}`;
}

/**
 * The fields whose change should make a calendar client re-notify the user.
 * `seq` is bumped when this hash moves, and iOS only applies an update when
 * SEQUENCE increases.
 */
export function contentHash(event: DayboardEvent): string {
  return sha1(
    JSON.stringify([
      event.title,
      event.start,
      event.end ?? null,
      event.allDay,
      event.location ?? null,
      event.status,
    ]),
  ).slice(0, 16);
}
