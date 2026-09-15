import { chairExerciseIds } from "./chair";
import { addDays, daysBetween, dayOfWeek } from "./dates";
import { rungAt, ladderLength, allRungIds } from "./ladders";
import {
  COOLDOWN,
  PHASES,
  SESSION_VARIANTS,
  WARMUP,
  isDeloadWeek,
  phaseForWeek,
  weekConfig,
  type PhaseConfig,
  type WeekConfig,
} from "./phases";
import type { Block, PatternId, PhaseInfo, Session, Station } from "./types";

export interface SessionContext {
  programStartDate: string;
  patternLevels: Record<string, number>;
}

function toPhaseInfo(p: PhaseConfig): PhaseInfo {
  return { index: p.index, name: p.name, startWeek: p.startWeek, endWeek: p.endWeek, blurb: p.blurb };
}

/** 1-based program week for a date; weeks before the start date clamp to 1. */
export function weekForDate(programStartDate: string, date: string): number {
  const diff = daysBetween(programStartDate, date);
  return Math.floor(Math.max(0, diff) / 7) + 1;
}

/**
 * The rung actually used today: the stored level, held under the phase's cap and
 * the end of the ladder.
 */
export function effectiveRung(
  patternId: PatternId,
  levels: Record<string, number>,
  capOrPhase: { rungCap: number },
): number {
  const stored = levels[patternId] ?? 0;
  return Math.min(stored, capOrPhase.rungCap, ladderLength(patternId) - 1);
}

function buildStation(
  patternId: PatternId,
  levels: Record<string, number>,
  cfg: WeekConfig,
  workSec: number,
  restSec: number,
): Station {
  const rungIndex = effectiveRung(patternId, levels, cfg);
  const rung = rungAt(patternId, rungIndex);
  return {
    patternId,
    rungIndex,
    exerciseId: rung.id,
    name: rung.name,
    cue: rung.cue,
    mode: rung.mode,
    equipment: rung.equipment,
    workSec,
    restSec,
  };
}

function warmupBlock(): Block {
  return {
    id: "warmup",
    kind: "warmup",
    label: "Warm-up",
    rounds: 1,
    roundRestSec: 0,
    stations: WARMUP.map((w, i) => ({
      patternId: "core" as PatternId,
      rungIndex: 0,
      exerciseId: `warmup-${i}`,
      name: w.name,
      cue: w.cue,
      mode: "hold" as const,
      workSec: 30,
      restSec: 5,
    })),
  };
}

function cooldownBlock(): Block {
  return {
    id: "cooldown",
    kind: "cooldown",
    label: "Cool-down",
    rounds: 1,
    roundRestSec: 0,
    stations: COOLDOWN.map((c, i) => ({
      patternId: "core" as PatternId,
      rungIndex: 0,
      exerciseId: `cooldown-${i}`,
      name: c.name,
      cue: c.cue,
      mode: "hold" as const,
      workSec: 40,
      restSec: 5,
    })),
  };
}

function variantForDay(cfg: WeekConfig, dow: number): "A" | "B" | "C" {
  const order = cfg.strengthDays.indexOf(dow);
  const variants: Array<"A" | "B" | "C"> = cfg.strengthDays.length >= 3 ? ["A", "B", "C"] : ["A", "B"];
  return variants[Math.max(0, order) % variants.length];
}

function estimateMinutes(blocks: Block[]): number {
  let seconds = 0;
  for (const b of blocks) {
    const perRound = b.stations.reduce((sum, s) => sum + s.workSec + s.restSec, 0);
    seconds += perRound * b.rounds + b.roundRestSec * Math.max(0, b.rounds - 1);
  }
  return Math.round(seconds / 60);
}

