import { addDays, daysBetween, startOfWeek } from "./dates";
import type { DayRecord, DifficultyAdjustment, WalkEntry } from "./store-types";
import { LADDERS, ladderLength } from "./ladders";
import { getSessionForDate, type SessionContext } from "./session";
import type { PatternId, Session } from "./types";

/** Completed sessions at one rung before the ladder advances on its own. */
export const AUTO_PROGRESS_SESSIONS = 8;

export interface HistoryInput {
  days: Record<string, DayRecord>;
  walks: WalkEntry[];
}

function hasWalk(walks: WalkEntry[], date: string): boolean {
  return walks.some((w) => w.date === date);
}

/**
 * Did this day count toward the streak?
 *  - "yes"     — something was logged
 *  - "no"      — something was scheduled and nothing happened
 *  - "neutral" — a scheduled rest day, or a day before the program began
 */
export function dayOutcome(
  ctx: SessionContext,
  history: HistoryInput,
  date: string,
): "yes" | "no" | "neutral" {
  const record = history.days[date];
  if (record && record.status !== "skipped") return "yes";
  if (hasWalk(history.walks, date)) return "yes";
  if (daysBetween(ctx.programStartDate, date) < 0) return "neutral";
  const session = getSessionForDate(ctx, date);
  if (session.kind === "rest") return "neutral";
  return "no";
}

/**
 * Consecutive active days, forgiving a single gap.
 *
 * Missing one day has no measurable effect on habit formation; missing two in a
 * row does. So one miss is absorbed silently and two ends the run — the streak
 * reflects the thing that actually matters instead of punishing a busy Tuesday.
 * Today is never counted as a miss, because today is not over.
 */
export function computeStreak(
  ctx: SessionContext,
  history: HistoryInput,
  today: string,
): { current: number; forgivenGap: boolean } {
  let cursor = today;
  let streak = 0;
  let misses = 0;
  let forgivenGap = false;

  if (dayOutcome(ctx, history, today) !== "yes") {
    cursor = addDays(today, -1);
  }

  for (let i = 0; i < 400; i++) {
    if (daysBetween(ctx.programStartDate, cursor) < 0) break;
    const outcome = dayOutcome(ctx, history, cursor);
    if (outcome === "yes") {
      streak += 1;
      misses = 0;
    } else if (outcome === "no") {
      misses += 1;
      if (misses >= 2) break;
      forgivenGap = true;
    }
    cursor = addDays(cursor, -1);
  }

  return { current: streak, forgivenGap };
}

/** Share of scheduled sessions actually done over the trailing window. */
export function computeAdherence(
  ctx: SessionContext,
  history: HistoryInput,
  today: string,
  windowDays = 28,
): { done: number; scheduled: number; pct: number } {
  let done = 0;
  let scheduled = 0;

  for (let i = 1; i <= windowDays; i++) {
    const date = addDays(today, -i);
    if (daysBetween(ctx.programStartDate, date) < 0) continue;
    const outcome = dayOutcome(ctx, history, date);
    if (outcome === "neutral") continue;
    scheduled += 1;
    if (outcome === "yes") done += 1;
  }

  return { done, scheduled, pct: scheduled === 0 ? 0 : Math.round((done / scheduled) * 100) };
}

export function minutesOnDate(history: HistoryInput, date: string): number {
  const record = history.days[date];
  const sessionMin = record && record.status !== "skipped" ? record.durationSec / 60 : 0;
  const walkMin = history.walks
    .filter((w) => w.date === date)
    .reduce((sum, w) => sum + w.durationMin, 0);
  return Math.round(sessionMin + walkMin);
}

/** Actual active minutes in the Monday-start week containing `date`. */
export function weeklyMinutes(history: HistoryInput, date: string): number {
  const start = startOfWeek(date);
  let total = 0;
  for (let i = 0; i < 7; i++) {
    total += minutesOnDate(history, addDays(start, i));
  }
  return total;
}

/** Trailing-7-day active minutes, which is what the guideline band is about. */
export function trailingWeekMinutes(history: HistoryInput, today: string): number {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    total += minutesOnDate(history, addDays(today, -i));
  }
  return total;
}

export function patternsInSession(session: Session): PatternId[] {
  const seen = new Set<PatternId>();
  for (const block of session.blocks) {
    if (block.kind === "warmup" || block.kind === "cooldown") continue;
    for (const station of block.stations) seen.add(station.patternId);
  }
  return [...seen];
}

function lastAdjustmentDate(adjustments: DifficultyAdjustment[], patternId: string): string | null {
  const relevant = adjustments.filter((a) => a.patternId === patternId);
  if (relevant.length === 0) return null;
  return relevant.reduce((latest, a) => (a.date > latest ? a.date : latest), relevant[0].date);
}

export interface ProgressionInput {
  date: string;
  record: DayRecord;
  levels: Record<string, number>;
  days: Record<string, DayRecord>;
  adjustments: DifficultyAdjustment[];
}

/**
 * Decides how the ladders move after a session is logged.
 *
 * Explicit feedback wins immediately and moves every pattern in the session.
 * Otherwise a pattern climbs on its own once it has been completed
 * AUTO_PROGRESS_SESSIONS times at its current rung, which is what keeps the
 * program progressing for someone who never presses the feedback buttons.
 *
 * Note this returns the *stored* level. The phase cap in `effectiveRung` is what
 * actually decides what you see, so a stored level can run ahead and simply
 * unlock at the next phase.
 */
export function evaluateProgression(input: ProgressionInput): DifficultyAdjustment[] {
  const { date, record, levels, days, adjustments } = input;
  const out: DifficultyAdjustment[] = [];
  const trained = [...new Set(record.exercises.map((e) => e.patternId))].filter(
    (p): p is PatternId => p in LADDERS,
  );

  for (const patternId of trained) {
    const from = levels[patternId] ?? 0;
    const max = ladderLength(patternId) - 1;

    if (record.feedback === "too_hard") {
      const to = Math.max(0, from - 1);
      if (to !== from) {
        out.push({ id: `${date}-${patternId}-down`, date, patternId, fromRung: from, toRung: to, reason: "too_hard" });
      }
      continue;
    }

    if (record.feedback === "too_easy") {
      const to = Math.min(max, from + 1);
      if (to !== from) {
        out.push({ id: `${date}-${patternId}-up`, date, patternId, fromRung: from, toRung: to, reason: "too_easy" });
      }
      continue;
    }

    if (record.status !== "completed" || from >= max) continue;

    const since = lastAdjustmentDate(adjustments, patternId);
    const atRung = Object.values(days).filter((d) => {
      if (d.status !== "completed") return false;
      if (since && d.date <= since) return false;
      return d.exercises.some((e) => e.patternId === patternId && e.rungIndex === from && !e.skipped);
    }).length;

    if (atRung >= AUTO_PROGRESS_SESSIONS) {
      out.push({
        id: `${date}-${patternId}-auto`,
        date,
        patternId,
        fromRung: from,
        toRung: from + 1,
        reason: "auto_progress",
      });
    }
  }

  return out;
}

export function applyAdjustments(
  levels: Record<string, number>,
  adjustments: DifficultyAdjustment[],
): Record<string, number> {
  const next = { ...levels };
  for (const a of adjustments) next[a.patternId] = a.toRung;
  return next;
}
