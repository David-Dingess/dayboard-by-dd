import type { BodyAnim, BodyPose, FigureAnim, Limb } from "./rig";
import { WORK_FLOOR, standing, workFloor } from "./poses";

/**
 * Moves done lying on your back: the glute bridges (and the minimum's bridge),
 * the dead bug (and the minimum's), the hollow hold, and the hamstring floss.
 * Seen from the side, head to the left, on a mat.
 */

const mat = { kind: "mat", x1: 40, x2: 380, y: WORK_FLOOR - 4 } as const;
const props = [workFloor, mat];
/** Lying down fills the bottom of a square; crop to the body. */
const LOW: BodyAnim["viewBox"] = [30, 110, 330, 330];
const LOW_WIDE: BodyAnim["viewBox"] = [-10, 80, 380, 380];
/** The arms lie beside the body, behind it from this side, so the torso reads as one shape. */
const armsBehind: BodyAnim["behind"] = ["armN"];

/** Lying flat, knees bent, feet on the mat, arms along the floor. */
const supine = (over: Partial<BodyPose>): BodyPose =>
  standing({
    pelvis: [236, 344],
    torso: 180,
    neck: 180,
    head: 180,
    legN: { to: [314, 346], bend: -1, end: 0 },
    legF: { to: [306, 347], bend: -1, end: 0 },
    armN: { to: [244, 350], bend: -1, end: 0 },
    armF: { to: [238, 351], bend: -1, end: 0 },
    ...over,
  });

const bridgeUp = (over: Partial<BodyPose> = {}) =>
  supine({
    pelvis: [230, 298],
    torso: 154,
    ...over,
  });

const bridge: BodyAnim = {
  kind: "body",
  view: "side",
  viewBox: LOW,
  behind: armsBehind,
  props,
  hot: ["hipN", "legN.thigh"],
  loop: 3.4,
  keys: [
    { at: 0, pose: supine({}), label: "On your back, heels close" },
    { at: 0.4, pose: supine({}), label: "Squeeze your glutes, lift" },
    { at: 1.3, pose: bridgeUp() },
    { at: 1.9, pose: bridgeUp(), label: "Ribs down, lower slowly" },
    { at: 2.9, pose: supine({}) },
  ],
};

/**
 * The free knee pulled in over the chest. Drawn without the hugging arms: from
 * the side, an arm from shoulder to knee turns the figure into scaffolding, and
 * the knee's position already says "hugged in".
 */
const hugged: Limb = { a: [-118, -20], end: -60 };
const hugArms = {
  armN: { to: [244, 350], bend: -1, end: 0 } as Limb,
  armF: { to: [238, 351], bend: -1, end: 0 } as Limb,
};

const tabletop: Pick<BodyPose, "legN" | "legF"> = {
  legN: { a: [-92, 0], end: -90 },
  legF: { a: [-88, 2], end: -90 },
};
const armsUp: Pick<BodyPose, "armN" | "armF"> = {
  armN: { a: [-92, -92], end: -92 },
  armF: { a: [-88, -88], end: -88 },
};
const deadbug = (reach: "none" | "near" | "far"): BodyPose =>
  supine({
    ...tabletop,
    ...armsUp,
    ...(reach === "near" ? { armF: { a: [-174, -174], end: -174 }, legN: { a: [-6, -6], end: -6 } } : {}),
    ...(reach === "far" ? { armN: { a: [-176, -176], end: -176 }, legF: { a: [-4, -4], end: -4 } } : {}),
  });

const deadbugAnim: BodyAnim = {
  kind: "body",
  view: "side",
  viewBox: LOW_WIDE,
  props,
  hot: ["torsoLow"],
  loop: 4.8,
  keys: [
    { at: 0, pose: deadbug("none"), label: "Low back glued to the mat" },
    { at: 0.4, pose: deadbug("none"), label: "Opposite arm and leg reach out" },
    { at: 1.4, pose: deadbug("near") },
    { at: 1.8, pose: deadbug("near"), label: "Back to the middle" },
    { at: 2.4, pose: deadbug("none") },
    { at: 2.8, pose: deadbug("none"), label: "Now the other pair" },
    { at: 3.8, pose: deadbug("far") },
    { at: 4.2, pose: deadbug("far"), label: "Back to the middle" },
  ],
};

const hollow = (lift: number): BodyPose =>
  supine({
    spine: 14 + lift,
    neck: 196 + lift,
    head: 200 + lift,
    armN: { a: [-160 + lift, -160 + lift], end: -160 + lift },
    armF: { a: [-162 + lift, -162 + lift], end: -162 + lift },
    legN: { a: [-14 - lift, -14 - lift], end: -94 - lift },
    legF: { a: [-12 - lift, -12 - lift], end: -92 - lift },
  });

/** Lying flat, arms overhead on the mat — the start of the hollow hold, in the same angle terms. */
const flat = supine({
  armN: { a: [-178, -178], end: -178 },
  armF: { a: [-179, -179], end: -179 },
  legN: { a: [-1, -1], end: -80 },
  legF: { a: [0, 0], end: -80 },
});

const floss = (up: number): BodyPose =>
  supine({
    legN: { a: [up, up], end: up - 80 },
    legF: { a: [-2, -2], end: -80 },
    armN: { grab: "legN.knee", offset: [-6, 4], bend: 1, end: up },
    armF: { grab: "legN.knee", offset: [-2, 8], bend: 1, end: up },
  });

export const FLOOR_FIGURES: Record<string, FigureAnim> = {
  "hinge-bridge": bridge,
  "min-bridge": bridge,
  "hinge-bridge-single": {
    ...bridge,
    hot: ["hipN", "legF.thigh"],
    keys: [
      { at: 0, pose: supine({ legN: hugged, ...hugArms }), label: "One foot planted, hug the other knee" },
      { at: 0.4, pose: supine({ legN: hugged, ...hugArms }), label: "Drive through the planted heel" },
      { at: 1.3, pose: bridgeUp({ legN: hugged, ...hugArms }) },
      { at: 1.9, pose: bridgeUp({ legN: hugged, ...hugArms }), label: "Hips level, lower slowly" },
      { at: 2.9, pose: supine({ legN: hugged, ...hugArms }) },
    ],
  },
  "core-deadbug": deadbugAnim,
  "min-deadbug": deadbugAnim,
  "core-hollow": {
    kind: "body",
    view: "side",
    viewBox: LOW_WIDE,
    behind: armsBehind,
    props,
    hot: ["torsoLow"],
    loop: 5,
    keys: [
      { at: 0, pose: flat, label: "Low back pressed down first" },
      { at: 0.6, pose: flat, label: "Lift arms and legs, as low as you can hold" },
      { at: 1.8, pose: hollow(0) },
      { at: 2.6, pose: hollow(4), label: "Hold — breathe" },
      { at: 3.6, pose: hollow(0) },
      { at: 4.2, pose: hollow(0), label: "Rest" },
    ],
  } satisfies BodyAnim,
  "mobility-3": {
    kind: "body",
    view: "side",
    viewBox: [30, 50, 340, 340],
    props,
    hot: ["legN.thigh", "legN.shin"],
    switchHalfway: true,
    loop: 3.2,
    keys: [
      { at: 0, pose: floss(-78), label: "Leg straight up, hands behind the thigh" },
      { at: 0.8, pose: floss(-78), label: "Gently pulse toward you" },
      { at: 1.4, pose: floss(-98) },
      { at: 2, pose: floss(-80) },
      { at: 2.6, pose: floss(-98) },
    ],
  } satisfies BodyAnim,
};
