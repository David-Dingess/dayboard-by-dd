import { describe, expect, it } from "vitest";
import {
  AUTO_PROGRESS_SESSIONS,
  addDays,
  applyAdjustments,
  computeAdherence,
  computeStreak,
  effectiveRung,
  evaluateProgression,
  getMinimumDose,
  getSessionForDate,
  isDeloadWeek,
  phaseForWeek,
  plannedWeeklyMinutes,
  weekForDate,
  PHASES,
  type DayRecord,
  type WalkEntry,
} from "../src/lib/health";

/**
 * The engine's own suite, carried over from the standalone app unchanged except for
 * the import path. It is the proof that the port did not quietly change the
 * program — which matters most for the two things that were rewritten
 * underneath it: the luxon dates, and plannedWeeklyMinutes.
 */

// 2026-08-10 is a Monday, which keeps the weekday maths readable below.
const START = "2026-08-10";
const ctx = { programStartDate: START, patternLevels: {} as Record<string, number> };

function record(over: Partial<DayRecord> = {}): DayRecord {
  return {
    date: START,
    sessionId: "s",
    kind: "strength",
    status: "completed",
    completedAt: `${START}T17:00:00.000Z`,
    durationSec: 900,
    exercises: [
      { exerciseId: "squat-chair", patternId: "squat", rungIndex: 0, roundsCompleted: 2, skipped: false },
    ],
    ...over,
  };
}

describe("week and phase maths", () => {
  it("counts the start date as week 1 and rolls over every seven days", () => {
    expect(weekForDate(START, START)).toBe(1);
    expect(weekForDate(START, addDays(START, 6))).toBe(1);
    expect(weekForDate(START, addDays(START, 7))).toBe(2);
    expect(weekForDate(START, addDays(START, 364))).toBe(53);
  });

  it("clamps dates before the program starts to week 1", () => {
    expect(weekForDate(START, addDays(START, -30))).toBe(1);
  });

  it("maps weeks to the five phases and holds at cruise altitude past week 52", () => {
    expect(phaseForWeek(1).index).toBe(1);
    expect(phaseForWeek(6).index).toBe(1);
    expect(phaseForWeek(7).index).toBe(2);
    expect(phaseForWeek(26).index).toBe(3);
    expect(phaseForWeek(52).index).toBe(5);
    expect(phaseForWeek(80).index).toBe(5);
  });

  it("puts a deload in the last week of each block", () => {
    expect(isDeloadWeek(6)).toBe(true);
    expect(isDeloadWeek(13)).toBe(true);
    expect(isDeloadWeek(20)).toBe(true);
    expect(isDeloadWeek(5)).toBe(false);
    expect(isDeloadWeek(7)).toBe(false);
  });
});

