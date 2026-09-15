"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FIGURES, buildSteps, formatDuration, sideAt, type Feedback, type Session } from "@/lib/health";
import { recordSession, sendFeedback } from "@/lib/health-actions";
import { primeAudio } from "./beeps";
import { ExerciseFigure } from "./ExerciseFigure";
import { SWITCH_SHOW_SEC, SwitchCallout, useSwitchCue } from "./switch-cue";
import { useIntervalTimer } from "./useIntervalTimer";

/**
 * Preview → running → done, ported from the standalone app's Player screen.
 *
 * The running state is deliberately the loudest thing on the board: this is read
 * from a mat several feet away, so it is one enormous number, one exercise name
 * and one line of coaching. Everything else gets out of the way.
 */
export function HealthPlayer({
  session,
  isMinimum,
  today,
  soundEnabled,
  writable,
  onDone,
  onRunning,
}: {
  session: Session;
  isMinimum: boolean;
  today: string;
  soundEnabled: boolean;
  writable: boolean;
  onDone: () => void;
  /** Told while the clock is actually going, so the eye break can stand down. */
  onRunning: (running: boolean) => void;
}) {
  // Memoised on the session object, which HealthApp froze at Start — see its
  // docblock. A refresh tick must not rebuild these.
  const steps = useMemo(() => buildSteps(session), [session]);
  const timer = useIntervalTimer(steps, soundEnabled);
  const [started, setStarted] = useState(false);

  // Switch sides at the half of a station whose cue says to. Worked out up here,
  // before any early return, because the chime is a hook; the callout below is
  // the same test read again.
  const cueStep = timer.step;
  const cueAnim =
    cueStep?.kind === "work" && cueStep.station ? FIGURES[cueStep.station.exerciseId] : undefined;
  const halfway = cueStep ? cueStep.seconds / 2 : 0;
  const switching = Boolean(
    started &&
      !timer.finished &&
      cueAnim?.switchHalfway &&
      timer.remaining <= halfway &&
      timer.remaining > halfway - SWITCH_SHOW_SEC,
  );
  useSwitchCue(switching, cueStep?.key, soundEnabled);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Not state: whether the record has been written is never drawn, and setting
  // it from inside the effect that writes it is what keeps that effect from
  // running twice.
  const savedRef = useRef(false);

  // Derived rather than stored. The timer already knows whether it has finished;
  // a second copy of that in state would only be a way for the two to disagree.
  const phase: "preview" | "running" | "done" = !started
    ? "preview"
    : timer.finished
      ? "done"
      : "running";

  useEffect(() => {
    onRunning(phase === "running");
    return () => onRunning(false);
  }, [phase, onRunning]);

  /**
   * Hold the screen awake while a session runs. The board is a page you walk
   * away from onto a mat, and a monitor that sleeps at station three is the one
   * failure this cannot recover from. Best-effort: the API is not everywhere,
   * and the lock is dropped whenever the tab is hidden, so it is re-taken on the
   * way back.
   */
  useEffect(() => {
    if (phase !== "running") return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const take = async () => {
      try {
        sentinel = (await navigator.wakeLock?.request("screen")) ?? null;
        if (cancelled) void sentinel?.release();
      } catch {
        // Unsupported, or refused because the tab is not visible. Fine.
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

  /**
   * Log it the moment the session ends, before any feedback, exactly once.
   *
   * The work is done at that point; closing the tab on the "how did that feel"
   * question must not be able to lose it. Feedback is a second, separate write.
   */
  useEffect(() => {
    if (phase !== "done" || savedRef.current) return;
    savedRef.current = true;

    const exercises = [];
    for (const block of session.blocks) {
      if (block.kind === "warmup" || block.kind === "cooldown") continue;
      for (const station of block.stations) {
        const own = steps.filter((s) => s.kind === "work" && s.station === station);
        const skippedCount = own.filter((s) => timer.skipped.has(s.key)).length;
        exercises.push({
          exerciseId: station.exerciseId,
          patternId: station.patternId,
          rungIndex: station.rungIndex,
          roundsCompleted: own.length - skippedCount,
          skipped: skippedCount === own.length && own.length > 0,
        });
      }
    }

    void recordSession({
      date: today,
      sessionId: session.id,
      kind: isMinimum ? "minimum" : session.kind,
      status: exercises.every((e) => e.skipped) ? "partial" : "completed",
      completedAt: new Date().toISOString(),
      durationSec: Math.max(timer.elapsedSec, 1),
      exercises,
    }).then((result) => {
      if (!result.ok) setError(result.error ?? "That didn't save.");
    });
  }, [phase, session, steps, timer.skipped, timer.elapsedSec, today, isMinimum]);

  if (phase === "preview") {
    return (
      <div className="widget-scroll healthbody">
        <p className="health-eyebrow">
          Week {session.week} · Phase {session.phase.index} · {session.phase.name}
        </p>
        <h3 className="healthcard-title">{session.title}</h3>
        <p className="healthcard-sub">{session.subtitle}</p>

        <div className="healthblocks">
          {session.blocks.map((block) => (
            <section key={block.id} className="healthblock">
              <header className="healthblock-head">
                <h4>{block.label}</h4>
                <span className="mono">{block.rounds > 1 ? `${block.rounds} rounds` : "1 round"}</span>
              </header>
              {block.note && <p className="healthblock-note">{block.note}</p>}
              <ol className="healthstations">
                {block.stations.map((station, i) => (
                  <li key={`${station.exerciseId}-${i}`}>
                    <span className="healthstation-n mono">{String(i + 1).padStart(2, "0")}</span>
                    <ExerciseFigure moveId={station.exerciseId} className="is-thumb" />
                    <span className="healthstation-body">
                      <span className="healthstation-name">
                        {station.name}
                        {station.equipment && <span className="healthchip">{station.equipment}</span>}
                      </span>
                      <span className="healthstation-cue">{station.cue}</span>
                    </span>
                    <span className="healthstation-sec mono">{station.workSec}s</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>

        <div className="healthfoot">
          <div className="healthfoot-acts">
            <button
              type="button"
              className="healthbtn is-primary"
              onClick={() => {
                primeAudio();
                timer.start();
                setStarted(true);
              }}
            >
              Start · about {session.estMinutes} min
            </button>
            <button type="button" className="healthlink" onClick={onDone}>
              Not now
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="widget-scroll healthbody healthdone-view">
        <span className="healthdone-mark">✓</span>
        <p className="health-eyebrow">Logged for today</p>
        <h3 className="healthcard-title">{session.title}, done.</h3>
        <p className="healthcard-sub mono">
          {formatDuration(timer.elapsedSec)} · week {session.week}
        </p>
        {error && <p className="healthnote is-error">{error}</p>}

        <section className="healthblock">
          <p className="healthstation-name">How did that feel?</p>
          <p className="healthblock-note">
            This is what moves the program up or down. Skip it and it progresses on its own.
          </p>
          <div className="healthfeedback">
            {(
              [
                ["too_easy", "Too easy"],
                ["just_right", "Just right"],
                ["too_hard", "Too hard"],
              ] as Array<[Feedback, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`healthbtn${feedback === value ? " is-primary" : " is-quiet"}`}
                disabled={!writable}
                onClick={() => {
                  setFeedback(value);
                  void sendFeedback(today, value).then((result) => {
                    if (!result.ok) setError(result.error ?? "That didn't save.");
                  });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {feedback && (
            <p className="healthblock-note is-go">
              {feedback === "too_hard"
                ? "Noted — the next one of these steps back a rung."
                : feedback === "too_easy"
                  ? "Noted — the next one steps up a rung."
                  : "Noted. Staying here for now."}
            </p>
          )}
        </section>

        <div className="healthfoot">
          <button type="button" className="healthbtn" onClick={onDone}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const step = timer.step;
  if (!step) return <div className="healthrun" />;

  const isWork = step.kind === "work";
  const shownId = isWork ? step.station?.exerciseId : timer.next?.station?.exerciseId;
  const shownAnim = shownId ? FIGURES[shownId] : undefined;
  const pct = step.seconds > 0 ? Math.max(0, Math.min(1, timer.remaining / step.seconds)) : 0;

  return (
    <div className="healthrun">
      <header className="healthrun-head">
        <div>
          <p className="health-eyebrow">
            {step.blockLabel}
            {step.rounds > 1 ? ` · round ${step.round} of ${step.rounds}` : ""}
          </p>
          <p className="healthrun-session">{session.title}</p>
        </div>
        <button type="button" className="healthlink" onClick={timer.finishNow}>
          Finish early
        </button>
      </header>

      <div className="healthrun-main">
        <div className="healthrun-copy">
          <p className={`health-eyebrow${isWork ? " is-work" : ""}`}>
            {isWork ? "Work" : step.kind === "roundrest" ? "Round break" : "Rest"}
            {isWork && shownAnim?.switchHalfway
              ? ` · ${sideAt(shownAnim, 0, step.seconds, timer.remaining).toLowerCase()} side`
              : ""}
          </p>
          <p className="healthrun-count mono">{Math.ceil(timer.remaining)}</p>
          <div className="healthbar healthrun-bar">
            <span className={isWork ? "is-work" : ""} style={{ width: `${pct * 100}%` }} />
          </div>
          <h3 className="healthrun-name">
            {isWork ? step.station?.name : timer.next ? `Next: ${timer.next.station?.name}` : "Almost done"}
          </h3>
          <p className="healthrun-cue">
            {isWork ? step.station?.cue : "Breathe. Shake it out. Get set for the next one."}
          </p>
          {isWork && step.station?.equipment && <p className="healthchip">{step.station.equipment}</p>}
        </div>

        {/* DURING A REST IT SHOWS THE NEXT MOVEMENT, not the one just finished.
            Rest is when you find out what is coming, and the words above it
            already say "Next:". Keyed on the step it is showing, so each
            station starts its loop from the top — and a rest previewing the
            next station is keyed the same as that station, so the loop carries
            straight on when the work begins instead of jumping back.

            A switch-halfway move mirrors once the work period is half gone,
            which is exactly when the cue says to swap. */}
        <div className="healthrun-fig">
          <ExerciseFigure
            key={isWork ? step.key : timer.next?.key}
            moveId={shownId}
            side={isWork && shownAnim ? sideAt(shownAnim, 0, step.seconds, timer.remaining) : "Right"}
            className="is-run"
          />
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
        <span className="healthrun-elapsed mono">{formatDuration(timer.elapsedSec)} elapsed</span>
      </footer>
    </div>
  );
}
