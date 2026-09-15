"use client";

import { useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { writeWatching, useWatching } from "@/components/watching";
import { videoKeyLabel, videoKeysFor } from "@/lib/health";
import type { HealthSnapshot } from "@/lib/health-store";
import { attachVideo, detachVideo } from "@/lib/health-actions";

/**
 * The follow-along shelf, and the dock the player sits on.
 *
 * `data-watchstage="health"` is what lets the board's one video player fill the
 * bottom of this tab rather than the corner — WatchPlayer finds its target by
 * that attribute, scoped to whichever panel slot is actually showing. Read that
 * file's docblock before moving this div: the player is never reparented, it is
 * measured, so this box only has to exist and have a size.
 *
 * Nothing else renders while something is playing. The player is sitting on top
 * of this rectangle by then, and two things fighting over one box is how you get
 * a scrollbar behind a video — the same rule WatchStage keeps for the Watch tab.
 */
export function HealthStage({
  snapshot,
  writable,
}: {
  snapshot: HealthSnapshot;
  writable: boolean;
}) {
  const { entry } = useWatching();

  return (
    <div className="healthstage" data-watchstage="health">
      {/* Hidden only for a video THIS tab is showing. A VOD started in
          Watch is playing in the corner now rather than over this stage — see
          WatchPlayer — so the shelf underneath it should still be here. */}
      {entry?.origin !== "health" ? (
        <HealthVideos snapshot={snapshot} writable={writable} />
      ) : null}
    </div>
  );
}

function HealthVideos({ snapshot, writable }: { snapshot: HealthSnapshot; writable: boolean }) {
  const keys = Object.keys(snapshot.videos);
  const [open, setOpen] = useState(false);

  return (
    <div className="healthshelf">
      <div className="healthshelf-head">
        <h3 className="stack-title">Follow along</h3>
        {writable && (
          <button type="button" className="healthlink" onClick={() => setOpen((was) => !was)}>
            {open ? "done" : "add a video"}
          </button>
        )}
      </div>

      {keys.length === 0 && !open ? (
        <p className="empty">
          Nothing attached for today. Add a video and it plays here, not in another tab.
        </p>
      ) : (
        <ul className="videos healthvideos">
          {keys.flatMap((key) =>
            snapshot.videos[key].map((video) => (
              <li key={`${key}-${video.id}`} className="video-item">
                <VideoTile keyName={key} video={video} />
                <a
                  className="tile-open"
                  href={`https://www.youtube.com/watch?v=${video.id}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open on YouTube"
                  title="Open on YouTube"
                >
                  <OpenIcon />
                </a>
                {writable && (
                  <button
                    type="button"
                    className="video-watched"
                    aria-label="Remove this video"
                    title="Remove this video"
                    onClick={() => void detachVideo(key, video.id)}
                  >
                    ×
                  </button>
                )}
              </li>
            )),
          )}
        </ul>
      )}

      {open && <HealthPaste snapshot={snapshot} onDone={() => setOpen(false)} />}
    </div>
  );
}

function VideoTile({
  keyName,
  video,
}: {
  keyName: string;
  video: { id: string; title: string; channel?: string };
}) {
  /**
   * A click plays it in this panel. The anchor keeps its href and target so
   * middle-click, ctrl-click and "copy link address" all still reach YouTube —
   * the modifier guard is what lets those through, exactly as in VideoList.
   */
  const play = (event: MouseEvent, id: string, title: string, channel?: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    writeWatching({
      kind: "youtube",
      key: id,
      title,
      channel: channel ?? "YouTube",
      href: `https://www.youtube.com/watch?v=${id}`,
      at: Date.now(),
      origin: "health",
    });
  };

  return (
    <a
      className="video"
      href={`https://www.youtube.com/watch?v=${video.id}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => play(e, video.id, video.title, video.channel)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnail;
          the optimiser would proxy every frame for nothing */}
      <img
        className="video-thumb"
        src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
        alt=""
        loading="lazy"
      />
      <span className="video-body">
        <span className="video-title">{video.title}</span>
        <span className="video-meta">
          {videoKeyLabel(keyName)}
          {video.channel ? ` · ${video.channel}` : ""}
        </span>
      </span>
    </a>
  );
}

function HealthPaste({ snapshot, onDone }: { snapshot: HealthSnapshot; onDone: () => void }) {
  const keys = [...new Set([...videoKeysFor(snapshot.session), "minimum"])];
  const [key, setKey] = useState(keys[0] ?? "minimum");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await attachVideo(key, text);
    setBusy(false);
    if (!result.ok) setError(result.error ?? "That didn't save.");
    else {
      setText("");
      onDone();
    }
  };

  return (
    <form className="watchpaste healthpaste" onSubmit={submit}>
      <label className="watchpaste-label" htmlFor="healthpaste">
        A YouTube video to follow along with
      </label>
      <div className="watchpaste-row">
        <select
          className="healthinput"
          value={key}
          aria-label="what this video is for"
          onChange={(e) => setKey(e.target.value)}
        >
          {keys.map((option) => (
            <option key={option} value={option}>
              {videoKeyLabel(option)}
            </option>
          ))}
        </select>
        <input
          id="healthpaste"
          className="watchpaste-input"
          type="text"
          value={text}
          placeholder="youtube.com/watch?v=…"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="watchpaste-go" disabled={busy}>
          {busy ? "…" : "Add"}
        </button>
      </div>
      {error && <p className="watchpaste-bad">{error}</p>}
    </form>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
      <path
        d="M7 17 17 7M9 7h8v8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