function strengthSession(date: string, dow: number, cfg: WeekConfig, ctx: SessionContext): Session {
  const variant = variantForDay(cfg, dow);
  const patterns = SESSION_VARIANTS[variant].slice(0, cfg.stationCount);

  const blocks: Block[] = [
    warmupBlock(),
    {
      id: "circuit",
      kind: "circuit",
      label: `Circuit ${variant}`,
      note: `${cfg.rounds} rounds · ${cfg.workSec}s work / ${cfg.restSec}s rest`,
      rounds: cfg.rounds,
      roundRestSec: cfg.roundRestSec,
      stations: patterns.map((p) => buildStation(p, ctx.patternLevels, cfg, cfg.workSec, cfg.restSec)),
    },
  ];

  if (cfg.conditioning) {
    blocks.push({
      id: "finisher",
      kind: "finisher",
      label: "Finisher",
      note: "Hard but honest. Stop a set early if the form goes.",
      rounds: cfg.finisherRounds,
      roundRestSec: 0,
      stations: [buildStation("conditioning", ctx.patternLevels, cfg, cfg.workSec, cfg.restSec + 20)],
    });
  }

  blocks.push(cooldownBlock());

  return {
    id: `w${cfg.week}-d${dow}-strength-${variant}`,
    date,
    week: cfg.week,
    dayOfWeek: dow,
    phase: toPhaseInfo(cfg.phase),
    kind: "strength",
    title: cfg.isDeload ? `Strength ${variant} (deload)` : `Strength ${variant}`,
    subtitle: cfg.isDeload
      ? "Lighter week on purpose — same movements, less of them."
      : `${patterns.length} stations, ${cfg.rounds} rounds.`,
    estMinutes: estimateMinutes(blocks),
    isDeload: cfg.isDeload,
    blocks,
  };
}

function walkSession(date: string, dow: number, cfg: WeekConfig, long: boolean): Session {
  const minutes = long ? cfg.longWalkMinutes : cfg.walkMinutes;

  return {
    id: `w${cfg.week}-d${dow}-walk`,
    date,
    week: cfg.week,
    dayOfWeek: dow,
    phase: toPhaseInfo(cfg.phase),
    kind: "walk",
    title: long ? "Long walk" : "Walk",
    subtitle: cfg.pickups
      ? `${minutes} minutes, with ${cfg.pickups} one-minute surges.`
      : `${minutes} minutes at a conversational pace.`,
    estMinutes: minutes,
    isDeload: cfg.isDeload,
    blocks: [],
    targetMinutes: minutes,
    pickups: cfg.pickups,
    outdoorsNote:
      "Outside if you can — midday daylight is doing a second job on your sleep and your vitamin D.",
  };
}

/**
 * The Sunday reset, as a list rather than a literal buried in the function that
 * uses it — anything keyed by exerciseId (the illustrations, the follow-along
 * videos) has to be able to enumerate these, and `mobility-4` meaning something
 * different from what allExerciseIds thinks it means is the bug that would
 * follow from two copies.
 */
export const MOBILITY = [
  { name: "Cat-cow", cue: "Slow spinal waves, breathing with the movement." },
  { name: "World's greatest stretch", cue: "Lunge, elbow to instep, rotate open. Switch sides." },
  { name: "Thread the needle", cue: "On all fours, reach one arm under the other. Mid-back opener." },
  { name: "Hamstring floss", cue: "On your back, leg straight up, gently pulse. Switch halfway." },
  { name: "Deep squat hold", cue: "Sit in the bottom of a squat. Hold a doorframe if you need to." },
  { name: "Slow breathing", cue: "In for four, out for six. This counts as training." },
];

function mobilitySession(date: string, dow: number, cfg: WeekConfig): Session {
  const stations: Station[] = MOBILITY.map((s, i) => ({
    patternId: "core" as PatternId,
    rungIndex: 0,
    exerciseId: `mobility-${i}`,
    name: s.name,
    cue: s.cue,
    mode: "hold" as const,
    workSec: Math.round((cfg.mobilityMinutes * 60) / 6) - 10,
    restSec: 10,
  }));

  const blocks: Block[] = [
    {
      id: "mobility",
      kind: "circuit",
      label: "Sunday reset",
      note: "No intensity here. This is the maintenance that keeps the other six days available.",
      rounds: 1,
      roundRestSec: 0,
      stations,
    },
  ];

  return {
    id: `w${cfg.week}-d${dow}-mobility`,
    date,
    week: cfg.week,
    dayOfWeek: dow,
    phase: toPhaseInfo(cfg.phase),
    kind: "mobility",
    title: "Mobility and reset",
    subtitle: "Undo the week of sitting.",
    estMinutes: estimateMinutes(blocks),
    isDeload: false,
    blocks,
  };
}

