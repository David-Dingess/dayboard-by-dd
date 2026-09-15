"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Step } from "@/lib/health";
import { sounds } from "./beeps";

export interface TimerState {
  index: number;
  step: Step | undefined;
  next: Step | undefined;
  remaining: number;
  running: boolean;
  finished: boolean;
  elapsedSec: number;
  skipped: Set<string>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  finishNow: () => void;
}

/**
 * The interval clock, ported from the standalone app.
 *
 * THE CLOCK IS `Date.now()` ARITHMETIC, NOT AN ACCUMULATING INTERVAL. Counting
 * ticks drifts the moment the window loses focus, which is routine here — the
 * whole point is that you walk away from the desk.
 *
 * The one thing added in the move: a one-second interval running alongside
 * requestAnimationFrame. rAF stops completely in a background browser tab, and
 * on a board that lives in a tab behind a DAW that would mean the countdown
 * froze on 14 and the finish chime never played. `setInterval` is throttled to
 * about once a second instead of stopped, which is enough to advance a step and
 * make a sound; the numbers stay right either way because both paths only ever
 * read the clock.
 */
export function useIntervalTimer(steps: Step[], soundEnabled: boolean): TimerState {
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(steps[0]?.seconds ?? 0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [skipped] = useState(() => new Set<string>());

  const endAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const lastTickSecRef = useRef(-1);
  const indexRef = useRef(0);

  // Synced in an effect rather than assigned during render, which the compiler
  // rules forbid. Everything that reads it is a callback or an interval, both of
  // which run after the effect has landed.
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const beginStep = useCallback(
    (i: number, autoRun: boolean) => {
      const step = steps[i];
      if (!step) return;
      setIndex(i);
      setRemaining(step.seconds);
      lastTickSecRef.current = -1;
      endAtRef.current = Date.now() + step.seconds * 1000;
      if (autoRun && soundEnabled) {
        if (step.kind === "work") sounds.go();
        else sounds.rest();
      }
    },
    [steps, soundEnabled],
  );

  const start = useCallback(() => {
    startedAtRef.current = Date.now();
    setFinished(false);
    setElapsedSec(0);
    setRunning(true);
    beginStep(0, true);
  }, [beginStep]);

  const pause = useCallback(() => {
    setRunning(false);
    setRemaining(Math.max(0, (endAtRef.current - Date.now()) / 1000));
  }, []);

  const resume = useCallback(() => {
    endAtRef.current = Date.now() + remaining * 1000;
    setRunning(true);
  }, [remaining]);

  const advance = useCallback(
    (from: number) => {
      const nextIndex = from + 1;
      if (nextIndex >= steps.length) {
        setRunning(false);
        setFinished(true);
        setRemaining(0);
        if (soundEnabled) sounds.finish();
        return;
      }
      beginStep(nextIndex, true);
    },
    [steps.length, beginStep, soundEnabled],
  );

  const skip = useCallback(() => {
    const current = steps[indexRef.current];
    if (current?.kind === "work") skipped.add(current.key);
    advance(indexRef.current);
  }, [steps, advance, skipped]);

  const finishNow = useCallback(() => {
    setRunning(false);
    setFinished(true);
  }, []);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let done = false;

    const tick = (): void => {
      if (done) return;
      const left = (endAtRef.current - Date.now()) / 1000;
      setRemaining(Math.max(0, left));
      setElapsedSec(Math.round((Date.now() - startedAtRef.current) / 1000));

      const whole = Math.ceil(left);
      if (soundEnabled && whole <= 3 && whole >= 1 && whole !== lastTickSecRef.current) {
        lastTickSecRef.current = whole;
        sounds.tick();
      }

      if (left <= 0) {
        done = true;
        advance(indexRef.current);
      }
    };

    const loop = (): void => {
      tick();
      if (!done) frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    // The backstop for a hidden tab, where rAF never fires at all.
    const fallback = setInterval(tick, 1000);

    return () => {
      done = true;
      cancelAnimationFrame(frame);
      clearInterval(fallback);
    };
  }, [running, index, advance, soundEnabled]);

  return {
    index,
    step: steps[index],
    next: steps.slice(index + 1).find((s) => s.kind === "work"),
    remaining,
    running,
    finished,
    elapsedSec,
    skipped,
    start,
    pause,
    resume,
    skip,
    finishNow,
  };
}
