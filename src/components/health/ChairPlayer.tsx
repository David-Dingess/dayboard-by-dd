"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  CHAIR_CORE,
  CHAIR_TITLE,
  chairExtraFor,
  formatDuration,
  formatTime,
  minutesOfDay,
  nowMinutes,
  type ChairRoutine,
} from "@/lib/health";
import { recordChair } from "@/lib/health-actions";
import type { HealthSnapshot } from "@/lib/health-store";
import { ExerciseFigure } from "./ExerciseFigure";
import { HealthWarning } from "./HealthWarning";
import { SWITCH_SHOW_SEC, SwitchCallout, useSwitchCue } from "./switch-cue";
import { useIntervalTimer } from "./useIntervalTimer";

/**
 * Chair five on the Health tab: the card on Today, and the player it opens.
 *
 * The routine itself — which moves, how long, why — is in lib/health/chair.ts.
 * This file only draws it.
 */

/** How long after its time an undone slot still reads as "now" rather than missed. */
const DUE_WINDOW_MIN = 120;
/** A routine finished inside its first minute was a mis-press, not a routine. */
const MIN_LOGGED_SEC = 60;

/* ------------------------------------------------------------------ clock -- */

/**
 * The NY minute of day, ticking once a minute — or null before hydration.
 *
 * Null on the server and on the first client render, so the markup matches
 * whatever the server sent; the snapshot deliberately never asks the time (see
 * buildSnapshot), and "is this slot due yet" is the one question the card
 * cannot answer without it.
 */
const minuteListeners = new Set<() => void>();
let minuteTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMinute() {
  minuteTimer = setTimeout(() => {
    for (const listener of minuteListeners) listener();
    scheduleMinute();
  }, 60_000 - (Date.now() % 60_000) + 250);
}

function subscribeMinute(listener: () => void) {
  minuteListeners.add(listener);
  if (!minuteTimer) scheduleMinute();
  return () => {
    minuteListeners.delete(listener);
    if (!minuteListeners.size && minuteTimer) {
      clearTimeout(minuteTimer);
      minuteTimer = null;
    }
  };
}

function useNowMinutes(): number | null {
  return useSyncExternalStore(subscribeMinute, () => nowMinutes(), () => null);
}

/* ------------------------------------------------------------------- card -- */

type DotState = "done" | "due" | "missed" | "ahead" | "off";

