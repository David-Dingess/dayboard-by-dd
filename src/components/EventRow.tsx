import Link from "next/link";
import type { DayboardEvent, Layer } from "@/lib/schema";
import { formatTimeOnly } from "@/lib/time";
import { hasFinished } from "@/lib/events";
import { LayerMark } from "./LayerMark";
import { HealthStart } from "./health/HealthStart";
import { localDate, todayLocal } from "@/lib/time";

/**
 * Layers defined in layers.json have a --layer-<id> custom property in
 * theme.css; subscribed calendars are synthesized at runtime and do not, so
 * their own colour is passed as the fallback.
 */
export function layerColor(layer: string, fallback?: string): string {
  return `var(--layer-${layer}, ${fallback ?? "var(--layer-fallback)"})`;
}

/** A play triangle. Small, and the row's only outbound link. */
function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

export function EventRow({
  event,
  layer,
  markSize = 22,
}: {
  event: DayboardEvent;
  layer: Layer | undefined;
  markSize?: number;
}) {
  const time = event.allDay ? "all day" : formatTimeOnly(event.start);
  // An event may override its layer's mark — see holidays.ts.
  const mark = event.emoji ? { ...layer!, emoji: event.emoji, logo: undefined } : layer;
  // Every page using this row is force-dynamic, so a request-time comparison is
  // fine and needs no client JS. One answer, used twice: a finished event both
  // loses its watch button and recedes.
  const finished = hasFinished(event);
  const watch = event.watch && event.status !== "cancelled" && !finished ? event.watch : null;
  // A session on the calendar has the same shape of question as a fixture — "can
  // I start this from here" — and unlike a fixture the answer is yes, on this
  // board, in the next panel over. TODAY'S ONLY: the Health tab knows one
  // session, the one for now, so a button on Thursday's row could do nothing but
  // change tabs, and a control that lies about what it does is worse than no
  // control.
  //
  // But NOT gone once the scheduled window passes, which is where the watch
  // button and this one part company. A kickoff is a fact about the world and
  // the game really is over; 4:30pm is a suggestion this program made to itself,
  // and doing the session at eight is the good outcome, not a late one. The row
  // still recedes with is-past — the session is behind schedule, and it says so.
  const health = event.layer === "health" && localDate(event.start) === todayLocal();

  return (
    // The watch link is a SIBLING of the row link, never a child: an <a> inside
    // an <a> is invalid HTML and React will not nest them the way it reads.
    <li className="event-wrap" data-layer={event.layer}>
      <Link
        href={`/event/${encodeURIComponent(event.id)}`}
        className={`event${event.status === "cancelled" ? " is-cancelled" : ""}${finished ? " is-past" : ""}`}
        style={{ ["--layer-color" as string]: layerColor(event.layer, event.color ?? layer?.color) }}
      >
        <span className="event-time">{time}</span>
        <LayerMark layer={mark} size={markSize} className="event-mark" />
        <span className="event-title">
          {event.title}
          {event.status === "tentative" && <span className="tag">date tbc</span>}
          {event.status === "cancelled" && <span className="tag">cancelled</span>}
        </span>
        {event.location && <span className="event-meta">{event.location}</span>}
      </Link>

      {health && <HealthStart date={localDate(event.start)} title={event.title} />}

      {watch && (
        <a
          className="event-watch"
          href={watch.url}
          target="_blank"
          rel="noreferrer"
          title={`Watch on ${watch.service}`}
          aria-label={`Watch ${event.title} on ${watch.service}`}
        >
          <PlayIcon />
          <span className="event-watch-label">{watch.service}</span>
        </a>
      )}
    </li>
  );
}