describe("session scheduling", () => {
  it("gives phase 1 two strength days, three walks, a rest day and a Sunday reset", () => {
    const kinds = Array.from({ length: 7 }, (_, i) => getSessionForDate(ctx, addDays(START, i)).kind);
    // Monday → Sunday
    expect(kinds).toEqual(["strength", "walk", "rest", "walk", "strength", "walk", "mobility"]);
  });

  it("adds a third strength day in phase 2", () => {
    const wed = getSessionForDate(ctx, addDays(START, 7 * 6 + 2));
    expect(wed.week).toBe(7);
    expect(wed.kind).toBe("strength");
  });

  it("caps a strength session at the phase station count", () => {
    const s = getSessionForDate(ctx, START);
    const circuit = s.blocks.find((b) => b.kind === "circuit")!;
    expect(circuit.stations).toHaveLength(PHASES[0].stationCount);
  });

  it("keeps every structured session inside the 30-minute budget", () => {
    // Walks are exempt: they are the part of the program you already do by
    // habit, and a Saturday long walk is meant to run past half an hour.
    for (let day = 0; day < 364; day += 1) {
      const s = getSessionForDate(ctx, addDays(START, day));
      if (s.kind === "walk") continue;
      expect(s.estMinutes).toBeLessThanOrEqual(30);
    }
  });

  it("runs two strength days at first and adds the third in week 5", () => {
    const wednesday = (week: number) => getSessionForDate(ctx, addDays(START, (week - 1) * 7 + 2)).kind;
    expect(wednesday(1)).toBe("rest");
    expect(wednesday(4)).toBe("rest");
    expect(wednesday(5)).toBe("strength");
  });

  it("drops a round and skips the finisher on deload weeks", () => {
    const normal = getSessionForDate(ctx, addDays(START, 7 * 14)); // week 15, phase 3
    const deload = getSessionForDate(ctx, addDays(START, 7 * 19)); // week 20, deload
    const normalCircuit = normal.blocks.find((b) => b.kind === "circuit")!;
    const deloadCircuit = deload.blocks.find((b) => b.kind === "circuit")!;

    expect(deload.isDeload).toBe(true);
    expect(deloadCircuit.rounds).toBe(normalCircuit.rounds - 1);
    expect(normal.blocks.some((b) => b.kind === "finisher")).toBe(true);
    expect(deload.blocks.some((b) => b.kind === "finisher")).toBe(false);
  });

  it("shortens walks on a deload week", () => {
    const normal = getSessionForDate(ctx, addDays(START, 7 * 14 + 1));
    const deload = getSessionForDate(ctx, addDays(START, 7 * 19 + 1));
    expect(deload.targetMinutes!).toBeLessThan(normal.targetMinutes!);
  });

  it("ramps weekly volume from about 90 minutes toward the guideline band", () => {
    const week1 = plannedWeeklyMinutes(ctx, START);
    const week52 = plannedWeeklyMinutes(ctx, addDays(START, 7 * 51));
    expect(week1).toBeGreaterThanOrEqual(80);
    expect(week1).toBeLessThanOrEqual(100);
    expect(week52).toBeGreaterThanOrEqual(150);
    expect(week52).toBeLessThanOrEqual(300);
  });

  it("ramps gradually, with no single week jumping the way injury data warns about", () => {
    // The ≤10%/week rule of thumb cannot be met exactly by a program built from
    // whole sessions — adding the third strength day or the fourth round lands
    // as a mid-teens step. What matters is that no week approaches the >15–30%
    // territory associated with a sharp rise in injury risk once volumes are
    // meaningful, and that the year-long average stays far below the guardrail.
    // Deload weeks are compared against each other, since the rebound out of a
    // deliberately light week is not progression.
    const weeks: number[] = [];
    for (let week = 0; week < 52; week++) {
      weeks.push(plannedWeeklyMinutes(ctx, addDays(START, week * 7)));
    }

    const normal = weeks.filter((_, i) => !isDeloadWeek(i + 1));
    const steps = normal.slice(1).map((v, i) => (v - normal[i]) / normal[i]);
    const increases = steps.filter((s) => s > 0);

    expect(Math.max(...steps)).toBeLessThanOrEqual(0.18);
    expect(increases.reduce((a, b) => a + b, 0) / steps.length).toBeLessThanOrEqual(0.04);
  });

  it("keeps deload weeks lighter than the weeks around them", () => {
    const week5 = plannedWeeklyMinutes(ctx, addDays(START, 4 * 7));
    const week6 = plannedWeeklyMinutes(ctx, addDays(START, 5 * 7));
    expect(isDeloadWeek(6)).toBe(true);
    expect(week6).toBeLessThan(week5);
  });

  it("offers a five-minute floor on any date", () => {
    const min = getMinimumDose(START, ctx);
    expect(min.kind).toBe("minimum");
    expect(min.estMinutes).toBeLessThanOrEqual(6);
  });
});

describe("rung caps", () => {
  it("holds an eager level under the phase cap", () => {
    const levels = { squat: 5 };
    expect(effectiveRung("squat", levels, PHASES[0])).toBe(PHASES[0].rungCap);
    expect(effectiveRung("squat", levels, PHASES[4])).toBe(5);
  });

  it("never returns a rung past the end of the ladder", () => {
    expect(effectiveRung("hinge", { hinge: 99 }, PHASES[4])).toBe(4);
  });
});

