"use client";

import { useEffect, useRef, useState } from "react";
import { ClaudeCat } from "@/components/ClaudeCat";
import {
  activityLabel,
  ageLabel,
  claudeActivityUrl,
  claudeUrl,
  levelOf,
  limitLabel,
  orderLimits,
  resetLabel,
  type ClaudeActivity,
  type ClaudeUsage,
} from "@/lib/claude-usage";

/**
 * How much of the Claude subscription is left.
 *
 * The board's third client component, and the same argument as the other two:
 * the answer lives on this PC — behind an OAuth token in %USERPROFILE% that a
 * a remote host region cannot read and should never be sent — so the browser sitting on
 * that PC is the only party who can fetch it. See lib/nowplaying.ts's agentBase
 * for why the loopback ADDRESS is what makes this work from an HTTPS page.
 *
 * IT POLLS SLOWLY, AND THAT IS NOT THE UPSTREAM RATE. /claude is a held copy —
 * the agent talks to Anthropic on its own five-minute cadence and this route
 * never makes a call — so this interval costs nothing but a loopback round trip
 * and exists only to keep the countdowns honest. Do NOT be tempted to speed the
 * agent up to match it.
 *
 * NO ON-SCREEN GATE, unlike VitalsWidget. That one lives in a panel tab that
 * Panel keeps mounted while hidden, so it has to measure itself to know whether
 * to stop asking. This is in the left stack, which is always on screen by
 * construction. Only document.hidden is worth checking, and only so a locked
 * machine is not looping all night.
 *
 * COLOUR ONLY. No tab dot — it is not in a tab — and no takeover. you asked
 * for a gauge, not an alarm: the weekly bar sits near the top of its range for
 * days at a time, and anything that interrupted at 90% would interrupt every
 * week and be muted by the second one.
 */

const POLL_MS = 30_000;
/** After a failed fetch. The agent may simply not be running yet. */
const RETRY_MS = 60_000;
/**
 * The shelf, which is a different question asked far more often.
 *
 * Three seconds rather than thirty because this drives a sprite: a cat that
 * sits down half a minute after the work stopped is a cat that is lying. It is
 * only a loopback read of a value the agent already holds — no upstream call is
 * involved at either end — so the cost is a few bytes over the loopback.
 */
const ACTIVITY_MS = 3_000;

type Fetched = ClaudeUsage | "down" | "old-agent" | null;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

export function ClaudeUsageWidget() {
  const [usage, setUsage] = useState<Fetched>(null);
  const [activity, setActivity] = useState<ClaudeActivity | null>(null);
  // Countdowns are recomputed against a ticking clock rather than against
  // Date.now() at render: without this the labels would only move when a poll
  // landed, so "resets in 2h 14m" would sit still for half a minute at a time.
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();

    (async () => {
      while (alive.current && !controller.signal.aborted) {
        if (document.hidden) {
          await sleep(POLL_MS, controller.signal);
          continue;
        }
        let wait = POLL_MS;
        try {
          const res = await fetch(claudeUrl(), {
            cache: "no-store",
            signal: controller.signal,
          });
          if (res.status === 404) {
            // dist/ is gitignored, so an agent built before this route existed
            // is the EXPECTED failure here, not a bug. Say so precisely — "the
            // agent isn't running" would send you looking in the wrong place.
            setUsage("old-agent");
            wait = RETRY_MS;
          } else if (!res.ok) {
            setUsage("down");
            wait = RETRY_MS;
          } else {
            setUsage((await res.json()) as ClaudeUsage);
            setNow(Date.now());
          }
        } catch {
          if (controller.signal.aborted) return;
          setUsage("down");
          wait = RETRY_MS;
        }
        await sleep(wait, controller.signal);
      }
    })();

    return () => {
      alive.current = false;
      controller.abort();
    };
  }, []);

  // Its own loop, at its own rate. Deliberately silent on failure: if the agent
  // is down the bars above already say so, and a second copy of that sentence
  // under them would be noise. The cat simply sits.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      while (!controller.signal.aborted) {
        if (!document.hidden) {
          try {
            const res = await fetch(claudeActivityUrl(), {
              cache: "no-store",
              signal: controller.signal,
            });
            setActivity(res.ok ? ((await res.json()) as ClaudeActivity) : null);
          } catch {
            if (controller.signal.aborted) return;
            setActivity(null);
          }
        }
        await sleep(ACTIVITY_MS, controller.signal);
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <div className="widget">
      <h2 className="stack-title">
        Claude
        <span className="stack-meta">{headline(usage, now)}</span>
      </h2>
      <div className="widget-scroll">
        {body(usage, now)}
        <Shelf activity={activity} />
      </div>
    </div>
  );
}

