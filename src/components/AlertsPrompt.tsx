"use client";

import { useEffect, useState } from "react";
import { audioArmed, primeAudio } from "@/components/health/beeps";

/**
 * The one click that turns the alerts on.
 *
 * TWO CHANNELS, ONE GESTURE, and that is the whole reason this exists rather
 * than two buttons in two settings panels. A browser will not let a page make a
 * sound until somebody has interacted with it, and it will not grant
 * notification permission except from a gesture either. A single button
 * satisfies both at once: the click IS the gesture that resumes the
 * AudioContext, and it is also what Chrome wants before it shows the permission
 * dialog.
 *
 * WHY IT IS NEEDED AT ALL on a board that is never clicked. That is exactly the
 * case: the display comes up at logon, runs for days, and nobody touches it —
 * so the chime that was supposed to say "walk" has been going to a suspended
 * audio context, and the notification that was supposed to reach you behind
 * another window was never permitted. Under the scheduled-task setup the
 * Chrome flags handle the audio half on their own, but the
 * notification grant is per-profile and still has to be given once.
 *
 * IT DISAPPEARS AND STAYS GONE. Shown only while there is something to fix, and
 * dismissible for the case where you genuinely do not want either — a
 * banner that reappears every morning on a always-on display is worse than no alerts.
 */

const DISMISSED = "dayboard.alerts.dismissed";

/** "checking" also covers the server render, where none of this can be known. */
type Need = "checking" | "hidden" | "ask" | "blocked";

export function AlertsPrompt() {
  const [need, setNeed] = useState<Need>("checking");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const look = () => {
      let off = false;
      try {
        off = localStorage.getItem(DISMISSED) === "1";
      } catch {
        // A private window asks again on the next reload, which is harmless.
      }
      if (off) {
        setNeed("hidden");
        return;
      }

      const supported = typeof Notification !== "undefined";
      const permission = supported ? Notification.permission : "denied";
      if (permission === "granted" && audioArmed()) {
        setNeed("hidden");
        return;
      }
      // Nothing a button can do about a block — Chrome only reopens that from
      // site settings — so say so rather than offering a click that does nothing.
      setNeed(permission === "denied" ? "blocked" : "ask");
    };

    // Deferred rather than called here: setting state straight from an effect
    // body is what react-hooks/set-state-in-effect is for, and one frame later
    // is invisible on a board that has been up for hours.
    const first = setTimeout(look, 0);
    // The audio half can be armed by any click anywhere on the board — see
    // HealthApp, which primes it on the first gesture — so this has to re-check
    // rather than read once at mount.
    const poll = setInterval(look, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
  }, []);

  if (dismissed || need === "checking" || need === "hidden") return null;

  const enable = async () => {
    // Order matters only in that both must happen inside this handler: it is
    // the user gesture, and it does not survive an await for the audio call.
    primeAudio();
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        await Notification.requestPermission();
      }
    } catch {
      // Denied, or unavailable. The chime still works.
    }
    setNeed(audioArmed() && Notification?.permission === "granted" ? "hidden" : "ask");
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Then it asks again next reload, which is the harmless direction.
    }
  };

  return (
    <div className="alertsprompt" role="status">
      <p className="alertsprompt-text">
        {need === "blocked"
          ? "Notifications are blocked for this site — Chrome only reopens that in site settings."
          : "Alerts are off. Nudges cannot chime or reach you behind another window."}
      </p>
      <div className="alertsprompt-acts">
        {need === "ask" && (
          <button type="button" className="alertsprompt-go" onClick={() => void enable()}>
            Turn on alerts
          </button>
        )}
        <button type="button" className="alertsprompt-x" onClick={dismiss} aria-label="Dismiss">
          Not now
        </button>
      </div>
    </div>
  );
}
