"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toClientRect } from "@/lib/stream";
import type { MusicCommand, MusicState } from "@/lib/music";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "@/components/widgets/NowPlayingWidget";

/**
 * Apple Music, in the centre panel.
 *
 * NOTHING HERE PLAYS ANYTHING. The stage below the head bar is a placeholder,
 * and over it sits music.apple.com in its own Chrome, which agent/stream has
 * made a child of the board window — lib/music.ts says why it is a window, and
 * lib/stream-host.ts how. This component only ever says where the stage is and
 * whether the window should be showing.
 *
 * HIDDEN IS NOT STOPPED. Leaving the tab hides the window and the music plays
 * on; nothing on this page ever closes the music browser. A board reload, a
 * deploy, and switching tabs all leave the song alone.
 *
 * The placement loop is mountStream()'s in components/players.ts, cut down: the
 * box is polled rather than only observed, a POST goes only when it changed (or
 * every couple of seconds, to pull back a window moved from outside), and the
 * window steps aside when the board draws anything over the stage.
 */

const PLACE_POLL_MS = 150;
const PLACE_RESEND_MS = 2000;
const STATE_POLL_MS = 2000;

async function musicCall(body: MusicCommand | null): Promise<MusicState | null> {
  try {
    const res = await fetch("/api/music", {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      // A cold start waits for Chrome and the adoption; everything else is quick.
      signal: AbortSignal.timeout(body?.action === "open" ? 30_000 : 6000),
    });
    return (await res.json()) as MusicState;
  } catch {
    return null;
  }
}

/**
 * The corner players over the stage, as holes for the music window.
 *
 * WHY HOLES. The corner player is DOM in the board's page (or, for a stream, a
 * window sitting over DOM), and the music window is a child window of that page
 * — which covers every pixel of the page under it, whatever the stacking order.
 * Dragging the corner video onto the Music tab put it underneath music.apple.com.
 * Cutting its rectangle out of the music window is the only way through.
 *
 * Only players actually overlapping the stage, and only the corner ones: a
 * docked or filled player belongs to another tab and is not on screen here.
 */
function cornerHoles(stage: DOMRect): [number, number, number, number, number][] {
  const dpr = window.devicePixelRatio;
  const holes: [number, number, number, number, number][] = [];
  for (const dock of document.querySelectorAll<HTMLElement>(".watchdock.is-mini")) {
    const r = dock.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const overlaps =
      r.left < stage.right && r.right > stage.left && r.top < stage.bottom && r.bottom > stage.top;
    if (!overlaps) continue;
    const box = toClientRect(r, dpr);
    const radius = Math.round((parseFloat(getComputedStyle(dock).borderTopLeftRadius) || 0) * dpr);
    holes.push([box.x, box.y, box.w, box.h, Math.min(64, radius)]);
  }
  return holes.slice(0, 8);
}

export function MusicWidget() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<MusicState | null>(null);
  const [opening, setOpening] = useState(false);
  const [active, setActive] = useState(false);

  /* -- where the stage is, and whether the window belongs on it -- */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let destroyed = false;
    let opened = false;
    let inFlight = false;
    let sent = "";
    let sentAt = 0;
    let shown: boolean | null = null;
    /** A corner player is over the stage right now. */
    let overlapped = false;

    const place = async () => {
      if (destroyed || inFlight) return;
      const slotActive = stage.closest(".widget-slot")?.classList.contains("is-active") ?? false;
      setActive(slotActive);

      // The first look at the tab is what launches the music browser — not the
      // board loading, so a board that never visits Music never runs it.
      if (slotActive && !opened) {
        opened = true;
        setOpening(true);
        void musicCall({ action: "open", url: "https://music.apple.com/", fresh: false }).then((next) => {
          if (destroyed) return;
          setOpening(false);
          if (next) setState(next);
          // open ends by showing the window, whatever this loop last asked for;
          // forget what was sent so the next tick says it again.
          shown = null;
          sentAt = 0;
        });
      }

      const r = stage.getBoundingClientRect();
      const sized = slotActive && r.width >= 40 && r.height >= 40;
      let clear = false;
      if (sized) {
        const probe = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        clear = probe !== null && (probe === stage || stage.contains(probe));
      }
      const wantShown = sized && clear;
      const box = toClientRect(r, window.devicePixelRatio);
      const holes = sized ? cornerHoles(r) : [];
      overlapped = holes.length > 0;
      const key = `${box.x},${box.y},${box.w},${box.h}|${holes.join(";")}`;

      inFlight = true;
      try {
        if (sized && opened && (key !== sent || Date.now() - sentAt > PLACE_RESEND_MS)) {
          await musicCall({ action: "place", ...box, holes });
          sent = key;
          sentAt = Date.now();
        }
        // Sent once on mount even with the tab hidden: a board reloaded onto
        // another tab must take down a window the last page left showing.
        if (wantShown !== shown) {
          await musicCall({ action: "show", on: wantShown });
          shown = wantShown;
        }
      } finally {
        inFlight = false;
      }
    };

    // Every frame while a corner player is over the stage, so the hole keeps up
    // with a drag; the ordinary poll the rest of the time.
    let lastPoll = 0;
    let frame = 0;
    const tick = (now: number) => {
      if (destroyed) return;
      if (overlapped || now - lastPoll >= PLACE_POLL_MS) {
        lastPoll = now;
        void place();
      }
      frame = requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(() => void place());
    observer.observe(stage);
    frame = requestAnimationFrame(tick);
    void place();

    return () => {
      destroyed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  /* -- what it is playing, for the head bar; only while the tab is showing -- */
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      const next = await musicCall(null).finally(() => {
        reading = false;
      });
      if (!cancelled && next) setState(next);
    };
    void read();
    const timer = setInterval(() => void read(), STATE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  const send = useCallback(async (command: MusicCommand) => {
    const next = await musicCall(command);
    if (next) setState(next);
  }, []);

  const track = state?.track ?? null;
  const playing = track?.playing ?? false;
  const problem = state && !state.ok ? state.reason : null;

  let note: string;
  if (problem) note = problem;
  else if (opening && !state?.running) note = "Opening Apple Music…";
  else if (state?.signedIn === false) note = "Sign in with the Apple ID from the card to play full songs.";
  else if (track) note = [track.title, track.artist].filter(Boolean).join(" — ");
  else note = "music.apple.com";

  return (
    <div className="widget musicwidget">
      <div className="widget-head musichead">
        <h2 className="widget-title">Music</h2>
        <span className="widget-meta musichead-note" title={note}>
          {note}
        </span>

        <span className="musichead-controls">
          <span className="np-transport">
            <button type="button" className="np-tbtn" onClick={() => send({ action: "previous" })} aria-label="Previous track" title="Previous track">
              <PrevIcon />
            </button>
            <button
              type="button"
              className="np-tbtn"
              onClick={() => send({ action: playing ? "pause" : "play" })}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause" : "Play"}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button type="button" className="np-tbtn" onClick={() => send({ action: "next" })} aria-label="Next track" title="Next track">
              <NextIcon />
            </button>
          </span>
          <span className="musichead-nav">
            <button type="button" onClick={() => send({ action: "back" })} title="Back a page">
              Back
            </button>
            <button type="button" onClick={() => send({ action: "home" })} title="Apple Music home">
              Home
            </button>
            <button type="button" onClick={() => send({ action: "reload" })} title="Reload the page">
              Reload
            </button>
          </span>
        </span>
      </div>

      <div className="musicstage" ref={stageRef}>
        <p className="musicstage-note">{problem ?? (opening ? "Opening Apple Music…" : "Apple Music")}</p>
      </div>
    </div>
  );
}
