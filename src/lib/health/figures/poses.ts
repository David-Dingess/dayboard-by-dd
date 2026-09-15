import type { BodyPose, HandPose, Prop, Pt } from "./rig";

/**
 * Base poses and props shared by the animation families. A family file takes one
 * of these and overrides the handful of fields its move changes, which keeps a
 * whole squat to a dozen lines and every figure the same proportions.
 */

export const SEAT_FLOOR = 322;
export const STAND_FLOOR = 342;
export const FULL: [number, number, number, number] = [0, 0, 400, 400];

export const floor: Prop = { kind: "floor", y: SEAT_FLOOR };
export const standFloor: Prop = { kind: "floor", y: STAND_FLOOR };
export const sideChair = (x = 160, back = 118): Prop => ({ kind: "chair", x, seat: 246, back, view: "side" });
export const frontChair: Prop = { kind: "chair", x: 200, seat: 246, back: 118, view: "front" };

export const SEATED: BodyPose = {
  pelvis: [165, 232],
  torso: -92,
  shoulderShift: [0, 0],
  neck: -88,
  head: -90,
  shoulderW: 34,
  headTurn: 0,
  armN: { to: [222, 220], bend: 1, end: 8 },
  armF: { to: [212, 222], bend: 1, end: 8 },
  legN: { to: [246, 310], bend: -1, end: 0 },
  legF: { to: [238, 311], bend: -1, end: 0 },
};

export const SEATED_FRONT: BodyPose = {
  ...SEATED,
  pelvis: [200, 232],
  torso: -90,
  neck: -90,
  head: -90,
  armN: { to: [172, 250], bend: 1, end: 95 },
  armF: { to: [228, 250], bend: -1, end: 85 },
  legN: { a: [128, 93], end: 180 },
  legF: { a: [52, 87], end: 0 },
};

export const seated = (over: Partial<BodyPose>): BodyPose => ({ ...SEATED, ...over });
export const seatedFront = (over: Partial<BodyPose>): BodyPose => ({ ...SEATED_FRONT, ...over });

export const HAND_STRAIGHT: HandPose = { mcp: 0, pip: 0, dip: 0, thumb: 32 };
export const HAND_HOOK: HandPose = { mcp: 0, pip: 95, dip: 75, thumb: 32 };
export const HAND_FIST: HandPose = { mcp: 88, pip: 100, dip: 65, thumb: 75 };
export const HAND_TABLETOP: HandPose = { mcp: 88, pip: 0, dip: 0, thumb: 32 };

export type { Pt };

/* ------------------------------------------------------------ standing --- */

/** The floor every standing, kneeling and lying workout figure uses. */
export const WORK_FLOOR = 360;
export const workFloor: Prop = { kind: "floor", y: WORK_FLOOR };
/** Standing, with room above the head for a press or a reach. */
export const TALL: [number, number, number, number] = [-20, -70, 440, 440];
/** Standing, nothing overhead. */
export const STANDING_BOX: [number, number, number, number] = [0, -10, 400, 400];

/** Side view, facing right, arms hanging, feet under the hips. */
export const STANDING: BodyPose = {
  pelvis: [200, 192],
  torso: -90,
  shoulderShift: [0, 0],
  neck: -90,
  head: -90,
  shoulderW: 34,
  headTurn: 0,
  spine: 0,
  chest: 1,
  armN: { to: [206, 200], bend: 1, end: 90 },
  armF: { to: [198, 202], bend: 1, end: 90 },
  legN: { to: [208, 350], bend: -1, end: 0 },
  legF: { to: [194, 350], bend: -1, end: 0 },
};

/** Front view, standing, arms at the sides. Use with FRONT_STANDING_BONES. */
export const STANDING_FRONT: BodyPose = {
  ...STANDING,
  armN: { a: [96, 92], end: 92 },
  armF: { a: [84, 88], end: 88 },
  legN: { a: [93, 91], end: 180 },
  legF: { a: [87, 89], end: 0 },
};

export const standing = (over: Partial<BodyPose>): BodyPose => ({ ...STANDING, ...over });
export const standingFront = (over: Partial<BodyPose>): BodyPose => ({ ...STANDING_FRONT, ...over });

/**
 * The same animation, slower or faster: every key time and the loop scaled.
 * Labels can be replaced by index for a tempo version that says "three seconds".
 */
export function retime<A extends { keys: { at: number; label?: string }[]; loop: number }>(
  anim: A,
  factor: number,
  labels: Record<number, string> = {},
): A {
  return {
    ...anim,
    loop: anim.loop * factor,
    keys: anim.keys.map((key, i) => ({ ...key, at: key.at * factor, label: labels[i] ?? key.label })),
  };
}
