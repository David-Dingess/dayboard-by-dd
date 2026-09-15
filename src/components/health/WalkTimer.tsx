"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/health";
import { deleteWalk, logWalk } from "@/lib/health-actions";
import type { HealthSnapshot } from "@/lib/health-store";
import { sounds } from "./beeps";

const QUICK = [15, 25, 45, 60, 90];

/**
 * Walks are logged, not choreographed.
 *
 * The timer is here because a target is easier to hit when something is
 * counting, but the manual entry matters just as much: you may already take long
 * unplanned walks, and those count for everything the program is trying to
 * achieve. Reachable on any day for the same reason — an extra walk always
 * counts, even when the schedule asked for something else.
 */
export function WalkTimer({
  snapshot,
  writable,
  onDone,
  onRunning,
}: {
  snapshot: HealthSnapshot;
  writable: boolean;
  onDone: () => void;
  /** Reported upward so the eye break can stand down — see the effect below. */
  onRunning?: (running: boolean) => void;
}) {
  const session = snapshot.session;
  const scheduled = session.kind === "walk";
  const target = session.targetMinutes ?? 30;

  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [manual, setManual] = useState(String(target));
  const [outdoors, setOutdoors] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(0);
  const announced = useRef(false);

  useEffect(() => {
    if (!running) return;
    // Against the clock, not by counting ticks: this runs while the tab is
    // hidden and in a browser tab behind everything else.
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 500);
    return () => clearInterval(id);
  }, [running]);

  /**
   * A WALK IN PROGRESS STANDS THE EYE BREAK DOWN; AN OPEN WALK SCREEN DOES NOT.
   *
   * HealthApp used to pass `view === "walk"` for that, which meant opening the
   * timer and never starting it — or walking off and leaving it on screen —
   * suppressed eye breaks for the rest of the day. Same rule the session player
   * already follows: report the clock, not the screen. Cleared on unmount, so
   * leaving the view can never strand it true.
   */
  useEffect(() => {
    onRunning?.(running);
    return () => onRunning?.(false);
  }, [running, onRunning]);

  // One chime at the target, then it keeps counting — going long is a good
  // outcome, not a reason to stop the clock.
  useEffect(() => {
    if (!running || announced.current) return;
    if (elapsed >= target * 60) {
      announced.current = true;
      if (snapshot.settings.soundEnabled) sounds.finish();
    }
  }, [elapsed, running, target, snapshot.settings.soundEnabled]);

  const save = async (minutes: number, source: "timer" | "manual") => {
    if (!Number.isFinite(minutes) || minutes < 1) {
      setError("How many minutes?");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await logWalk({ durationMin: Math.round(minutes), outdoors, source });
    setBusy(false);
    if (!result.ok) setError(result.error ?? "That didn't save.");
    else onDone();
  };

  const pct = Math.min(1, elapsed / (target * 60));
  const r = 54;
  const circumference = 2 * Math.PI * r;

  return (
    <>
      <p className="health-eyebrow">
        Week {session.week} · {scheduled ? session.title : "Extra walk"}
      </p>
      <h3 className="healthcard-title">
        {scheduled ? `${target} minutes, conversational pace` : "A walk, any length"}
      </h3>
      <p className="healthcard-sub">
        {!scheduled
          ? `Today's schedule says ${session.title}, but walks never need permission. Anything logged here counts toward the week.`
          : session.pickups
            ? `Somewhere in the middle, pick up the pace for one minute, ${session.pickups} times. Hard enough that talking gets awkward.`
            : "Fast enough to feel it, slow enough to hold a conversation."}
      </p>

      <div className="healthring">
        <svg viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="var(--voice-live)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <span className="healthring-time mono">{formatDuration(elapsed)}</span>
      </div>

      <div className="healthfoot-acts healthring-acts">
        {!running ? (
          <button
            type="button"
            className="healthbtn is-primary"
            onClick={() => {
              startedAt.current = Date.now() - elapsed * 1000;
              setRunning(true);
            }}
          >
            {elapsed > 0 ? "Resume" : "Start walking"}
          </button>
        ) : (
          <button type="button" className="healthbtn" onClick={() => setRunning(false)}>
            Pause
          </button>
        )}
        <button
          type="button"
          className="healthbtn is-quiet"
          disabled={!writable || busy || elapsed < 60}
          onClick={() => void save(Math.max(1, Math.round(elapsed / 60)), "timer")}
        >
          {elapsed < 60 ? "Log this walk" : `Log ${Math.round(elapsed / 60)} min`}
        </button>
      </div>

      <section className="healthblock">
        <p className="health-eyebrow">Log a walk you already took</p>
        <div className="healthmanual">
          <input
            className="healthinput"
            type="number"
            min={1}
            max={300}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            aria-label="minutes"
          />
          <span className="healthcard-sub">minutes</span>
          <label className="healthcheck">
            <input type="checkbox" checked={outdoors} onChange={(e) => setOutdoors(e.target.checked)} />
            outdoors
          </label>
          <button
            type="button"
            className="healthbtn is-primary"
            disabled={!writable || busy}
            onClick={() => void save(Number(manual), "manual")}
          >
            Log it
          </button>
        </div>
        <div className="healthquick">
          {QUICK.map((m) => (
            <button key={m} type="button" className="healthquick-btn mono" onClick={() => setManual(String(m))}>
              {m}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="healthnote is-error">{error}</p>}

      {snapshot.walksToday.length > 0 && (
        <section className="healthblock">
          <p className="health-eyebrow">Logged today</p>
          <ul className="healthlist">
            {snapshot.walksToday.map((walk) => (
              <li key={walk.id}>
                <span className="mono">
                  {walk.durationMin} min{walk.outdoors ? " · outdoors" : ""}
                </span>
                <button
                  type="button"
                  className="healthlink"
                  disabled={!writable}
                  onClick={() => void deleteWalk(walk.id)}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="healthfoot">
        <button type="button" className="healthbtn is-quiet" onClick={onDone}>
          Back
        </button>
      </div>
    </>
  );
}
