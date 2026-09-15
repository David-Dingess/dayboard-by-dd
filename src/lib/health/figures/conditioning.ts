import type { BodyAnim, BodyPose, FigureAnim, Limb } from "./rig";
import { FRONT_STANDING_BONES } from "./rig";
import { march } from "./carry";
import { STANDING_BOX, TALL, standing, standingFront, workFloor } from "./poses";

/**
 * The warm-up and the non-kettlebell conditioning rungs: marches, step-touch,
 * ankle and hip rocks, arm circles. The swing sets are the kettlebell swing and
 * live in hinge.ts.
 */

type Arms = Pick<BodyPose, "armN" | "armF">;

const pumping = (phase: "nearUp" | "farUp" | "down"): Arms =>
  phase === "nearUp"
    ? { armN: { to: [176, 214], bend: 1, end: 110 }, armF: { to: [262, 136], bend: 1, end: -60 } }
    : phase === "farUp"
      ? { armN: { to: [262, 136], bend: 1, end: -60 }, armF: { to: [176, 214], bend: 1, end: 110 } }
      : { armN: { to: [224, 176], bend: 1, end: 20 }, armF: { to: [218, 178], bend: 1, end: 20 } };

const swinging = (phase: "nearUp" | "farUp" | "down"): Arms =>
  phase === "nearUp"
    ? { armN: { to: [178, 200], bend: 1, end: 100 }, armF: { to: [236, 196], bend: 1, end: 70 } }
    : phase === "farUp"
      ? { armN: { to: [236, 196], bend: 1, end: 70 }, armF: { to: [178, 200], bend: 1, end: 100 } }
      : { armN: { to: [206, 202], bend: 1, end: 90 }, armF: { to: [200, 202], bend: 1, end: 90 } };

const stepTouch = (side: -1 | 1): BodyPose =>
  standingFront({
    pelvis: [200 + 34 * side, 198],
    legN: { to: [side < 0 ? 130 : 214, 350], bend: 1, end: 180 },
    legF: { to: [side < 0 ? 186 : 270, 350], bend: -1, end: 0 },
    armN: { a: side < 0 ? [-128, -122] : [-100, -96], end: side < 0 ? -120 : -96 },
    armF: { a: side < 0 ? [-80, -84] : [-52, -58], end: side < 0 ? -84 : -60 },
  });

const rock = (forward: boolean): BodyPose =>
  standing({
    pelvis: forward ? [214, 232] : [186, 236],
    torso: forward ? -84 : -96,
    neck: forward ? -84 : -94,
    head: -90,
    legN: { to: [262, 350], bend: -1, end: 0 },
    legF: { to: [146, 350], bend: -1, end: 0 },
    armN: { grab: "hip.front", offset: [-2, -8], bend: -1, end: 200 },
    armF: { grab: "hip.front", offset: [-8, -6], bend: -1, end: 200 },
  });

/** Straight arms turning in a full circle, seen from the side. */
const circle = (deg: number): BodyPose => {
  const armN: Limb = { a: [deg, deg], end: deg };
  const armF: Limb = { a: [deg + 8, deg + 8], end: deg + 8 };
  return standing({ armN, armF });
};

export const CONDITIONING_FIGURES: Record<string, FigureAnim> = {
  "cond-march": march({ arms: pumping, loop: 1, label: "Knees up, arms pumping" }),
  "warmup-2": march({ arms: swinging, loop: 1.8, label: "Knees to hip height" }),
  "cond-step-touch": {
    kind: "body",
    view: "front",
    viewBox: TALL,
    props: [workFloor],
    bones: FRONT_STANDING_BONES,
    hot: ["legN.thigh", "legF.thigh"],
    loop: 2.2,
    keys: [
      { at: 0, pose: stepTouch(-1), label: "Step, touch, reach overhead" },
      { at: 0.3, pose: stepTouch(-1) },
      { at: 1.1, pose: stepTouch(1) },
      { at: 1.4, pose: stepTouch(1) },
    ],
  } satisfies BodyAnim,
  "warmup-0": {
    kind: "body",
    view: "side",
    viewBox: STANDING_BOX,
    props: [workFloor],
    hot: ["legN.shin", "hipN"],
    loop: 2.6,
    keys: [
      { at: 0, pose: rock(false), label: "Low stance, rock forward" },
      { at: 1.1, pose: rock(true), label: "And back" },
      { at: 1.3, pose: rock(true) },
      { at: 2.4, pose: rock(false), label: "Low stance, rock forward" },
    ],
  } satisfies BodyAnim,
  "warmup-1": {
    kind: "body",
    view: "side",
    viewBox: TALL,
    props: [workFloor],
    hot: ["shoulderN"],
    ease: "linear",
    loop: 4.8,
    keys: [
      { at: 0, pose: circle(90), label: "Big slow circles forward" },
      { at: 0.6, pose: circle(0) },
      { at: 1.2, pose: circle(-90) },
      { at: 1.8, pose: circle(-180) },
      { at: 2.4, pose: circle(-270), label: "Now backward" },
      { at: 3, pose: circle(-180) },
      { at: 3.6, pose: circle(-90) },
      { at: 4.2, pose: circle(0) },
    ],
  } satisfies BodyAnim,
};
