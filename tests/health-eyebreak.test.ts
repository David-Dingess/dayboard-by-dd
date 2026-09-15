import { describe, expect, it } from "vitest";
import {
  breakSecondsLeft,
  eyeClockOf,
  restoreEye,
  stepEye,
  type EyeEnv,
  type EyeState,
} from "../src/lib/health";

/**
 * The 20/20/20 break. Half of these are about a moment when taking the screen
 * would be wrong, which is the only reason a feature this pushy is tolerable —
 * and half are about the opposite failure, which is the one that actually
 * happened: a break that was owed and never arrived.
 */

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;
const EVERY = 20 * MINUTE;

const env = (over: Partial<EyeEnv> = {}): EyeEnv => ({
  now: T0,
  visible: true,
  quiet: false,
  busy: false,
  enabled: true,
  everyMs: EVERY,
  forMs: 20_000,
  warnMs: 5_000,
  ...over,
});

const counting = (accruedMs: number, since = T0): EyeState => ({ phase: "counting", accruedMs, since });
const gone = (accruedMs: number, hiddenSince = T0): EyeState => ({
  phase: "away",
  accruedMs,
  hiddenSince,
});
const tick = { type: "tick" } as const;

describe("counting", () => {
  it("starts counting from idle as soon as the screen is being looked at", () => {
    const { state } = stepEye({ phase: "idle" }, env(), tick);
    expect(state).toEqual(counting(0));
  });

  it("accrues time", () => {
    const { state } = stepEye(counting(0), env({ now: T0 + 5 * MINUTE }), tick);
    expect(state).toEqual(counting(5 * MINUTE, T0 + 5 * MINUTE));
  });

  it("abandons the count for a session, bedtime, or being switched off", () => {
    for (const off of [{ busy: true }, { quiet: true }, { enabled: false }]) {
      expect(stepEye(counting(19 * MINUTE), env(off), tick).state).toEqual({ phase: "idle" });
    }
  });
});

describe("time in another window", () => {
  it("KEEPS COUNTING while the board is hidden", () => {
    // The bug that made this feature look broken. Time in another tab is the
    // same eyes on the same monitor — treating it as a rest meant every real
    // stretch of work reset the clock, and a break almost never arrived.
    const hidden = stepEye(counting(10 * MINUTE), env({ visible: false, now: T0 + MINUTE }), {
      type: "visibility",
    });
    expect(hidden.state).toEqual(gone(11 * MINUTE, T0 + MINUTE));

    const back = stepEye(hidden.state, env({ now: T0 + 6 * MINUTE }), { type: "visibility" });
    expect(back.state).toEqual(counting(16 * MINUTE, T0 + 6 * MINUTE));
  });

  it("fires the moment the board comes back, if the break came due while away", () => {
    // Not on the next five-second tick: you are looking at it NOW.
    const { state } = stepEye(gone(15 * MINUTE), env({ now: T0 + 6 * MINUTE }), {
      type: "visibility",
    });
    expect(state.phase).toBe("warning");
  });

  it("never takes a break nobody can see", () => {
    const { state } = stepEye(gone(19 * MINUTE), env({ visible: false, now: T0 + MINUTE }), tick);
    expect(state.phase).toBe("away");
  });

  it("starts over after a whole interval away — that long IS the rest", () => {
    const back = stepEye(gone(19 * MINUTE), env({ now: T0 + EVERY }), { type: "visibility" });
    expect(back.state).toEqual(counting(0, T0 + EVERY));
  });

  it("gives up entirely once the board has been away that long", () => {
    const { state } = stepEye(gone(19 * MINUTE), env({ visible: false, now: T0 + EVERY }), tick);
    expect(state).toEqual({ phase: "idle" });
  });
});

