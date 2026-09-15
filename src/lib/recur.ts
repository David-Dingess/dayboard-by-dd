import { DateTime } from "luxon";
import type { DayboardEvent, Recurrence } from "./schema";
import { zone } from "./time";

/**
 * Repeating events, expanded into the ones you can actually see.
 *
 * WHY THIS EXISTS AT ALL. `recurrence` has been in the schema since the
 * birthdays arrived, and until now exactly one thing read it: the ICS writer,
 * which turned it into an RRULE and let the phone do the work. The board itself
 * expanded nothing — so the 62 birthdays are stored dated 2026, and on
 * 2027-01-01 every one of them would have quietly vanished from the board while
 * still repeating perfectly on your phone. That asymmetry is the bug this
 * fixes, and it arrived early because an event editor that offers "every week"
 * has to show you next week.
 *
 * LUXON RATHER THAN ical.js, though ical.js is already a dependency and has a
 * rule iterator. The iterator works in floating time and hands back its own date
 * objects, which would mean converting in and out of a second date library on
 * every occurrence, in a repo where every other date decision is luxon in
 * America/New_York. Adding `{ weeks: 1 }` to a zoned DateTime keeps the board
 * time across a DST boundary, which is the only hard part of this, and luxon
 * does it for free.
 *
 * SHORT MONTHS AND FEBRUARY 29 ARE SKIPPED, NOT CLAMPED. Luxon reads
 * "31 January plus one month" as 28 February; RFC 5545 says a monthly rule on
 * the 31st simply does not occur in a month without one. Clamping would invent
 * an event on a day you never picked and then move it back the following
 * month, so an occurrence whose day-of-month drifted is dropped instead.
 *
 * IDS: the master keeps its own bare id for its own date, and every other
 * occurrence is `${id}@${date}`. That is what keeps iOS calm — a birthday's
 * VEVENT UID never changes — and it is what lets the event page and the editor
 * find their way back to the series with masterId().
 */

/** How far a single series may be expanded, whatever the window asks for. */
const MAX_OCCURRENCES = 400;

export function masterId(id: string): string {
  const at = id.indexOf("@");
  return at === -1 ? id : id.slice(0, at);
}

export function isInstance(id: string): boolean {
  return id.includes("@");
}

