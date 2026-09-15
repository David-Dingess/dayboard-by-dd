import { DateTime } from "luxon";
import type { DayboardEvent } from "./schema";
import { relativeDay } from "./events";
import { formatTimeOnly, localDate, zone, toInstant } from "./time";

/**
 * How a fixture reads in a small space: who the other side is, and when.
 *
 * THE SAME RULES AS THE SCORES GRID in LiveScoresWidget, which has its own copy
 * of these for now — that file had uncommitted work in it when the Sports tab
 * was built, and lifting its functions out from under that would have been
 * editing someone else's change. Folding it onto these is a two-line follow-up.
 */

const SIDES = /\s+(?:vs\.?|v\.?|@|at|[-–—])\s+/i;

/**
 * "vs Orlando City SC", "at Manchester United" — the half of the title your team is
 * not. The team NAME picks out which side is your; exactly one side has to match,
 * or the whole title comes back untouched.
 */
export function opponent(title: string, teamName: string | undefined): string {
  if (!teamName) return title;
  const parts = title.split(SIDES);
  if (parts.length !== 2) return title;
  const needle = teamName.toLowerCase();
  const mine = parts.map((p) => p.toLowerCase().includes(needle));
  if (mine[0] === mine[1]) return title;
  return mine[0] ? `vs ${parts[1]}` : `at ${parts[0]}`;
}

const shortDay = (date: string, today: string) =>
  relativeDay(date, today) ?? DateTime.fromISO(date, { zone: zone() }).toFormat("ccc d LLL");

/** "Today · 7:30pm", "Wed 9 Sep · 7:30pm"; a multi-day event by the days it spans. */
export function whenLabel(event: DayboardEvent, today: string): string {
  const first = localDate(event.start);

  if (event.allDay) {
    const last = event.end
      ? DateTime.fromISO(localDate(event.end), { zone: zone() }).minus({ days: 1 }).toISODate()!
      : first;
    if (last > first) return `${shortDay(first, today)} – ${shortDay(last, today)}`;
    return shortDay(first, today);
  }

  const day =
    relativeDay(first, today) ??
    DateTime.fromISO(event.start, { setZone: true }).setZone(zone()).toFormat("ccc d LLL");
  return `${day} · ${formatTimeOnly(event.start)}`;
}

/**
 * Order tiles by how soon their game is: anything on right now first, then
 * soonest start, then tiles with nothing scheduled. Ties keep their original
 * order, so two sides kicking off together stay in layer order.
 */
export function nearestFirst<T>(
  items: T[],
  when: (item: T) => { live: boolean; start: number } | null,
): T[] {
  return items
    .map((item, index) => ({ item, index, at: when(item) }))
    .sort((a, b) => {
      if (!a.at || !b.at) return a.at ? -1 : b.at ? 1 : a.index - b.index;
      if (a.at.live !== b.at.live) return a.at.live ? -1 : 1;
      return a.at.start - b.at.start || a.index - b.index;
    })
    .map(({ item }) => item);
}

/** How long a game has been running. */
export function elapsed(event: DayboardEvent, now: number): string {
  const minutes = Math.max(0, Math.round((now - toInstant(event.start)) / 60_000));
  return minutes < 60 ? `${minutes}m in` : `${Math.floor(minutes / 60)}h ${minutes % 60}m in`;
}
