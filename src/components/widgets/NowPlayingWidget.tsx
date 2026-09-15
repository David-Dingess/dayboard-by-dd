"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentBase,
  formatMs,
  transportUrl,
  BANDS,
  type NowPlaying,
  type Transport,
} from "@/lib/nowplaying";

/**
 * Now Playing — album art, the tags, a progress bar and a real EQ.
 *
 * The only client-side widget on the board, and it has to be: what is playing is
 * a fact about this PC, and the server rendering this page is in a a remote host
 * region. The browser is the one process that can see both, so it talks to the
 * local agent directly at 127.0.0.1.
 *
 * That is legal from an HTTPS page because loopback counts as a "potentially
 * trustworthy" origin, so the mixed-content blocker leaves it alone. It is also
 * why the art can be read back off a canvas for the accent colour: the agent
 * returns a real Access-Control-Allow-Origin, so crossOrigin="anonymous" keeps
 * the canvas untainted.
 *
 * One EventSource carries both rates — a track event on change, level frames at
 * ~30 Hz. Level frames never touch React state; they go into a ref and are drawn
 * from a rAF loop, because re-rendering a component thirty times a second to move
 * some rectangles would be the single most expensive thing on this board.
 */

const BAR_GAP = 2;

/**
 * What the clock reads before the new track's length is known.
 *
 * Same four characters as a real time, and .np-time is tabular with a floor
 * width, so swapping to "3:45" moves nothing.
 */
const BLANK_TIME = "–:––";

export function PrevIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M11.5 3.6 5.8 8l5.7 4.4Z" />
      <rect x="4" y="3.6" width="1.3" height="8.8" rx="0.4" />
    </svg>
  );
}

export function NextIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M4.5 3.6 10.2 8l-5.7 4.4Z" />
      <rect x="10.7" y="3.6" width="1.3" height="8.8" rx="0.4" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M5 3.4 12.2 8 5 12.6Z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <rect x="4.4" y="3.6" width="2.4" height="8.8" rx="0.6" />
      <rect x="9.2" y="3.6" width="2.4" height="8.8" rx="0.6" />
    </svg>
  );
}