const WEEKDAY: Record<string, number> = { SU: 7, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** The next candidate after `from`, by frequency. Weekly-with-byDay is handled apart. */
function step(start: DateTime, rule: Recurrence, n: number): DateTime {
  const by = rule.interval * n;
  switch (rule.freq) {
    case "DAILY":
      return start.plus({ days: by });
    case "WEEKLY":
      return start.plus({ weeks: by });
    case "MONTHLY":
      return start.plus({ months: by });
    case "YEARLY":
      return start.plus({ years: by });
  }
}

/** Did luxon move the date to make it exist? Then this occurrence does not. */
function drifted(candidate: DateTime, start: DateTime, freq: Recurrence["freq"]): boolean {
  if (freq === "MONTHLY") return candidate.day !== start.day;
  if (freq === "YEARLY") return candidate.day !== start.day || candidate.month !== start.month;
  return false;
}

/**
 * Every date a rule lands on, in order, as ISO dates in New York.
 *
 * Pure and separate from the event-building below so the rule arithmetic can be
 * tested without constructing events around it.
 */
export function occurrences(
  startISO: string,
  allDay: boolean,
  rule: Recurrence,
  fromDate: string,
  toDate: string,
  max = MAX_OCCURRENCES,
): DateTime[] {
  const start = allDay
    ? DateTime.fromISO(startISO, { zone: zone() })
    : DateTime.fromISO(startISO, { setZone: true }).setZone(zone());
  if (!start.isValid) return [];

  const from = DateTime.fromISO(fromDate, { zone: zone() }).startOf("day");
  const to = DateTime.fromISO(toDate, { zone: zone() }).endOf("day");
  const until = rule.until ? DateTime.fromISO(rule.until, { zone: zone() }).endOf("day") : null;

  const out: DateTime[] = [];
  let taken = 0; // counts against rule.count, which includes occurrences before the window
  let guard = 0;

  const consider = (dt: DateTime): "stop" | "next" => {
    if (until && dt > until) return "stop";
    taken++;
    if (rule.count && taken > rule.count) return "stop";
    if (dt > to) return "stop";
    if (dt >= from) out.push(dt);
    return "next";
  };

  // WEEKLY with named days walks week blocks and emits each named day inside
  // one, which is the only shape where a period holds more than one occurrence.
  if (rule.freq === "WEEKLY" && rule.byDay?.length) {
    const days = [...new Set(rule.byDay.map((d) => WEEKDAY[d]))].sort((a, b) => a - b);
    // Sunday-first weeks, to match how this board draws one everywhere else.
    const weekStart = start.minus({ days: start.weekday % 7 }).startOf("day");
    for (let block = 0; guard++ < max * 8 && out.length < max; block++) {
      const base = weekStart.plus({ weeks: rule.interval * block });
      let stopped = false;
      for (const weekday of days) {
        const day = base.plus({ days: weekday % 7 });
        // A rule never fires before the event it belongs to.
        if (day < start.startOf("day")) continue;
        const dt = day.set({ hour: start.hour, minute: start.minute, second: 0, millisecond: 0 });
        if (consider(dt) === "stop") {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
      if (base > to) break;
    }
    return out.slice(0, max);
  }

  for (let n = 0; guard++ < max * 8 && out.length < max; n++) {
    const candidate = step(start, rule, n);
    if (drifted(candidate, start, rule.freq)) {
      // Skipped, and deliberately not counted against `count`: RFC 5545 counts
      // occurrences, and a month with no 31st produced none.
      if (candidate > to) break;
      continue;
    }
    if (consider(candidate) === "stop") break;
  }

  return out.slice(0, max);
}

/**
 * A repeating event as the list of events it stands for, within a window.
 *
 * The master's own occurrence keeps the master's id and its `recurrence`; every
 * other one is a plain event with an `@date` id and no rule of its own, so
 * nothing downstream can expand an expansion.
 */
export function expandRecurrence(
  master: DayboardEvent,
  fromDate: string,
  toDate: string,
  max = MAX_OCCURRENCES,
): DayboardEvent[] {
  if (!master.recurrence) return [master];

  const dates = occurrences(master.start, master.allDay, master.recurrence, fromDate, toDate, max);
  if (!dates.length) return [];

  const start = master.allDay
    ? DateTime.fromISO(master.start, { zone: zone() })
    : DateTime.fromISO(master.start, { setZone: true }).setZone(zone());
  // Held as a duration rather than an offset so a session that spans a clock
  // change stays the length it was set to.
  const end = master.end
    ? master.allDay
      ? DateTime.fromISO(master.end, { zone: zone() })
      : DateTime.fromISO(master.end, { setZone: true }).setZone(zone())
    : null;
  const length = end ? end.diff(start) : null;

  return dates.map((dt) => {
    const date = dt.toISODate()!;
    const isMaster = date === start.toISODate();
    const finish = length ? dt.plus(length) : null;

    return {
      ...master,
      id: isMaster ? master.id : `${master.id}@${date}`,
      start: master.allDay ? date : dt.toISO({ suppressMilliseconds: true })!,
      end: finish
        ? master.allDay
          ? finish.toISODate()!
          : finish.toISO({ suppressMilliseconds: true })!
        : master.end,
      // Only the master carries the rule. An instance that kept it would be
      // expanded again by anything that ran this twice.
      recurrence: isMaster ? master.recurrence : undefined,
    };
  });
}

/**
 * Every event, with the repeating ones expanded across a window around today.
 *
 * The window is what keeps this bounded: a daily rule with no UNTIL is a real
 * thing to write down and an infinite list to render.
 */
export function expandAll(
  events: DayboardEvent[],
  today: string,
  pastDays = 30,
  futureDays = 400,
): DayboardEvent[] {
  const from = DateTime.fromISO(today, { zone: zone() }).minus({ days: pastDays }).toISODate()!;
  const to = DateTime.fromISO(today, { zone: zone() }).plus({ days: futureDays }).toISODate()!;

  const out: DayboardEvent[] = [];
  for (const event of events) {
    if (!event.recurrence) out.push(event);
    else out.push(...expandRecurrence(event, from, to));
  }
  return out;
}
