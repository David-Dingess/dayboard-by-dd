/**
 * The program engine's vocabulary. Ported verbatim from the standalone app
 * (`src/engine/types.ts`) — the app this tab replaced. See index.ts.
 */

export type PatternId =
  | "squat"
  | "hinge"
  | "push"
  | "pull"
  | "core"
  | "carry"
  | "overhead"
  | "conditioning";

export type SessionKind = "strength" | "walk" | "mobility" | "rest" | "minimum";

export interface Rung {
  id: string;
  name: string;
  /** One line of form coaching, shown under the exercise name in the player. */
  cue: string;
  mode: "reps" | "hold";
  equipment?: string;
}

export interface Ladder {
  patternId: PatternId;
  label: string;
  rungs: Rung[];
}

export interface Station {
  patternId: PatternId;
  rungIndex: number;
  exerciseId: string;
  name: string;
  cue: string;
  mode: "reps" | "hold";
  equipment?: string;
  workSec: number;
  restSec: number;
}

export interface Block {
  id: string;
  kind: "warmup" | "circuit" | "finisher" | "cooldown";
  label: string;
  note?: string;
  rounds: number;
  /** Rest between rounds, in seconds. */
  roundRestSec: number;
  stations: Station[];
}

export interface PhaseInfo {
  index: number;
  name: string;
  startWeek: number;
  endWeek: number;
  blurb: string;
}

export interface Session {
  id: string;
  date: string;
  /** 1-based week within the 52-week program. */
  week: number;
  /**
   * Day of week with `Date#getDay` semantics: 0 = Sunday … 6 = Saturday. (The
   * original comment said "Monday = 1", which is true of Monday and misleading
   * about Sunday — session.ts matches the Sunday reset with `dow === 0`.)
   */
  dayOfWeek: number;
  phase: PhaseInfo;
  kind: SessionKind;
  title: string;
  subtitle: string;
  estMinutes: number;
  isDeload: boolean;
  blocks: Block[];
  /** Walk sessions only. */
  targetMinutes?: number;
  pickups?: number;
  outdoorsNote?: string;
}
