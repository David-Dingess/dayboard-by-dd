import type { BodyAnim, BodyPose, FigureAnim, GrabLimb, IkLimb, Pt } from "./rig";
import {
  FULL,
  HAND_FIST,
  HAND_HOOK,
  HAND_STRAIGHT,
  HAND_TABLETOP,
  STAND_FLOOR,
  floor,
  frontChair,
  seated,
  seatedFront,
  sideChair,
  standFloor,
} from "./poses";

/**
 * Chair five, drawn: one looping animation per move of the chair routine
 * (lib/health/chair.ts), all in or at the desk chair.
 */

export const CHAIR_FIGURES: Record<string, FigureAnim> = {
  "chair-tendon-glides": {
    kind: "hand",
    viewBox: [36, 30, 330, 330],
    props: [],
    hot: ["fingers"],
    loop: 10.8,
    keys: [
      { at: 0, pose: HAND_STRAIGHT, label: "Straight" },
      { at: 0.8, pose: HAND_STRAIGHT, label: "Hook" },
      { at: 1.7, pose: HAND_HOOK },
      { at: 2.7, pose: HAND_HOOK, label: "Straight" },
      { at: 3.6, pose: HAND_STRAIGHT },
      { at: 4.4, pose: HAND_STRAIGHT, label: "Fist" },
      { at: 5.3, pose: HAND_FIST },
      { at: 6.3, pose: HAND_FIST, label: "Straight" },
      { at: 7.2, pose: HAND_STRAIGHT },
      { at: 8.0, pose: HAND_STRAIGHT, label: "Tabletop" },
      { at: 8.9, pose: HAND_TABLETOP },
      { at: 9.9, pose: HAND_TABLETOP, label: "Straight" },
    ],
  },

  "chair-nerve-glide": {
    kind: "body",
    view: "front",
    viewBox: FULL,
    props: [frontChair, floor],
    hot: ["armN.upper", "armN.fore"],
    loop: 5,
    keys: [
      { at: 0, pose: seatedFront({ armN: { to: [56, 140], bend: -1, end: 180 } }), label: "Arm out, palm up" },
      {
        at: 1,
        pose: seatedFront({ armN: { to: [56, 140], bend: -1, end: 180 } }),
        label: "Wrist back, head away",
      },
      {
        at: 2.2,
        pose: seatedFront({ neck: -76, head: -54, armN: { to: [56, 140], bend: -1, end: 92 } }),
      },
      {
        at: 3,
        pose: seatedFront({ neck: -76, head: -54, armN: { to: [56, 140], bend: -1, end: 92 } }),
        label: "Ease back out",
      },
      { at: 4.2, pose: seatedFront({ armN: { to: [56, 140], bend: -1, end: 180 } }) },
    ],
  },

  "chair-wrist-flexor": wristStretch(-72, "Arm straight, palm up", "Draw the fingers back", {
    grab: "armN.tip",
    offset: [3, 2],
    bend: 1,
    end: 150,
  }),

  "chair-wrist-extensor": wristStretch(78, "Arm straight, palm down", "Press the back of the hand in", {
    grab: "armN.mid",
    offset: [9, 0],
    bend: 1,
    end: 100,
  }),

  "chair-hamstring": (() => {
    const base = {
      pelvis: [194, 232] as Pt,
      legF: { to: [262, 311], bend: -1, end: 0 } as IkLimb,
    };
    const upright = (foot: number) =>
      seated({
        ...base,
        legN: { to: [322, 312], bend: -1, end: foot },
        armN: { to: [236, 238], bend: 1, end: 20 },
        armF: { to: [228, 240], bend: 1, end: 20 },
      });
    const hinged = seated({
      ...base,
      torso: -56,
      neck: -52,
      head: -62,
      legN: { to: [322, 312], bend: -1, end: -65 },
      armN: { to: [268, 262], bend: 1, end: 25 },
      armF: { to: [260, 264], bend: 1, end: 25 },
    });
    return {
      kind: "body",
      view: "side",
      viewBox: FULL,
      props: [sideChair(), floor],
      hot: ["legN.thigh", "legN.shin"],
      loop: 7.6,
      keys: [
        { at: 0, pose: upright(0), label: "Edge of the seat, leg straight" },
        { at: 0.9, pose: upright(0), label: "Toes up" },
        { at: 1.7, pose: upright(-65) },
        { at: 2.3, pose: upright(-65), label: "Hinge forward, flat back" },
        { at: 3.6, pose: hinged },
        { at: 5.8, pose: hinged, label: "Ease up" },
        { at: 7.0, pose: upright(0) },
      ],
    } satisfies BodyAnim;
  })(),

  "chair-calf": (() => {
    const stance = (pelvis: Pt, torso: number): BodyPose =>
      seated({
        pelvis,
        torso,
        neck: torso,
        head: torso - 10,
        armN: { to: [288, 190], bend: 1, end: 0 },
        armF: { to: [280, 191], bend: 1, end: 0 },
        legN: { to: [118, 332], bend: -1, end: 0 },
        legF: { to: [232, 332], bend: -1, end: 0 },
      });
    const start = stance([186, 186], -78);
    const lean = stance([200, 192], -66);
    const soft = stance([196, 206], -66);
    return {
      kind: "body",
      view: "side",
      viewBox: FULL,
      props: [{ kind: "desk", x: 270, top: 198, floor: STAND_FLOOR }, standFloor],
      hot: ["legN.shin"],
      loop: 8.8,
      keys: [
        { at: 0, pose: start, label: "Hands on the desk, one foot back" },
        { at: 1, pose: start, label: "Lean in, back heel down" },
        { at: 2.2, pose: lean },
        { at: 4.2, pose: lean, label: "Soften the back knee" },
        { at: 5.2, pose: soft },
        { at: 7, pose: soft, label: "Ease out" },
        { at: 8.2, pose: start },
      ],
    } satisfies BodyAnim;
  })(),

  "chair-chin-tuck": {
    kind: "body",
    view: "side",
    viewBox: [64, 30, 210, 210],
    props: [sideChair(), { kind: "guide", x: 182, y1: 40, y2: 150 }],
    hot: ["neck"],
    loop: 5.4,
    keys: [
      { at: 0, pose: seated({ neck: -68, head: -90 }), label: "Eyes level" },
      { at: 0.8, pose: seated({ neck: -68, head: -90 }), label: "Slide the chin straight back" },
      { at: 1.8, pose: seated({ neck: -106, head: -92 }) },
      { at: 3.8, pose: seated({ neck: -106, head: -92 }), label: "Release" },
      { at: 4.8, pose: seated({ neck: -68, head: -90 }) },
    ],
  },

  "chair-shoulder-rolls": {
    kind: "body",
    view: "side",
    viewBox: [60, 50, 210, 210],
    props: [sideChair()],
    hot: ["shoulderN"],
    ease: "linear",
    loop: 2.6,
    keys: [
      { at: 0, pose: seated({ shoulderShift: [6, 2] }), label: "Up, back, down — big and slow" },
      { at: 0.65, pose: seated({ shoulderShift: [2, -11] }) },
      { at: 1.3, pose: seated({ shoulderShift: [-9, -5] }) },
      { at: 1.95, pose: seated({ shoulderShift: [-6, 6] }) },
    ],
  },

  "chair-figure-four": (() => {
    const pose = (torso: number): BodyPose =>
      seated({
        torso,
        neck: torso + 4,
        head: torso < -80 ? -90 : torso - 6,
        legF: { to: [240, 311], bend: -1, end: 0 },
        legN: { grab: "legF.knee", offset: [6, -14], bend: -1, end: 5, len: [40, 52] },
        armN: { grab: "legN.knee", offset: [2, -8], bend: 1, end: 20 },
        armF: { grab: "legF.knee", offset: [6, -10], bend: 1, end: 20 },
      });
    return {
      kind: "body",
      view: "side",
      viewBox: FULL,
      props: [sideChair(), floor],
      hot: ["legN.thigh"],
      loop: 6.4,
      keys: [
        { at: 0, pose: pose(-92), label: "Ankle on the opposite knee" },
        { at: 1, pose: pose(-92), label: "Sit tall, lean the chest forward" },
        { at: 2.4, pose: pose(-64) },
        { at: 4.6, pose: pose(-64), label: "Ease up" },
        { at: 5.8, pose: pose(-92) },
      ],
    } satisfies BodyAnim;
  })(),

  "chair-thoracic-extension": (() => {
    const pose = (torso: number, neck: number, head: number): BodyPose =>
      seated({
        pelvis: [132, 232],
        torso,
        neck,
        head,
        armN: { grab: "head.back", offset: [0, -6], bend: -1, end: -80 },
        armF: { grab: "head.back", offset: [3, -3], bend: -1, end: -80 },
        legN: { to: [212, 310], bend: -1, end: 0 },
        legF: { to: [204, 311], bend: -1, end: 0 },
      });
    const up = pose(-90, -86, -88);
    const back = pose(-116, -128, -134);
    return {
      kind: "body",
      view: "side",
      viewBox: FULL,
      props: [sideChair(160, 176), floor],
      hot: ["torso"],
      loop: 6.4,
      keys: [
        { at: 0, pose: up, label: "Hands behind your head, elbows wide" },
        { at: 1, pose: up, label: "Lean back over the top of the backrest" },
        { at: 2.4, pose: back },
        { at: 4.6, pose: back, label: "Come back up" },
        { at: 5.8, pose: up },
      ],
    } satisfies BodyAnim;
  })(),

  "chair-seated-twist": (() => {
    const neutral = seatedFront({});
    const twisted = seatedFront({
      shoulderW: 13,
      shoulderShift: [4, 0],
      headTurn: 0.9,
      armN: { to: [226, 246], bend: -1, end: 80 },
      armF: { to: [266, 168], bend: 1, end: -60 },
    });
    return {
      kind: "body",
      view: "front",
      viewBox: FULL,
      props: [frontChair, floor],
      hot: ["torso"],
      behind: ["armF"],
      loop: 6.2,
      keys: [
        { at: 0, pose: neutral, label: "Sit tall" },
        { at: 0.8, pose: neutral, label: "Hand to the opposite knee, turn from the ribs" },
        { at: 2.2, pose: twisted },
        { at: 4.4, pose: twisted, label: "Back to center" },
        { at: 5.6, pose: neutral },
      ],
    } satisfies BodyAnim;
  })(),
};

function wristStretch(bentHand: number, setup: string, action: string, other: GrabLimb): BodyAnim {
  const pose = (hand: number) =>
    seated({
      armN: { to: [270, 132], bend: 1, end: hand },
      armF: other,
    });
  return {
    kind: "body",
    view: "side",
    viewBox: [100, 40, 220, 220],
    props: [sideChair(), floor],
    hot: ["armN.fore"],
    loop: 5.6,
    keys: [
      { at: 0, pose: pose(0), label: setup },
      { at: 0.8, pose: pose(0), label: action },
      { at: 2, pose: pose(bentHand) },
      { at: 4, pose: pose(bentHand), label: "Ease off" },
      { at: 5, pose: pose(0) },
    ],
  };
}