describe("taking the screen", () => {
  it("gives five seconds of notice first, with a beep", () => {
    // Being yanked off a sentence mid-word is how a habit becomes a thing you
    // switch off. The screen goes black now; the twenty seconds start after.
    const { state, effects } = stepEye(counting(EVERY), env(), tick);
    expect(state).toEqual({ phase: "warning", startedAt: T0, endsAt: T0 + 5_000 });
    expect(effects).toEqual([{ type: "chime", sound: "warn" }]);
  });

  it("does not touch the panel it is covering", () => {
    // It used to switch the centre tab to Health and draw itself in the widget.
    // A full-screen blackout has nothing to switch to and nothing to put back.
    const { effects } = stepEye(counting(EVERY), env(), tick);
    expect(effects.some((e) => e.type !== "chime")).toBe(false);
  });

  it("starts the twenty seconds when the notice runs out, silently", () => {
    // The beep five seconds ago was the announcement; a second one here would
    // just be noise.
    const warning: EyeState = { phase: "warning", startedAt: T0, endsAt: T0 + 5_000 };
    const { state, effects } = stepEye(warning, env({ now: T0 + 5_001 }), tick);
    expect(state).toEqual({
      phase: "breaking",
      startedAt: T0 + 5_001,
      endsAt: T0 + 5_001 + 20_000,
    });
    expect(effects).toEqual([]);
  });

  it("counts the notice down as well as the break", () => {
    const warning: EyeState = { phase: "warning", startedAt: T0, endsAt: T0 + 5_000 };
    expect(breakSecondsLeft(warning, T0)).toBe(5);
    expect(breakSecondsLeft(warning, T0 + 4_200)).toBe(1);
  });

  it("can be waved off during the notice, before it has cost anything", () => {
    const warning: EyeState = { phase: "warning", startedAt: T0, endsAt: T0 + 5_000 };
    expect(stepEye(warning, env({ now: T0 + 2_000 }), { type: "skip" }).state).toEqual({
      phase: "restoring",
      chime: false,
    });
    const snoozed = stepEye(warning, env({ now: T0 + 2_000 }), { type: "snooze", minutes: 5 });
    expect(snoozed.state.phase).toBe("restoring");
    expect(snoozed.effects).toContainEqual({
      type: "persist",
      lastBreakAt: T0 + 2_000,
      snoozedUntil: T0 + 2_000 + 5 * MINUTE,
    });
  });

  it("takes the screen over a playing video too — the component pauses it", () => {
    // The rule: only a workout stands a break down, not something on screen.
    // What plays underneath is paused (a video) or muted (a stream) and put back
    // — see components/player-hush.ts.
    expect(stepEye(counting(EVERY), env(), tick).state.phase).toBe("warning");
  });

  it("counts the twenty seconds down", () => {
    const breaking: EyeState = { phase: "breaking", startedAt: T0, endsAt: T0 + 20_000 };
    expect(breakSecondsLeft(breaking, T0)).toBe(20);
    expect(breakSecondsLeft(breaking, T0 + 15_500)).toBe(5);
    expect(breakSecondsLeft(breaking, T0 + 30_000)).toBe(0);
  });
});

describe("coming back", () => {
  const breaking: EyeState = { phase: "breaking", startedAt: T0, endsAt: T0 + 20_000 };

  it("ends on time, with a chime, and starts the clock again", () => {
    const { state } = stepEye(breaking, env({ now: T0 + 20_001 }), tick);
    expect(state).toEqual({ phase: "restoring", chime: true });

    const back = stepEye(state, env({ now: T0 + 20_001 }), tick);
    expect(back.effects).toContainEqual({ type: "chime", sound: "end" });
    expect(back.state).toEqual(counting(0, T0 + 20_001));
  });

  it("skips without the end chime, since nothing was waited out", () => {
    const { state } = stepEye(breaking, env({ now: T0 + 3000 }), { type: "skip" });
    expect(state).toEqual({ phase: "restoring", chime: false });
    const back = stepEye(state, env(), tick);
    expect(back.effects.some((e) => e.type === "chime")).toBe(false);
  });

  it("snoozes five minutes, and comes back five minutes later rather than twenty", () => {
    const { state, effects } = stepEye(breaking, env({ now: T0 + 3000 }), { type: "snooze", minutes: 5 });
    expect(state.phase).toBe("restoring");
    expect(effects).toContainEqual({
      type: "persist",
      lastBreakAt: T0 + 3000,
      snoozedUntil: T0 + 3000 + 5 * MINUTE,
    });
  });

  it("records the break so a reload does not forget it", () => {
    const { effects } = stepEye({ phase: "restoring", chime: true }, env(), tick);
    expect(effects).toContainEqual({ type: "persist", lastBreakAt: T0, snoozedUntil: 0 });
  });
});

