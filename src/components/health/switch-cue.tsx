"use client";

import { useEffect, useRef } from "react";
import { sounds } from "./beeps";

/**
 * "Switch sides" — said out loud and on screen at the moment to swap.
 *
 * Two places need it. A programme station whose cue says "switch halfway" (a
 * side plank, a suitcase hold) has one work period for both sides, so the
 * moment is the half. The chair routine does each side as its own step, so the
 * moment is the start of the left one. Either way the caller decides WHEN; this
 * owns what happens: one chime per step, never repeated while the callout is
 * up, and a callout that is purely derived from the timer — nothing to reset.
 */

/** How long the callout stays up after the switch. */
export const SWITCH_SHOW_SEC = 3;

export function useSwitchCue(active: boolean, stepKey: string | undefined, soundEnabled: boolean, delayMs = 0) {
  // The step the chime last went off for, so a re-render inside the window —
  // which is every frame — does not play it again.
  const cued = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !stepKey || cued.current === stepKey) return;
    cued.current = stepKey;
    if (soundEnabled) sounds.switchSides(delayMs);
  }, [active, stepKey, soundEnabled, delayMs]);
}

export function SwitchCallout({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="healthswitch" role="status" aria-live="assertive">
      <span aria-hidden>⇄</span> Switch sides
    </div>
  );
}
