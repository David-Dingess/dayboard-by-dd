import { minutesOfDay } from "./dates";
import type { Step } from "./steps";
import type { NotificationSlot } from "./store-types";

/**
 * Chair five: five minutes in or at the chair, three times a day.
 *
 * WHO IT IS FOR. It is for somebody who sits twelve hours a day at a desk,
 * from about nine in the morning. The programme's strength days and walks are
 * about being fit; this is about the specific wear a day like that leaves — the
 * wrists on a keyboard and mouse, the hamstrings and calves shortened by a
 * seat, the neck pushed toward a screen.
 *
 * WHAT IS IN IT, AND WHY. Every routine is the same four minutes of core plus
 * one minute that rotates:
 *
 *  - Wrists first. Tendon glides and median nerve glides are what hand
 *    therapists give for carpal tunnel: they keep the flexor tendons and the
 *    nerve sliding through the tunnel rather than crowding it. The flexor and
 *    extensor stretches, held 15–30 seconds, take load off the forearm. The
 *    usual prescription is under five minutes, two or three times a day — which
 *    is exactly the dose and the cadence here.
 *  - Hamstrings with the toes pulled up, so the same stretch reaches the calf.
 *  - A standing calf stretch at the desk, straight knee then soft knee, which is
 *    the one move that gets you out of the chair. Standing up is its own point.
 *  - The rotating minute: neck and shoulders, then hips, then the upper back.
 *    Sitting shortens hip flexors and rounds the thoracic spine, and a screen
 *    pulls the head forward; one of those a routine, spread across the day, is
 *    all three without making any one routine longer.
 *
 * WHY THREE A DAY AND NOT MORE. The research on breaking up sitting says more
 * often is better — five minutes every half hour was the only dose that moved
 * blood glucose in one trial. That is also a board that interrupts sixteen
 * times a day and gets switched off within a week. Three, alongside the eye
 * breaks and the midday walk, is the dose that survives.
 *
 * NO RESTS. A stretch is its own rest, and a five-minute routine with twenty
 * seconds of standing about between every move is a seven-minute one. The
 * interval timer's go-tone at each step is the cue to switch sides.
 *
 * Pure, like the rest of lib/health: no React, no node, no next.
 */

export interface ChairMove {
  /** Also the key of its drawn animation in lib/health/figures/chair.ts. */
  id: string;
  name: string;
  cue: string;
  seconds: number;
  /** Done once per side, Right then Left, `seconds` each. */
  sided: boolean;
}

export interface ChairExtra {
  id: "neck" | "hips" | "spine";
  name: string;
  moves: ChairMove[];
}

export interface ChairStepMove extends ChairMove {
  side?: "Right" | "Left";
}

export interface ChairRoutine {
  /** Stable per extra, so a log line says which one was done. */
  id: string;
  title: string;
  extra: ChairExtra["id"];
  extraName: string;
  estSeconds: number;
  steps: Step[];
  /** Keyed by `Step.key`. The steps carry no Station — this is not a programme session. */
  moves: Record<string, ChairStepMove>;
}

export const CHAIR_TITLE = "Chair five";

export const CHAIR_CORE: ChairMove[] = [
  {
    id: "chair-tendon-glides",
    name: "Tendon glides",
    cue: "Both hands, slowly. Straight, then hook; straight, then fist; straight, then tabletop. Keep cycling.",
    seconds: 40,
    sided: false,
  },
  {
    id: "chair-nerve-glide",
    name: "Median nerve glide",
    cue: "Arm out to the side, palm up. Bend the wrist back as you tilt your head away, then ease both back. A glide, not a stretch.",
    seconds: 20,
    sided: true,
  },
  {
    id: "chair-wrist-flexor",
    name: "Wrist flexor stretch",
    cue: "Arm straight, palm up. The other hand draws the fingers back toward you.",
    seconds: 20,
    sided: true,
  },
  {
    id: "chair-wrist-extensor",
    name: "Wrist extensor stretch",
    cue: "Arm straight, palm down. The other hand presses the back of the hand toward you.",
    seconds: 15,
    sided: true,
  },
  {
    id: "chair-hamstring",
    name: "Seated hamstring, toes up",
    cue: "Edge of the seat, leg straight, heel down, toes pulled up. Hinge at the hips with a flat back. Toes up is what reaches the calf.",
    seconds: 30,
    sided: true,
  },
  {
    id: "chair-calf",
    name: "Calf stretch at the desk",
    cue: "Stand, hands on the desk, one foot back, heel down, knee straight. Last few seconds, soften the back knee.",
    seconds: 25,
    sided: true,
  },
];

