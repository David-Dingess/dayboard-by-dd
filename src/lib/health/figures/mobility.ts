import type { BodyAnim, BodyPose, FigureAnim, Pt } from "./rig";
import { STANDING_BOX, WORK_FLOOR, standing, workFloor } from "./poses";

/**
 * The Sunday mobility reset and the session cool-down: cat-cow, the world's
 * greatest stretch, thread the needle, the deep squat hold, slow breathing,
 * the doorway chest stretch and the half-kneeling hip flexor stretch. The
 * hamstring floss is a lying move and lives in floor.ts.
 */

const mat = { kind: "mat", x1: 20, x2: 380, y: WORK_FLOOR - 4 } as const;
const props = [workFloor, mat];

/* ----------------------------------------------------------- all fours --- */

const KNEE: Pt = [132, WORK_FLOOR - 14];
const HANDS: [Pt, Pt] = [
  [230, WORK_FLOOR - 10],
  [224, WORK_FLOOR - 9],
];

/** Hands under shoulders, knees under hips, shins flat behind. */
const allFours = (over: Partial<BodyPose>): BodyPose =>
  standing({
    pelvis: [132, 264],
    torso: -14,
    spine: 0,
    neck: -8,
    head: -4,
    legN: { via: KNEE, at: [60, WORK_FLOOR - 12], end: 180 },
    legF: { via: [126, WORK_FLOOR - 13], at: [54, WORK_FLOOR - 11], end: 180 },
    armN: { to: HANDS[0], bend: 1, end: 0 },
    armF: { to: HANDS[1], bend: 1, end: 0 },
    ...over,
  });

const neutral = allFours({});
const cow = allFours({ torso: 8, spine: -44, neck: -46, head: -112 });
const cat = allFours({ torso: -36, spine: 44, neck: 58, head: 64 });

const threadUnder = allFours({
  torso: -4,
  neck: 20,
  head: 70,
  armN: { to: [232, WORK_FLOOR - 10], bend: 1, end: 0 },
  armF: { to: [120, WORK_FLOOR - 16], bend: 1, end: 180 },
});
const openUp = allFours({
  torso: -16,
  neck: -40,
  head: -130,
  armF: { to: [222, 124], bend: 1, end: -90 },
});

/* ------------------------------------------------------------- lunges --- */

const lunge = (over: Partial<BodyPose>): BodyPose =>
  standing({
    pelvis: [182, 284],
    torso: -30,
    neck: -26,
    head: -20,
    legN: { to: [290, 350], bend: -1, end: 0 },
    legF: { to: [52, 336], bend: -1, end: 100 },
    armN: { to: [268, 350], bend: 1, end: 0 },
    armF: { to: [262, 351], bend: 1, end: 0 },
    ...over,
  });

/** Half-kneeling: the near (back) knee down, the far foot planted in front. */
const halfKneel = (pelvis: Pt, torso: number): BodyPose =>
  standing({
    pelvis,
    torso,
    neck: torso,
    head: -90,
    legN: { via: [168, WORK_FLOOR - 14], at: [96, WORK_FLOOR - 12], end: 180 },
    legF: { to: [300, 350], bend: -1, end: 0 },
    armN: { grab: "legF.knee", offset: [-6, -10], bend: 1, end: 10 },
    armF: { grab: "legF.knee", offset: [-10, -8], bend: 1, end: 10 },
  });

/* -------------------------------------------------------------- squat --- */

const deepSquat = (sink: number, chest: number): BodyPose =>
  standing({
    pelvis: [172, 298 + sink],
    torso: -74,
    neck: -76,
    head: -88,
    chest,
    legN: { to: [216, 350], bend: -1, end: 0 },
    legF: { to: [204, 350], bend: -1, end: 0 },
    armN: { to: [300, 214], bend: 1, end: -90 },
    armF: { to: [300, 222], bend: 1, end: -90 },
  });

/* ---------------------------------------------------------- breathing --- */

/** Seated cross-legged on the mat, from the front, hands on the knees. */
const breathing = (chest: number, lift: number): BodyPose =>
  standing({
    pelvis: [200, 330],
    torso: -90,
    neck: -90,
    head: -90,
    chest,
    shoulderShift: [0, -lift],
    legN: { a: [172, 8], end: 90 },
    legF: { a: [8, 172], end: 90 },
    armN: { grab: "legN.knee", offset: [8, -8], bend: 1, end: 100 },
    armF: { grab: "legF.knee", offset: [-8, -8], bend: -1, end: 80 },
  });

const breathe: BodyAnim = {
  kind: "body",
  view: "front",
  viewBox: [30, 110, 340, 340],
  props,
  bones: { thigh: 76, shin: 70, foot: 10 },
  hot: ["torso"],
  loop: 10,
  keys: [
    { at: 0, pose: breathing(1, 0), label: "In for four" },
    { at: 4, pose: breathing(1.2, 5), label: "Out for six" },
  ],
};

/* ------------------------------------------------------------ doorway --- */

