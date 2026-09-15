"use client";

import { selectTab } from "@/components/Panel";
import { requestStart } from "./health-start";

/** A play triangle, the same one EventRow's watch button uses. */
function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

/**
 * The agenda's Start button, for a session on the Health layer.
 *
 * A fixture in that list carries a watch link, which is a link off the board.
 * A session is the opposite — everything needed to do it is already here — so
 * this is the same shape of control pointing inwards: it brings the Health tab
 * forward and tells it to begin, which for a walk means the timer and for
 * anything else means the session, with today's follow-along video sitting under
 * it.
 *
 * A button, not a link: there is nowhere to go.
 */
export function HealthStart({ date, title }: { date: string; title: string }) {
  return (
    <button
      type="button"
      className="event-watch"
      title={`Start ${title}`}
      aria-label={`Start ${title}`}
      onClick={() => {
        requestStart(date);
        selectTab("center", "health");
      }}
    >
      <PlayIcon />
      <span className="event-watch-label">Start</span>
    </button>
  );
}
