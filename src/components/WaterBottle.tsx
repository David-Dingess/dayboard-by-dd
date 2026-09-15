"use client";

import { useState, useTransition } from "react";
import { drinkWater } from "@/lib/water-actions";
import type { WaterSnapshot } from "@/lib/water";

/**
 * A bottle that fills up, and three buttons that fill it.
 *
 * THE WATER IS SVG AND CSS, not a canvas. Two wave paths slide across each
 * other at different speeds inside a clip of the bottle's own outline — which
 * is enough to read as liquid, costs no JavaScript at all, and cannot fight the
 * board's 30-second refresh the way a rAF loop would. The Now Playing EQ is the
 * one animation here that earns a canvas; this is not it.
 *
 * THE LEVEL IS A CSS VARIABLE, so the only thing a save changes is one number
 * and the transition does the rest — water rises rather than jumping.
 *
 * The colour is the accent at low opacity, deliberately the same faint wash the
 * week grid uses to mark today: this is a quiet panel about a quiet habit, and a
 * saturated blue would have shouted over the four widgets around it.
 *
 * AND IT GOES STILL AT THE GOAL. Water still moving reads as "keep going"; flat
 * water is the whole of the reward for having finished.
 *
 * BEHIND THE PACE, IT GLOWS RED. Pace is the goal spread across a waking day —
 * 8am to 10pm — so nothing is owed at breakfast and all of it is by bedtime. The
 * glow starts at a fifth of the day's water owed and steps up twice; below that
 * it stays dark, because a panel that lit up one glass down would be red every
 * afternoon and would stop meaning anything. The number beside it says how far.
 */

/** What is actually on the desk: a cup, a glass, and the big bottle. */
const POURS = [8, 16, 40] as const;

/** The bottle drawing, in its own coordinate space. */
const BODY =
  "M23.5 14.5 v5.6 c0 3.2 -12.9 5.8 -12.9 15.8 v100 c0 4.4 3.6 8 8 8 h22.8 c4.4 0 8 -3.6 8 -8 v-100 c0 -10 -12.9 -12.6 -12.9 -15.8 v-5.6 z";

export function WaterBottle({
  snapshot,
  writable,
  reason,
}: {
  snapshot: WaterSnapshot;
  writable: boolean;
  reason: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pour = (ounces: number) => {
    setError(null);
    startTransition(async () => {
      const result = await drinkWater(ounces);
      if (!result.ok) setError(result.error ?? "That didn't save.");
    });
  };

  const { ounces, goalOz, fill, streak, week, expectedOz, behind } = snapshot;
  const pct = Math.round(fill * 100);

  /**
   * How hard it glows: nothing until a fifth of the day's water is owed, then
   * three steps. A panel that lit up the moment you were one glass down would be
   * red most of the afternoon and stop meaning anything.
   */
  const alarm = behind >= 0.4 ? 3 : behind >= 0.3 ? 2 : behind >= 0.2 ? 1 : 0;

  return (
    <div className={`water${fill >= 1 ? " is-full" : ""}${alarm ? ` is-behind is-behind-${alarm}` : ""}`}>
      {/* aria-hidden: the numbers beside it say everything this draws, and a
          screen reader has no use for a bottle. */}
      <svg className="waterbottle" viewBox="0 0 60 150" aria-hidden focusable="false">
        <defs>
          <clipPath id="water-inside">
            <path d={BODY} />
          </clipPath>
        </defs>

        {/* The liquid, clipped to the bottle and translated by the fill level.
            0% sits just under the bottle's floor; 100% at the shoulder.

            THE TRANSFORM IS SET DIRECTLY, not through a custom property. Two
            attempts failed first: `calc(126px - (var(--fill) * 118px))` computed
            to a flat 126, and handing the same figure over as a px-valued
            variable left the computed transform stale at its previous value —
            an unregistered custom property inside `transform` does not
            re-resolve dependably. A plain inline transform does, and the CSS
            transition still animates it. */}
        <g clipPath="url(#water-inside)">
          <g
            className="water-body"
            style={{ transform: `translateY(${(126 - fill * 118).toFixed(2)}px)` }}
          >
            <path className="water-wave water-wave-a" d="M-60 8 q15 -8 30 0 t30 0 t30 0 t30 0 t30 0 v150 h-150 z" />
            <path className="water-wave water-wave-b" d="M-60 10 q15 -7 30 0 t30 0 t30 0 t30 0 t30 0 v150 h-150 z" />
          </g>
        </g>

        <rect className="water-cap" x="21" y="3" width="18" height="11" rx="2.5" />
        <path className="water-outline" d={BODY} />
        <path className="water-ridge" d="M11 98 h38 M11 111 h38 M11 124 h38" />
      </svg>

      <div className="water-side">
        <p className="water-read">
          <span className="water-oz">{ounces}</span>
          <span className="water-goal">/ {goalOz} oz</span>
          {alarm > 0 && (
            <span className="water-behind" title={`On pace you would be at ${expectedOz} oz by now`}>
              {expectedOz - ounces} oz behind
            </span>
          )}
          {streak > 0 && (
            <span className="water-streak" title={`${streak} day${streak === 1 ? "" : "s"} at goal`}>
              {streak}d streak
            </span>
          )}
        </p>

        <div className="water-bar" role="img" aria-label={`${pct}% of today's water`}>
          <span style={{ width: `${pct}%` }} />
        </div>

        <div className="water-pours">
          {POURS.map((oz) => (
            <button
              key={oz}
              type="button"
              className="water-btn"
              disabled={!writable || pending}
              onClick={() => pour(oz)}
            >
              +{oz}
            </button>
          ))}
          {/* Undo rather than a per-drink log: the only correction anyone wants
              from a water tracker is taking back the last press. */}
          <button
            type="button"
            className="water-btn is-undo"
            disabled={!writable || pending || ounces === 0}
            onClick={() => pour(-8)}
            title="Take back 8 oz"
            aria-label="Take back 8 ounces"
          >
            −8
          </button>
        </div>

        <ul className="water-week">
          {week.map((day) => (
            <li
              key={day.date}
              className={`water-day${day.met ? " is-met" : ""}${day.isToday ? " is-today" : ""}`}
              title={`${day.date}: ${day.ounces} oz`}
            >
              {day.short}
            </li>
          ))}
        </ul>

        {!writable && <p className="todonote">{reason}</p>}
        {error && <p className="todonote is-error">{error}</p>}
      </div>
    </div>
  );
}