function restSession(date: string, dow: number, cfg: WeekConfig): Session {
  return {
    id: `w${cfg.week}-d${dow}-rest`,
    date,
    week: cfg.week,
    dayOfWeek: dow,
    phase: toPhaseInfo(cfg.phase),
    kind: "rest",
    title: "Rest day",
    subtitle: "Nothing scheduled. A walk is always welcome, never required.",
    estMinutes: 0,
    isDeload: false,
    blocks: [],
  };
}

/** The scheduled session for any date. Pure — same inputs, same output. */
export function getSessionForDate(ctx: SessionContext, date: string): Session {
  const cfg = weekConfig(weekForDate(ctx.programStartDate, date));
  const dow = dayOfWeek(date);

  if (cfg.strengthDays.includes(dow)) return strengthSession(date, dow, cfg, ctx);
  if (cfg.longWalkDay === dow) return walkSession(date, dow, cfg, true);
  if (cfg.walkDays.includes(dow)) return walkSession(date, dow, cfg, false);
  if (dow === 0) return mobilitySession(date, dow, cfg);
  return restSession(date, dow, cfg);
}

/**
 * The five-minute floor. Research on habit formation says a single missed day
 * costs nothing but consecutive misses do real damage — so there is always a
 * version of today small enough to say yes to.
 */
export function getMinimumDose(date: string, ctx: SessionContext): Session {
  const cfg = weekConfig(weekForDate(ctx.programStartDate, date));

  const blocks: Block[] = [
    {
      id: "minimum",
      kind: "circuit",
      label: "Five minutes",
      note: "This counts. Getting back tomorrow is the whole game.",
      rounds: 2,
      roundRestSec: 15,
      stations: [
        {
          patternId: "hinge",
          rungIndex: 0,
          exerciseId: "min-bridge",
          name: "Glute bridge",
          cue: "Squeeze at the top. Undo some sitting.",
          mode: "reps",
          workSec: 40,
          restSec: 10,
        },
        {
          patternId: "core",
          rungIndex: 0,
          exerciseId: "min-deadbug",
          name: "Dead bug",
          cue: "Slow and controlled, low back down.",
          mode: "reps",
          workSec: 40,
          restSec: 10,
        },
        {
          patternId: "push",
          rungIndex: 0,
          exerciseId: "min-wallpush",
          name: "Wall push-up",
          cue: "Whatever pace feels good.",
          mode: "reps",
          workSec: 40,
          restSec: 10,
        },
      ],
    },
  ];

  return {
    id: `w${cfg.week}-minimum`,
    date,
    week: cfg.week,
    dayOfWeek: dayOfWeek(date),
    phase: toPhaseInfo(cfg.phase),
    kind: "minimum",
    title: "Five-minute minimum",
    subtitle: "The version of today you can always say yes to.",
    estMinutes: estimateMinutes(blocks),
    isDeload: false,
    blocks,
  };
}

/**
 * Planned minutes for the seven days beginning at `weekStartDate`.
 *
 * The original walked the week with `new Date(y, m - 1, d + i)` — the one place
 * the engine reached past dates.ts to the local clock. On a UTC server that
 * would have been off by a day for the evening hours; `addDays` keeps it in NY.
 */
export function plannedWeeklyMinutes(ctx: SessionContext, weekStartDate: string): number {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    total += getSessionForDate(ctx, addDays(weekStartDate, i)).estMinutes;
  }
  return total;
}

export { PHASES, isDeloadWeek, phaseForWeek, weekConfig };

/**
 * Every exerciseId this program can ever put on a screen.
 *
 * The ladders are only part of it: the warm-up, the cool-down, the Sunday
 * mobility flow and the five-minute floor all mint their own ids, and anything
 * keyed by exercise — the illustrations, the follow-along videos — has to know
 * about those too. Derived from the same constants the sessions are built from,
 * so adding a warm-up movement cannot silently leave a hole.
 */
export function allExerciseIds(): string[] {
  return [
    ...allRungIds(),
    ...WARMUP.map((_, i) => `warmup-${i}`),
    ...COOLDOWN.map((_, i) => `cooldown-${i}`),
    ...MOBILITY.map((_, i) => `mobility-${i}`),
    "min-bridge",
    "min-deadbug",
    "min-wallpush",
    // The chair routine is not a session, but its moves go on the same screen
    // with the same pictures, so they answer to the same completeness check.
    ...chairExerciseIds(),
  ];
}
