import type { PatternId, PhaseInfo } from "./types";

/**
 * "Off the Chair in Five Phases" — a 52-week ramp from a mostly-seated baseline
 * (~60–120 sporadic minutes a week) to the WHO target band of 150–300 weekly
 * minutes plus strength twice a week.
 *
 * Phases set the shape; the numbers *inside* a phase are interpolated week by
 * week. That matters: a phase model with constant values steps volume up 40–50%
 * at every boundary, which is exactly the kind of jump the training-load
 * evidence associates with a sharp rise in injury risk. Interpolating keeps the
 * ramp near 2–3% a week on average.
 *
 * Some steps are unavoidably chunky, because you cannot add two thirds of a
 * strength day — adding the third session, or the fourth round, lands as a
 * mid-teens percentage jump. Those are deliberately placed while the absolute
 * volumes are still small, and every seventh week is a deload that unloads
 * whatever the previous block added.
 *
 * `rungCap` is the structural safety rail: a phase caps how far up any ladder
 * you can climb, so "too easy" can accelerate you within a phase but can never
 * jump you onto a movement the ramp has not earned yet.
 */
export interface PhaseConfig extends PhaseInfo {
  strengthDays: number[];
  /** Phase 1 only: the reduced schedule used before `strengthRampWeek`. */
  strengthDaysEarly?: number[];
  strengthRampWeek?: number;
  walkDays: number[];
  longWalkDay?: number;
  stationCount: number;
  /** Rounds interpolate from the first value to the second across the phase. */
  rounds: [number, number];
  workSec: number;
  restSec: number;
  roundRestSec: number;
  /** Walk length in minutes, interpolated across the phase. */
  walkMinutes: [number, number];
  longWalkMinutes?: [number, number];
  pickups: number;
  conditioning: boolean;
  rungCap: number;
  mobilityMinutes: number;
}

export const PHASES: PhaseConfig[] = [
  {
    index: 1,
    name: "Showing up",
    startWeek: 1,
    endWeek: 6,
    blurb:
      "The only goal is that the habit exists. Short strength circuits, easy walks, and a day off in the middle of the week.",
    strengthDays: [1, 3, 5],
    strengthDaysEarly: [1, 5],
    strengthRampWeek: 5,
    walkDays: [2, 4, 6],
    stationCount: 4,
    rounds: [2, 2],
    workSec: 30,
    restSec: 30,
    roundRestSec: 45,
    walkMinutes: [18, 24],
    pickups: 0,
    conditioning: false,
    rungCap: 1,
    mobilityMinutes: 10,
  },
  {
    index: 2,
    name: "Foundation",
    startWeek: 7,
    endWeek: 14,
    blurb:
      "The kettlebell shows up and circuits grow a fifth station, then a third round. Walks stretch toward half an hour.",
    strengthDays: [1, 3, 5],
    walkDays: [2, 4, 6],
    stationCount: 5,
    rounds: [2, 3],
    workSec: 35,
    restSec: 25,
    roundRestSec: 45,
    walkMinutes: [24, 28],
    pickups: 0,
    conditioning: false,
    rungCap: 2,
    mobilityMinutes: 12,
  },
  {
    index: 3,
    name: "Building",
    startWeek: 15,
    endWeek: 26,
    blurb:
      "Work periods lengthen, a conditioning finisher appears, and Saturday becomes a proper long walk.",
    strengthDays: [1, 3, 5],
    walkDays: [2, 4],
    longWalkDay: 6,
    stationCount: 5,
    rounds: [3, 3],
    workSec: 40,
    restSec: 20,
    roundRestSec: 45,
    walkMinutes: [26, 32],
    longWalkMinutes: [35, 50],
    pickups: 0,
    conditioning: true,
    rungCap: 3,
    mobilityMinutes: 15,
  },
  {
    index: 4,
    name: "Power and pace",
    startWeek: 27,
    endWeek: 38,
    blurb:
      "A fourth round arrives, swings drive the finisher, and walks pick up three one-minute surges. This is where the aerobic base really moves.",
    strengthDays: [1, 3, 5],
    walkDays: [2, 4],
    longWalkDay: 6,
    stationCount: 5,
    rounds: [3, 4],
    workSec: 40,
    restSec: 20,
    roundRestSec: 30,
    walkMinutes: [32, 36],
    longWalkMinutes: [50, 58],
    pickups: 3,
    conditioning: true,
    rungCap: 4,
    mobilityMinutes: 15,
  },
  {
    index: 5,
    name: "Cruise altitude",
    startWeek: 39,
    endWeek: 52,
    blurb:
      "Six stations at a tighter work-to-rest ratio, and enough weekly minutes to sit in the middle of the guideline band. From here it repeats — that is the point.",
    strengthDays: [1, 3, 5],
    walkDays: [2, 4],
    longWalkDay: 6,
    stationCount: 6,
    rounds: [4, 4],
    workSec: 35,
    restSec: 15,
    roundRestSec: 30,
    walkMinutes: [36, 40],
    longWalkMinutes: [58, 66],
    pickups: 3,
    conditioning: true,
    rungCap: 99,
    mobilityMinutes: 20,
  },
];