const DOOR_X = 206;
const doorway = (pelvis: Pt, torso: number, front: number, back: number): BodyPose =>
  standing({
    pelvis,
    torso,
    neck: torso,
    head: -90,
    legN: { to: [front, 350], bend: -1, end: 0 },
    legF: { to: [back, 350], bend: -1, end: 0 },
    armN: { via: [DOOR_X + 6, 96], at: [DOOR_X + 6, 44], end: -90 },
    armF: { to: [pelvis[0] + 6, 200], bend: 1, end: 90 },
  });

export const MOBILITY_FIGURES: Record<string, FigureAnim> = {
  "mobility-0": {
    kind: "body",
    view: "side",
    viewBox: [10, 90, 300, 300],
    props,
    hot: ["torso", "torsoLow"],
    loop: 7,
    keys: [
      { at: 0, pose: neutral, label: "On all fours" },
      { at: 0.6, pose: neutral, label: "Breathe in — drop the belly, look up" },
      { at: 2, pose: cow },
      { at: 2.8, pose: cow, label: "Breathe out — round up, tuck the chin" },
      { at: 4.6, pose: cat },
      { at: 5.4, pose: cat, label: "Slow waves" },
    ],
  } satisfies BodyAnim,
  "mobility-1": {
    kind: "body",
    view: "side",
    viewBox: [0, 30, 360, 360],
    props,
    hot: ["legF.thigh", "torso"],
    switchHalfway: true,
    loop: 6,
    keys: [
      { at: 0, pose: lunge({}), label: "Lunge, hands inside the front foot" },
      {
        at: 0.8,
        pose: lunge({}),
        label: "Elbow down to the instep",
      },
      { at: 1.8, pose: lunge({ torso: -12, neck: -8, head: 10, armN: { to: [270, 326], bend: -1, end: 60 } }) },
      {
        at: 2.6,
        pose: lunge({ torso: -12, neck: -8, head: 10, armN: { to: [270, 326], bend: -1, end: 60 } }),
        label: "Rotate open, reach to the ceiling",
      },
      {
        at: 3.8,
        pose: lunge({ torso: -40, neck: -60, head: -140, armN: { to: [270, 116], bend: 1, end: -90 } }),
      },
      {
        at: 4.8,
        pose: lunge({ torso: -40, neck: -60, head: -140, armN: { to: [270, 116], bend: 1, end: -90 } }),
        label: "Back down",
      },
    ],
  } satisfies BodyAnim,
  "mobility-2": {
    kind: "body",
    view: "side",
    viewBox: [10, 50, 330, 330],
    props,
    hot: ["torso"],
    inFront: ["armF"],
    loop: 7,
    keys: [
      { at: 0, pose: neutral, label: "On all fours" },
      { at: 0.6, pose: neutral, label: "Reach one arm under the other" },
      { at: 2, pose: threadUnder },
      { at: 3, pose: threadUnder, label: "Open it up to the ceiling" },
      { at: 4.6, pose: openUp },
      { at: 5.6, pose: openUp, label: "Back to all fours" },
    ],
  } satisfies BodyAnim,
  "mobility-4": {
    kind: "body",
    view: "side",
    viewBox: STANDING_BOX,
    props: [workFloor, { kind: "door", x: 306, top: 20, floor: WORK_FLOOR }],
    hot: ["hipN", "legN.thigh"],
    loop: 5,
    keys: [
      { at: 0, pose: deepSquat(0, 1), label: "Sit in the bottom of a squat" },
      { at: 2.5, pose: deepSquat(6, 1.08), label: "Hold the doorframe if you need to" },
    ],
  } satisfies BodyAnim,
  "mobility-5": breathe,
  "cooldown-2": {
    ...breathe,
    keys: [
      { at: 0, pose: breathing(1, 0), label: "In for four" },
      { at: 4, pose: breathing(1.2, 5), label: "Out for six — six rounds" },
    ],
  },
  "cooldown-0": {
    kind: "body",
    view: "side",
    viewBox: STANDING_BOX,
    props: [workFloor, { kind: "door", x: DOOR_X, top: 20, floor: WORK_FLOOR }],
    hot: ["shoulderN", "torso"],
    loop: 6,
    keys: [
      { at: 0, pose: doorway([252, 192], -90, 262, 244), label: "Forearm on the frame" },
      { at: 0.8, pose: doorway([252, 192], -90, 262, 244), label: "Step through — undo the chair" },
      { at: 2.2, pose: doorway([276, 198], -84, 312, 236) },
      { at: 4, pose: doorway([276, 198], -84, 312, 236), label: "Ease back" },
      { at: 5.2, pose: doorway([252, 192], -90, 262, 244) },
    ],
  } satisfies BodyAnim,
  "cooldown-1": {
    kind: "body",
    view: "side",
    viewBox: [20, 40, 340, 340],
    props,
    hot: ["legN.thigh", "hipN"],
    switchHalfway: true,
    loop: 5.6,
    keys: [
      { at: 0, pose: halfKneel([170, 266], -90), label: "Half-kneel, tuck the tailbone" },
      { at: 0.8, pose: halfKneel([170, 266], -90), label: "Lean in until the front of the hip opens" },
      { at: 2.2, pose: halfKneel([200, 272], -92) },
      { at: 4, pose: halfKneel([200, 272], -92), label: "Ease back" },
      { at: 5, pose: halfKneel([170, 266], -90) },
    ],
  } satisfies BodyAnim,
};