describe("restoreEye", () => {
  it("RESUMES from the last break rather than starting the twenty minutes over", () => {
    // The board reloads itself several times an hour — a dev edit, an HMR
    // update, an F5. Every one of those used to buy a fresh twenty minutes,
    // which is the second half of why breaks stopped arriving.
    const saved = { lastBreakAt: T0 - 12 * MINUTE, snoozedUntil: 0 };
    expect(restoreEye(saved, env())).toEqual(counting(12 * MINUTE));
  });

  it("starts clean when the board has been shut longer than an interval", () => {
    const saved = { lastBreakAt: T0 - 5 * 60 * MINUTE, snoozedUntil: 0 };
    expect(restoreEye(saved, env())).toEqual(counting(0));
  });

  it("starts clean with nothing remembered at all", () => {
    expect(restoreEye(null, env())).toEqual(counting(0));
  });

  it("honours a snooze that is still running", () => {
    const saved = { lastBreakAt: T0 - MINUTE, snoozedUntil: T0 + 5 * MINUTE };
    expect(restoreEye(saved, env())).toEqual(counting(15 * MINUTE));
  });

  it("ignores a snooze that has expired", () => {
    expect(restoreEye({ lastBreakAt: T0 - 1000, snoozedUntil: T0 - 1000 }, env())).toEqual(
      counting(1000),
    );
  });

  it("comes back hidden if the board loaded behind something", () => {
    // Not idle: a reload while the tab is in the background is still a board
    // that was on the wall a second ago.
    expect(restoreEye({ lastBreakAt: T0 - MINUTE, snoozedUntil: 0 }, env({ visible: false }))).toEqual(
      gone(MINUTE, T0),
    );
  });

  it("stays idle if the conditions are against it", () => {
    expect(restoreEye(null, env({ quiet: true }))).toEqual({ phase: "idle" });
    expect(restoreEye(null, env({ busy: true }))).toEqual({ phase: "idle" });
  });
});

describe("eyeClockOf — what the left stack shows", () => {
  it("reports a deadline while counting, not a remainder", () => {
    // A consumer ticking its own clock subtracts now from this and cannot drift
    // against the five-second tick that produced it.
    expect(eyeClockOf(counting(5 * MINUTE), env())).toEqual({
      phase: "counting",
      nextAt: T0 + 15 * MINUTE,
    });
  });

  it("keeps counting on the row while the board is hidden, because it IS counting", () => {
    expect(eyeClockOf(gone(5 * MINUTE), env())).toEqual({
      phase: "counting",
      nextAt: T0 + 15 * MINUTE,
    });
  });

  it("says why it is off, so the row can tell standing down from broken", () => {
    expect(eyeClockOf(counting(0), env({ busy: true }))).toEqual({ phase: "off", reason: "busy" });
    expect(eyeClockOf(counting(0), env({ quiet: true }))).toEqual({ phase: "off", reason: "quiet" });
    expect(eyeClockOf(counting(0), env({ enabled: false }))).toEqual({
      phase: "off",
      reason: "disabled",
    });
    expect(eyeClockOf({ phase: "idle" }, env())).toEqual({ phase: "off", reason: "idle" });
  });

  it("hands over the overlay's own deadline", () => {
    const breaking: EyeState = { phase: "breaking", startedAt: T0, endsAt: T0 + 20_000 };
    expect(eyeClockOf(breaking, env())).toEqual({ phase: "breaking", endsAt: T0 + 20_000 });
  });
});