export const CHAIR_EXTRAS: ChairExtra[] = [
  {
    id: "neck",
    name: "neck & shoulders",
    moves: [
      {
        id: "chair-chin-tuck",
        name: "Chin tucks",
        cue: "Eyes level, slide the chin straight back into a double chin. Hold two seconds, release, repeat.",
        seconds: 30,
        sided: false,
      },
      {
        id: "chair-shoulder-rolls",
        name: "Shoulder rolls",
        cue: "Big slow circles — up, back, down. Squeeze the shoulder blades on the way down.",
        seconds: 30,
        sided: false,
      },
    ],
  },
  {
    id: "hips",
    name: "hips",
    moves: [
      {
        id: "chair-figure-four",
        name: "Seated figure-four",
        cue: "Ankle on the opposite knee. Sit tall, then lean the chest forward until the outer hip opens.",
        seconds: 25,
        sided: true,
      },
    ],
  },
  {
    id: "spine",
    name: "upper back",
    moves: [
      {
        id: "chair-thoracic-extension",
        name: "Extension over the chair back",
        cue: "Hands behind your head, elbows wide. Lean back over the top of the backrest and open the chest. Breathe.",
        seconds: 30,
        sided: false,
      },
      {
        id: "chair-seated-twist",
        name: "Seated twist",
        cue: "Sit tall, hand on the opposite knee, other hand on the backrest. Turn from the ribs, not the neck.",
        seconds: 15,
        sided: true,
      },
    ],
  },
];

/** Which extra comes next: the first routine of the day gets the neck, and so on round. */
export function chairExtraFor(doneToday: number): ChairExtra {
  const n = Math.max(0, Math.floor(doneToday));
  return CHAIR_EXTRAS[n % CHAIR_EXTRAS.length];
}

/** Every move id a routine can put on screen. Each has a drawn animation in lib/health/figures. */
export function chairExerciseIds(): string[] {
  return [...CHAIR_CORE, ...CHAIR_EXTRAS.flatMap((extra) => extra.moves)].map((move) => move.id);
}

export function chairRoutine(doneToday: number): ChairRoutine {
  const extra = chairExtraFor(doneToday);
  const steps: Step[] = [];
  const moves: Record<string, ChairStepMove> = {};
  const all: Array<{ move: ChairMove; block: string }> = [
    ...CHAIR_CORE.map((move) => ({ move, block: "Wrists, hamstrings, calves" })),
    ...extra.moves.map((move) => ({ move, block: `Plus ${extra.name}` })),
  ];

  for (const { move, block } of all) {
    const sides: Array<ChairStepMove["side"]> = move.sided ? ["Right", "Left"] : [undefined];
    for (const side of sides) {
      const key = side ? `${move.id}-${side.toLowerCase()}` : move.id;
      steps.push({
        key,
        kind: "work",
        seconds: move.seconds,
        blockId: `chair-${extra.id}`,
        blockLabel: block,
        round: 1,
        rounds: 1,
      });
      moves[key] = side ? { ...move, side } : { ...move };
    }
  }

  return {
    id: `chair-${extra.id}`,
    title: CHAIR_TITLE,
    extra: extra.id,
    extraName: extra.name,
    estSeconds: steps.reduce((sum, step) => sum + step.seconds, 0),
    steps,
    moves,
  };
}

/**
 * How early a routine may be done and still count for a slot. Doing one at
 * 2:20 answers the 2:45 nudge; doing one at 1:30 does not.
 */
export const CHAIR_EARLY_MINUTES = 60;

/**
 * Has this chair slot been answered? `chairAt` is the minutes-of-day, New York,
 * of every routine finished today.
 */
export function chairAnswered(slot: Pick<NotificationSlot, "time">, chairAt: readonly number[]): boolean {
  const from = minutesOfDay(slot.time) - CHAIR_EARLY_MINUTES;
  return chairAt.some((at) => at >= from);
}

/**
 * Which of today's chair slots are done, for the dots on the Today card.
 *
 * Stricter than `chairAnswered`, which only has to decide whether ONE nudge
 * should still speak: here one routine must not light up every dot behind it.
 * Each slot owns the window from an hour before it until an hour before the
 * next one, and is done if a routine landed in that window.
 */
export function chairSlotsDone(
  slots: readonly NotificationSlot[],
  chairAt: readonly number[],
): Array<{ id: string; time: string; label: string; enabled: boolean; done: boolean }> {
  const chairs = slots
    .filter((slot) => slot.kind === "chair")
    .sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));

  return chairs.map((slot, i) => {
    const from = minutesOfDay(slot.time) - CHAIR_EARLY_MINUTES;
    const next = chairs[i + 1];
    const until = next ? minutesOfDay(next.time) - CHAIR_EARLY_MINUTES : 24 * 60;
    return {
      id: slot.id,
      time: slot.time,
      label: slot.label,
      enabled: slot.enabled,
      done: chairAt.some((at) => at >= from && at < until),
    };
  });
}