/**
 * The line under the bars, and the cat on it.
 *
 * A shelf rather than a fourth bar: the three above are quantities and this is
 * a state, so giving it the same shape would invite reading it as a fourth
 * number. It is the only thing on the board that MOVES on its own — Now
 * Playing's EQ aside — which is the whole point. Motion in the corner of the
 * eye means Claude is doing something.
 *
 * HE KEEPS HIS PLACE ACROSS A STATE CHANGE, which is why the pacing is built
 * here in JavaScript rather than declared in CSS. A CSS animation always starts
 * from its first keyframe, so the old version snapped it back to the left edge
 * the moment work stopped and set off from the left edge again when it resumed
 * — the shelf forgot where it was several times an hour. A Web Animations API
 * animation can simply be paused, which holds it exactly where it is, and
 * played again, which carries on from there.
 *
 * The animations are created ONCE and never recreated; the effect below only
 * ever calls play() or pause(). Recreating them on each state change would
 * reintroduce the very bug this replaces.
 */
function Shelf({ activity }: { activity: ClaudeActivity | null }) {
  const state = activity?.live ? activity.activity : "chilling";
  const walker = useRef<HTMLDivElement | null>(null);
  const moves = useRef<Animation[] | null>(null);

  useEffect(() => {
    const el = walker.current;
    if (!el) return;
    // Someone who would rather nothing slid about gets a cat who changes pose
    // but never paces. Nothing is created at all, so there is nothing to play.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof el.animate !== "function") return;

    if (!moves.current) {
      moves.current = [
        // The pacing. `alternate` is what turns it round at each end rather
        // than teleporting back, and the easing is what makes the turn read as
        // a turn instead of a bounce.
        el.animate(
          [{ left: "0px" }, { left: "calc(100% - var(--cat-size))" }],
          {
            duration: 9000,
            direction: "alternate",
            iterations: Infinity,
            easing: "ease-in-out",
          },
        ),
        // Facing. Two lengths of the walk make one round trip, so this runs at
        // twice the duration and cuts — never eases — at the halfway point,
        // which is exactly where it turns. Both are driven by the same clock
        // and are paused and resumed together, so they cannot drift apart.
        //
        // The sprite is drawn facing LEFT, so the flip is inverted from the
        // obvious: mirrored on the rightward leg, left alone on the way back.
        el.animate(
          [
            { transform: "scaleX(-1)", offset: 0 },
            { transform: "scaleX(-1)", offset: 0.4999 },
            { transform: "scaleX(1)", offset: 0.5 },
            { transform: "scaleX(1)", offset: 1 },
          ],
          { duration: 18000, iterations: Infinity, easing: "linear" },
        ),
      ];
    }

    for (const move of moves.current) {
      if (state === "working") void move.play();
      else move.pause();
    }
  }, [state]);

  // Cancelled only on unmount. A paused animation still applies its current
  // value, which is what leaves it standing where it stopped rather than
  // dropping back to the CSS left:0.
  useEffect(
    () => () => {
      for (const move of moves.current ?? []) move.cancel();
      moves.current = null;
    },
    [],
  );

  return (
    <div className="catshelf" data-state={state}>
      <div className="catshelf-stage">
        <div className="catwalk" ref={walker}>
          <ClaudeCat />
        </div>
      </div>
      <div className="catshelf-line" />
      <p className="catshelf-say">{activityLabel(activity)}</p>
    </div>
  );
}

/** The right-hand half of the label row: the age, or nothing. */
function headline(usage: Fetched, now: number): string {
  if (usage === null || usage === "down" || usage === "old-agent") return "";
  if (usage.state === "looking") return "";
  return ageLabel(usage.fetchedAt, now) ?? "";
}

function body(usage: Fetched, now: number) {
  if (usage === null) return <p className="empty">Checking…</p>;
  if (usage === "old-agent")
    return <p className="empty">The Dayboard agent is out of date — rebuild and restart it.</p>;
  if (usage === "down") return <p className="empty">The Dayboard agent isn&rsquo;t running.</p>;

  // A state with nothing behind it yet. Once a reading has landed the bars stay
  // up through a later failure — see Keep() in Claude.cs — so this only shows
  // before the first success.
  if (usage.limits.length === 0)
    return <p className="empty">{usage.note ?? "No usage yet."}</p>;

  return (
    <>
      <ul className="usagebars">
        {orderLimits(usage.limits).map((limit) => {
          const level = levelOf(limit);
          const reset = resetLabel(limit.resetsAt, now);
          return (
            <li key={limit.kind + (limit.label ?? "")} className="usagebar" data-level={level}>
              <span className="usagebar-name">{limitLabel(limit)}</span>
              <span className="usagebar-pct">{Math.round(limit.percent)}%</span>
              <span
                className="usagebar-track"
                role="meter"
                aria-valuenow={Math.round(limit.percent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${limitLabel(limit)} usage`}
              >
                <span className="usagebar-fill" style={{ width: `${limit.percent}%` }} />
              </span>
              <span className="usagebar-reset">{reset ?? ""}</span>
            </li>
          );
        })}
      </ul>
      {/* A failure AFTER a good reading keeps the bars and admits the age — the
          same bargain lib/memo.ts's stale() makes for the server-side widgets.
          Blanking three bars because one request 429'd would be worse. */}
      {usage.state !== "ok" && usage.note ? (
        <p className="usagenote">{usage.note}</p>
      ) : null}
    </>
  );
}
