"use client";

import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { parseWatchUrl } from "@/lib/embed";
import { homeFor, useWatching, writeWatching, type WatchOrigin } from "@/components/watching";
import { selectTab } from "@/components/Panel";

/**
 * What a staged tab shows when the player is empty — Watch's and Sports' both.
 *
 * It renders nothing at all once something from THIS tab is playing, because
 * WatchPlayer is sitting directly on top of this box by then and two things
 * fighting over the same rectangle is how you end up with a scrollbar behind a
 * video.
 *
 * THE PASTE BOX takes a YouTube video, a Twitch channel, or a page on any
 * streaming service lib/watch.ts knows — the last opens in the stream window,
 * which is how a match on a service no team tile points at still gets on the
 * board. Whatever is pasted plays in the tab it was pasted into.
 */

export function WatchStage({
  children,
  home = "watch",
}: {
  children?: React.ReactNode;
  /** Which tab this stage belongs to. */
  home?: WatchOrigin;
}) {
  // The lane that docks in THIS stage: Sports' stage belongs to the stream
  // window, Watch's to the video player.
  const { entry } = useWatching(home === "sports" ? "stream" : "main");
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const found = parseWatchUrl(text);
      if (!found) {
        setBad(true);
        return;
      }
      setBad(false);
      setText("");
      writeWatching({
        kind: found.kind,
        key: found.key,
        title:
          found.kind === "youtube"
            ? "Pasted video"
            : found.kind === "stream"
              ? (found.service ?? "Stream")
              : found.key,
        channel:
          found.kind === "youtube" ? "YouTube" : found.kind === "stream" ? (found.service ?? "") : "Twitch",
        href:
          found.kind === "youtube"
            ? `https://www.youtube.com/watch?v=${found.key}`
            : found.kind === "stream"
              ? found.key
              : `https://www.twitch.tv/${found.key}`,
        at: Date.now(),
        // Where it actually docks, which for a pasted stream is Sports and for a
        // pasted video is never Sports. See homeFor.
        origin: found.kind === "stream" ? "sports" : home === "sports" ? "watch" : home,
      });
      // A stream pasted anywhere else goes to the tab it plays in. A video
      // pasted into Sports stays put and plays in the corner, beside the match.
      if (found.kind === "stream" && home !== "sports") selectTab("center", "sports");
    },
    [text, home],
  );

  // The player owns this rectangle now.
  // Same rule as the Health stage: give the rectangle up only for a video this
  // tab is actually showing. Anything started elsewhere is in the corner.
  if (entry && homeFor(entry) === home) return null;

  return (
    <div className="watchidle">
      {children}

      <form className="watchpaste" onSubmit={submit}>
        <label className="watchpaste-label" htmlFor={`watchpaste-${home}`}>
          Paste a YouTube, Twitch or streaming link
        </label>
        <div className="watchpaste-row">
          <input
            id={`watchpaste-${home}`}
            className="watchpaste-input"
            type="text"
            value={text}
            placeholder={home === "sports" ? "peacocktv.com/… or tv.apple.com/…" : "youtube.com/watch?v=… or twitch.tv/…"}
            onChange={(e) => {
              setText(e.target.value);
              setBad(false);
            }}
          />
          <button type="submit" className="watchpaste-go">
            Play
          </button>
        </div>
        {bad && (
          <p className="watchpaste-bad">
            That is not a YouTube video, a Twitch channel or a streaming service the
            board knows. The services it opens are listed in src/lib/watch.ts.
          </p>
        )}
      </form>
    </div>
  );
}
