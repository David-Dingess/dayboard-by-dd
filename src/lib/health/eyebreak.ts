/**
 * The 20/20/20 rule, as a state machine.
 *
 * Every twenty minutes at a screen, look at something twenty feet away for
 * twenty seconds. It is the one piece of this program that was never in Out of
 * Office, and it is the one that fits a board best: the board is already
 * the thing you are looking at, so it can simply stop being useful for twenty
 * seconds and say why.
 *
 * IT TAKES THE WHOLE SCREEN. Not the centre panel — the screen, black, the way a
 * bedtime nudge does, with a video paused and a stream muted underneath it. The
 * panel version was too easy to keep working next to, which is a strange thing
 * to say about a rest you asked for and exactly what happened. It gives five
 * seconds of warning first — a beep and a countdown — because being yanked off a
 * sentence mid-word is the difference between a habit and a thing you switch
 * off.
 *
 * TIME AT A SCREEN IS WALL-CLOCK TIME, and that correction is what made the
 * feature start working at all. The first version counted only the seconds this
 * BOARD was visible and threw the count away after two minutes hidden. But the
 * board shares a Chrome window with other tabs and a monitor with other windows:
 * every stretch of actual work — the thing that tires eyes — looked like time
 * away from a screen, so nineteen minutes went in the bin several times an hour
 * and a break almost never arrived. Now:
 *
 *   - Hidden time COUNTS. Reading another tab is not a rest; it is the same eyes
 *     on the same monitor.
 *   - An absence at least as long as the interval itself IS a rest, and starts
 *     the count over. Twenty minutes away from this board is twenty minutes in
 *     which the eyes got far more than twenty seconds, and coming back to a
 *     break waiting for you would be the board being obtuse.
 *   - A break is only ever TAKEN while the board is visible. A blackout nobody
 *     can see is not a break, and recording one would be a lie.
 *   - A reload keeps the count — see `restoreEye`. The board reloads itself, and
 *     every one of those used to buy a fresh twenty minutes.
 *
 * The rest of the rules are about not being obnoxious:
 *
 *   - It never fires during a workout or a walk (`busy`). Twenty seconds of
 *     looking away is the point of the rest period anyway.
 *   - It has its OWN quiet hours, off by default. The nudge quiet hours exist to
 *     stop the board shouting about a walk at 11pm; eyes at 11pm are the eyes
 *     that need this most, and borrowing that setting silenced the whole feature
 *     every evening.
 *   - Whatever is playing is put back exactly as it was found. That is the
 *     component's job, not this file's.
 *
 * Pure, and effects come back as data, so all of that is testable without a DOM
 * (see tests/health-eyebreak.test.ts). components/health/EyeBreak.tsx is the
 * half that owns the clock, localStorage, and the black rectangle.
 */

export type EyeState =
  | { phase: "idle" }
  /** Accruing time. `since` is when the current stretch started. */
  | { phase: "counting"; accruedMs: number; since: number }
  /** The board is hidden. Still counting; `hiddenSince` is when it went away. */
  | { phase: "away"; accruedMs: number; hiddenSince: number }
  /** The five seconds of notice. The screen is already black; the clock has not started. */
  | { phase: "warning"; startedAt: number; endsAt: number }
  | { phase: "breaking"; startedAt: number; endsAt: number }
  /** One step, so putting things back is an effect like every other. */
  | { phase: "restoring"; chime: boolean };

export interface EyeEnv {
  now: number;
  visible: boolean;
  quiet: boolean;
  /** A session or a walk timer is running. */
  busy: boolean;
  enabled: boolean;
  everyMs: number;
  /** How long the break itself runs. */
  forMs: number;
  /** How much notice comes first. */
  warnMs: number;
}

export type EyeEvent =
  | { type: "tick" }
  | { type: "visibility" }
  | { type: "skip" }
  | { type: "snooze"; minutes: number };

export type EyeEffect =
  | { type: "chime"; sound: "warn" | "end" }
  | { type: "persist"; lastBreakAt: number; snoozedUntil: number };