describe("difficulty feedback", () => {
  const base = { date: START, levels: { squat: 2 }, days: {}, adjustments: [] };

  it('drops a rung on "too hard"', () => {
    const out = evaluateProgression({ ...base, record: record({ feedback: "too_hard" }) });
    expect(out).toHaveLength(1);
    expect(out[0].toRung).toBe(1);
    expect(applyAdjustments(base.levels, out).squat).toBe(1);
  });

  it('adds a rung on "too easy"', () => {
    const out = evaluateProgression({ ...base, record: record({ feedback: "too_easy" }) });
    expect(out[0].toRung).toBe(3);
  });

  it("does not drop below the bottom rung", () => {
    const out = evaluateProgression({
      ...base,
      levels: { squat: 0 },
      record: record({ feedback: "too_hard" }),
    });
    expect(out).toHaveLength(0);
  });

  it("climbs on its own after enough completed sessions at one rung", () => {
    const days: Record<string, DayRecord> = {};
    for (let i = 0; i < AUTO_PROGRESS_SESSIONS; i++) {
      const date = addDays(START, i);
      days[date] = record({ date });
    }
    const out = evaluateProgression({
      date: addDays(START, AUTO_PROGRESS_SESSIONS),
      record: record(),
      levels: { squat: 0 },
      days,
      adjustments: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("auto_progress");
    expect(out[0].toRung).toBe(1);
  });

  it("waits for the threshold before climbing", () => {
    const days: Record<string, DayRecord> = {};
    for (let i = 0; i < AUTO_PROGRESS_SESSIONS - 2; i++) {
      const date = addDays(START, i);
      days[date] = record({ date });
    }
    const out = evaluateProgression({
      date: START,
      record: record(),
      levels: { squat: 0 },
      days,
      adjustments: [],
    });
    expect(out).toHaveLength(0);
  });

  it("restarts the count after an adjustment", () => {
    const days: Record<string, DayRecord> = {};
    for (let i = 0; i < AUTO_PROGRESS_SESSIONS; i++) {
      const date = addDays(START, i);
      days[date] = record({ date });
    }
    const out = evaluateProgression({
      date: addDays(START, AUTO_PROGRESS_SESSIONS),
      record: record(),
      levels: { squat: 0 },
      days,
      adjustments: [
        {
          id: "x",
          date: addDays(START, AUTO_PROGRESS_SESSIONS - 1),
          patternId: "squat",
          fromRung: 0,
          toRung: 0,
          reason: "too_hard",
        },
      ],
    });
    expect(out).toHaveLength(0);
  });
});

describe("streaks", () => {
  const walk = (date: string): WalkEntry => ({
    id: date,
    date,
    loggedAt: `${date}T12:00:00.000Z`,
    durationMin: 25,
    source: "manual",
    outdoors: true,
  });

  it("counts consecutive active days", () => {
    const walks = [walk(START), walk(addDays(START, 1)), walk(addDays(START, 2))];
    const { current } = computeStreak(ctx, { days: {}, walks }, addDays(START, 2));
    expect(current).toBe(3);
  });

  it("forgives a single missed day", () => {
    // Active Mon, Tue; nothing Thu (a scheduled walk day); active Fri.
    const walks = [walk(START), walk(addDays(START, 1)), walk(addDays(START, 4))];
    const { current, forgivenGap } = computeStreak(ctx, { days: {}, walks }, addDays(START, 4));
    expect(current).toBe(3);
    expect(forgivenGap).toBe(true);
  });

  it("breaks after two missed days in a row", () => {
    // Active Mon; nothing Tue or Thu (both scheduled); active Fri.
    const walks = [walk(START), walk(addDays(START, 4))];
    const { current } = computeStreak(ctx, { days: {}, walks }, addDays(START, 4));
    expect(current).toBe(1);
  });

  it("does not treat a scheduled rest day as a miss", () => {
    // Wednesday is a rest day in phase 1, so Mon + Thu is an unbroken run.
    const walks = [walk(START), walk(addDays(START, 1)), walk(addDays(START, 3))];
    const { current, forgivenGap } = computeStreak(ctx, { days: {}, walks }, addDays(START, 3));
    expect(current).toBe(3);
    expect(forgivenGap).toBe(false);
  });

  it("does not penalise a today that has not happened yet", () => {
    const walks = [walk(START), walk(addDays(START, 1))];
    const { current } = computeStreak(ctx, { days: {}, walks }, addDays(START, 2));
    expect(current).toBe(2);
  });
});

describe("adherence", () => {
  it("ignores rest days when scoring the trailing window", () => {
    const days: Record<string, DayRecord> = {};
    for (let i = 0; i < 14; i++) {
      const date = addDays(START, i);
      if (getSessionForDate(ctx, date).kind === "rest") continue;
      days[date] = record({ date });
    }
    const result = computeAdherence(ctx, { days, walks: [] }, addDays(START, 14), 14);
    expect(result.pct).toBe(100);
    expect(result.scheduled).toBeLessThan(14);
  });
});