/**
 * Weeks 6, 13, 20, 27 … — a fixed seven-week rhythm, at reduced volume. It does
 * not line up with the phase boundaries and is not meant to: the "block" here is
 * the seven weeks, not the phase.
 */
export function isDeloadWeek(week: number): boolean {
  return week % 7 === 6;
}

export function phaseForWeek(week: number): PhaseConfig {
  const clamped = Math.max(1, week);
  for (const phase of PHASES) {
    if (clamped >= phase.startWeek && clamped <= phase.endWeek) return phase;
  }
  // Past week 52 the program holds at cruise altitude rather than ending.
  return PHASES[PHASES.length - 1];
}

/** Position of `week` within its phase, 0 at the first week and 1 at the last. */
function phaseProgress(phase: PhaseConfig, week: number): number {
  const span = phase.endWeek - phase.startWeek;
  if (span <= 0) return 0;
  const t = (Math.min(week, phase.endWeek) - phase.startWeek) / span;
  return Math.min(1, Math.max(0, t));
}

function lerp(range: [number, number], t: number): number {
  return Math.round(range[0] + (range[1] - range[0]) * t);
}

/** Everything the session builder needs for one specific week. */
export interface WeekConfig {
  week: number;
  phase: PhaseConfig;
  isDeload: boolean;
  strengthDays: number[];
  walkDays: number[];
  longWalkDay?: number;
  stationCount: number;
  rounds: number;
  workSec: number;
  restSec: number;
  roundRestSec: number;
  finisherRounds: number;
  walkMinutes: number;
  longWalkMinutes: number;
  pickups: number;
  conditioning: boolean;
  rungCap: number;
  mobilityMinutes: number;
}

export function weekConfig(week: number): WeekConfig {
  const phase = phaseForWeek(week);
  const t = phaseProgress(phase, week);
  const deload = isDeloadWeek(week);

  const strengthDays =
    phase.strengthDaysEarly && phase.strengthRampWeek && week < phase.strengthRampWeek
      ? phase.strengthDaysEarly
      : phase.strengthDays;

  const rounds = lerp(phase.rounds, t);
  const walk = lerp(phase.walkMinutes, t);
  const longWalk = phase.longWalkMinutes ? lerp(phase.longWalkMinutes, t) : walk;

  return {
    week,
    phase,
    isDeload: deload,
    strengthDays,
    walkDays: phase.walkDays,
    longWalkDay: phase.longWalkDay,
    stationCount: phase.stationCount,
    rounds: deload ? Math.max(2, rounds - 1) : rounds,
    workSec: phase.workSec,
    restSec: phase.restSec,
    roundRestSec: phase.roundRestSec,
    finisherRounds: 3,
    walkMinutes: deload ? Math.round(walk * 0.7) : walk,
    longWalkMinutes: deload ? Math.round(longWalk * 0.7) : longWalk,
    pickups: deload ? 0 : phase.pickups,
    conditioning: phase.conditioning && !deload,
    rungCap: phase.rungCap,
    mobilityMinutes: phase.mobilityMinutes,
  };
}

/**
 * Station order per session variant. Sliced to the week's station count, so the
 * first four always cover legs / push / core / hinge no matter the phase.
 */
export const SESSION_VARIANTS: Record<"A" | "B" | "C", PatternId[]> = {
  A: ["squat", "push", "core", "hinge", "overhead", "carry"],
  B: ["hinge", "pull", "core", "squat", "carry", "overhead"],
  C: ["squat", "pull", "push", "core", "overhead", "carry"],
};

export const WARMUP = [
  { name: "Ankle and hip rocks", cue: "Rock forward and back in a low stance. Wake the joints up." },
  { name: "Arm circles and shoulder rolls", cue: "Big and slow, both directions." },
  { name: "Standing march", cue: "Knees to hip height. Get the heart rate off the floor." },
];

export const COOLDOWN = [
  { name: "Chest and doorway stretch", cue: "Forearm on the frame, step through. Undo the chair." },
  { name: "Hip flexor stretch", cue: "Half-kneeling, tuck the tailbone, lean in. Switch halfway." },
  { name: "Slow breathing", cue: "In for four, out for six. Six rounds, and you are done." },
];
