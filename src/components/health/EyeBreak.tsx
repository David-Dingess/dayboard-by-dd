"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hushPlayers } from "@/components/player-hush";
import {
  breakSecondsLeft,
  eyeClockOf,
  inQuietHours,
  restoreEye,
  stepEye,
  type EyeEnv,
  type EyeEvent,
  type EyeState,
} from "@/lib/health";
import type { HealthSettingsFile } from "@/lib/schema";
import { sounds } from "./beeps";
import { publishEye } from "./eye-clock";

/**
 * The 20/20/20 break: every twenty minutes, look twenty feet away for twenty
 * seconds.
 *
 * All the judgement is in lib/health/eyebreak.ts, which is a pure reducer and
 * where the rules are written down. This half owns the four things a reducer
 * cannot: the clock, localStorage, the player, and the black rectangle.
 *
 * IT IS A PORTAL ONTO document.body, not a box in the Health tab. The break used
 * to switch the centre panel to Health and draw itself in the widget, which was
 * a polite version of an impolite idea: it interrupted the panel and left the
 * other two thirds of a 3440px board perfectly readable, so it was easy to work
 * straight through. Now it does what the bedtime nudge does — the whole screen
 * goes black — and it no longer touches the tabs at all, so nothing has to be
 * put back afterwards.
 *
 * IT MUST KEEP TICKING WITH THE TAB HIDDEN. Panel hides an inactive widget with
 * display:none rather than unmounting it, so this runs whether you are looking
 * at the calendar, the Watch tab, or this one — which is the only reason it can
 * ever be the thing that interrupts you.
 *
 * THE STATE LIVES IN A REF, not in useState. Nothing about counting is visible:
 * "nineteen minutes in" and "just started" draw the same nothing. Only a running
 * break renders, so only a running break is React state — which keeps a
 * five-second tick from re-rendering a panel that has not changed.
 */

const STORE = "dayboard.health.eye";
/** A dev escape hatch: /?eye=30s waits 30 seconds instead of 20 minutes. */
const OVERRIDE = "dayboard.health.eye.every";

const TICK_MS = 5_000;
const COUNTDOWN_MS = 250;
/** Notice before the twenty seconds start. Long enough to finish a sentence. */
const WARN_MS = 5_000;

