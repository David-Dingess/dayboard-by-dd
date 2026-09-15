import type { BodyAnim, BodyPose, FigureAnim, Limb } from "./rig";
import { STANDING_BOX, retime, standing, workFloor } from "./poses";

/**
 * The standing hinges: kettlebell deadlift, kettlebell swing (also the three
 * conditioning swing sets), and the single-leg RDL. The bridges, which are the
 * hinge ladder's floor rungs, are drawn with the other lying moves in floor.ts.
 */

const feet = {
  legN: { to: [218, 350], bend: -1, end: 0 } as Limb,
  legF: { to: [204, 350], bend: -1, end: 0 } as Limb,
};

const tall = (arms: Pick<BodyPose, "armN" | "armF">) => standing({ pelvis: [206, 192], ...feet, ...arms });

const hinged = (arms: Pick<BodyPose, "armN" | "armF">, torso = -22, pelvis: [number, number] = [158, 208]) =>
  standing({ pelvis, torso, neck: torso - 8, head: torso - 20, ...feet, ...arms });

const kb = [{ kind: "kettlebell", hand: "armN", hang: true }] as BodyAnim["held"];

const deadlift: BodyAnim = {
  kind: "body",
  view: "side",
  viewBox: STANDING_BOX,
  props: [workFloor],
  hot: ["legN.thigh", "hipN"],
  held: kb,
  loop: 4,
  keys: [
    {
      at: 0,
      pose: tall({ armN: { to: [214, 206], bend: 1, end: 90 }, armF: { to: [208, 208], bend: 1, end: 90 } }),
      label: "Stand tall, bell at your thighs",
    },
    {
      at: 0.6,
      pose: tall({ armN: { to: [214, 206], bend: 1, end: 90 }, armF: { to: [208, 208], bend: 1, end: 90 } }),
      label: "Push the hips back, flat back",
    },
    {
      at: 1.8,
      pose: hinged({ armN: { to: [246, 272], bend: 1, end: 90 }, armF: { to: [240, 274], bend: 1, end: 90 } }),
    },
    {
      at: 2.2,
      pose: hinged({ armN: { to: [246, 272], bend: 1, end: 90 }, armF: { to: [240, 274], bend: 1, end: 90 } }),
      label: "Stand tall — don't lean back",
    },
    {
      at: 3.4,
      pose: tall({ armN: { to: [214, 206], bend: 1, end: 90 }, armF: { to: [208, 208], bend: 1, end: 90 } }),
    },
  ],
};

const swing: BodyAnim = {
  kind: "body",
  view: "side",
  viewBox: STANDING_BOX,
  props: [workFloor],
  hot: ["hipN", "legN.thigh"],
  held: [{ kind: "kettlebell", hand: "armN" }],
  loop: 1.8,
  keys: [
    {
      at: 0,
      pose: hinged(
        { armN: { to: [196, 268], bend: 1, end: 120 }, armF: { to: [192, 270], bend: 1, end: 120 } },
        -28,
        [160, 210],
      ),
      label: "Hike it back",
    },
    {
      at: 0.8,
      pose: tall({ armN: { to: [314, 112], bend: 1, end: -8 }, armF: { to: [308, 116], bend: 1, end: -8 } }),
      label: "Snap the hips — arms are ropes",
    },
    {
      at: 1.05,
      pose: tall({ armN: { to: [316, 108], bend: 1, end: -10 }, armF: { to: [310, 112], bend: 1, end: -10 } }),
    },
  ],
};

const rdlUp = standing({
  pelvis: [200, 192],
  legF: { to: [204, 350], bend: -1, end: 0 },
  legN: { to: [196, 350], bend: -1, end: 0 },
  armN: { to: [206, 202], bend: 1, end: 90 },
  armF: { to: [196, 200], bend: 1, end: 90 },
});
const rdlDown = standing({
  pelvis: [178, 200],
  torso: -14,
  neck: -20,
  head: -30,
  legF: { to: [204, 350], bend: -1, end: 0 },
  legN: { to: [22, 186], bend: -1, end: 96 },
  armN: { to: [266, 290], bend: 1, end: 90 },
  armF: { to: [250, 250], bend: 1, end: 90 },
});

/** Halfway: the torso and the back leg move as one straight line, pivoting at the hip. */
const rdlMid = standing({
  pelvis: [190, 196],
  torso: -52,
  neck: -56,
  head: -64,
  legF: { to: [204, 350], bend: -1, end: 0 },
  legN: { to: [96, 322], bend: -1, end: 110 },
  armN: { to: [248, 272], bend: 1, end: 90 },
  armF: { to: [236, 262], bend: 1, end: 90 },
});

export const HINGE_FIGURES: Record<string, FigureAnim> = {
  "hinge-kb-deadlift": deadlift,
  "hinge-kb-swing": swing,
  "cond-swing-15": swing,
  "cond-swing-20": retime(swing, 1, { 1: "Keep the back flat, arms loose" }),
  "cond-swing-30": retime(swing, 1, { 1: "Power from the hips, breathe out at the top" }),
  "hinge-rdl-single": {
    kind: "body",
    view: "side",
    viewBox: STANDING_BOX,
    props: [workFloor],
    hot: ["legF.thigh", "hipN"],
    held: [{ kind: "dumbbell", hand: "armN" }],
    loop: 5,
    keys: [
      { at: 0, pose: rdlUp, label: "Stand on one leg" },
      { at: 0.5, pose: rdlUp, label: "Reach the dumbbell down, back leg lifts" },
      { at: 1.25, pose: rdlMid },
      { at: 2, pose: rdlDown },
      { at: 2.6, pose: rdlDown, label: "Slowly back up" },
      { at: 3.4, pose: rdlMid },
      { at: 4.2, pose: rdlUp },
    ],
  },
};
