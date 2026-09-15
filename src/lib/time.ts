import { DateTime } from "luxon";
import { DATE_ONLY } from "./schema";
import { zone } from "./runtime";

/**
 * The board's zone comes from data/settings.json (or the machine, when unset)
 * through lib/runtime.ts, so it is the same answer on the server and in the
 * browser. Every helper here defaults to it; every date key on the board is
 * computed in it.
 */
export { zone };

export function nowIso(): string {
  return new Date().toISOString();
}

/** "2026-09-05", in the board's zone. */
export function todayLocal(): string {
  return DateTime.now().setZone(zone()).toISODate()!;
}

/**
 * Accepts what a human types ("2026-10-04 19:30", "2026-10-04T19:30",
 * "2026-10-04") and returns a canonical stored value.
 * A bare date is all-day; anything else gets an explicit offset in `tz`.
 */
export function parseFlexible(
  input: string,
  tz: string = zone(),
): { value: string; allDay: boolean } {
  const trimmed = input.trim();
  if (DATE_ONLY.test(trimmed)) return { value: trimmed, allDay: true };

  const normalised = trimmed.replace(" ", "T");
  const dt = DateTime.fromISO(normalised, { zone: tz });
  if (!dt.isValid) throw new Error(`Unparseable date/time: "${input}" (${dt.invalidReason})`);
  return { value: dt.toISO({ suppressMilliseconds: true })!, allDay: false };
}

/** A JS Date (an absolute instant) → ISO with the offset that applied in `tz`. */
export function isoInZone(date: Date, tz: string = zone()): string {
  return DateTime.fromJSDate(date).setZone(tz).toISO({ suppressMilliseconds: true })!;
}

/** The local calendar date a stored value falls on. */
export function localDate(value: string, tz: string = zone()): string {
  if (DATE_ONLY.test(value)) return value;
  return DateTime.fromISO(value, { setZone: true }).setZone(tz).toISODate()!;
}

/** Sortable instant. All-day values sort at local midnight. */
export function toInstant(value: string, tz: string = zone()): number {
  if (DATE_ONLY.test(value)) {
    return DateTime.fromISO(value, { zone: tz }).toMillis();
  }
  return DateTime.fromISO(value, { setZone: true }).toMillis();
}

export function addDays(value: string, days: number, tz: string = zone()): string {
  if (DATE_ONLY.test(value)) {
    return DateTime.fromISO(value, { zone: tz }).plus({ days }).toISODate()!;
  }
  return DateTime.fromISO(value, { setZone: true })
    .plus({ days })
    .toISO({ suppressMilliseconds: true })!;
}

/** "Sat 4 Oct" / "Sat 4 Oct, 7:30pm" — the agenda's line format. */
export function formatEvent(value: string, allDay: boolean, tz: string = zone()): string {
  const dt = DATE_ONLY.test(value)
    ? DateTime.fromISO(value, { zone: tz })
    : DateTime.fromISO(value, { setZone: true }).setZone(tz);
  const day = dt.toFormat("ccc d LLL");
  if (allDay) return day;
  return `${day}, ${dt.toFormat("h:mma").toLowerCase()}`;
}

export function formatTimeOnly(value: string, tz: string = zone()): string {
  return DateTime.fromISO(value, { setZone: true })
    .setZone(tz)
    .toFormat("h:mma")
    .toLowerCase();
}

/**
 * The wall clock: "5:42:09 pm · Mon 7 Sep".
 *
 * Here rather than beside the component that ticks it, for the same reason as
 * untilLabel below — the server renders the first one so hydration has
 * something true to match, and a "use client" export cannot be called there.
 *
 * Always New York, and seconds included: this board hangs on a second monitor, and a clock
 * that only changes once a minute looks like a clock that has stopped.
 */
export function clockLabel(now: number = Date.now(), tz: string = zone()): string {
  const dt = DateTime.fromMillis(now, { zone: tz });
  return `${dt.toFormat("h:mm:ss a").toLowerCase()} · ${dt.toFormat("ccc d LLL")}`;
}

/**
 * How long until an instant, as a countdown. "2d 4h", "3h 12m", "14m 08s".
 *
 * Lives here rather than beside <Countdown> because BOTH sides need it: the
 * server renders the first label so hydration has something true to match, and
 * the client re-renders it every second afterwards. A function exported from a
 * "use client" module cannot be called on the server at all.
 *
 * Seconds only under an hour, where they are the difference between "soon" and
 * "now" — above that they are noise on a board.
 *
 * `now` defaults rather than being read at the call site, the same way
 * hasFinished does it: a server component may not call Date.now() during render
 * (react-hooks/purity), and pushing the clock into the helper is how the rest of
 * this file already answers that.
 */
export function untilLabel(start: string, now: number = Date.now()): string {
  const ms = Date.parse(start) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "kicking off";

  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
