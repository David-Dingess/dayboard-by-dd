import { readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic";
import { WaterFileSchema, type WaterFile } from "./schema";
import { zone } from "./time";
import { DateTime } from "luxon";

/**
 * The water log: `data/water.json`, the fifth file the board writes itself.
 *
 * Same shape as todos, health and notes — a pure half with no `next/*` imports,
 * an uncached read, an atomic write, and `scripts/water.ts` on this exact code
 * path so the CLI and the buttons cannot disagree.
 *
 * ONE NUMBER A DAY, not a list of drinks. A timestamped log would let the widget
 * draw when you drank, which is a question nobody asks; "have I had enough today"
 * is the only one, and "that was a mistake" is answered by subtracting.
 */

const FILE = path.join(process.cwd(), "data", "water.json");

export const emptyWater = (): WaterFile => WaterFileSchema.parse({});

/* ---------------------------------------------------------------- pure ---- */

/**
 * Add (or, with a negative number, take back) ounces on a date.
 *
 * Clamped at zero rather than allowed to go negative: an undo pressed twice is
 * a slip, and a day that owes water is not a state worth representing.
 */
export function applyDrink(file: WaterFile, date: string, ounces: number): WaterFile {
  const next = Math.max(0, (file.days[date] ?? 0) + ounces);
  const days = { ...file.days };
  if (next === 0) delete days[date];
  else days[date] = next;
  return { ...file, days };
}

export function applyGoal(file: WaterFile, goalOz: number): WaterFile {
  return { ...file, goalOz };
}

export interface WaterDay {
  date: string;
  /** Sun, Mon… — for the week strip. */
  short: string;
  ounces: number;
  met: boolean;
  isToday: boolean;
}

export interface WaterSnapshot {
  today: string;
  ounces: number;
  goalOz: number;
  /** 0–1, capped: the bottle cannot fill past its own top. */
  fill: number;
  /** Consecutive days ending today that met the goal. */
  streak: number;
  week: WaterDay[];
  /** What you should have drunk by now to be on for the goal. */
  expectedOz: number;
  /**
   * How far behind, as a share of the day's goal. 0 while on pace or ahead.
   * The widget turns this into how hard it glows.
   */
  behind: number;
}

/**
 * The drinking day: 8am to 10pm.
 *
 * Pace is measured against these fourteen hours rather than the twenty-four,
 * because nobody is expected to have had a fifth of their water by 4am. Before
 * 8am nothing is owed; after 10pm the whole goal is.
 */
const DAY_STARTS = 8;
const DAY_ENDS = 22;

/**
 * How much of the goal should be gone by a given hour.
 *
 * Linear across the waking day, which is not how anyone actually drinks — but a
 * curve would be a guess dressed up as a model, and the number only has to be
 * right enough to answer "am I behind".
 */
export function expectedBy(goalOz: number, now: DateTime): number {
  const hour = now.hour + now.minute / 60;
  if (hour <= DAY_STARTS) return 0;
  if (hour >= DAY_ENDS) return goalOz;
  return Math.round((goalOz * (hour - DAY_STARTS)) / (DAY_ENDS - DAY_STARTS));
}

/**
 * Everything the widget draws, computed on the server so the client holds no
 * arithmetic and nothing has to be recomputed on a refresh tick.
 *
 * THE STREAK DOES NOT COUNT TODAY UNTIL TODAY IS DONE. Counting a day in
 * progress would show a 5 that silently becomes a 4 at midnight, which is the
 * one thing a streak must never do. Today extends it the moment the goal is met
 * and not before.
 */
export function buildWaterSnapshot(
  file: WaterFile,
  today: string,
  now: DateTime = DateTime.now().setZone(zone()),
): WaterSnapshot {
  const ounces = file.days[today] ?? 0;
  const goalOz = file.goalOz;

  let streak = 0;
  let cursor = DateTime.fromISO(today, { zone: zone() });
  // Walk backwards while each day met the goal. Today is only counted once it
  // has, so an unfinished day neither breaks the streak nor inflates it.
  if ((file.days[today] ?? 0) < goalOz) cursor = cursor.minus({ days: 1 });
  for (let guard = 0; guard < 400; guard++) {
    const key = cursor.toISODate()!;
    if ((file.days[key] ?? 0) < goalOz) break;
    streak++;
    cursor = cursor.minus({ days: 1 });
  }

  // THE CALENDAR WEEK, Sunday to Saturday — not the last seven days. A rolling
  // window put today on the right-hand end and Sunday somewhere in the middle,
  // which reads as a bug next to a week grid and a month view that both start on
  // Sunday. `weekday % 7` is the same Sunday-first arithmetic lib/grid.ts uses.
  const anchor = DateTime.fromISO(today, { zone: zone() });
  const start = anchor.minus({ days: anchor.weekday % 7 });
  const week: WaterDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = start.plus({ days: i });
    const key = day.toISODate()!;
    const had = file.days[key] ?? 0;
    return {
      date: key,
      short: day.toFormat("ccc").slice(0, 1),
      ounces: had,
      met: had >= goalOz,
      isToday: key === today,
    };
  });

  const expectedOz = expectedBy(goalOz, now);
  // Only ever behind, never "ahead": being up on the day is not a state that
  // needs drawing, and a bottle that congratulated you would be one more thing
  // moving on a board that is mostly still.
  const behind = goalOz > 0 ? Math.max(0, (expectedOz - ounces) / goalOz) : 0;

  return {
    today,
    ounces,
    goalOz,
    fill: goalOz > 0 ? Math.min(1, ounces / goalOz) : 0,
    streak,
    week,
    expectedOz,
    behind,
  };
}

/* ------------------------------------------------------------------ fs ---- */

export function loadWater(): WaterFile {
  try {
    return WaterFileSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyWater();
    console.error(`dayboard: water unreadable — ${(err as Error).message.split("\n")[0]}`);
    return emptyWater();
  }
}

export function saveWater(next: WaterFile): void {
  writeJsonAtomic(FILE, JSON.stringify(WaterFileSchema.parse(next), null, 2) + "\n");
}
