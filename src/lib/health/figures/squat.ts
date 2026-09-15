import type { BodyAnim, BodyPose, FigureAnim, Limb } from "./rig";
import { STANDING_BOX, WORK_FLOOR, retime, standing, workFloor } from "./poses";

/**
 * The squat ladder: to a chair with a push from the thighs, to a chair with no
 * hands, bodyweight, then goblet with a kettlebell at the chest — plain, tempo,
 * and one-and-a-half reps.
 */

/** A chair behind the figure whose seat is at the bottom of the squat. */
const chairBehind = { kind: "chair", x: 104, seat: WORK_FLOOR - 76, back: 170, view: "side" } as const;

const feet = {
  legN: { to: [214, 350], bend: -1, end: 0 } as Limb,
  legF: { to: [200, 350], bend: -1, end: 0 } as Limb,
};

const top = (arms: Pick<BodyPose, "armN" | "armF">) => standing({ pelvis: [204, 192], ...feet, ...arms });
const bottom = (arms: Pick<BodyPose, "armN" | "armF">, depth = 1) =>
  standing({
    pelvis: [150 + 8 * (1 - depth), 270 - 40 * (1 - depth)],
    torso: -58 - 14 * (1 - depth),
    neck: -62,
    head: -84,
    ...feet,
    ...arms,
  });
const halfway = (arms: Pick<BodyPose, "armN" | "armF">) =>
  standing({ pelvis: [176, 232], torso: -70, neck: -72, head: -86, ...feet, ...arms });

type Arms = Pick<BodyPose, "armN" | "armF">;

const hanging: Arms = { armN: { to: [210, 198], bend: 1, end: 90 }, armF: { to: [202, 200], bend: 1, end: 90 } };
const forward: Arms = {
  armN: { to: [292, 150], bend: 1, end: -4 },
  armF: { to: [286, 154], bend: 1, end: -4 },
};
const onThighs: Arms = {
  armN: { grab: "legN.knee", offset: [-10, -8], bend: 1, end: 30 },
  armF: { grab: "legF.knee", offset: [-12, -6], bend: 1, end: 30 },
};
/** Standing with the hands resting on the thighs, ready to push — the same grab as the bottom, so it eases. */
const thighsTop: Arms = {
  armN: { grab: "legN.knee", offset: [-4, -34], bend: 1, end: 80 },
  armF: { grab: "legF.knee", offset: [-6, -32], bend: 1, end: 80 },
};
const goblet: Arms = {
  armN: { grab: "chest", offset: [16, 6], bend: 1, end: -80 },
  armF: { grab: "chest", offset: [12, 8], bend: 1, end: -80 },
};

function squat(
  standArms: Pick<BodyPose, "armN" | "armF">,
  sitArms: Pick<BodyPose, "armN" | "armF">,
  extra: Partial<BodyAnim> = {},
  labels: [string, string] = ["Sit back", "Stand up"],
): BodyAnim {
  return {
    kind: "body",
    view: "side",
    viewBox: STANDING_BOX,
    props: [workFloor],
    hot: ["legN.thigh", "hipN"],
    loop: 3.6,
    keys: [
      { at: 0, pose: top(standArms), label: "Stand tall" },
      { at: 0.5, pose: top(standArms), label: labels[0] },
      { at: 1.6, pose: bottom(sitArms) },
      { at: 2, pose: bottom(sitArms), label: labels[1] },
      { at: 3, pose: top(standArms) },
    ],
    ...extra,
  };
}

const gobletSquat = squat(goblet, goblet, {
  held: [{ kind: "kettlebell", hand: "armN", hang: true }],
}, ["Sit between your knees", "Drive up"]);

export const SQUAT_FIGURES: Record<string, FigureAnim> = {
  "squat-chair": squat(thighsTop, onThighs, { props: [chairBehind, workFloor] }, [
    "Sit back until you touch the seat",
    "Push off your thighs, stand",
  ]),
  "squat-box": squat(forward, forward, { props: [chairBehind, workFloor] }, [
    "Sit back, tap the seat",
    "Stand — no hands",
  ]),
  "squat-bodyweight": squat(hanging, forward, {}, ["Hips back, knees over toes", "Stand up"]),
  "squat-goblet": gobletSquat,
  "squat-goblet-tempo": retime(gobletSquat, 2.4, { 1: "Three seconds down", 3: "One at the bottom, three up" }),
  "squat-goblet-15": {
    ...gobletSquat,
    loop: 5.6,
    keys: [
      { at: 0, pose: top(goblet), label: "Stand tall" },
      { at: 0.4, pose: top(goblet), label: "All the way down" },
      { at: 1.5, pose: bottom(goblet) },
      { at: 1.8, pose: bottom(goblet), label: "Halfway up" },
      { at: 2.5, pose: halfway(goblet) },
      { at: 2.8, pose: halfway(goblet), label: "Back down" },
      { at: 3.5, pose: bottom(goblet) },
      { at: 3.8, pose: bottom(goblet), label: "All the way up — one rep" },
      { at: 5, pose: top(goblet) },
    ],
  },
};
