import { DateTime } from "luxon";
import type { DayboardEvent } from "@/lib/schema";
import { getLayer } from "@/lib/layers";
import { formatTimeOnly } from "@/lib/time";
import { StreamLink } from "@/components/StreamLink";

/**
 * A game that is on right now, and the shortest route to actually watching it.
 *
 * THE BUTTON PLAYS IT ON THE BOARD. Every service the fixtures point at still
 * refuses to be embedded, but "Watch on Peacock" no longer means a new tab: it
 * opens that page in the stream window, a real logged-in Chrome tucked into the
 * Sports stage (see lib/stream-host.ts). The card says what is on, hands the
 * stream window the one link most likely to be right, and gets out of the way.
 *
 * The three tiers of `precision` from lib/watch.ts are the whole point of the
 * layout. A deep link is this exact match and is offered without ceremony; a
 * network is the named broadcaster; a competition is only the right service for
 * the competition, and that is where the note lives, because "NBC has all 380
 * matches across NBC, Peacock and USA Network" is the difference between a
 * useful button and a misleading one.
 *
 * WHEN THERE IS NO LINK AT ALL — a tournament with no feed, and any fixture the ESPN
 * lookup could not resolve — the card turns into the blank search screen you
 * asked for: who is playing, and three searches ready to run. Twitch is first of
 * those, because an esports major is on Twitch. Find the channel or the service
 * page, paste it in the box below, and it plays on the board.
 */

function searchUrls(query: string) {
  const q = encodeURIComponent(query);
  return {
    twitch: `https://www.twitch.tv/search?term=${q}`,
    youtube: `https://www.youtube.com/results?search_query=${q}`,
    google: `https://www.google.com/search?q=${q}`,
  };
}

export function GameCard({ event, now }: { event: DayboardEvent; now: DateTime }) {
  const layer = getLayer(event.layer);
  const started = DateTime.fromISO(event.start, { setZone: true });
  const minutes = Math.max(0, Math.round(now.diff(started, "minutes").minutes));
  const elapsed =
    minutes < 60 ? `${minutes}m in` : `${Math.floor(minutes / 60)}h ${minutes % 60}m in`;

  const watch = event.status === "cancelled" ? undefined : event.watch;
  const search = searchUrls(`${event.title} live stream`);

  return (
    <div className="gamecard">
      <div className="gamecard-head">
        {layer?.logo ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a club crest
             from public/, already the size it is drawn at */
          <img className="gamecard-crest" src={layer.logo} alt="" width={34} height={34} />
        ) : (
          <span className="gamecard-crest is-blank" aria-hidden>
            {layer?.emoji ?? "•"}
          </span>
        )}
        <div className="gamecard-who">
          <p className="gamecard-title">{event.title}</p>
          <p className="gamecard-meta">
            <span className="gamecard-live">Live</span>
            {` ${elapsed} · started ${formatTimeOnly(event.start, event.tz)}`}
            {event.location ? ` · ${event.location}` : ""}
          </p>
        </div>
      </div>

      {watch ? (
        <>
          <div className="gamecard-actions">
            <StreamLink
              className="gamecard-go"
              url={watch.url}
              service={watch.service}
              title={event.title}
            >
              Watch on {watch.service} →
            </StreamLink>
            {watch.eventUrl && (
              <a className="gamecard-side" href={watch.eventUrl} target="_blank" rel="noreferrer">
                Match page
              </a>
            )}
          </div>
          {watch.precision !== "deep-link" && watch.note && (
            <p className="gamecard-note">{watch.note}</p>
          )}
        </>
      ) : (
        <>
          <p className="gamecard-note">
            Nobody has said where this one is. Go and find it:
          </p>
          <div className="gamecard-actions">
            <a className="gamecard-go" href={search.twitch} target="_blank" rel="noreferrer">
              Search Twitch →
            </a>
            <a className="gamecard-side" href={search.youtube} target="_blank" rel="noreferrer">
              YouTube
            </a>
            <a className="gamecard-side" href={search.google} target="_blank" rel="noreferrer">
              Google
            </a>
          </div>
          <p className="gamecard-note">
            Found a Twitch channel, a YouTube stream or the service it is on? Paste it below and it plays here.
          </p>
        </>
      )}
    </div>
  );
}
