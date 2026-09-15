"use client";

import { useCallback } from "react";
import type { MouseEvent } from "react";
import type { LiveStream } from "@/lib/twitch";
import { writeWatching } from "@/components/watching";
import { selectTab } from "@/components/Panel";

/**
 * The live tiles, lifted out of TwitchWidget so a click can do something.
 *
 * The markup is unchanged and so is the CSS — this exists only because playing a
 * stream on the board is a client-side act and the widget around it is still a
 * server component with real network access. Same split, and the same reason, as
 * VideoList under YouTubeWidget.
 *
 * A stream is not a queue item, so unlike a video nothing here gets marked
 * watched. It either is on or it is not.
 *
 * Anything time-dependent — uptime, a viewer count formatted for humans — is
 * computed on the server and handed down in `meta`, because a client component
 * working out "two hours ago" for itself would hydrate into a mismatch.
 */

/**
 * A head and shoulders, drawn rather than typed. An emoji would render in the
 * body text colour on some platforms and full colour on others — the exact bug
 * the weather glyphs had, in reverse — and next to a number it has to read as a
 * unit rather than as decoration.
 */
function ViewerIcon() {
  return (
    <svg className="twlive-eye" viewBox="0 0 16 16" aria-hidden focusable="false">
      <circle cx="8" cy="5" r="2.6" />
      <path d="M2.6 14c0-3 2.4-5 5.4-5s5.4 2 5.4 5" />
    </svg>
  );
}

/** The way out to twitch.tv proper. Same control, same class, as a video tile. */
function OpenIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M6.2 3.2h6.6v6.6" />
      <path d="M12.8 3.2 6 10" />
      <path d="M11 9.4v3.4H3.2V5h3.4" />
    </svg>
  );
}

export interface StreamMeta {
  /** "Just Chatting · 2h 14m" — the game and how long they have been on. */
  line: string;
  viewers: string;
}

export function StreamList({
  streams,
  meta,
}: {
  streams: LiveStream[];
  /** Keyed by stream id. Computed on the server — see the widget. */
  meta: Record<string, StreamMeta>;
}) {
  const play = useCallback((event: MouseEvent, stream: LiveStream) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    writeWatching({
      kind: "twitch",
      key: stream.login,
      title: stream.title || stream.name,
      channel: stream.name,
      href: stream.url,
      at: Date.now(),
      origin: "watch",
    });
    selectTab("center", "watch");
  }, []);

  return (
    <ul className="twlives">
      {streams.map((stream) => (
        <li key={stream.id} className="twlive-item">
          <a
            className="twlive"
            href={stream.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => play(e, stream)}
          >
            <span className="twlive-shot">
              {stream.preview && (
                /* Twitch's own CDN, already sized by the {width}x{height}
                   template — the optimiser would proxy every frame for
                   nothing. Same call as VideoList's thumbnails. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="twlive-thumb" src={stream.preview} alt="" loading="lazy" />
              )}
              {stream.avatar ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  className="twlive-avatar"
                  src={stream.avatar}
                  alt=""
                  width={26}
                  height={26}
                  loading="lazy"
                />
              ) : (
                <span className="twlive-avatar is-blank" aria-hidden>
                  {stream.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>

            <span className="twlive-body">
              <span className="twlive-head">
                <span className="twlive-name">{stream.name}</span>
                <span className="twlive-viewers">
                  <ViewerIcon />
                  {meta[stream.id]?.viewers}
                </span>
              </span>

              <span className="twlive-game">{meta[stream.id]?.line}</span>

              {stream.title && <span className="twlive-title">{stream.title}</span>}
            </span>
          </a>

          <a
            className="tile-open"
            href={stream.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${stream.name} on Twitch`}
            title="Open on Twitch"
          >
            <OpenIcon />
          </a>
        </li>
      ))}
    </ul>
  );
}
