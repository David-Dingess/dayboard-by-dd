import { DateTime } from "luxon";
import { zone } from "../time";

/**
 * Every date key in the Health engine is a calendar day, "YYYY-MM-DD", in
 * America/New_York — the same clock the rest of the board keeps.
 *
 * the standalone app wrote these helpers on the local `Date` and warned, at length,
 * against `toISOString().slice(0, 10)`: in a negative UTC offset that reports
 * tomorrow for the last hours of the evening and silently corrupts streaks and
 * fired-notification markers. A desktop app only had one clock to worry about.
 * This one renders on a a remote host server in UTC and in a browser in New York, so
 * "local" would mean two different days. Pinning the zone here, in the one file
 * every other engine file imports, is what lets the engine be copied unchanged
 * and still agree with itself across the wire.
 *
 * The export list is the original's, exactly, so session.ts and progress.ts
 * did not need a line changed. Labels use a fixed en-US locale for the same
 * reason the zone is fixed: a server and a browser with different locales
 * would hydrate to different strings.
 */

export type DateKey = string;

const pad = (n: number) => String(n).padStart(2, "0");

const inNY = (d: Date) => DateTime.fromJSDate(d).setZone(zone());
/** A key as a DateTime at NY midnight. */
const at = (key: DateKey) => DateTime.fromISO(key, { zone: zone() });

export function toKey(d: Date): DateKey {
  return inNY(d).toISODate()!;
}

export function todayKey(now: Date = new Date()): DateKey {
  return toKey(now);
}

/** Parses "YYYY-MM-DD" into the instant of NY midnight on that day. */
export function fromKey(key: DateKey): Date {
  return at(key).toJSDate();
}

export function addDays(key: DateKey, days: number): DateKey {
  return at(key).plus({ days }).toISODate()!;
}

/** Whole calendar days from `from` to `to`; negative if `to` is earlier. DST-safe. */
export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.round(at(to).diff(at(from), "days").days);
}

/** 0 = Sunday … 6 = Saturday, matching Date#getDay. (Luxon counts 1 = Monday … 7 = Sunday.) */
export function dayOfWeek(key: DateKey): number {
  return at(key).weekday % 7;
}

/** Minutes since midnight for an "HH:mm" string. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes since NY midnight, right now. */
export function nowMinutes(now: Date = new Date()): number {
  const t = inNY(now);
  return t.hour * 60 + t.minute;
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad(m)}${suffix}`;
}

/**
 * Quiet hours wrap midnight (e.g. 21:00 → 07:00), so this is an OR across the
 * wrap rather than a simple range test.
 */
export function inQuietHours(start: string, end: string, now: Date = new Date()): boolean {
  const cur = nowMinutes(now);
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** "Sunday, September 6" */
export function formatDayLabel(key: DateKey): string {
  return at(key).setLocale("en-US").toFormat("cccc, LLLL d");
}

/** "Sun" */
export function formatShortDay(key: DateKey): string {
  return at(key).setLocale("en-US").toFormat("ccc");
}

/** `month` is zero-based, as the original (and Date) had it. "September 2026" */
export function monthLabel(year: number, month: number): string {
  return DateTime.fromObject({ year, month: month + 1, day: 1 }, { zone: zone() })
    .setLocale("en-US")
    .toFormat("LLLL yyyy");
}

/** Monday-start week containing `key`. */
export function startOfWeek(key: DateKey): DateKey {
  const dow = dayOfWeek(key);
  return addDays(key, dow === 0 ? -6 : 1 - dow);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${pad(s % 60)}`;
}