export function ChairCard({
  chair,
  writable,
  onStart,
  onPreview,
}: {
  chair: HealthSnapshot["chair"];
  writable: boolean;
  onStart: () => void;
  onPreview: () => void;
}) {
  const now = useNowMinutes();

  const dots = chair.slots.map((slot) => {
    const at = minutesOfDay(slot.time);
    let state: DotState;
    if (slot.done) state = "done";
    else if (!slot.enabled) state = "off";
    else if (now === null || now < at) state = "ahead";
    else if (now < at + DUE_WINDOW_MIN) state = "due";
    else state = "missed";
    return { ...slot, state };
  });

  const planned = chair.slots.filter((slot) => slot.enabled).length;
  const due = dots.some((dot) => dot.state === "due");
  const count =
    planned > 0 && chair.doneToday <= planned
      ? `${chair.doneToday} of ${planned} today`
      : `${chair.doneToday} today`;

  return (
    <section className={`healthcard is-chair${due ? " is-due" : ""}`}>
      <div className="healthcard-main">
        <p className="health-eyebrow">
          <span className="healthdot is-chair" aria-hidden />
          {CHAIR_TITLE} · {count}
        </p>
        <h3 className="healthcard-title">Wrists, hamstrings, calves</h3>
        <p className="healthcard-sub">Plus {chair.nextExtra} this time · about 5 min, in the chair</p>
        {dots.length > 0 && (
          <ol className="chairdots" aria-label="today's chair routines">
            {dots.map((dot) => (
              <li key={dot.id} className={`chairdot is-${dot.state}`} title={labelFor(dot.state)}>
                <span className="chairdot-mark" aria-hidden>
                  {dot.state === "done" ? "✓" : ""}
                </span>
                <span className="chairdot-time mono">{formatTime(dot.time)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="healthcard-acts">
        {/* Always startable: a fourth one on a long day is a good thing, and
            "due" only changes how loudly the button asks. */}
        <button
          type="button"
          className={`healthbtn${due ? " is-primary" : ""}`}
          onClick={onStart}
          disabled={!writable}
        >
          {due ? "Start · 5 min" : "Do one now"}
        </button>
        <button type="button" className="healthlink" onClick={onPreview}>
          see the moves
        </button>
      </div>
    </section>
  );
}

function labelFor(state: DotState): string {
  switch (state) {
    case "done":
      return "done";
    case "due":
      return "due now";
    case "missed":
      return "missed";
    case "off":
      return "nudge off";
    default:
      return "later today";
  }
}

/* ----------------------------------------------------------------- player -- */

/**
 * Straight into the clock — no preview screen. It is five minutes of stretches
 * in a chair; the thing to decide was whether to press Start, and that is done.
 *
 * Built on the same interval timer and the same `.healthrun` layout as the
 * session player, so it reads from across the room the same way, and so the
 * go-tone at every step is the cue to switch sides.
 */
export function ChairPlayer({
  routine,
  doneBefore,
  soundEnabled,
  writable,
  onDone,
  onRunning,
}: {
  /** Frozen at Start by HealthApp, like a session — a refresh must not rebuild it. */
  routine: ChairRoutine;
  doneBefore: number;
  soundEnabled: boolean;
  writable: boolean;
  onDone: () => void;
  onRunning: (running: boolean) => void;
}) {
  const steps = useMemo(() => routine.steps, [routine]);
  const timer = useIntervalTimer(steps, soundEnabled);
  const { start } = timer;
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef(false);
  const startedRef = useRef(false);

  // Pressing Start on the card is the gesture; the clock starts as this mounts.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    start();
  }, [start]);

  const phase: "running" | "done" = timer.finished ? "done" : "running";

  // Each side is its own step here, so the switch is the start of a left one.
  // The go tone plays at that same instant, so the chime waits for it to finish.
  const cueStep = timer.step;
  const cueMove = cueStep ? routine.moves[cueStep.key] : undefined;
  const switching = Boolean(
    !timer.finished &&
      cueStep &&
      cueMove?.side === "Left" &&
      cueStep.seconds - timer.remaining < SWITCH_SHOW_SEC,
  );
  useSwitchCue(switching, cueStep?.key, soundEnabled, 260);

  useEffect(() => {
    onRunning(phase === "running");
    return () => onRunning(false);
  }, [phase, onRunning]);

  // Hold the screen awake: you are looking at the board from a stretch, not
  // touching the mouse. Same best-effort lock as the session player.
  useEffect(() => {
    if (phase !== "running") return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const take = async () => {
      try {
        sentinel = (await navigator.wakeLock?.request("screen")) ?? null;
        if (cancelled) void sentinel?.release();
      } catch {
        // Unsupported, or the tab is hidden. Fine.
      }
    };
    void take();
    const onVisible = () => {
      if (document.visibilityState === "visible") void take();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [phase]);

  const logged = timer.elapsedSec >= MIN_LOGGED_SEC;

  // Logged the moment it ends, exactly once — the same rule as a session.
  useEffect(() => {
    if (phase !== "done" || savedRef.current) return;
    savedRef.current = true;
    if (!logged) return;
    void recordChair({
      routineId: routine.id,
      durationSec: Math.max(timer.elapsedSec, 1),
      skipped: [...timer.skipped],
    }).then((result) => {
      if (!result.ok) setError(result.error ?? "That didn't save.");
    });
  }, [phase, logged, routine.id, timer.elapsedSec, timer.skipped]);

  if (phase === "done") {
    return (
      <div className="widget-scroll healthbody healthdone-view">
        <span className="healthdone-mark">{logged ? "✓" : "·"}</span>
        <p className="health-eyebrow">{logged ? "Logged" : "Not logged"}</p>
        <h3 className="healthcard-title">
          {logged ? `${CHAIR_TITLE}, done.` : "Stopped inside the first minute."}
        </h3>
        <p className="healthcard-sub mono">
          {formatDuration(timer.elapsedSec)}
          {logged ? ` · ${doneBefore + 1} today` : ""}
        </p>
        {!writable && <p className="healthnote">Routines can only be logged on the machine the board runs on.</p>}
        {error && <p className="healthnote is-error">{error}</p>}
        <div className="healthfoot">
          <button type="button" className="healthbtn" onClick={onDone}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const step = timer.step;
  const move = step ? routine.moves[step.key] : undefined;
  if (!step || !move) return <div className="healthrun" />;

  const nextMove = timer.next ? routine.moves[timer.next.key] : undefined;
  const pct = step.seconds > 0 ? Math.max(0, Math.min(1, timer.remaining / step.seconds)) : 0;

  return (
    <div className="healthrun is-chair">
      <header className="healthrun-head">
        <div>
          <p className="health-eyebrow">
            {step.blockLabel} · {timer.index + 1} of {steps.length}
          </p>
          <p className="healthrun-session">
            {CHAIR_TITLE} · plus {routine.extraName}
          </p>
        </div>
        <button type="button" className="healthlink" onClick={timer.finishNow}>
          Finish early
        </button>
      </header>

      <div className="healthrun-main">
        <div className="healthrun-copy">
          <p className="health-eyebrow is-work">{move.side ? `${move.side} side` : "Both sides"}</p>
          <p className="healthrun-count mono">{Math.ceil(timer.remaining)}</p>
          <div className="healthbar healthrun-bar">
            <span className="is-work" style={{ width: `${pct * 100}%` }} />
          </div>
          <h3 className="healthrun-name">{move.name}</h3>
          <p className="healthrun-cue">{move.cue}</p>
          {nextMove && (
            <p className="healthchip">
              Next: {nextMove.name}
              {nextMove.side ? ` · ${nextMove.side.toLowerCase()}` : ""}
            </p>
          )}
        </div>
        {/* Keyed on the step, so each move — and each side — starts its loop
            from the beginning rather than wherever the last one had got to. */}
        <div className="healthrun-fig">
          <ExerciseFigure key={step.key} moveId={move.id} side={move.side ?? "Right"} className="is-run" />
          <SwitchCallout show={switching} />
        </div>
      </div>

      <footer className="healthrun-foot">
        <button type="button" className="healthbtn is-quiet" onClick={timer.running ? timer.pause : timer.resume}>
          {timer.running ? "Pause" : "Resume"}
        </button>
        <button type="button" className="healthbtn is-quiet" onClick={timer.skip}>
          Skip
        </button>
        <span className="healthrun-elapsed mono">
          {formatDuration(timer.elapsedSec)} of about {formatDuration(routine.estSeconds)}
        </span>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------- preview -- */

/**
 * Every move in the next routine, all playing at once, with nothing timing
 * them. For learning the shapes before the clock is running — a first routine
 * is not the moment to find out what a tendon glide is.
 */
export function ChairPreview({
  doneToday,
  writable,
  onStart,
  onBack,
}: {
  doneToday: number;
  writable: boolean;
  onStart: () => void;
  onBack: () => void;
}) {
  const extra = chairExtraFor(doneToday);
  const groups = [
    { title: "Every time", moves: CHAIR_CORE },
    { title: `This time: ${extra.name}`, moves: extra.moves },
  ];

  return (
    <>
      <p className="health-eyebrow">{CHAIR_TITLE}</p>
      <h3 className="healthcard-title">The moves</h3>
      <p className="healthcard-sub">
        Each one loops. Moves marked each side are drawn doing the right; the left is the mirror.
      </p>
      {groups.map((group) => (
        <section key={group.title} className="healthblock">
          <p className="health-eyebrow">{group.title}</p>
          <ul className="chairmoves">
            {group.moves.map((move) => (
              <li key={move.id} className="chairmove">
                <ExerciseFigure moveId={move.id} />
                <p className="healthstation-name">
                  {move.name}
                  <span className="healthchip">
                    {move.sided ? `${move.seconds}s each side` : `${move.seconds}s`}
                  </span>
                </p>
                <p className="healthstation-cue">{move.cue}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="healthfoot">
        <div className="healthfoot-acts">
          <button type="button" className="healthbtn is-primary" onClick={onStart} disabled={!writable}>
            Start · 5 min
          </button>
          <button type="button" className="healthlink" onClick={onBack}>
            back
          </button>
        </div>
      </div>
      <HealthWarning />
    </>
  );
}
