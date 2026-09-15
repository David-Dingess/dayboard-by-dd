import type { BodyAnim, BodyPose, FigureAnim, Limb } from "./rig";
import { FULL, STANDING_BOX, WORK_FLOOR, standing, workFloor } from "./poses";
import { along } from "./rig";

/**
 * The pull ladder: bent-over dumbbell rows (5 and 10 lb), the gorilla row with
 * one kettlebell, its tempo version, and the renegade row from a plank on the
 * dumbbells.
 */

const hinge = (over: Partial<BodyPose>, torso = -30, pelvis: [number, number] = [160, 214]): BodyPose =>
  standing({
    pelvis,
    torso,
    neck: torso - 6,
    head: torso - 16,
    legN: { to: [222, 350], bend: -1, end: 0 },
    legF: { to: [208, 350], bend: -1, end: 0 },
    ...over,
  });

const shoulderOf = (pelvis: [number, number], torso: number) => along(pelvis, torso, 100);

function rowAnim(opts: {
  hang: Pick<BodyPose, "armN" | "armF">;
  row: Pick<BodyPose, "armN" | "armF">;
  torso: number;
  pelvis: [number, number];
  held: BodyAnim["held"];
  labels: [string, string];
  lowerSec?: number;
}): BodyAnim {
  const down = hinge(opts.hang, opts.torso, opts.pelvis);
  const up = hinge(opts.row, opts.torso, opts.pelvis);
  const lower = opts.lowerSec ?? 0.9;
  return {
    kind: "body",
    view: "side",
    viewBox: STANDING_BOX,
    props: [workFloor],
    hot: ["armN.upper", "torso"],
    held: opts.held,
    loop: 1.9 + lower,
    keys: [
      { at: 0, pose: down, label: opts.labels[0] },
      { at: 0.3, pose: down, label: opts.labels[1] },
      { at: 0.9, pose: up },
      { at: 1.3, pose: up },
      { at: 1.3 + lower, pose: down },
    ],
  };
}

const rowSh = shoulderOf([160, 214], -30);
const dumbbellRow = rowAnim({
  torso: -30,
  pelvis: [160, 214],
  hang: {
    armN: { to: [rowSh[0] + 4, rowSh[1] + 108], bend: 1, end: 90 },
    armF: { to: [rowSh[0] - 2, rowSh[1] + 108], bend: 1, end: 90 },
  },
  row: {
    armN: { to: [rowSh[0] - 36, rowSh[1] + 40], bend: 1, end: 90 },
    armF: { to: [rowSh[0] - 42, rowSh[1] + 42], bend: 1, end: 90 },
  },
  held: [
    { kind: "dumbbell", hand: "armN" },
    { kind: "dumbbell", hand: "armF" },
  ],
  labels: ["Hinge forward, flat back", "Pull to your ribs, squeeze"],
});

const gSh = shoulderOf([166, 236], -16);
const braced: Limb = { grab: "legF.knee", offset: [4, -6], bend: 1, end: 60 };
const gorilla = (lowerSec?: number) =>
  rowAnim({
    torso: -16,
    pelvis: [166, 236],
    hang: { armN: { to: [gSh[0] - 8, WORK_FLOOR - 58], bend: 1, end: 90 }, armF: braced },
    row: { armN: { to: [gSh[0] - 44, gSh[1] + 34], bend: 1, end: 90 }, armF: braced },
    held: [{ kind: "kettlebell", hand: "armN", hang: true }],
    labels: lowerSec ? ["Bell between your feet", "Pull fast, lower for three"] : ["Bell between your feet", "Row it up, one arm"],
    lowerSec,
  });

/* Renegade: the push-up top with a dumbbell in each hand. */
const ankle: [number, number] = [38, 336];
const deg = 21.5;
const pelvis = along(ankle, -deg, 162);
const top = along(pelvis, -deg, 100);
const plank = (rowNear: boolean, rowFar: boolean): BodyPose =>
  standing({
    pelvis,
    torso: -deg,
    neck: -deg,
    head: -deg - 4,
    legN: { to: [ankle[0], ankle[1]], bend: 1, end: 90 },
    legF: { to: [ankle[0] - 8, ankle[1]], bend: 1, end: 90 },
    armN: rowNear ? { to: [top[0] - 44, top[1] + 30], bend: 1, end: 60 } : { to: [top[0] + 2, WORK_FLOOR - 16], bend: 1, end: 0 },
    armF: rowFar ? { to: [top[0] - 50, top[1] + 32], bend: 1, end: 60 } : { to: [top[0] - 4, WORK_FLOOR - 15], bend: 1, end: 0 },
  });

export const PULL_FIGURES: Record<string, FigureAnim> = {
  "pull-row-light": dumbbellRow,
  "pull-row-10": {
    ...dumbbellRow,
    keys: dumbbellRow.keys.map((k, i) => (i === 1 ? { ...k, label: "Elbows brush past your sides" } : k)),
  },
  "pull-gorilla": gorilla(),
  "pull-gorilla-tempo": gorilla(3),
  "pull-renegade": {
    kind: "body",
    view: "side",
    viewBox: FULL,
    props: [workFloor, { kind: "mat", x1: 30, x2: 390, y: WORK_FLOOR - 4 }],
    hot: ["armN.upper", "torsoLow"],
    held: [
      { kind: "dumbbell", hand: "armN" },
      { kind: "dumbbell", hand: "armF" },
    ],
    loop: 3.2,
    keys: [
      { at: 0, pose: plank(false, false), label: "Plank on the dumbbells" },
      { at: 0.3, pose: plank(false, false), label: "Row one — hips stay square" },
      { at: 0.9, pose: plank(true, false) },
      { at: 1.2, pose: plank(true, false) },
      { at: 1.6, pose: plank(false, false), label: "Now the other" },
      { at: 2.2, pose: plank(false, true) },
      { at: 2.5, pose: plank(false, true) },
    ],
  } satisfies BodyAnim,
};