export interface EyeStep {
  state: EyeState;
  effects: EyeEffect[];
}

type Counting = Extract<EyeState, { phase: "counting" }>;

const counting = (now: number, accruedMs = 0): Counting => ({
  phase: "counting",
  accruedMs,
  since: now,
});

const away = (accruedMs: number, hiddenSince: number): EyeState => ({
  phase: "away",
  accruedMs,
  hiddenSince,
});

/**
 * Conditions under which the count is abandoned, not held.
 *
 * Hiddenness is deliberately NOT in here — it is time at a screen like any
 * other. These three are the states where counting screen time would be
 * meaningless rather than merely unwatched.
 */
function off(env: EyeEnv): boolean {
  return !env.enabled || env.quiet || env.busy;
}

/** An absence this long is itself the rest, so the count starts over. */
function isRest(gapMs: number, env: EyeEnv): boolean {
  return gapMs >= env.everyMs;
}

export function stepEye(state: EyeState, env: EyeEnv, event: EyeEvent): EyeStep {
  const effects: EyeEffect[] = [];

  // The notice. Skipping or snoozing here is the same answer as during the break
  // itself; letting it run out starts the twenty seconds, silently, because the
  // beep five seconds ago was the announcement.
  if (state.phase === "warning") {
    if (event.type === "snooze") {
      return {
        state: { phase: "restoring", chime: false },
        effects: [
          { type: "persist", lastBreakAt: env.now, snoozedUntil: env.now + event.minutes * 60_000 },
        ],
      };
    }
    if (event.type === "skip" || !env.enabled) {
      return { state: { phase: "restoring", chime: false }, effects: [] };
    }
    if (env.now >= state.endsAt) {
      return {
        state: { phase: "breaking", startedAt: env.now, endsAt: env.now + env.forMs },
        effects,
      };
    }
    return { state, effects };
  }

  // A break already running is finished, not abandoned, if the conditions turn
  // against it — otherwise switching windows would leave a black screen up.
  if (state.phase === "breaking") {
    if (event.type === "snooze") {
      return {
        state: { phase: "restoring", chime: false },
        effects: [
          { type: "persist", lastBreakAt: env.now, snoozedUntil: env.now + event.minutes * 60_000 },
        ],
      };
    }
    if (event.type === "skip") {
      return { state: { phase: "restoring", chime: false }, effects: [] };
    }
    if (env.now >= state.endsAt || !env.enabled) {
      return { state: { phase: "restoring", chime: true }, effects: [] };
    }
    return { state, effects };
  }

  if (state.phase === "restoring") {
    if (state.chime) effects.push({ type: "chime", sound: "end" });
    effects.push({ type: "persist", lastBreakAt: env.now, snoozedUntil: 0 });
    if (off(env)) return { state: { phase: "idle" }, effects };
    return { state: env.visible ? counting(env.now) : away(0, env.now), effects };
  }

  if (off(env)) return { state: { phase: "idle" }, effects };

  // Hidden. The count keeps running; only a long enough absence spends it. Every
  // event lands here while hidden, including a skip — there is nothing on screen
  // to skip, and nothing has been taken that needs making up for.
  if (!env.visible) {
    if (state.phase === "away") {
      return isRest(env.now - state.hiddenSince, env)
        ? { state: { phase: "idle" }, effects }
        : { state, effects };
    }
    if (state.phase === "counting") {
      return { state: away(state.accruedMs + Math.max(0, env.now - state.since), env.now), effects };
    }
    return { state: { phase: "idle" }, effects };
  }

  /**
   * Visible, which is the only branch allowed to decide a break is due.
   *
   * Coming back from hidden is resolved here and then falls through rather than
   * returning: a count that came due while you were in another tab should fire
   * the moment you look back at the board, not five seconds later when the next
   * tick happens to land.
   */
  let base: Counting;
  if (state.phase === "away") {
    const gap = env.now - state.hiddenSince;
    base = counting(env.now, isRest(gap, env) ? 0 : state.accruedMs + gap);
  } else if (state.phase === "counting") {
    base = state;
  } else {
    base = counting(env.now);
  }

  if (event.type === "skip" || event.type === "snooze") {
    const back = event.type === "snooze" ? env.everyMs - event.minutes * 60_000 : 0;
    return {
      state: counting(env.now, Math.max(0, back)),
      effects: [
        {
          type: "persist",
          lastBreakAt: env.now,
          snoozedUntil: event.type === "snooze" ? env.now + event.minutes * 60_000 : 0,
        },
      ],
    };
  }

  const accrued = base.accruedMs + Math.max(0, env.now - base.since);
  if (accrued < env.everyMs) {
    return { state: counting(env.now, accrued), effects };
  }

  return {
    state: { phase: "warning", startedAt: env.now, endsAt: env.now + env.warnMs },
    effects: [{ type: "chime", sound: "warn" }],
  };
}

