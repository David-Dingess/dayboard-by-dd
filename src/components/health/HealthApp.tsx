"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePanelTab } from "@/components/Panel";
import { setTabStatus } from "@/components/tab-status";
import { logWalk } from "@/lib/health-actions";
import type { HealthSnapshot } from "@/lib/health-store";
import { chairRoutine, type ChairRoutine, type Session } from "@/lib/health";
import { primeAudio } from "./beeps";
import { ChairCard, ChairPlayer, ChairPreview } from "./ChairPlayer";
import { clearDue } from "./health-due";
import { clearStart, readStart, subscribeStart } from "./health-start";
import { HealthHistory } from "./HealthHistory";
import { HealthPlayer } from "./HealthPlayer";
import { HealthSettings } from "./HealthSettings";
import { HealthStage } from "./HealthStage";
import { EyeBreak } from "./EyeBreak";
import { KindDot, kindLabel } from "./kind";
import { WalkTimer } from "./WalkTimer";

/**
 * The Health tab: one widget, several views, all client state.
 *
 * VIEWS ARE NOT ROUTES. The standalone app had five screens behind a HashRouter;
 * here they are a `view` in useState, because the URL on this board already
 * belongs to the calendar (`?cal=week&on=…`) and a session in progress is not
 * something to restore on a reload — it is something to have finished or
 * abandoned. A reload lands on Today, which is the honest answer.
 *
 * THE RUNNING SESSION IS FROZEN AT START. `snapshot` is a new object every
 * thirty seconds, because AutoRefresh re-renders every server component; the
 * steps the timer walks are memoised on `active` instead, which is a copy taken
 * when Start was pressed. Without that, one refresh mid-workout would rebuild
 * the step list and reset the clock.
 */

export type HealthView = "today" | "session" | "walk" | "chair" | "chairmoves" | "history" | "settings";

