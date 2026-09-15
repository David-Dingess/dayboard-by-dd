import { DateTime } from "luxon";
import type { DayboardEvent } from "./schema";
import { zone, toInstant, localDate } from "./time";

export function sortEvents(events: DayboardEvent[]): DayboardEvent[] {
  return [...events].sort((a, b) => {
    const byTime = toInstant(a.start) - toInstant(b.start);
    if (byTime) return byTime;
    // All-day events read first in a day, then timed ones, then alphabetically.
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

export interface DayGroup {
  date: string;
  events: DayboardEvent[];
}

/** Group into local days, keeping an all-day span visible on each day it covers. */
export function groupByDay(events: DayboardEvent[], maxSpanDays = 21): DayGroup[] {
  const days = new Map<string, DayboardEvent[]>();

  for (const event of events) {
    const first = localDate(event.start);
    const push = (date: string) => {
      const list = days.get(date);
      if (list) list.push(event);
      else days.set(date, [event]);
    };

    if (!event.allDay || !event.end) {
      push(first);
      continue;
    }
    // All-day DTEND is exclusive, so a one-day event ends on the next date.
    let cursor = DateTime.fromISO(first, { zone: zone() });
    const end = DateTime.fromISO(localDate(event.end), { zone: zone() });
    let guard = 0;
    while (cursor < end && guard++ < maxSpanDays) {
      push(cursor.toISODate()!);
      cursor = cursor.plus({ days: 1 });
    }
    if (guard === 0) push(first);
  }

  return [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({ date, events: sortEvents(list) }));
}

/**
 * The events an agenda anchored at `fromDate` should consider.
 *
 * THE TWO KINDS ARE FILTERED DIFFERENTLY, and that is the whole of this
 * function. An all-day event spans dates and its DTEND is exclusive, so it is
 * kept while its span overlaps the window. A TIMED event belongs to the day it
 * starts on — the same rule groupByDay uses to file it — so it is kept when that
 * day is in the window, and its end time is never consulted.
 *
 * Treating both the old way, as [start date, end date), silently dropped every
 * timed event that started and ended on the anchor day: its end collapsed to
 * that day's midnight, which is not AFTER the window's start, so a 4:30pm
 * session vanished from its own agenda. Health sessions are the ones that made
 * it visible — with no row there was no Start button — but it hid a fixture
 * kicking off tonight just as thoroughly.
 *
 * Comparing instants instead would fix that and introduce a stranger bug: a
 * game that started at 11:30pm yesterday and runs past midnight would be "in"
 * the window while groupByDay files it under yesterday, printing a Yesterday
 * heading above Today. One rule, used by both, or they disagree.
 */
export function inWindow(
  events: DayboardEvent[],
  fromDate: string,
  days: number,
): DayboardEvent[] {
  const from = DateTime.fromISO(fromDate, { zone: zone() }).startOf("day");
  const to = from.plus({ days });
  return events.filter((event) => {
    if (event.allDay) {
      const start = DateTime.fromISO(localDate(event.start), { zone: zone() });
      const end = event.end
        ? DateTime.fromISO(localDate(event.end), { zone: zone() })
        : start.plus({ days: 1 });
      return end > from && start < to;
    }
    const day = DateTime.fromISO(localDate(event.start), { zone: zone() });
    return day >= from && day < to;
  });
}

/**
 * Has this already finished? Used to hide the watch button on a played game —
 * the detail page still keeps the link for reference.
 */
export function hasFinished(event: DayboardEvent, now = DateTime.now().setZone(zone())): boolean {
  const end = event.end
    ? event.allDay
      ? DateTime.fromISO(event.end, { zone: zone() })
      : DateTime.fromISO(event.end, { setZone: true })
    : event.allDay
      ? DateTime.fromISO(event.start, { zone: zone() }).plus({ days: 1 })
      : DateTime.fromISO(event.start, { setZone: true }).plus({ hours: 3 });
  return end < now;
}

/**
 * Started, and not over yet.
 *
 * The other half of hasFinished, and deliberately built on it rather than
 * beside it: one place decides when a thing has ended, including the three-hour
 * guess for a timed event whose feed gave no DTEND. Fixtures nearly always carry
 * a real one — the NFL feed says three hours, the NBA two, a club feed an hour
 * forty-five — so the guess is a backstop rather than the rule.
 *
 * All-day events are excluded on purpose. A tournament runs Thursday to Sunday
 * and is "on" for four days; treating that as live would leave the Watch tab
 * shouting all weekend. Something with a kickoff is what this is for.
 */
export function liveNow(
  events: DayboardEvent[],
  now = DateTime.now().setZone(zone()),
): DayboardEvent[] {
  return sortEvents(
    events.filter((event) => {
      if (event.allDay || event.status === "cancelled") return false;
      const start = DateTime.fromISO(event.start, { setZone: true });
      if (!start.isValid || start > now) return false;
      return !hasFinished(event, now);
    }),
  );
}

export function relativeDay(date: string, today: string): string | null {
  const a = DateTime.fromISO(date, { zone: zone() });
  const b = DateTime.fromISO(today, { zone: zone() });
  const diff = Math.round(a.diff(b, "days").days);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return null;
}
