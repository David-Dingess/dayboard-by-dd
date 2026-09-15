import { DateTime } from "luxon";
import type { DayboardEvent } from "./schema";
import { zone, localDate } from "./time";

/** Layout maths for the hourly week grid. */

export interface Placed {
  event: DayboardEvent;
  /** minutes from midnight */
  startMin: number;
  endMin: number;
  /** which of `lanes` this event sits in, for side-by-side overlaps */
  lane: number;
  lanes: number;
}

const MIN_BLOCK = 30;

function minutesInto(value: string): number {
  const dt = DateTime.fromISO(value, { setZone: true }).setZone(zone());
  return dt.hour * 60 + dt.minute;
}

/**
 * Pack a day's timed events into lanes so overlapping ones sit side by side
 * rather than on top of each other — the thing that makes a week grid readable.
 * Events are grouped into clusters of mutual overlap; every event in a cluster
 * shares that cluster's lane count, so columns line up.
 */
export function placeDay(events: DayboardEvent[]): Placed[] {
  const timed = events
    .filter((e) => !e.allDay)
    .map((event) => {
      const startMin = minutesInto(event.start);
      const rawEnd = event.end ? minutesInto(event.end) : startMin + 60;
      // An event ending past midnight, or a zero-length one, still needs a block
      // tall enough to read.
      const endMin = Math.max(rawEnd > startMin ? rawEnd : startMin + 60, startMin + MIN_BLOCK);
      return { event, startMin, endMin: Math.min(endMin, 24 * 60) };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const out: Placed[] = [];
  let cluster: typeof timed = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endMin);
      } else {
        laneEnds[lane] = item.endMin;
      }
      return { ...item, lane };
    });
    for (const item of assigned) out.push({ ...item, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of timed) {
    if (cluster.length && item.startMin >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();

  return out;
}

/** The hour range worth rendering: a sensible default, widened to fit real events. */
export function hourRange(placed: Placed[][], defaultFrom = 7, defaultTo = 23): [number, number] {
  let from = defaultFrom;
  let to = defaultTo;
  for (const day of placed) {
    for (const item of day) {
      from = Math.min(from, Math.floor(item.startMin / 60));
      to = Math.max(to, Math.ceil(item.endMin / 60));
    }
  }
  return [Math.max(0, from), Math.min(24, Math.max(to, from + 1))];
}

export function weekStart(date: string): string {
  // Weeks run Sunday to Saturday, the way a second monitor calendar and iOS both do it.
  const dt = DateTime.fromISO(date, { zone: zone() });
  return dt.minus({ days: dt.weekday % 7 }).toISODate()!;
}

export function weekDays(start: string): string[] {
  const first = DateTime.fromISO(start, { zone: zone() });
  return Array.from({ length: 7 }, (_, i) => first.plus({ days: i }).toISODate()!);
}

/** Every date a (possibly multi-day) event covers, clamped to a span. */
export function datesCovered(event: DayboardEvent, maxDays = 60): string[] {
  const first = localDate(event.start);
  if (!event.allDay || !event.end) return [first];
  const out: string[] = [];
  let cursor = DateTime.fromISO(first, { zone: zone() });
  const end = DateTime.fromISO(localDate(event.end), { zone: zone() });
  let guard = 0;
  while (cursor < end && guard++ < maxDays) {
    out.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return out.length ? out : [first];
}

/** The 6x7 grid a month view draws, including the leading/trailing days. */
export function monthGrid(ym: string): { days: string[]; month: number; year: number } {
  const first = DateTime.fromISO(`${ym}-01`, { zone: zone() });
  const start = first.minus({ days: first.weekday % 7 });
  return {
    days: Array.from({ length: 42 }, (_, i) => start.plus({ days: i }).toISODate()!),
    month: first.month,
    year: first.year,
  };
}
