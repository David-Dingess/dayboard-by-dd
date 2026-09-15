import type { Ladder, PatternId, Rung } from "./types";

/**
 * Progression ladders. Each pattern is a list of rungs from easiest to hardest;
 * the program never adds load beyond the 20 lb kettlebell / 10 lb dumbbells on
 * hand, so the levers are range of motion, leverage, tempo and density.
 *
 * The cues are written for a 6'5" body: long femurs make deep squats and hinges
 * more demanding on the lower back, so short-range patterns come first and every
 * hinge rung says something about the spine.
 */
export const LADDERS: Record<PatternId, Ladder> = {
  squat: {
    patternId: "squat",
    label: "Squat",
    rungs: [
      {
        id: "squat-chair",
        name: "Chair-assisted squat",
        cue: "Sit back until you touch the seat, then stand. Push off your thighs if you need to.",
        mode: "reps",
      },
      {
        id: "squat-box",
        name: "Box-depth squat",
        cue: "Sit back to the chair, tap, stand. No hands this time.",
        mode: "reps",
      },
      {
        id: "squat-bodyweight",
        name: "Bodyweight squat",
        cue: "Feet wide as your shoulders, knees track over your toes.",
        mode: "reps",
      },
      {
        id: "squat-goblet",
        name: "Goblet squat",
        cue: "Kettlebell at your chest like a mug of coffee. It counterbalances your height.",
        mode: "reps",
        equipment: "20 lb kettlebell",
      },
      {
        id: "squat-goblet-tempo",
        name: "Tempo goblet squat",
        cue: "Three seconds down, one at the bottom, three back up. Count out loud.",
        mode: "reps",
        equipment: "20 lb kettlebell",
      },
      {
        id: "squat-goblet-15",
        name: "1½-rep goblet squat",
        cue: "Down, halfway up, back down, all the way up. That is one rep.",
        mode: "reps",
        equipment: "20 lb kettlebell",
      },
    ],
  },

  hinge: {
    patternId: "hinge",
    label: "Hinge",
    rungs: [
      {
        id: "hinge-bridge",
        name: "Glute bridge",
        cue: "On your back, heels close. Squeeze your glutes at the top, ribs down.",
        mode: "reps",
      },
      {
        id: "hinge-bridge-single",
        name: "Single-leg glute bridge",
        cue: "One foot planted, other knee hugged in. Keep your hips level.",
        mode: "reps",
      },
      {
        id: "hinge-kb-deadlift",
        name: "Kettlebell deadlift",
        cue: "Push your hips back, chest proud, flat back. Stand tall, do not lean back.",
        mode: "reps",
        equipment: "20 lb kettlebell",
      },
      {
        id: "hinge-kb-swing",
        name: "Kettlebell swing",
        cue: "Hike it back, snap your hips forward. Arms are ropes, the hips do the work.",
        mode: "reps",
        equipment: "20 lb kettlebell",
      },
      {
        id: "hinge-rdl-single",
        name: "Single-leg RDL",
        cue: "One dumbbell, reach it toward the floor as your back leg lifts. Slow.",
        mode: "reps",
        equipment: "10 lb dumbbell",
      },
    ],
  },

  push: {
    patternId: "push",
    label: "Push",
    rungs: [
      {
        id: "push-wall",
        name: "Wall push-up",
        cue: "Hands on the board at chest height, body in one long line.",
        mode: "reps",
      },
      {
        id: "push-incline",
        name: "Incline push-up",
        cue: "Hands on the desk or a counter. Lower with control, elbows back not out.",
        mode: "reps",
      },
      {
        id: "push-knee",
        name: "Knee push-up",
        cue: "Knees down, hips forward so your body is still a straight line.",
        mode: "reps",
      },
      {
        id: "push-full",
        name: "Push-up",
        cue: "Full plank, chest to the mat. Long arms mean a long way down — take your time.",
        mode: "reps",
      },
      {
        id: "push-tempo",
        name: "Tempo push-up",
        cue: "Three seconds down, pause an inch off the floor, press up.",
        mode: "reps",
      },
      {
        id: "push-elevated",
        name: "Feet-elevated push-up",
        cue: "Feet on the chair. Brace hard so your hips do not sag.",
        mode: "reps",
      },
    ],
  },

  pull: {
    patternId: "pull",
    label: "Pull",
    rungs: [
      {
        id: "pull-row-light",
        name: "Bent-over row",
        cue: "Hinge forward, flat back. Pull the dumbbells to your ribs, squeeze.",
        mode: "reps",
        equipment: "5 lb dumbbells",
      },
      {
        id: "pull-row-10",
        name: "Bent-over row",
        cue: "Same shape, heavier. Elbows brush past your sides.",
        mode: "reps",
        equipment: "10 lb dumbbells",
      },
      {
        id: "pull-gorilla",
        name: "Gorilla row",
        cue: "Kettlebell between your feet, hinge and row it one arm at a time.",
        mode: "reps",
        equipment: "20 lb kettlebell",
      },
      {
        id: "pull-gorilla-tempo",
        name: "Tempo gorilla row",
        cue: "Pull fast, lower for three. Do not let your shoulders rotate.",
        mode: "reps",
        equipment: "20 lb kettlebell",
      },
      {
        id: "pull-renegade",
        name: "Renegade row",
        cue: "From a plank on the dumbbells, row one at a time. Hips stay square.",
        mode: "reps",
        equipment: "10 lb dumbbells",
      },
    ],
  },

  core: {
    patternId: "core",
    label: "Core",
    rungs: [
      {
        id: "core-deadbug",
        name: "Dead bug",
        cue: "Low back glued to the mat. Opposite arm and leg reach out slowly.",
        mode: "reps",
      },
      {
        id: "core-plank",
        name: "Forearm plank",
        cue: "Elbows under shoulders, squeeze glutes. Breathe — do not hold your breath.",
        mode: "hold",
      },
      {
        id: "core-side-plank",
        name: "Side plank",
        cue: "Switch sides halfway. Stack your shoulders, lift your hip high.",
        mode: "hold",
      },
      {
        id: "core-hollow",
        name: "Hollow hold",
        cue: "Low back pressed down first, then lower the arms and legs as far as you can hold.",
        mode: "hold",
      },
      {
        id: "core-shoulder-tap",
        name: "Plank shoulder tap",
        cue: "Wide feet, tap the opposite shoulder. Let the hips rock as little as possible.",
        mode: "reps",
      },
    ],
  },

  carry: {
    patternId: "carry",
    label: "Carry",
    rungs: [
      {
        id: "carry-suitcase-hold",
        name: "Suitcase hold",
        cue: "Kettlebell in one hand, stand tall and resist the lean. Switch halfway.",
        mode: "hold",
        equipment: "20 lb kettlebell",
      },
      {
        id: "carry-suitcase-march",
        name: "Suitcase march",
        cue: "Same hold, now march in place. Ribs down, shoulders level.",
        mode: "hold",
        equipment: "20 lb kettlebell",
      },
      {
        id: "carry-farmer-march",
        name: "Farmer march",
        cue: "A dumbbell in each hand, knees to hip height, slow and tall.",
        mode: "hold",
        equipment: "10 lb dumbbells",
      },
      {
        id: "carry-overhead-hold",
        name: "Overhead hold",
        cue: "One dumbbell locked out overhead, biceps by your ear. Switch halfway.",
        mode: "hold",
        equipment: "10 lb dumbbell",
      },
      {
        id: "carry-overhead-march",
        name: "Overhead march",
        cue: "Locked out overhead and marching. This is the posture medicine.",
        mode: "hold",
        equipment: "10 lb dumbbell",
      },
    ],
  },

  overhead: {
    patternId: "overhead",
    label: "Press",
    rungs: [
      {
        id: "press-5",
        name: "Overhead press",
        cue: "Press straight up, finish with your arms by your ears.",
        mode: "reps",
        equipment: "5 lb dumbbells",
      },
      {
        id: "press-10",
        name: "Overhead press",
        cue: "Squeeze your glutes so you press instead of leaning back.",
        mode: "reps",
        equipment: "10 lb dumbbells",
      },
      {
        id: "press-seesaw",
        name: "See-saw press",
        cue: "Alternate arms — one goes up as the other comes down.",
        mode: "reps",
        equipment: "10 lb dumbbells",
      },
      {
        id: "press-kb",
        name: "Kettlebell press",
        cue: "Bell resting on your forearm, press and rotate the palm forward. Switch halfway.",
        mode: "reps",
        equipment: "20 lb kettlebell",
      },
      {
        id: "press-tempo",
        name: "Tempo press",
        cue: "Press up, lower for a slow count of three.",
        mode: "reps",
        equipment: "10 lb dumbbells",
      },
    ],
  },

  conditioning: {
    patternId: "conditioning",
    label: "Conditioning",
    rungs: [
      {
        id: "cond-march",
        name: "Fast march in place",
        cue: "Knees up, arms pumping. Breathing hard is the point.",
        mode: "hold",
      },
      {
        id: "cond-step-touch",
        name: "Step-touch + reach",
        cue: "Side to side, reach overhead. Low impact, high heart rate.",
        mode: "hold",
      },
      {
        id: "cond-swing-15",
        name: "Kettlebell swings",
        cue: "Snap the hips, breathe out at the top. Stop early if the form fades.",
        mode: "hold",
        equipment: "20 lb kettlebell",
      },
      {
        id: "cond-swing-20",
        name: "Kettlebell swings",
        cue: "Longer set. Keep the back flat and the arms loose.",
        mode: "hold",
        equipment: "20 lb kettlebell",
      },
      {
        id: "cond-swing-30",
        name: "Kettlebell swings",
        cue: "Half a minute on. Power from the hips all the way through.",
        mode: "hold",
        equipment: "20 lb kettlebell",
      },
    ],
  },
};

export const PATTERN_IDS = Object.keys(LADDERS) as PatternId[];

export function rungAt(patternId: PatternId, index: number): Rung {
  const rungs = LADDERS[patternId].rungs;
  const i = Math.min(Math.max(index, 0), rungs.length - 1);
  return rungs[i];
}

export function ladderLength(patternId: PatternId): number {
  return LADDERS[patternId].rungs.length;
}

/** Every rung id across every ladder — the exercise half of a video key. */
export function allRungIds(): string[] {
  return PATTERN_IDS.flatMap((p) => LADDERS[p].rungs.map((r) => r.id));
}