export function HealthApp({
  snapshot,
  writable,
  reason,
}: {
  snapshot: HealthSnapshot;
  writable: boolean;
  reason: string;
}) {
  const [view, setView] = useState<HealthView>("today");
  const [active, setActive] = useState<{ session: Session; isMinimum: boolean } | null>(null);
  // Frozen at Start for the same reason `active` is: the refresh tick must not
  // rebuild the step list under a running clock.
  const [chair, setChair] = useState<{ routine: ChairRoutine; doneBefore: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether the interval clock is actually going, reported by the player. Not
  // "is the session view open": a finished session sitting on the feedback
  // screen is a board nobody is exercising in front of, and it must not hold the
  // eye break off all evening.
  const [running, setRunning] = useState(false);
  // Same question for a walk, and the same answer: is the clock going. Not "is
  // the walk screen open" — that left eye breaks off for the rest of the day.
  const [walking, setWalking] = useState(false);
  // And the chair routine: five minutes of stretching is not the moment for a
  // blackout telling you to look away from the screen.
  const [stretching, setStretching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tab = usePanelTab("center");
  // Read by the Start-request callback below, which outlives any one render.
  const snapshotRef = useRef(snapshot);

  /**
   * Browsers refuse to make a sound until the page has been interacted with, and
   * this board can sit untouched for days on a second monitor.
   *
   * So: every gesture the platform counts, once each, as early as possible. A
   * pointer down is the obvious one, but a board you only scroll or types
   * into would have stayed silent — which is how the first eye break came and
   * went without a sound. The Start button primes it again for the case where
   * none of these ever fired.
   */
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const arm = () => primeAudio();
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const event of events) {
      document.addEventListener(event, arm, { once: true, passive: true });
    }
    return () => {
      for (const event of events) document.removeEventListener(event, arm);
    };
  }, []);

  // Looking at the tab is dealing with it: the pulse goes.
  useEffect(() => {
    if (tab !== "health") return;
    setTabStatus("health", "ok");
  }, [tab]);

  /**
   * Starting a session answers whatever nudge asked for one, so the store is
   * cleared here rather than waiting for it to go stale. Nothing displays it
   * any more — see the note where the banner used to be — but leaving answered
   * nudges lying in localStorage would still let a reload seed NudgeTakeover
   * with one.
   */
  const start = useCallback(
    (session: Session, isMinimum: boolean) => {
      primeAudio();
      setActive({ session, isMinimum });
      setView("session");
      clearDue();
      setTabStatus("health", "ok");
    },
    [],
  );

  const startChair = useCallback(() => {
    primeAudio();
    const doneBefore = snapshotRef.current.chair.doneToday;
    setChair({ routine: chairRoutine(doneBefore), doneBefore });
    setView("chair");
    clearDue();
    setTabStatus("health", "ok");
  }, []);

  /**
   * `/?chair` starts a routine straight away, so a thing that otherwise only
   * happens at 9:45 can be looked at now — the same escape hatch as `?eye=30s`
   * and `?nudge=`. It logs a real routine if run past the first minute.
   *
   * Deferred a tick rather than called in the effect body: starting changes the
   * view, and a view change belongs in a callback, not in an effect's render pass.
   */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("chair") === null) return;
    const id = setTimeout(startChair, 0);
    return () => clearTimeout(id);
  }, [startChair]);

  /**
   * Someone pressed Start on the agenda row.
   *
   * Handled from the store's own notification rather than from a render, which
   * is what keeps a view change out of an effect body. This widget is always
   * mounted — Panel hides the inactive tab, it does not unmount it — so the
   * callback is there before the button can be pressed.
   */
  useEffect(() => {
    const begin = () => {
      const request = readStart();
      if (!request) return;
      clearStart();
      if (request.date !== snapshotRef.current.today) return;
      const today = snapshotRef.current;
      if (today.session.kind === "walk") setView("walk");
      else if (today.session.kind === "rest") start(today.minimum, true);
      else start(today.session, false);
    };
    return subscribeStart(begin);
  }, [start]);

  const quickWalk = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await logWalk({ durationMin: 30, outdoors: true, source: "manual" });
    setBusy(false);
    if (!result.ok) setError(result.error ?? "That didn't save.");
    else clearDue();
  }, []);

  const body = (() => {
    if (view === "session" && active) {
      return (
        <HealthPlayer
          session={active.session}
          isMinimum={active.isMinimum}
          today={snapshot.today}
          soundEnabled={snapshot.settings.soundEnabled}
          writable={writable}
          onRunning={setRunning}
          onDone={() => {
            setActive(null);
            setView("today");
          }}
        />
      );
    }
    if (view === "chair" && chair) {
      return (
        <ChairPlayer
          routine={chair.routine}
          doneBefore={chair.doneBefore}
          soundEnabled={snapshot.settings.soundEnabled}
          writable={writable}
          onRunning={setStretching}
          onDone={() => {
            setChair(null);
            setView("today");
          }}
        />
      );
    }
    if (view === "chairmoves") {
      return (
        <ChairPreview
          doneToday={snapshot.chair.doneToday}
          writable={writable}
          onStart={startChair}
          onBack={() => setView("today")}
        />
      );
    }
    if (view === "walk") {
      return (
        <WalkTimer
          snapshot={snapshot}
          writable={writable}
          onRunning={setWalking}
          onDone={() => setView("today")}
        />
      );
    }
    if (view === "history") {
      return <HealthHistory snapshot={snapshot} writable={writable} onBack={() => setView("today")} />;
    }
    if (view === "settings") {
      return (
        <HealthSettings snapshot={snapshot} writable={writable} onBack={() => setView("today")} />
      );
    }
    return (
      <Today
        snapshot={snapshot}
        writable={writable}
        reason={reason}
        busy={busy}
        error={error}
        onStart={start}
        onStartChair={startChair}
        onView={setView}
        onQuickWalk={quickWalk}
      />
    );
  })();

  // Keyed on the view, never on whether the clock is running: flipping the
  // wrapper would remount the player and start the routine over. Like the
  // session player, its done screen draws its own scroll body.
  const inSession = (view === "session" && active !== null) || (view === "chair" && chair !== null);

  return (
    <>
      {inSession ? body : <div className="widget-scroll healthbody">{body}</div>}
      {!inSession && <HealthStage snapshot={snapshot} writable={writable} />}
      {/* A sibling of the stage rather than a child of it, because it has to
          keep counting while a session is running and while another tab is
          showing — neither of which renders a stage. CSS puts it in the same
          bottom row when it does appear. */}
      <EyeBreak settings={snapshot.settings} busy={running || walking || stretching} />
    </>
  );
}

