import type { BodyAnim, BodyPose, FigureAnim, Limb, Pt } from "./rig";
import { FRONT_STANDING_BONES, along } from "./rig";
import { FULL, WORK_FLOOR, retime, standing, workFloor } from "./poses";

/**
 * The push ladder and the planks, which share a body in one straight line:
 * wall, desk, knees, floor, tempo and feet-on-the-chair push-ups, the forearm
 * plank, shoulder taps, and the side plank (from the front, so the stacked
 * shoulders and the lifted hip are visible).
 */

const mat = { kind: "mat", x1: 30, x2: 390, y: WORK_FLOOR - 4 } as const;

const LEG = 162;
const TORSO = 100;

/**
 * A straight body from the ankles up to the shoulders, rising `deg` above
 * horizontal toward the head (to the right). Returns the pelvis and the top
 * of the torso so the arms can be placed against them.
 */
function plankLine(ankle: Pt, deg: number) {
  const pelvis = along(ankle, -deg, LEG);
  const top = along(pelvis, -deg, TORSO);
  return { pelvis, top };
}

function onToes(ankle: Pt, deg: number, hands: [Pt, Pt], bend: 1 | -1 = 1, handEnd = 0): BodyPose {
  const { pelvis } = plankLine(ankle, deg);
  return standing({
    pelvis,
    torso: -deg,
    neck: -deg,
    head: -deg - 4,
    legN: { to: ankle, bend: 1, end: 90 },
    legF: { to: [ankle[0] - 6, ankle[1]], bend: 1, end: 90 },
    armN: { to: hands[0], bend, end: handEnd },
    armF: { to: hands[1], bend, end: handEnd },
  });
}

const floorHands: [Pt, Pt] = [
  [286, WORK_FLOOR - 10],
  [280, WORK_FLOOR - 9],
];

function pushAnim(top: BodyPose, bottom: BodyPose, props: BodyAnim["props"], labels: [string, string, string]): BodyAnim {
  return {
    kind: "body",
    view: "side",
    viewBox: FULL,
    props,
    hot: ["armN.upper", "torso"],
    loop: 3,
    keys: [
      { at: 0, pose: top, label: labels[0] },
      { at: 0.4, pose: top, label: labels[1] },
      { at: 1.4, pose: bottom },
      { at: 1.7, pose: bottom, label: labels[2] },
      { at: 2.6, pose: top },
    ],
  };
}

/* Wall: standing, leaning into it. */
const wallX = 362;
const wallHands: [Pt, Pt] = [
  [wallX - 8, 124],
  [wallX - 8, 128],
];
const wallTop = onToes([150, 348], 70, wallHands, 1, -90);
const wallBottom = onToes([150, 348], 62, wallHands, 1, -90);
const onWall = { ...wallTop, legN: { to: [150, 348], bend: -1, end: 0 } as Limb, legF: { to: [144, 349], bend: -1, end: 0 } as Limb };
const onWallDown = { ...wallBottom, legN: onWall.legN, legF: onWall.legF };
const wallPush = pushAnim(onWall, onWallDown, [workFloor, { kind: "wall", x: wallX, top: 0, floor: WORK_FLOOR }], [
  "Hands on the board, body one long line",
  "Lower toward the board",
  "Press back",
]);

/* Desk: hands on the edge. */
const deskHands: [Pt, Pt] = [
  [256, 244],
  [250, 245],
];
const inclineTop = { ...onToes([92, 348], 53, deskHands), legN: { to: [92, 348], bend: -1, end: 0 } as Limb, legF: { to: [86, 349], bend: -1, end: 0 } as Limb };
const inclineBottom = { ...onToes([92, 348], 39, deskHands), legN: inclineTop.legN, legF: inclineTop.legF };

/* Floor, on the toes. */
const TOES: Pt = [38, 336];
const fullTop = onToes(TOES, 21.5, floorHands);
const fullBottom = onToes(TOES, 4, floorHands);

/* Knees down: the thigh and torso make the line, the shins rest on the mat. */
function onKnees(deg: number): BodyPose {
  const knee: Pt = [160, WORK_FLOOR - 14];
  const pelvis = along(knee, -deg, 82);
  return standing({
    pelvis,
    torso: -deg,
    neck: -deg,
    head: -deg - 4,
    legN: { via: knee, at: [88, WORK_FLOOR - 30], end: 170 },
    legF: { via: [154, WORK_FLOOR - 13], at: [82, WORK_FLOOR - 29], end: 170 },
    armN: { to: [306, WORK_FLOOR - 10], bend: 1, end: 0 },
    armF: { to: [300, WORK_FLOOR - 9], bend: 1, end: 0 },
  });
}

/* Feet on the chair seat. */
const seat = WORK_FLOOR - 76;
const elevatedTop = onToes([22, seat - 12], 5, [
  [294, WORK_FLOOR - 10],
  [288, WORK_FLOOR - 9],
]);
const elevatedBottom = onToes([22, seat - 12], -6, [
  [294, WORK_FLOOR - 10],
  [288, WORK_FLOOR - 9],
]);

const fullPush = pushAnim(fullTop, fullBottom, [workFloor, mat], [
  "Full plank, body one line",
  "Chest to the mat — take your time",
  "Press up",
]);