/**
 * Where to pick up after a reload.
 *
 * IT RESUMES, and that is a reversal. This used to start the twenty minutes over
 * on every load, on the argument that a page which had just opened was not being
 * read a moment ago. That argument is wrong about THIS page: the board reloads
 * for a dev-server edit, an HMR update, an F5 — several times an hour on a
 * working day, each one quietly wiping the count. It is a always-on display that was
 * already on the board a second ago.
 *
 * So the count comes back from the last break actually taken, and a gap longer
 * than one interval starts clean: that means the board was closed, and the eyes
 * had their rest without any help from it. A live snooze is honoured ahead of
 * both.
 */
export function restoreEye(
  saved: { lastBreakAt: number; snoozedUntil: number } | null,
  env: EyeEnv,
): EyeState {
  if (off(env)) return { phase: "idle" };

  let accrued = 0;
  if (saved && saved.snoozedUntil > env.now) {
    accrued = Math.max(0, env.everyMs - (saved.snoozedUntil - env.now));
  } else if (saved && saved.lastBreakAt > 0) {
    const since = env.now - saved.lastBreakAt;
    accrued = since >= 0 && !isRest(since, env) ? since : 0;
  }

  return env.visible ? counting(env.now, accrued) : away(accrued, env.now);
}

/** Seconds left on whichever clock is showing, for the overlay's countdown. */
export function breakSecondsLeft(state: EyeState, now: number): number {
  if (state.phase !== "breaking" && state.phase !== "warning") return 0;
  return Math.max(0, Math.ceil((state.endsAt - now) / 1000));
}

/**
 * The position, for anything that wants to show it.
 *
 * Counting draws nothing on its own — that is why the state lives in a ref in
 * the component — but the Quick row in the left stack asks a different question:
 * "is this thing even running, and when is the next one?". Answering it means
 * projecting the state into something with an absolute deadline in it, so the
 * consumer can tick its own clock without this component re-rendering.
 *
 * Hidden reports as counting, because it IS counting. There is no third answer
 * worth giving: the row is only read while the board is on screen, and by then
 * the deadline it was handed is still the right one.
 *
 * Pure, and derived rather than stored, so there is no second copy of the truth.
 */
export type EyeClock =
  | { phase: "off"; reason: "disabled" | "quiet" | "busy" | "idle" }
  | { phase: "counting"; nextAt: number }
  | { phase: "warning" | "breaking"; endsAt: number };

export function eyeClockOf(state: EyeState, env: EyeEnv): EyeClock {
  if (!env.enabled) return { phase: "off", reason: "disabled" };
  if (env.quiet) return { phase: "off", reason: "quiet" };
  if (env.busy) return { phase: "off", reason: "busy" };

  switch (state.phase) {
    // The deadline, not the remainder: a consumer ticking once a second
    // subtracts `now` itself and never drifts against this clock.
    case "counting":
      return { phase: "counting", nextAt: state.since + Math.max(0, env.everyMs - state.accruedMs) };
    case "away":
      return {
        phase: "counting",
        nextAt: state.hiddenSince + Math.max(0, env.everyMs - state.accruedMs),
      };
    case "warning":
    case "breaking":
      return { phase: state.phase, endsAt: state.endsAt };
    default:
      return { phase: "off", reason: "idle" };
  }
}
