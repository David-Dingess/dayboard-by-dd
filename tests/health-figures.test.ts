import { describe, expect, it } from "vitest";
import {
  CHAIR_FIGURES,
  FIGURES,
  LADDERS,
  PATTERN_IDS,
  allExerciseIds,
  chairExerciseIds,
  drawFigure,
  labelAt,
  sideAt,
  solveTwoBone,
  type BodyPose,
  type FigureAnim,
  type LimbName,
} from "../src/lib/health";

/**
 * The drawn exercise animations — the chair routine's and the programme's.
 *
 * What is worth pinning: every move the board can put on screen has one; no
 * frame of any of them produces a NaN, which draws nothing and fails silently
 * in an SVG; loops are seamless and labelled; and the limbs of consecutive key
 * poses are placed the same way, because easing from a reach to an angle
 * cannot tween and jumps instead.
 */

const finite = (n: number) => Number.isFinite(n);
const entries = Object.entries(FIGURES);

describe("coverage", () => {
  it("draws every exercise the programme can show", () => {
    const missing = allExerciseIds().filter((id) => !FIGURES[id]);
    expect(missing).toEqual([]);
  });

  it("draws every chair move, and keeps the chair set under its own name", () => {
    for (const id of chairExerciseIds()) {
      expect(FIGURES[id], id).toBeDefined();
      expect(CHAIR_FIGURES[id], id).toBeDefined();
    }
  });

  it("has nothing drawn for an id nobody can show", () => {
    const known = new Set(allExerciseIds());
    expect(Object.keys(FIGURES).filter((id) => !known.has(id))).toEqual([]);
  });
});

describe("every animation", () => {
  it("has ordered keys inside the loop, and a label from the first frame", () => {
    for (const [id, anim] of entries) {
      const times = anim.keys.map((k) => k.at);
      expect(times[0], id).toBe(0);
      expect([...times].sort((a, b) => a - b), id).toEqual(times);
      expect(times.at(-1)!, id).toBeLessThan(anim.loop);
      expect(labelAt(anim, 0), id).not.toBe("");
    }
  });

  it("never produces a non-finite shape at any point in its loop", () => {
    for (const [id, anim] of entries) {
      for (let t = 0; t < anim.loop * 2; t += anim.loop / 37) {
        for (const shape of drawFigure(anim, t)) {
          const values =
            shape.kind === "line" ? [shape.x1, shape.y1, shape.x2, shape.y2, shape.w] : [shape.cx, shape.cy, shape.r];
          expect(values.every(finite), `${id} at ${t.toFixed(2)}s`).toBe(true);
        }
      }
    }
  });

  it("loops seamlessly: the end of the loop is the first key", () => {
    for (const [id, anim] of entries) {
      // Rounded: the eased value just before the loop is the first key to within
      // float noise, which is all a seamless loop needs.
      const round = (t: number) =>
        JSON.stringify(drawFigure(anim, t), (_, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));
      expect(round(anim.loop - 1e-9), id).toBe(round(0));
    }
  });

  it("actually moves", () => {
    for (const [id, anim] of entries) {
      const frames = new Set<string>();
      for (let t = 0; t < anim.loop; t += anim.loop / 12) frames.add(JSON.stringify(drawFigure(anim, t)));
      expect(frames.size, id).toBeGreaterThan(3);
    }
  });

  it("places each limb the same way in every key, so it can ease", () => {
    const kind = (limb: object) => ["via", "a", "grab", "to"].find((k) => k in limb);
    for (const [id, anim] of entries) {
      if (anim.kind !== "body") continue;
      for (const name of ["armN", "armF", "legN", "legF"] as LimbName[]) {
        const kinds = new Set(anim.keys.map((key) => kind((key.pose as BodyPose)[name])));
        expect(kinds.size, `${id} ${name}: ${[...kinds].join(", ")}`).toBe(1);
      }
    }
  });

  it("never clips the head out of its frame", () => {
    // Zoomed moves crop legs and chairs on purpose; a head cut off by the edge
    // is the failure that actually happens, and it is always a mistake.
    const clipped: string[] = [];
    for (const [id, anim] of entries) {
      if (anim.kind === "hand") continue;
      const [x, y, w, h] = anim.viewBox;
      for (let t = 0; t < anim.loop; t += anim.loop / 24) {
        for (const shape of drawFigure(anim, t)) {
          if (shape.kind !== "circle" || shape.tone !== "near") continue;
          const r = shape.r;
          if (shape.cx - r < x || shape.cx + r > x + w || shape.cy - r < y || shape.cy + r > y + h) {
            clipped.push(`${id} at ${t.toFixed(1)}s`);
            break;
          }
        }
      }
    }
    expect([...new Set(clipped.map((c) => c.split(" at ")[0]))]).toEqual([]);
  });
});

describe("equipment and sides", () => {
  it("puts a kettlebell or dumbbell in the hands of every rung that names one", () => {
    for (const pattern of PATTERN_IDS) {
      for (const rung of LADDERS[pattern].rungs) {
        const anim = FIGURES[rung.id] as FigureAnim;
        if (anim.kind !== "body") continue;
        const held = new Set((anim.held ?? []).map((item) => item.kind));
        if (rung.equipment?.includes("kettlebell")) expect(held.has("kettlebell"), rung.id).toBe(true);
        if (rung.equipment?.includes("dumbbell")) expect(held.has("dumbbell"), rung.id).toBe(true);
        if (!rung.equipment) expect(held.size, rung.id).toBe(0);
      }
    }
  });

  it("switches sides halfway exactly on the moves whose cue says to", () => {
    const switching = entries.filter(([, anim]) => anim.switchHalfway).map(([id]) => id).sort();
    expect(switching).toEqual(
      [
        "carry-overhead-hold",
        "carry-overhead-march",
        "carry-suitcase-hold",
        "carry-suitcase-march",
        "cooldown-1",
        "core-side-plank",
        "mobility-1",
        "mobility-3",
        "press-kb",
      ].sort(),
    );
  });

  it("picks the side by the timer when there is one, and by the loop when there is not", () => {
    const anim = FIGURES["core-side-plank"];
    expect(sideAt(anim, 0, 40, 30)).toBe("Right");
    expect(sideAt(anim, 0, 40, 10)).toBe("Left");
    expect(sideAt(anim, anim.loop * 0.5)).toBe("Right");
    expect(sideAt(anim, anim.loop * 1.5)).toBe("Left");
    expect(sideAt(FIGURES["push-full"], 0, 40, 10)).toBe("Right");
  });
});

describe("solveTwoBone", () => {
  it("reaches a reachable point with both bones at their length", () => {
    const { joint, end } = solveTwoBone([0, 0], [80, 60], 60, 60, 1);
    expect(end[0]).toBeCloseTo(80);
    expect(end[1]).toBeCloseTo(60);
    expect(Math.hypot(joint[0], joint[1])).toBeCloseTo(60);
    expect(Math.hypot(end[0] - joint[0], end[1] - joint[1])).toBeCloseTo(60);
  });

  it("stops short of a point out of reach instead of stretching", () => {
    const { end } = solveTwoBone([0, 0], [500, 0], 60, 60, 1);
    expect(end[0]).toBeLessThanOrEqual(120);
    expect(end[1]).toBeCloseTo(0);
  });

  it("bends the other way when told to", () => {
    const up = solveTwoBone([0, 0], [100, 0], 60, 60, -1).joint;
    const down = solveTwoBone([0, 0], [100, 0], 60, 60, 1).joint;
    expect(Math.sign(up[1])).toBe(-Math.sign(down[1]));
  });
});
