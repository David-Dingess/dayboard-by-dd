import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { loadAllEvents } from "@/lib/layers";
import { zone, formatEvent, localDate } from "@/lib/time";
import { layerColor } from "@/components/EventRow";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { events, layers } = await loadAllEvents();
  const event = events.find((e) => e.id === decodeURIComponent(id));
  if (!event) notFound();

  const layer = layers.get(event.layer);
  const start = DateTime.fromISO(localDate(event.start), { zone: zone() });

  return (
    <article>
      <p className="muted" style={{ marginTop: 20, display: "flex", gap: 14 }}>
        <Link href="/">← Board</Link>
        {/* Only what this board actually stores. A fixture is rewritten wholesale
            by the refresh routine and a subscribed event lives in iCloud, so an
            edit to either would vanish — the action refuses both anyway, but
            offering a button that cannot work is its own kind of lie. */}
        {event.source.kind === "curated" && (
          <Link href={`/?cal=week&on=${localDate(event.start)}&edit=${encodeURIComponent(event.id)}`}>
            Edit
          </Link>
        )}
      </p>

      <h1 style={{ fontSize: 24, lineHeight: 1.2, margin: "12px 0 6px" }}>{event.title}</h1>

      <p
        className="mono"
        style={{ color: layerColor(event.layer), fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {layer?.name ?? event.layer}
        {event.status !== "confirmed" ? ` · ${event.status}` : ""}
      </p>

      <div className="card" style={{ marginTop: 16, display: "grid", gap: 10 }}>
        <div>
          <div className="nextup-label">When</div>
          <div>
            {formatEvent(event.start, event.allDay)}
            {event.end && event.allDay && localDate(event.end) !== start.plus({ days: 1 }).toISODate()
              ? ` — ${formatEvent(event.end, true)}`
              : ""}
            {event.end && !event.allDay ? ` — ${formatEvent(event.end, false).split(", ")[1] ?? ""}` : ""}
          </div>
        </div>

        {event.watch && (
          <div>
            <div className="nextup-label">Watch</div>
            <div className="watchbox">
              <a
                className="button"
                href={event.watch.url}
                target="_blank"
                rel="noreferrer"
              >
                Watch on {event.watch.service}
              </a>
              {/* Say which kind of promise this is. A competition-level link is
                  the right site, not a guarantee the game is on it. */}
              {event.watch.precision === "competition" && (
                <p className="watch-note">
                  {event.watch.note ??
                    "The competition's usual home — the broadcaster for this game hasn't been announced."}
                </p>
              )}
              {event.watch.precision === "network" && event.watch.note && (
                <p className="watch-note">{event.watch.note}</p>
              )}
              {event.watch.eventUrl && (
                <a
                  className="watch-secondary"
                  href={event.watch.eventUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Match page on ESPN →
                </a>
              )}
            </div>
          </div>
        )}

        {event.location && (
          <div>
            <div className="nextup-label">Where</div>
            <div>{event.location}</div>
          </div>
        )}

        {event.notes && (
          <div>
            <div className="nextup-label">Notes</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{event.notes}</div>
          </div>
        )}

        {event.url && (
          <div>
            <div className="nextup-label">Link</div>
            <a className="mono" href={event.url} target="_blank" rel="noreferrer">
              {event.url}
            </a>
          </div>
        )}

        <div>
          <div className="nextup-label">Source</div>
          <div className="muted">
            {event.source.kind}
            {event.source.ref ? ` · ${event.source.ref}` : ""}
          </div>
        </div>
      </div>
    </article>
  );
}
