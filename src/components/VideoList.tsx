"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { MouseEvent } from "react";
import type { TitleParts, Video } from "@/lib/youtube";
import { markWatched } from "@/lib/watch-actions";
import { writeWatching } from "@/components/watching";
import { publishQueue } from "@/components/queue";
import { selectTab } from "@/components/Panel";

/**
 * The video list.
 *
 * A CLICK NOW PLAYS IT ON THE BOARD rather than opening a tab — it goes to the
 * Watch panel in the centre, which comes forward on its own. The corner arrow is
 * the way out to YouTube proper, and it is not decoration: a video whose
 * uploader disabled embedding cannot play in the panel, and nothing in the page
 * can find that out in advance, so the escape hatch has to be visible.
 *
 * MARKING WATCHED REMOVES THE TILE. It used to fade it in place, on the theory
 * that a stable list is easier to read and a mis-click is easier to undo; you
 * wants a queue instead, and a queue you have to look past is not one.
 *
 * OPENING SOMETHING NO LONGER MARKS IT. It used to: for as long as a click meant
 * a new tab, starting a video and finishing it were near enough the same act.
 * They stopped being the same act when the player moved into the panel — now a
 * click is "put this on", which is something you might do to three things before
 * settling on one. So the eye is the only thing that clears a tile, and it is
 * pressed on purpose.
 *
 * THE FILTERING HAPPENS ON THE SERVER NOW, and `videos` arrives already short.
 * It used to be done here against localStorage, which meant the whole feed was
 * in the HTML and three separate places — this list, the count beside the title,
 * the queue the player advances through — each had to hold a "storage has not
 * been read yet" state so they would not flash the full list or replay something
 * already seen. All of that is gone with the answer: see the schema docblock on
 * WatchedFileSchema for why the list moved into data/watched.json.
 *
 * NO OPTIMISTIC UPDATE, the same call JobTiles makes: the tile dims and stays
 * until the write lands. A click that silently fails and pops the tile back
 * reads worse than two hundred milliseconds of honest dimming.
 *
 * The undo is `npm run watched -- restore <id>`, or an edit to data/watched.json,
 * which is a file rather than a console incantation now.
 *
 * The button is a corner icon rather than a labelled one under the tile. It used
 * to say "Mark watched" in full, which in a two-column grid is a word wider than
 * the thing it sits under — and it is a control you use with your eyes already on
 * the thumbnail. It is one-way now, so there is no tick state to draw: a watched
 * tile is not on screen to show one.
 */

/**
 * The way out to the real site. It has to be a separate control, because the
 * tile itself no longer goes there — and because a video whose uploader
 * disabled embedding will not play in the panel, and this is the button that
 * rescues it. Always in the DOM, so a keyboard reaches it; only visible on hover.
 */
function OpenIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M6.2 3.2h6.6v6.6" />
      <path d="M12.8 3.2 6 10" />
      <path d="M11 9.4v3.4H3.2V5h3.4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M1.4 8s2.4-4 6.6-4 6.6 4 6.6 4-2.4 4-6.6 4S1.4 8 1.4 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}

export function VideoList({
  videos,
  ago,
  fresh = [],
  titles = {},
  showChannel = true,
  writable,
}: {
  /** Already filtered — the cleared ones never reach the browser. */
  videos: Video[];
  ago: Record<string, string>;
  /** Ids posted in the last half hour, decided on the server — see the widget. */
  fresh?: string[];
  /**
   * Titles already pulled apart into game and statement, for the channels that
   * write them that way. A video with no entry keeps its title whole.
   */
  titles?: Record<string, TitleParts>;
  showChannel?: boolean;
  /** Whether the eye can write — the render-time half of `todoGate`. */
  writable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isNew = new Set(fresh);

  const mark = useCallback((id: string) => {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await markWatched(id);
      if (!result.ok) setError(result.error ?? "That didn't work.");
      setPendingId(null);
    });
  }, []);

  /**
   * Hand the player what to play next, in the order the eye reads it.
   *
   * This component stays mounted while its tab is hidden — Panel uses
   * display:none rather than unmounting — so the queue stays current whichever
   * tab is up, which is what lets the corner player keep advancing.
   *
   * It used to need a gate in front of it: before localStorage had been read the
   * list still held everything you had already seen, and advancing into that
   * replays them. The server does the filtering now, so the first render of this
   * list is already the right one and there is nothing to wait for.
   */
  useEffect(() => {
    publishQueue(
      videos.map((video) => ({
        kind: "youtube" as const,
        key: video.id,
        title: video.title,
        channel: video.channel,
        href: video.url,
        at: 0,
      })),
    );
  }, [videos]);

  /**
   * A click plays it in the centre panel instead of leaving the board.
   *
   * The anchor keeps its href and its target, so middle-click, ctrl-click,
   * "copy link address" and a keyboard with no JS all still reach YouTube — the
   * modifier guard is what lets those through untouched. None of those routes
   * mark anything; see the docblock.
   */
  const play = useCallback(
    (event: MouseEvent, video: Video) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;
      event.preventDefault();
      writeWatching({
        kind: "youtube",
        key: video.id,
        title: video.title,
        channel: video.channel,
        href: video.url,
        at: Date.now(),
      origin: "watch",
      });
      selectTab("center", "watch");
    },
    [],
  );

  if (videos.length === 0) return <p className="empty">All caught up.</p>;

  return (
    <>
      {/* A clear that failed has to say so somewhere, and the tile it failed on
          is still sitting there — so this line is the only thing that can. */}
      {error && <p className="todonote is-error">{error}</p>}
      <ul className="videos">
        {videos.map((video) => {
          const shout = isNew.has(video.id);
          const parts = titles[video.id];
          const busy = pending && pendingId === video.id;
          return (
            <li
              key={video.id}
              className={`video-item${shout ? " is-fresh" : ""}${busy ? " is-pending" : ""}`}
            >
              <a
                className="video"
                href={video.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => play(e, video)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- remote
                    thumbnail; the optimiser would proxy every frame for nothing */}
                <img className="video-thumb" src={video.thumbnail} alt="" loading="lazy" />
                <span className="video-body">
                  {/* The game leads, because the game is what decides whether you
                      clicks. The joke is still the title of the video and still
                      worth reading — just not first, and not at the cost of a
                      second line the game might need. */}
                  <span className="video-title">{parts?.game ?? video.title}</span>
                  {parts?.game && parts.statement && (
                    <span className="video-statement">{parts.statement}</span>
                  )}
                  <span className="video-meta">
                    {showChannel ? `${video.channel} · ${ago[video.id]}` : ago[video.id]}
                    {parts?.ad ? " · ad" : ""}
                  </span>
                </span>
              </a>
              <a
                className="tile-open"
                href={video.url}
                target="_blank"
                rel="noreferrer"
                aria-label="Open on YouTube"
                title="Open on YouTube"
              >
                <OpenIcon />
              </a>
              <button
                type="button"
                className="video-watched"
                aria-label="Mark watched"
                disabled={!writable || busy}
                onClick={() => mark(video.id)}
                title="Mark watched — removes it from the list"
              >
                <EyeIcon />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
