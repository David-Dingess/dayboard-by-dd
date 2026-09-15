import type { BodyAnim, BodyPose, FigureAnim, Held, HotPart, Limb } from "./rig";
import { FRONT_STANDING_BONES } from "./rig";
import { STANDING_BOX, TALL, standing, standingFront, workFloor } from "./poses";

/**
 * Carries and marches. The holds are drawn from the front — standing tall
 * against a weight on one side is the whole point, and only the front shows
 * shoulders staying level — and the marches from the side, where the knees are.
 * The standing march and fast march of the warm-up and conditioning ladder use
 * the same stride.
 */

type Arms = Pick<BodyPose, "armN" | "armF">;

/** One stride cycle: near knee up, both down, far knee up, both down. */
export function march(opts: {
  arms: (phase: "nearUp" | "farUp" | "down") => Arms;
  held?: Held[];
  hot?: HotPart[];
  loop: number;
  label: string;
  viewBox?: BodyAnim["viewBox"];
  switchHalfway?: boolean;
}): BodyAnim {
  const planted = (x: number): Limb => ({ to: [x, 350], bend: -1, end: 0 });
  const lifted: Limb = { to: [276, 272], bend: -1, end: 24 };
  const at = (phase: "nearUp" | "farUp" | "down"): BodyPose =>
    standing({
      pelvis: [200, phase === "down" ? 192 : 190],
      legN: phase === "nearUp" ? lifted : planted(206),
      legF: phase === "farUp" ? lifted : planted(196),
      ...opts.arms(phase),
    });
  const q = opts.loop / 4;
  return {
    kind: "body",
    view: "side",
    viewBox: opts.viewBox ?? STANDING_BOX,
    props: [workFloor],
    hot: opts.hot ?? ["legN.thigh"],
    held: opts.held,
    loop: opts.loop,
    switchHalfway: opts.switchHalfway,
    keys: [
      { at: 0, pose: at("nearUp"), label: opts.label },
      { at: q, pose: at("down") },
      { at: 2 * q, pose: at("farUp") },
      { at: 3 * q, pose: at("down") },
    ],
  };
}

const atSides: Arms = {
  armN: { to: [208, 200], bend: 1, end: 90 },
  armF: { to: [196, 202], bend: 1, end: 90 },
};

/** A still hold with a slow breath in it, so the figure is visibly alive. */
function frontHold(armN: Limb, armF: Limb, held: Held[], labels: [string, string], hot: HotPart[]): BodyAnim {
  const pose = (chest: number) => standingFront({ armN, armF, chest });
  return {
    kind: "body",
    view: "front",
    viewBox: TALL,
    props: [workFloor, { kind: "guide", x: 200, y1: -40, y2: 350 }],
    bones: FRONT_STANDING_BONES,
    hot,
    held,
    switchHalfway: true,
    loop: 5,
    keys: [
      { at: 0, pose: pose(1), label: labels[0] },
      { at: 2.5, pose: pose(1.08), label: labels[1] },
    ],
  };
}

const bellAtSide: Limb = { a: [96, 92], end: 92 };
const otherAtSide: Limb = { a: [84, 88], end: 88 };
const overhead: Limb = { a: [-94, -91], end: -90 };

export const CARRY_FIGURES: Record<string, FigureAnim> = {
  "carry-suitcase-hold": frontHold(
    bellAtSide,
    otherAtSide,
    [{ kind: "kettlebell", hand: "armN", hang: true }],
    ["Bell in one hand, stand tall", "Resist the lean"],
    ["torso"],
  ),
  "carry-suitcase-march": march({
    arms: () => atSides,
    held: [{ kind: "kettlebell", hand: "armN", hang: true }],
    loop: 2.4,
    label: "March — ribs down, shoulders level",
    hot: ["torso", "legN.thigh"],
    switchHalfway: true,
  }),
  "carry-farmer-march": march({
    arms: () => atSides,
    held: [
      { kind: "dumbbell", hand: "armN" },
      { kind: "dumbbell", hand: "armF" },
    ],
    loop: 2.8,
    label: "Knees to hip height, slow and tall",
    hot: ["torso", "legN.thigh"],
  }),
  "carry-overhead-hold": frontHold(
    overhead,
    otherAtSide,
    [{ kind: "dumbbell", hand: "armN" }],
    ["Lock it out overhead", "Biceps by your ear"],
    ["armN.upper", "torso"],
  ),
  "carry-overhead-march": march({
    arms: () => ({ armN: { to: [204, -16], bend: 1, end: -90 }, armF: atSides.armF }),
    held: [{ kind: "dumbbell", hand: "armN" }],
    loop: 2.8,
    label: "Locked out overhead, marching",
    hot: ["armN.upper", "legN.thigh"],
    viewBox: TALL,
    switchHalfway: true,
  }),
};