/* Forearm plank. */
function forearmPlank(chest: number): BodyPose {
  const ankle: Pt = TOES;
  const deg = 9.5;
  const { pelvis, top } = plankLine(ankle, deg);
  const elbowY = WORK_FLOOR - 8;
  return standing({
    pelvis,
    torso: -deg,
    neck: -deg,
    head: -deg - 6,
    chest,
    legN: { to: ankle, bend: 1, end: 90 },
    legF: { to: [ankle[0] - 6, ankle[1]], bend: 1, end: 90 },
    armN: { via: [top[0] + 2, elbowY], at: [top[0] + 54, elbowY], end: 0 },
    armF: { via: [top[0] - 4, elbowY + 1], at: [top[0] + 48, elbowY + 1], end: 0 },
  });
}

/* Shoulder tap: the push-up top, one hand to the other shoulder. */
const tapTop = fullTop;
const fullTopLine = plankLine(TOES, 21.5);
const tapNear: BodyPose = { ...fullTop, armN: { to: [fullTopLine.top[0] - 12, fullTopLine.top[1] + 24], bend: -1, end: -120 } };
const tapFar: BodyPose = { ...fullTop, armF: { to: [fullTopLine.top[0] - 16, fullTopLine.top[1] + 26], bend: -1, end: -120 } };

/* Side plank, from the front: head to the left, forearm on the mat, hips lifted. */
function sidePlank(deg: number, legDeg: number): BodyPose {
  const torso = 180 + deg;
  const top: Pt = [110, 261];
  const pelvis = along(top, deg, TORSO);
  return {
    pelvis,
    torso,
    shoulderShift: [0, 0],
    neck: torso,
    head: torso - 8,
    shoulderW: 34,
    headTurn: 0,
    spine: 0,
    chest: 1,
    legN: { a: [legDeg, legDeg], end: legDeg + 90 },
    legF: { a: [legDeg - 1, legDeg - 1], end: legDeg + 89 },
    armN: { via: [100, WORK_FLOOR - 8], at: [150, WORK_FLOOR - 6], end: 0 },
    armF: { grab: "hip.front", offset: [0, -2], bend: 1, end: 200 },
  };
}

export const PUSH_FIGURES: Record<string, FigureAnim> = {
  "push-wall": wallPush,
  "min-wallpush": retime(wallPush, 1, { 1: "Whatever pace feels good" }),
  "push-incline": pushAnim(inclineTop, inclineBottom, [workFloor, { kind: "desk", x: 232, top: 250, floor: WORK_FLOOR }], [
    "Hands on the desk edge",
    "Lower with control, elbows back",
    "Press away",
  ]),
  "push-knee": pushAnim(onKnees(33), onKnees(11), [workFloor, mat], [
    "Knees down, hips forward",
    "Lower as one straight line",
    "Press up",
  ]),
  "push-full": fullPush,
  "push-tempo": {
    ...fullPush,
    loop: 5.6,
    keys: [
      { at: 0, pose: fullTop, label: "Full plank" },
      { at: 0.4, pose: fullTop, label: "Three seconds down" },
      { at: 3.4, pose: fullBottom },
      { at: 3.6, pose: fullBottom, label: "Pause an inch off the floor" },
      { at: 4.4, pose: fullBottom, label: "Press up" },
      { at: 5.2, pose: fullTop },
    ],
  },
  "push-elevated": pushAnim(
    elevatedTop,
    elevatedBottom,
    [workFloor, mat, { kind: "chair", x: 52, seat, back: seat - 110, view: "side" }],
    ["Feet on the chair", "Brace — hips don't sag", "Press up"],
  ),
  "core-plank": {
    kind: "body",
    view: "side",
    viewBox: FULL,
    props: [workFloor, mat],
    hot: ["torsoLow", "hipN"],
    loop: 5,
    keys: [
      { at: 0, pose: forearmPlank(1), label: "Elbows under shoulders, squeeze glutes" },
      { at: 2.5, pose: forearmPlank(1.1), label: "Breathe — don't hold it" },
    ],
  } satisfies BodyAnim,
  "core-shoulder-tap": {
    kind: "body",
    view: "side",
    viewBox: FULL,
    props: [workFloor, mat],
    hot: ["torsoLow"],
    loop: 2.8,
    keys: [
      { at: 0, pose: tapTop, label: "Wide feet, tap the opposite shoulder" },
      { at: 0.5, pose: tapNear },
      { at: 0.9, pose: tapTop, label: "Hips stay still" },
      { at: 1.4, pose: tapTop },
      { at: 1.9, pose: tapFar },
      { at: 2.3, pose: tapTop },
    ],
  } satisfies BodyAnim,
  "core-side-plank": {
    kind: "body",
    view: "front",
    viewBox: FULL,
    props: [workFloor, mat],
    bones: FRONT_STANDING_BONES,
    hot: ["torsoLow", "hipN"],
    switchHalfway: true,
    loop: 4,
    keys: [
      { at: 0, pose: sidePlank(12, 20), label: "Forearm down, stack your shoulders" },
      { at: 1.2, pose: sidePlank(26, 12), label: "Lift your hip high" },
      { at: 2.8, pose: sidePlank(26, 12) },
    ],
  } satisfies BodyAnim,
};
