import { describe, expect, it } from "vitest";
import {
  CHAIR_CORE,
  CHAIR_EXTRAS,
  allExerciseIds,
  chairExerciseIds,
  chairExtraFor,
  chairRoutine,
} from "../src/lib/health";

/**
 * The routine itself. The rules worth pinning are the ones that make it the
 * thing it claims to be: about five minutes, every step a real move with a cue,
 * and the rotating minute actually rotating.
 */

describe("chairRoutine", () => {
  it("runs about five minutes, whichever extra it carries", () => {
    for (let done = 0; done < CHAIR_EXTRAS.length; done++) {
      const routine = chairRoutine(done);
      expect(routine.estSeconds).toBeGreaterThanOrEqual(270);
      expect(routine.estSeconds).toBeLessThanOrEqual(330);
    }
  });

  it("gives every step a move with a name and a cue, and never a rest", () => {
    const routine = chairRoutine(0);
    for (const step of routine.steps) {
      expect(step.kind).toBe("work");
      const move = routine.moves[step.key];
      expect(move?.name).toBeTruthy();
      expect(move?.cue.length).toBeGreaterThan(10);
      expect(move?.seconds).toBe(step.seconds);
    }
  });

  it("does both sides of a sided move, right first", () => {
    const routine = chairRoutine(0);
    const sides = routine.steps
      .filter((s) => s.key.startsWith("chair-hamstring"))
      .map((s) => routine.moves[s.key].side);
    expect(sides).toEqual(["Right", "Left"]);
  });

  it("uses unique step keys, which the timer's skip set relies on", () => {
    const keys = chairRoutine(1).steps.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("always starts with the wrists and keeps the core in every routine", () => {
    for (let done = 0; done < 3; done++) {
      const ids = chairRoutine(done).steps.map((s) => s.key);
      expect(ids[0]).toBe("chair-tendon-glides");
      for (const move of CHAIR_CORE) expect(ids.some((key) => key.startsWith(move.id))).toBe(true);
    }
  });

  it("rotates the extra minute through the day and comes back round", () => {
    expect([0, 1, 2, 3].map((n) => chairExtraFor(n).id)).toEqual(["neck", "hips", "spine", "neck"]);
    expect(chairRoutine(1).id).toBe("chair-hips");
  });
});

describe("chair moves", () => {
  it("are all exercise ids the board knows, so each one is drawn", () => {
    for (const id of chairExerciseIds()) expect(allExerciseIds()).toContain(id);
  });
});
