import { CHAIR_FIGURES } from "./chair";
import { CARRY_FIGURES } from "./carry";
import { CONDITIONING_FIGURES } from "./conditioning";
import { FLOOR_FIGURES } from "./floor";
import { HINGE_FIGURES } from "./hinge";
import { MOBILITY_FIGURES } from "./mobility";
import { PRESS_FIGURES } from "./press";
import { PULL_FIGURES } from "./pull";
import { PUSH_FIGURES } from "./push";
import { SQUAT_FIGURES } from "./squat";
import type { FigureAnim } from "./rig";

/**
 * Every drawn exercise animation, keyed by exercise id. The chair routine's
 * moves and the programme's share one engine and one style.
 */
export const FIGURES: Record<string, FigureAnim> = {
  ...CHAIR_FIGURES,
  ...SQUAT_FIGURES,
  ...HINGE_FIGURES,
  ...PRESS_FIGURES,
  ...CARRY_FIGURES,
  ...CONDITIONING_FIGURES,
  ...FLOOR_FIGURES,
  ...PUSH_FIGURES,
  ...PULL_FIGURES,
  ...MOBILITY_FIGURES,
};

export { CHAIR_FIGURES };
export * from "./rig";