function readSaved(): { lastBreakAt: number; snoozedUntil: number } | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lastBreakAt: number; snoozedUntil: number };
    if (typeof parsed?.snoozedUntil !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The override, read once from the URL and then remembered for this tab.
 *
 * Twenty minutes is a long time to wait to find out whether a twenty-second
 * blackout looks right, and the alternative — editing the setting and putting it
 * back — writes to the file that holds a year of history.
 *
 * IT SHORTENS THE WAIT AND NOTHING ELSE. The first version scaled the break and
 * the notice along with it, so testing showed a six-second break and quite
 * rightly said the timer had not run its twenty. What you are testing has to be
 * the thing that ships; only the boredom in front of it is negotiable.
 *
 * sessionStorage, not localStorage, for the same reason: an override that
 * outlives the tab it was typed into is a permanent change nobody remembers
 * making.
 */
function overrideMs(): number | null {
  try {
    const param = new URLSearchParams(window.location.search).get("eye");
    if (param) {
      if (param === "off") {
        sessionStorage.removeItem(OVERRIDE);
        return null;
      }
      const seconds = Number(param.replace(/s$/, ""));
      if (Number.isFinite(seconds) && seconds >= 5) {
        sessionStorage.setItem(OVERRIDE, String(seconds));
        return seconds * 1000;
      }
    }
    const stored = Number(sessionStorage.getItem(OVERRIDE));
    return Number.isFinite(stored) && stored >= 5 ? stored * 1000 : null;
  } catch {
    return null;
  }
}

export function EyeBreak({ settings, busy }: { settings: HealthSettingsFile; busy: boolean }) {
  /**
   * The only visible state: the notice or the break itself, and how long is
   * left. Counting draws nothing, so counting is not state.
   */
  const [showing, setShowing] = useState<{
    phase: "warning" | "breaking";
    endsAt: number;
    left: number;
  } | null>(null);

  const settingsRef = useRef(settings);
  const busyRef = useRef(busy);
  const stateRef = useRef<EyeState>({ phase: "idle" });
  const overrideRef = useRef<number | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
    busyRef.current = busy;
  }, [settings, busy]);

  const env = useCallback((): EyeEnv => {
    const s = settingsRef.current;
    const every = overrideRef.current ?? s.eyeBreaks.everyMinutes * 60_000;
    return {
      now: Date.now(),
      visible: document.visibilityState === "visible",
      // The eye break's own hours, and null means none. It used to read
      // s.quietHours — the NUDGE hours — which switched the feature off every
      // night at nine, when a screen has the most time behind it.
      quiet: s.eyeBreaks.quietHours
        ? inQuietHours(s.eyeBreaks.quietHours.start, s.eyeBreaks.quietHours.end)
        : false,
      busy: busyRef.current,
      enabled: s.eyeBreaks.enabled,
      everyMs: every,
      // NOT scaled by the override — see overrideMs above. A twenty-second break
      // is twenty seconds whether you waited twenty minutes for it or thirty.
      forMs: s.eyeBreaks.forSeconds * 1000,
      warnMs: WARN_MS,
    };
  }, []);

  /**
   * One turn of the reducer, and whatever it asked for.
   *
   * `restoring` is a single step by design, so it is taken in the same beat
   * rather than waiting five seconds for the next tick — a loop rather than a
   * recursive call, which keeps this a plain function.
   */
  const run = useCallback(
    (event: EyeEvent) => {
      let pending: EyeEvent = event;

      for (let guard = 0; guard < 4; guard++) {
        const environment = env();
        const { state: next, effects } = stepEye(stateRef.current, environment, pending);

        for (const effect of effects) {
          if (effect.type === "chime") {
            if (settingsRef.current.soundEnabled) {
              if (effect.sound === "warn") sounds.eyeWarn();
              else sounds.eyeEnd();
            }
          } else {
            try {
              localStorage.setItem(
                STORE,
                JSON.stringify({
                  lastBreakAt: effect.lastBreakAt,
                  snoozedUntil: effect.snoozedUntil,
                }),
              );
            } catch {
              // Private window: the count restarts on reload, which is harmless.
            }
          }
        }

        stateRef.current = next;
        // The left stack's countdown reads this. Published on every step rather
        // than only when the overlay is up, because "counting, 12 minutes to go"
        // is the whole of what that row is for.
        publishEye(eyeClockOf(next, environment));
        setShowing(
          next.phase === "breaking" || next.phase === "warning"
            ? {
                phase: next.phase,
                endsAt: next.endsAt,
                left: breakSecondsLeft(next, environment.now),
              }
            : null,
        );

        if (next.phase !== "restoring") break;
        pending = { type: "tick" };
      }
    },
    [env],
  );

  useEffect(() => {
    overrideRef.current = overrideMs();
    // Not setState: "counting" and "idle" both draw nothing, so the first frame
    // is already right and there is nothing to re-render for.
    const environment = env();
    stateRef.current = restoreEye(readSaved(), environment);
    publishEye(eyeClockOf(stateRef.current, environment));

    const id = setInterval(() => run({ type: "tick" }), TICK_MS);
    const onVisibility = () => run({ type: "visibility" });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [env, run]);

  // A second clock, and only while the overlay is up: the countdown moves every
  // second, and the five-second tick that decides everything else would make it
  // stutter.
  useEffect(() => {
    if (!showing) return;
    const id = setInterval(() => {
      if (Date.now() >= showing.endsAt) run({ type: "tick" });
      else setShowing({ ...showing, left: Math.max(0, Math.ceil((showing.endsAt - Date.now()) / 1000)) });
    }, COUNTDOWN_MS);
    return () => clearInterval(id);
  }, [showing, run]);

  /**
   * Quiet the player for as long as the screen is black, and put it back.
   *
   * Keyed on whether anything is showing AT ALL, not on the phase: the notice
   * and the break are one continuous blackout, and re-running this between them
   * would unpause a video for a frame. The restore is React's own cleanup, which
   * is why skip, snooze, running out and unmounting all put the sound back
   * without any of them saying so.
   */
  const blacked = showing !== null;
  useEffect(() => {
    if (!blacked) return;
    return hushPlayers();
  }, [blacked]);

  if (!showing) return null;

  const warning = showing.phase === "warning";

  // Onto the body, over everything: the panels, the tab row, and the player,
  // which is fixed at --z-popover and would otherwise sit in the middle of it.
  return createPortal(
    <div
      className={`eyetake${warning ? " is-warning" : ""}`}
      role="alert"
      aria-live="assertive"
    >
      <p className="eyetake-label">{warning ? "Eye break in" : "Look at something 20 feet away"}</p>
      <p className="eyetake-count">{showing.left}</p>
      <p className="eyetake-sub">
        {warning ? "Find a stopping point." : "And blink. The board will be here."}
      </p>
      <div className="eyetake-acts">
        <button type="button" className="eyetake-btn" onClick={() => run({ type: "skip" })}>
          Skip
        </button>
        <button
          type="button"
          className="eyetake-btn"
          onClick={() => run({ type: "snooze", minutes: 5 })}
        >
          Snooze 5
        </button>
      </div>
    </div>,
    document.body,
  );
}