function Today({
  snapshot,
  writable,
  reason,
  busy,
  error,
  onStart,
  onStartChair,
  onView,
  onQuickWalk,
}: {
  snapshot: HealthSnapshot;
  writable: boolean;
  reason: string;
  busy: boolean;
  error: string | null;
  onStart: (session: Session, isMinimum: boolean) => void;
  onStartChair: () => void;
  onView: (view: HealthView) => void;
  onQuickWalk: () => void;
}) {
  const { session, streak, adherence, trailingMinutes } = snapshot;
  const startLabel =
    session.kind === "walk" ? "Start the walk" : session.kind === "rest" ? "Move anyway" : "Start the session";

  const begin = () => {
    if (session.kind === "walk") onView("walk");
    else if (session.kind === "rest") onStart(snapshot.minimum, true);
    else onStart(session, false);
  };

  const week = trailingMinutes;

  return (
    <>
      {/* THE NUDGE BANNER USED TO SIT HERE and was deliberately removed. A
          nudge is an event, not an item: it chimes, it takes the screen for
          five seconds if it is that kind, and it pulses the tab. Holding it
          here afterwards turned every nudge into a piece of admin waiting to be
          dismissed — an inbox on a always-on display, which is the opposite of what
          this board is for. The store it was reading is still there; it is the
          bus NudgeTakeover fires from. */}

      <section className="healthcard">
        <div className="healthcard-main">
          <p className="health-eyebrow">
            <KindDot kind={session.kind} />
            {kindLabel(session.kind)}
            {session.isDeload ? " · deload week" : ""}
          </p>
          <h3 className="healthcard-title">{session.title}</h3>
          <p className="healthcard-sub">{session.subtitle}</p>
          {session.kind === "walk" && session.outdoorsNote && (
            <p className="healthcard-note">{session.outdoorsNote}</p>
          )}
        </div>

        <div className="healthcard-acts">
          {snapshot.done ? (
            // A button, not a link. Doing it twice is a real thing people do —
            // a second walk, a session after a five-minute floor — and the way
            // back to it should look the same as the way in. Only the emphasis
            // changes: is-primary means "this is the thing to do now", and once
            // today is logged that is no longer true.
            <>
              <span className="healthdone">✓ Done today</span>
              <button type="button" className="healthbtn" onClick={begin} disabled={!writable}>
                Start again
              </button>
            </>
          ) : (
            <>
              <button type="button" className="healthbtn is-primary" onClick={begin} disabled={!writable}>
                {startLabel}
              </button>
              {session.kind !== "rest" && (
                <button
                  type="button"
                  className="healthlink"
                  onClick={() => onStart(snapshot.minimum, true)}
                  disabled={!writable}
                >
                  only five minutes today
                </button>
              )}
            </>
          )}
        </div>
      </section>

      <ChairCard
        chair={snapshot.chair}
        writable={writable}
        onStart={onStartChair}
        onPreview={() => onView("chairmoves")}
      />

      {!writable && <p className="healthnote">{reason}</p>}
      {error && <p className="healthnote is-error">{error}</p>}

      <div className="healthstats">
        <div className="healthstat">
          <p className="health-eyebrow">Streak</p>
          <p className={`healthstat-value${streak.current > 0 ? " is-go" : ""}`}>{streak.current}</p>
          <p className="healthstat-hint">
            {streak.forgivenGap
              ? "One missed day forgiven — that is by design."
              : streak.current === 0
                ? "Today is a fine place to start."
                : "Consecutive active days."}
          </p>
        </div>
        <div className="healthstat">
          <p className="health-eyebrow">Last 7 days</p>
          <p className={`healthstat-value${week >= 150 ? " is-go" : ""}`}>{week}m</p>
          <div className="healthbar">
            <span
              className={week >= 150 ? "is-go" : ""}
              style={{ width: `${Math.min(100, (week / 300) * 100)}%` }}
            />
          </div>
          <p className="healthstat-hint">
            {week >= 150
              ? "Inside the 150–300 minute guideline band."
              : `${150 - week} minutes from the guideline floor.`}
          </p>
        </div>
        <div className="healthstat">
          <p className="health-eyebrow">Adherence</p>
          <p className="healthstat-value">{adherence.scheduled === 0 ? "—" : `${adherence.pct}%`}</p>
          <p className="healthstat-hint">
            {adherence.scheduled === 0
              ? "Nothing scheduled yet."
              : `${adherence.done} of ${adherence.scheduled} scheduled days, last 4 weeks.`}
          </p>
        </div>
      </div>

      <p className="health-eyebrow healthweek-title">This week</p>
      <ul className="healthweek">
        {snapshot.week.map((day) => (
          <li
            key={day.date}
            className={`healthday${day.isToday ? " is-today" : ""}${day.minutes > 0 ? " is-done" : ""}`}
          >
            <span className="healthday-name">{day.short}</span>
            <span className="healthday-mark">
              {day.minutes > 0 ? (
                <span className="healthday-tick">✓</span>
              ) : day.kind === "rest" ? (
                <span className="healthday-rest">—</span>
              ) : day.isPast ? (
                <span className="healthday-missed">·</span>
              ) : (
                <KindDot kind={day.kind} />
              )}
            </span>
            <span className="healthday-min">
              {day.minutes > 0 ? `${day.minutes}m` : day.kind === "rest" ? "rest" : `${day.estMinutes}m`}
            </span>
          </li>
        ))}
      </ul>

      <div className="healthfoot">
        <p className="healthwhy">
          <span className="health-eyebrow">Why · </span>
          {snapshot.note}
        </p>
        <div className="healthfoot-acts">
          <button type="button" className="healthbtn is-quiet" onClick={onQuickWalk} disabled={!writable || busy}>
            {busy ? "Logging…" : "Log a 30-min walk"}
          </button>
          <button type="button" className="healthlink" onClick={() => onView("walk")}>
            walk timer
          </button>
          <button type="button" className="healthlink" onClick={() => onView("history")}>
            history
          </button>
          <button type="button" className="healthlink" onClick={() => onView("settings")}>
            settings
          </button>
        </div>
      </div>
    </>
  );
}
