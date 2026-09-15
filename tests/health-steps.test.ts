import { describe, expect, it } from "vitest";
import { buildSteps } from "../src/lib/health/steps";
import { getMinimumDose, getSessionForDate } from "../src/lib/health";
import type { Session, Station } from "../src/lib/health";

/**
 * The flattening the timer walks. Pulled out of the React hook so the two rules
 * that matter can be tested: no dead time at the end, and round rest only
 * between rounds.
 */

const ctx = { programStartDate: "2026-09-07", patternLevels: {} };

const station = (name: string, workSec: number, restSec: number): Station => ({
  patternId: "core",
  rungIndex: 0,
  exerciseId: name,
  name,
  cue: "",
  mode: "hold",
  workSec,
  restSec,
});

const session = (over: Partial<Session> = {}): Session => ({
  id: "s",
  date: "2026-09-07",
  week: 1,
  dayOfWeek: 1,
  phase: { index: 1, name: "Showing up", startWeek: 1, endWeek: 6, blurb: "" },
  kind: "strength",
  title: "t",
  subtitle: "",
  estMinutes: 5,
  isDeload: false,
  blocks: [],
  ...over,
});

describe("buildSteps", () => {
  it("ends on work — a finished session never makes you wait out a rest", () => {
    const steps = buildSteps(
      session({
        blocks: [
          {
            id: "circuit",
            kind: "circuit",
            label: "Circuit",
            rounds: 1,
            roundRestSec: 45,
            stations: [station("a", 30, 30), station("b", 30, 30)],
          },
        ],
      }),
    );
    expect(steps.map((s) => s.kind)).toEqual(["work", "rest", "work"]);
  });

  it("puts round rest between rounds and never after the last one", () => {
    const steps = buildSteps(
      session({
        blocks: [
          {
            id: "circuit",
            kind: "circuit",
            label: "Circuit",
            rounds: 2,
            roundRestSec: 45,
            stations: [station("a", 30, 0)],
          },
        ],
      }),
    );
    expect(steps.map((s) => s.kind)).toEqual(["work", "roundrest", "work"]);
  });

  it("carries the round it is in, so the player can say 'round 2 of 3'", () => {
    const steps = buildSteps(
      session({
        blocks: [
          {
            id: "circuit",
            kind: "circuit",
            label: "Circuit A",
            rounds: 3,
            roundRestSec: 0,
            stations: [station("a", 30, 0)],
          },
        ],
      }),
    );
    expect(steps.map((s) => s.round)).toEqual([1, 2, 3]);
    expect(steps.every((s) => s.rounds === 3 && s.blockLabel === "Circuit A")).toBe(true);
  });

  it("walks a real session end to end without producing an empty list", () => {
    const monday = buildSteps(getSessionForDate(ctx, "2026-09-07"));
    expect(monday.length).toBeGreaterThan(10);
    expect(monday[0].kind).toBe("work");
    expect(monday[monday.length - 1].kind).toBe("work");

    // The floor is three stations twice over, with the trailing rest dropped.
    const floor = buildSteps(getMinimumDose("2026-09-07", ctx));
    expect(floor.filter((s) => s.kind === "work")).toHaveLength(6);
  });

  it("has nothing to walk on a rest day", () => {
    expect(buildSteps(getSessionForDate(ctx, "2026-09-09"))).toEqual([]);
  });
});
