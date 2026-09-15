import type { BodyAnim, BodyPose, FigureAnim, Limb } from "./rig";
import { FRONT_STANDING_BONES } from "./rig";
import { TALL, standingFront, workFloor } from "./poses";

/**
 * The overhead press ladder, from the front so both arms and the lockout by
 * the ears are visible: dumbbell press (5 and 10 lb, then tempo), see-saw, and
 * the single-arm kettlebell press.
 */

const rackN: Limb = { a: [112, -100], end: -90 };
const rackF: Limb = { a: [68, -80], end: -90 };
const upN: Limb = { a: [-96, -92], end: -90 };
const upF: Limb = { a: [-84, -88], end: -90 };
const sideF: Limb = { a: [84, 88], end: 88 };

const pose = (armN: Limb, armF: Limb, over: Partial<BodyPose> = {}) => standingFront({ armN, armF, ...over });

const base: Pick<BodyAnim, "kind" | "view" | "viewBox" | "props" | "bones"> = {
  kind: "body",
  view: "front",
  viewBox: TALL,
  props: [workFloor],
  bones: FRONT_STANDING_BONES,
};

function press(labels: [string, string, string], lowerSec = 1): BodyAnim {
  return {
    ...base,
    hot: ["armN.upper", "armF.upper"],
    held: [
      { kind: "dumbbell", hand: "armN" },
      { kind: "dumbbell", hand: "armF" },
    ],
    loop: 2.2 + lowerSec + 0.4,
    keys: [
      { at: 0, pose: pose(rackN, rackF), label: labels[0] },
      { at: 0.4, pose: pose(rackN, rackF), label: labels[1] },
      { at: 1.2, pose: pose(upN, upF) },
      { at: 1.6, pose: pose(upN, upF), label: labels[2] },
      { at: 1.6 + lowerSec, pose: pose(rackN, rackF) },
    ],
  };
}

export const PRESS_FIGURES: Record<string, FigureAnim> = {
  "press-5": press(["Dumbbells at your shoulders", "Press straight up", "Arms by your ears, lower"]),
  "press-10": press(["Squeeze your glutes", "Press — don't lean back", "Lower with control"]),
  "press-tempo": press(["Dumbbells at your shoulders", "Press up", "Lower for a slow three"], 3),
  "press-seesaw": {
    ...base,
    hot: ["armN.upper", "armF.upper"],
    held: [
      { kind: "dumbbell", hand: "armN" },
      { kind: "dumbbell", hand: "armF" },
    ],
    loop: 3,
    keys: [
      { at: 0, pose: pose(upN, rackF), label: "One goes up" },
      { at: 0.5, pose: pose(upN, rackF), label: "As the other comes down" },
      { at: 1.3, pose: pose(rackN, upF) },
      { at: 2, pose: pose(rackN, upF) },
    ],
  },
  "press-kb": {
    ...base,
    hot: ["armN.upper"],
    held: [{ kind: "kettlebell", hand: "armN" }],
    switchHalfway: true,
    loop: 2.8,
    keys: [
      { at: 0, pose: pose(rackN, sideF), label: "Bell on your forearm" },
      { at: 0.4, pose: pose(rackN, sideF), label: "Press, palm turns forward" },
      { at: 1.2, pose: pose(upN, sideF) },
      { at: 1.6, pose: pose(upN, sideF), label: "Lower to the rack" },
      { at: 2.4, pose: pose(rackN, sideF) },
    ],
  },
};
