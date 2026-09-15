"use client";

import { useEffect, useState } from "react";
import { sounds } from "@/components/health/beeps";
import { currentDue, subscribeDue, writeDue } from "@/components/health/health-due";

/**
 * The board goes dark and says one thing.
 *
 * Experimental, and the most intrusive thing on this display by a distance —
 * which is the point: a nudge in a banner is something you can look past for an
 * hour, and "bro, go to bed" is not meant to be looked past.
 *
 * IT FIRES ON THE EDGE, NEVER ON THE STATE. The due store keeps a nudge until it
 * is answered, so "there is a nudge" stays true for hours; taking the screen on
 * that would black the board out every thirty seconds until you dealt with it.
 * The trigger is a due whose `at` this component has not seen before AND which
 * arrived in the last minute — so a reload at 11:20 does not replay the eleven
 * o'clock one.
 *
 * IT DOES NOT INTERRUPT A WORKOUT. The Health tab's own session player is the
 * one thing on this board already holding the screen for a reason, and blacking
 * it out mid-rep would be the board fighting itself.
 *
 * Five seconds, then it fades back. A click or any key dismisses it early,
 * because a thing that takes the whole screen must always have a way out.
 */

/** How long the message holds before it fades away on its own. */
const HOLD_MS = 5000;
/** Ignore anything older than this — it is a replay, not an event. */
const FRESH_MS = 60_000;

export function NudgeTakeover() {
  const [showing, setShowing] = useState<{ title: string; body: string } | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Seeded with whatever is already sitting there, so a reload at 11:20 does
    // not replay the eleven o'clock nudge. Only something that ARRIVES after
    // this point can take the screen.
    let seen = currentDue()?.at ?? null;

    return subscribeDue((due) => {
      if (!due || due.at === seen) return;
      seen = due.at;
      if (Date.now() - due.at > FRESH_MS) return;

      setLeaving(false);
      setShowing({ title: due.title, body: due.body });
      sounds.takeover();
    });
  }, []);

  /**
   * `/?nudge=go+to+bed` fires one immediately, so the thing that only happens at
   * 10pm can be looked at now.
   *
   * Same escape hatch as the eye break's `?eye=30s`, and for the same reason:
   * waiting until bedtime to find out whether a five-second full-screen takeover
   * is too much is a bad way to design one. `?nudge` on its own uses a default
   * line.
   *
   * IT GOES THROUGH THE REAL STORE rather than setting this component's state
   * directly — so the test exercises the path a 10pm nudge actually takes, and
   * so the state change happens in the subscription callback rather than in an
   * effect body. It leaves a "Test" banner in the Health tab exactly as a real
   * one would; press Done there to clear it.
   *
   * DECLARED AFTER THE SUBSCRIPTION ABOVE, and that ordering is the whole thing:
   * React runs effects in source order, so writing to the store first meant the
   * notification went out before anything was listening — and then seeded `seen`
   * with the very nudge it had just written, so it could never fire again.
   */
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("nudge");
    if (param === null) return;
    writeDue({
      slotId: "test",
      title: "Test nudge",
      body: param || "This is what a nudge looks like.",
      route: "none",
      at: Date.now(),
    });
  }, []);

  useEffect(() => {
    if (!showing) return;

    const dismiss = () => setLeaving(true);
    const hold = setTimeout(dismiss, HOLD_MS);
    // The fade-out is 600ms of CSS; this is what actually unmounts it.
    const gone = setTimeout(() => setShowing(null), HOLD_MS + 700);

    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => {
      clearTimeout(hold);
      clearTimeout(gone);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismiss);
    };
  }, [showing]);

  // A dismissed overlay still has to finish fading, so `leaving` shortens the
  // remaining life rather than ending it.
  useEffect(() => {
    if (!leaving || !showing) return;
    const gone = setTimeout(() => setShowing(null), 700);
    return () => clearTimeout(gone);
  }, [leaving, showing]);

  if (!showing) return null;

  return (
    <div
      className={`takeover${leaving ? " is-leaving" : ""}`}
      role="alert"
      aria-live="assertive"
      onClick={() => setLeaving(true)}
    >
      <p className="takeover-text">{showing.body || showing.title}</p>
    </div>
  );
}