export function NowPlayingWidget() {
  const base = agentBase();

  // Checked here rather than in a try/catch inside the effect: EventSource throws
  // on a malformed URL, and recovering from that with setState would be a
  // cascading render for a config typo the first paint could have shown instead.
  const endpoint = useMemo(() => {
    try {
      return new URL(`${base}/events`).toString();
    } catch {
      return null;
    }
  }, [base]);

  const [track, setTrack] = useState<NowPlaying | null>(null);
  const [connected, setConnected] = useState<boolean | null>(endpoint ? null : false);
  const [accent, setAccent] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const elapsedRef = useRef<HTMLSpanElement | null>(null);

  // Level frames land here. `smooth` is what is actually drawn, easing toward
  // `target` so a 30 Hz feed still looks right on a 144 Hz monitor.
  const target = useRef<Float32Array>(new Float32Array(BANDS));
  const smooth = useRef<Float32Array>(new Float32Array(BANDS));
  const trackRef = useRef<NowPlaying | null>(null);

  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  /**
   * Write the bar straight to the DOM for a given track.
   *
   * Called the instant a track frame arrives, BEFORE React re-renders, because
   * the fill's width is not a React-controlled prop — it survives a render, and
   * an un-repainted bar would spend a frame showing the previous song's position
   * against the new song's title.
   */
  const paintProgress = useCallback((next: NowPlaying | null) => {
    const known = Boolean(next && next.durationMs > 0);
    const position = known ? Math.min(next!.positionMs, next!.durationMs) : 0;
    if (fillRef.current) {
      fillRef.current.style.width = known
        ? `${((position / next!.durationMs) * 100).toFixed(2)}%`
        : "0%";
    }
    if (elapsedRef.current) {
      elapsedRef.current.textContent = known ? formatMs(position) : BLANK_TIME;
    }
  }, []);

  // ---------------------------------------------------------------- the feed
  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    const source = new EventSource(endpoint);

    source.addEventListener("open", () => !cancelled && setConnected(true));

    source.addEventListener("track", (event) => {
      if (cancelled) return;
      try {
        const next = JSON.parse((event as MessageEvent).data) as NowPlaying;
        setTrack(next);
        // Before the render, not after: see paintProgress.
        paintProgress(next);
        setConnected(true);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    });

    source.addEventListener("levels", (event) => {
      if (cancelled) return;
      try {
        const values = JSON.parse((event as MessageEvent).data) as number[];
        for (let i = 0; i < BANDS; i++) target.current[i] = values[i] ?? 0;
      } catch {
        /* same */
      }
    });

    // EventSource reconnects on its own; this only reflects that in the UI.
    source.addEventListener("error", () => !cancelled && setConnected(false));

    return () => {
      cancelled = true;
      source.close();
    };
  }, [endpoint, paintProgress]);

  // ------------------------------------------------------------- the drawing
  useEffect(() => {
    let frame = 0;
    let lastLabel = -1;

    const draw = () => {
      frame = requestAnimationFrame(draw);

      const canvas = canvasRef.current;
      const now = trackRef.current;
      const playing = now?.status === "Playing";

      // --- progress, written straight to the DOM to stay off the render path
      if (now && now.durationMs > 0) {
        const anchored = Date.parse(now.positionAt);
        const drift = playing && Number.isFinite(anchored) ? Date.now() - anchored : 0;
        const position = Math.min(now.positionMs + drift, now.durationMs);
        const pct = (position / now.durationMs) * 100;
        if (fillRef.current) fillRef.current.style.width = `${pct.toFixed(2)}%`;
        const whole = Math.floor(position / 1000);
        if (whole !== lastLabel && elapsedRef.current) {
          lastLabel = whole;
          elapsedRef.current.textContent = formatMs(position);
        }
      } else if (lastLabel !== -1) {
        // Between tracks SMTC reports the new title before it knows the length.
        // The bar stays put and reads blank for that moment — the alternative is
        // the old track's fill sitting there claiming to be this one's. Guarded
        // on lastLabel so this writes once per gap, not sixty times a second.
        lastLabel = -1;
        if (fillRef.current) fillRef.current.style.width = "0%";
        if (elapsedRef.current) elapsedRef.current.textContent = BLANK_TIME;
      }

      // --- the EQ
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      // Panel keeps every widget mounted and hides the inactive ones, so this
      // canvas measures 0x0 whenever another tab is showing. Drawing into that
      // is both wasted work and, via a negative bar width, a thrown exception
      // sixty times a second.
      if (width < 1 || height < 1) return;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Never below a pixel: a narrow panel must still draw something, and
      // roundRect throws on a negative radius rather than clamping.
      const barWidth = Math.max(1, (width - BAR_GAP * (BANDS - 1)) / BANDS);
      const ink = accent ?? "#4bc0c8";

      for (let i = 0; i < BANDS; i++) {
        // Ease toward the incoming value: up fast so a snare reads, down slower
        // so the bars fall like a real meter instead of flickering.
        const goal = playing ? target.current[i] : 0;
        const current = smooth.current[i];
        smooth.current[i] = current + (goal - current) * (goal > current ? 0.45 : 0.12);

        const value = Math.max(smooth.current[i], 0.012);
        const barHeight = value * height;
        const x = i * (barWidth + BAR_GAP);

        ctx.globalAlpha = 0.28 + value * 0.72;
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.roundRect(x, height - barHeight, barWidth, barHeight, Math.min(2, barWidth / 2));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [accent]);

  // ------------------------------------------------------------ accent colour
  // Wallpaper Engine tints its panel from the cover; this does the same, in the
  // browser, so the agent never has to decode an image.
  const onArtLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    try {
      const size = 16;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      // Average only the colourful, mid-bright pixels. A plain mean of an album
      // cover is almost always mud.
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]];
        const max = Math.max(pr, pg, pb);
        const min = Math.min(pr, pg, pb);
        if (max - min < 28 || max < 60 || max > 246) continue;
        r += pr;
        g += pg;
        b += pb;
        n++;
      }
      if (n === 0) {
        setAccent(null);
        return;
      }
      setAccent(lift(r / n, g / n, b / n));
    } catch {
      // A tainted canvas means the agent's CORS header did not arrive. The
      // panel simply keeps the board's own accent.
      setAccent(null);
    }
  }, []);

  /**
   * Ask the agent to drive the session — and then do nothing about the answer.
   *
   * FIRE AND FORGET, DELIBERATELY. There is no busy state and no optimistic
   * update, because the SSE stream that draws everything else here is the thing
   * that reports the result: the agent's Publish gate compares Status, so a
   * pause pushes a `track` frame by itself and the icon flips from the same
   * source as the title. Painting a guess first would only give it something to
   * disagree with. A failure is silent for the same reason — if the music did
   * not move, the widget still says so, because it is showing the truth rather
   * than the request.
   */
  const send = useCallback((command: Transport) => {
    void fetch(transportUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command }),
      cache: "no-store",
    }).catch(() => {});
  }, []);

  const playing = track?.status === "Playing";
  const has = Boolean(track?.ok && track.title);

  return (
    <div className="widget">
      <h2 className="stack-title">
        Now Playing
        <span className="stack-meta">{has ? (track?.app ?? "") : ""}</span>
      </h2>

      <div className="widget-scroll">
        {connected === false ? (
          <p className="empty">
            The now-playing agent isn&apos;t running. Start{" "}
            <code>dayboard-nowplaying</code> on this machine.
          </p>
        ) : connected === null ? (
          <p className="empty">Looking for the agent…</p>
        ) : !has ? (
          <p className="empty">Nothing playing.</p>
        ) : (
          <section className="np" style={accent ? { ["--np-accent" as string]: accent } : undefined}>
            {/* THE ART IS A COLUMN, not a row above the rest. It used to sit in a
                96px cell with the title beside it and the progress and the EQ
                stacked underneath; now it is 168px and the other three are one
                stack to its right. The widget got the full width of the column
                when it stopped sharing a row with the scores, and a cover is the
                one thing here worth spending it on. */}
            {track?.artUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="np-art"
                  src={`${base}${track.artUrl}`}
                  alt=""
                  crossOrigin="anonymous"
                  onLoad={onArtLoad}
                  onError={() => setAccent(null)}
                />
              ) : (
              <span className="np-art is-blank" aria-hidden>
                ♪
              </span>
            )}

            <div className="np-side">
              <div className="np-tags">
                <span className="np-title" title={track?.title ?? ""}>
                  {track?.title}
                </span>
                {track?.artist && (
                  <span className="np-artist" title={track.artist}>
                    {track.artist}
                  </span>
                )}
                {track?.album && (
                  <span className="np-album" title={track.album}>
                    {track.album}
                  </span>
                )}
                <span className={`np-state${playing ? " is-playing" : ""}`}>
                  {playing ? "playing" : (track?.status.toLowerCase() ?? "")}
                </span>
              </div>

            {/* ALWAYS RENDERED, even with no duration yet. It used to unmount
                the moment a track changed, which took ~28px out of the widget
                and — because the left column sizes to its content — jolted
                Discord up the screen and back every time a song ended. */}
            <div className="np-progress">
              {/* One grid child holding three buttons, so the row's 10px gap
                  falls between the controls and the clock rather than between
                  every button. They render off `track` alone — nothing in the
                  30 Hz draw loop touches their state, and none of this may
                  carry a key: a remount here would drop the refs below and the
                  bar would stop moving. */}
              <span className="np-transport">
                <button
                  type="button"
                  className="np-tbtn"
                  onClick={() => send("previous")}
                  aria-label="Previous track"
                  title="Previous track"
                >
                  <PrevIcon />
                </button>
                <button
                  type="button"
                  className="np-tbtn"
                  onClick={() => send(playing ? "pause" : "play")}
                  aria-label={playing ? "Pause" : "Play"}
                  title={playing ? "Pause" : "Play"}
                >
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button
                  type="button"
                  className="np-tbtn"
                  onClick={() => send("next")}
                  aria-label="Next track"
                  title="Next track"
                >
                  <NextIcon />
                </button>
              </span>
              {/* .np-elapsed, not :first-child — the transport group is first
                  now, and the alignment rule has to keep naming this span. */}
              <span className="np-time np-elapsed" ref={elapsedRef}>
                {(track?.durationMs ?? 0) > 0 ? formatMs(track?.positionMs ?? 0) : BLANK_TIME}
              </span>
              <span className="np-bar">
                <span className="np-fill" ref={fillRef} />
              </span>
              <span className="np-time">
                {(track?.durationMs ?? 0) > 0 ? formatMs(track!.durationMs) : BLANK_TIME}
              </span>
            </div>

              <canvas className="np-eq" ref={canvasRef} aria-hidden />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** Nudge a cover colour up to something that reads on #101216 without glowing. */
function lift(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const scale = max < 150 ? 150 / Math.max(max, 1) : 1;
  const clamp = (v: number) => Math.round(Math.min(235, v * scale));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}
