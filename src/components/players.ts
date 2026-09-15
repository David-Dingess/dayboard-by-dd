"use client";

/**
 * One set of buttons, two completely different players behind it.
 *
 * A cross-origin iframe cannot be driven from the page — you cannot reach into
 * youtube.com and press play. Both providers ship an official SDK for exactly
 * this, so the board loads those rather than inventing a postMessage protocol:
 *
 *   YouTube   https://www.youtube.com/iframe_api      -> window.YT.Player
 *   Twitch    https://embed.twitch.tv/embed/v1.js     -> window.Twitch.Player
 *
 * Each takes a container element and builds its own iframe inside it, which is
 * exactly the shape WatchPlayer needs: the container never moves, so switching
 * dashboard tabs touches nothing, and only a genuine change of what you picked
 * ever tears a player down.
 *
 * THIS FILE IS THE SEAM. Everything provider-specific is behind DeckPlayer's six
 * methods. A desktop build that wanted the real logged-in YouTube would drop a
 * <webview> adapter in here implementing the same six, and nothing above it
 * would change.
 *
 * Both scripts load lazily and at most once — the board should not pay for two
 * SDKs until you actually watch something.
 */

import {
  twitchOptions,
  youtubeState,
  youtubeVars,
  YOUTUBE_ORIGIN,
  type PlayState,
} from "@/lib/embed";
import { toClientRect, type StreamState } from "@/lib/stream";

// The state vocabulary and YouTube's number mapping live in lib/embed.ts with
// the rest of the pure player knowledge — re-exported here so this stays the one
// seam every consumer imports from.
export type { PlayState };

export interface DeckPlayer {
  play(): void;
  pause(): void;
  setMuted(muted: boolean): void;
  /** Start the same thing over. The button that rescues a dropped stream. */
  reload(): void;
  destroy(): void;
  /** Told whenever the player starts, stops, or runs out. */
  onState(callback: (state: PlayState) => void): void;
  /**
   * How far in, and how long. Null for a live stream, which has neither — you
   * cannot be twelve minutes into something that is still happening.
   */
  progress(): { seconds: number; duration: number } | null;
  /**
   * The stream window only. It is a real window over the board rather than
   * something drawn in it, so anything the board draws on top — the eye break,
   * a dialog — would be underneath it unless it steps aside.
   */
  setHidden?(hidden: boolean): void;
  /** The stream window only: its own history, since a kiosk window has no back button. */
  back?(): void;
  /** The stream window only: back to the page the tile opened. */
  home?(): void;
  /**
   * Whether the player itself is muted right now, or null when it cannot say.
   * WatchPlayer compares this with the mute it wants, because an embed can
   * reset itself (a Twitch ad break reloads its player) and a mute that is only
   * set once does not survive that.
   */
  isMuted?(): boolean | null;
}

export interface MountOpts {
  autoplay: boolean;
  /** Twitch only, and load-bearing — see lib/embed.ts. */
  parents: string[];
  /** Seconds in to pick up from. Ignored by anything live. */
  startAt?: number;
}

/* ---- script loading ---------------------------------------------------- */

const scripts = new Map<string, Promise<void>>();

/**
 * Load a script tag once, and resolve when `ready()` says the global it defines
 * has actually appeared. Those are not the same moment for YouTube, which
 * fetches a second bundle after the first one runs.
 */
function loadScript(src: string, ready: () => boolean): Promise<void> {
  const existing = scripts.get(src);
  if (existing) return existing;

  const pending = new Promise<void>((resolve, reject) => {
    if (ready()) {
      resolve();
      return;
    }

    const settle = () => {
      if (!ready()) return false;
      resolve();
      return true;
    };

    const tag = document.createElement("script");
    tag.src = src;
    tag.async = true;
    tag.onerror = () => reject(new Error("Could not load " + src));
    tag.onload = () => {
      if (settle()) return;
      // YouTube's loader defines YT immediately but fills it in a moment later,
      // so poll briefly rather than guessing at a delay.
      const started = Date.now();
      const timer = setInterval(() => {
        if (settle() || Date.now() - started > 10_000) clearInterval(timer);
      }, 50);
    };
    document.head.appendChild(tag);
  });

  scripts.set(src, pending);
  return pending;
}

/* ---- keeping fullscreen inside the panel -------------------------------- */

/**
 * Take fullscreen away from the iframe the SDK just built.
 *
 * Fullscreen is meant to fill the dashboard panel rather than the screen.
 * YouTube's own button is already gone via `fs: 0`; Twitch has no such option,
 * so the permission is removed instead. WatchPlayer also watches for a
 * fullscreenchange it did not ask for, which is what catches pressing `f` with
 * focus inside the player — this just means that safety net rarely has to fire.
 */
function disarmFullscreen(container: HTMLElement) {
  const frame = container.querySelector("iframe");
  if (!frame) return;
  frame.removeAttribute("allowfullscreen");
  const allow = frame.getAttribute("allow");
  if (!allow) return;
  frame.setAttribute(
    "allow",
    allow
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith("fullscreen"))
      .join("; "),
  );
}

/** The SDKs replace the node they are handed, so never hand them the container. */
function freshMountPoint(container: HTMLElement): HTMLElement {
  container.replaceChildren();
  const node = document.createElement("div");
  node.style.width = "100%";
  node.style.height = "100%";
  container.appendChild(node);
  return node;
}

/* ---- YouTube ------------------------------------------------------------ */

interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  loadVideoById(id: string): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

interface YtPlayerConfig {
  host?: string;
  videoId: string;
  playerVars: Record<string, number | string>;
  events: {
    onReady?: () => void;
    onStateChange?: (event: { data: number }) => void;
  };
}

interface TwitchPlayer {
  play(): void;
  pause(): void;
  setMuted(muted: boolean): void;
  getMuted(): boolean;
  setChannel(channel: string): void;
  addEventListener(event: string, callback: () => void): void;
}

interface TwitchPlayerCtor {
  new (el: HTMLElement, options: ReturnType<typeof twitchOptions>): TwitchPlayer;
  READY: string;
  PLAY: string;
  PAUSE: string;
  ENDED: string;
  OFFLINE: string;
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, config: YtPlayerConfig) => YtPlayer };
    Twitch?: { Player: TwitchPlayerCtor };
  }
}

/**
 * How long to wait for the iframe handshake before calling a player dead.
 *
 * Warm, onReady lands in well under a second; a cold script or a predecessor
 * that was only just torn down makes it longer. Ten seconds is the same budget
 * loadScript gives the SDK itself, and erring long only delays the "would not
 * load" line on a player that was never coming back anyway.
 */
const READY_TIMEOUT_MS = 10_000;

export async function mountYouTube(
  container: HTMLElement,
  videoId: string,
  opts: MountOpts,
): Promise<DeckPlayer> {
  await loadScript("https://www.youtube.com/iframe_api", () => Boolean(window.YT?.Player));
  const YT = window.YT;
  if (!YT) throw new Error("YouTube IFrame API did not load");

  const node = freshMountPoint(container);
  let notify: ((state: PlayState) => void) | null = null;

  /**
   * WAIT FOR onReady, BECAUSE THE CONSTRUCTOR HANDS BACK A STUB.
   *
   * `new YT.Player()` returns an object carrying `destroy` and nothing else.
   * playVideo, pauseVideo, mute, unMute, loadVideoById, getCurrentTime and
   * getDuration are all attached later, when the iframe finishes its handshake
   * and onReady fires — measured at ~0.4s with the script already warm, and
   * longer right after another player was torn down, which is exactly when
   * you reach for the controls.
   *
   * Resolving at construction published a DeckPlayer whose six methods were
   * undefined, so a click landing in that window threw `pauseVideo is not a
   * function` out of an event handler and took the whole board down with it.
   * `progress()` below still carries the try/catch from the one time this was
   * noticed and patched a method at a time; gating the promise is that same fix
   * made general. Above this line nothing can hold a player it cannot drive.
   */
  const player = await new Promise<YtPlayer>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        built.destroy();
      } catch {
        // Never got far enough to have anything worth tearing down.
      }
      container.replaceChildren();
      reject(new Error("YouTube player never became ready"));
    }, READY_TIMEOUT_MS);

    const built: YtPlayer = new YT.Player(node, {
      host: YOUTUBE_ORIGIN,
      videoId,
      playerVars: youtubeVars({
        autoplay: opts.autoplay,
        origin: window.location.origin,
        start: opts.startAt,
      }),
      events: {
        onReady: () => {
          clearTimeout(timer);
          disarmFullscreen(container);
          resolve(built);
        },
        onStateChange: (event) => notify?.(youtubeState(event.data)),
      },
    });
  });

  return {
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    setMuted: (muted) => (muted ? player.mute() : player.unMute()),
    isMuted: () => {
      try {
        return player.isMuted();
      } catch {
        return null;
      }
    },
    // Deliberately with no start offset: reload is the button that says "take it
    // from the top", and it is the only way back to the beginning of something
    // the board would otherwise resume.
    reload: () => player.loadVideoById(videoId),
    destroy: () => {
      try {
        player.destroy();
      } catch {
        // Already gone with the container; nothing left to clean up.
      }
      container.replaceChildren();
    },
    onState: (callback) => {
      notify = callback;
    },
    progress: () => {
      try {
        const seconds = player.getCurrentTime();
        const duration = player.getDuration();
        if (!Number.isFinite(seconds) || !Number.isFinite(duration)) return null;
        return { seconds, duration };
      } catch {
        // Asked before the player was ready, or after it went away.
        return null;
      }
    },
  };
}

/* ---- Twitch ------------------------------------------------------------- */

export async function mountTwitch(
  container: HTMLElement,
  login: string,
  opts: MountOpts,
): Promise<DeckPlayer> {
  await loadScript("https://embed.twitch.tv/embed/v1.js", () => Boolean(window.Twitch?.Player));
  const Twitch = window.Twitch;
  if (!Twitch) throw new Error("Twitch embed SDK did not load");

  const node = freshMountPoint(container);
  let notify: ((state: PlayState) => void) | null = null;

  const player = new Twitch.Player(
    node,
    twitchOptions(login, { autoplay: opts.autoplay, parents: opts.parents }),
  );

  player.addEventListener(Twitch.Player.READY, () => {
    disarmFullscreen(container);
    // AND ACTUALLY START IT. The `autoplay` option above is a request the embed
    // is free to ignore, and it does — a stream sent from the Stream Deck arrived
    // as a paused first frame with a play button over it, which is not what
    // "push to play" means. READY is the first moment the player will accept the
    // call, so this is where it goes rather than beside the mount.
    if (opts.autoplay) player.play();
  });
  player.addEventListener(Twitch.Player.PLAY, () => notify?.("playing"));
  player.addEventListener(Twitch.Player.PAUSE, () => notify?.("paused"));
  // ENDED is a broadcast finishing; OFFLINE is a fact about the channel rather
  // than about playback, and calling it "ended" is the false positive that would
  // advance a video queue because someone went to bed. What actually keeps that
  // safe is WatchPlayer gating the advance on kind === "youtube" — this mapping
  // is just honest, so it stays honest the day a Twitch VOD adapter lands here.
  player.addEventListener(Twitch.Player.ENDED, () => notify?.("ended"));
  player.addEventListener(Twitch.Player.OFFLINE, () => notify?.("idle"));

  return {
    play: () => player.play(),
    pause: () => player.pause(),
    setMuted: (muted) => player.setMuted(muted),
    isMuted: () => {
      try {
        const muted = player.getMuted();
        return typeof muted === "boolean" ? muted : null;
      } catch {
        // Asked before READY.
        return null;
      }
    },
    // Re-pointing at the same channel is how you rejoin a stream that dropped.
    reload: () => {
      player.setChannel(login);
      player.play();
    },
    // Twitch's player has no teardown of its own; emptying the container is it.
    destroy: () => container.replaceChildren(),
    onState: (callback) => {
      notify = callback;
    },
    // A live stream has no position to keep. Coming back to it means joining
    // whatever is happening now, which is what it already does.
    progress: () => null,
  };
}

/* ---- the stream window -------------------------------------------------- */

/** How often the stream is asked what it is doing. It is a DevTools round trip. */
const STREAM_POLL_MS = 2000;

/** How often the player's box is re-measured. A getBoundingClientRect, nothing more. */
const PLACE_POLL_MS = 150;

/** How often the box is sent even when it has not changed. See place(). */
const PLACE_RESEND_MS = 2000;

async function streamCall(body: Record<string, unknown> | null): Promise<StreamState | null> {
  try {
    const res = await fetch("/api/stream", {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      // So a close sent as the page unloads still arrives.
      keepalive: body?.action === "close",
      // A request that never answers must not freeze the loops that wait on it.
      signal: AbortSignal.timeout(6000),
    });
    return (await res.json()) as StreamState;
  } catch {
    return null;
  }
}

/**
 * A whole streaming site, standing in the player's box.
 *
 * NOTHING IS MOUNTED HERE BUT A PLACEHOLDER. The picture is a separate Chrome
 * window that agent/stream has made a child of the board's window; this adapter
 * tells the server where the box is and the window follows it — docked, filled
 * or parked in the corner, dragged or not, with no geometry of its own, because
 * `container` is the same .watchmount the embeds fill.
 *
 * THE BOX IS WATCHED BY POLLING, not only by a ResizeObserver, because the
 * corner player moves without resizing and a ResizeObserver never hears about a
 * move. A rect read every 150ms is nothing; a POST only goes when it changed,
 * and only one is ever in flight — a drag sends the latest box, not every box.
 *
 * AND IT STEPS ASIDE for anything the board draws over the box. A native window
 * cannot be under a DOM element, so the eye break's takeover or a dialog would
 * otherwise be hidden behind a football match. The test is the DOM's own: the
 * element at the centre of the box has to be the box.
 */
export async function mountStream(
  container: HTMLElement,
  url: string,
  service: string,
  opts: MountOpts,
): Promise<DeckPlayer> {
  container.replaceChildren();
  const hold = document.createElement("div");
  hold.className = "streamhold";
  const who = document.createElement("p");
  who.className = "streamhold-who";
  const note = document.createElement("p");
  note.className = "streamhold-note";
  hold.append(who, note);
  container.appendChild(hold);

  const say = (headline: string, detail = "") => {
    who.textContent = headline;
    note.textContent = detail;
  };
  say(`Opening ${service}…`);

  let notify: ((state: PlayState) => void) | null = null;
  let destroyed = false;
  let hushed = false;
  let adopted = false;
  let lastMuted: boolean | null = null;

  const opened = await streamCall({ action: "open", url, fresh: opts.autoplay });
  if (!opened?.ok) {
    const reason = opened?.reason ?? "The board's server did not answer.";
    say(`${service} could not open here.`, reason);
    throw new Error(reason);
  }
  adopted = opened.adopted;
  say(service, "");

  /* -- where the box is -- */

  let sent = "";
  let sentAt = 0;
  let inFlight = false;
  let shown: boolean | null = null;

  const place = async () => {
    if (destroyed || inFlight) return;
    const r = container.getBoundingClientRect();
    const sized = r.width >= 40 && r.height >= 40;

    let clear = false;
    if (sized) {
      const probe = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      clear = probe !== null && (probe === container || container.contains(probe));
    }
    const wantShown = sized && clear && !hushed;

    const box = toClientRect(r, window.devicePixelRatio);
    // The corner player has rounded corners and the window over it does not,
    // unless the helper clips it: the dock's radius less its 1px border.
    const dock = container.closest<HTMLElement>(".watchdock");
    const radius =
      dock?.classList.contains("is-mini") === true
        ? Math.max(0, Math.round(((parseFloat(getComputedStyle(dock).borderTopLeftRadius) || 0) - 1) * window.devicePixelRatio))
        : 0;
    const key = `${box.x},${box.y},${box.w},${box.h},${radius}`;

    inFlight = true;
    try {
      // Resent every couple of seconds even when nothing moved. The window can be
      // moved from outside this page (a server restart re-adopting it, a hand
      // test), and a box that is only sent on change would never pull it back.
      if (sized && (key !== sent || Date.now() - sentAt > PLACE_RESEND_MS)) {
        await streamCall({ action: "place", ...box, r: radius });
        sent = key;
        sentAt = Date.now();
      }
      if (wantShown !== shown) {
        await streamCall({ action: "show", on: wantShown });
        shown = wantShown;
      }
    } finally {
      inFlight = false;
    }
  };

  const observer = new ResizeObserver(() => void place());
  observer.observe(container);
  const placing = setInterval(() => void place(), PLACE_POLL_MS);
  void place();

  /* -- what it is doing -- */

  let reading = false;
  const read = async () => {
    // One at a time. Chrome allows six connections to the board's server and
    // the Stream Deck bridge holds one open for good; slow reads stacking up
    // every two seconds would starve the placement calls behind them.
    if (reading) return;
    reading = true;
    const state = await streamCall(null).finally(() => {
      reading = false;
    });
    if (destroyed || !state) return;
    if (!state.ok) {
      say(`${service} is not answering.`, state.reason ?? "");
      return;
    }
    if (adopted && !state.adopted) {
      say(`The ${service} window closed.`, "Reload brings it back.");
    }
    adopted = state.adopted;
    lastMuted = state.muted;
    if (state.adopted) say(service, "");
    notify?.(state.video ? (state.video.playing ? "playing" : "paused") : "idle");
  };
  const polling = setInterval(() => void read(), STREAM_POLL_MS);

  const act = (body: Record<string, unknown>) => {
    void streamCall(body).then(() => read());
  };

  return {
    play: () => act({ action: "play" }),
    pause: () => act({ action: "pause" }),
    setMuted: (muted) => act({ action: "mute", on: muted }),
    isMuted: () => lastMuted,
    // Reload rescues both failures: a page that stalled, and a window that is
    // gone altogether — the second needs opening again, not refreshing.
    reload: () => {
      if (adopted) act({ action: "reload" });
      else {
        say(`Opening ${service}…`);
        void streamCall({ action: "open", url, fresh: true }).then((state) => {
          adopted = Boolean(state?.adopted);
          sent = "";
          shown = null;
          void place();
        });
      }
    },
    back: () => act({ action: "back" }),
    home: () => act({ action: "home", url }),
    setHidden: (hidden) => {
      hushed = hidden;
      void place();
    },
    destroy: () => {
      destroyed = true;
      clearInterval(placing);
      clearInterval(polling);
      observer.disconnect();
      void streamCall({ action: "close" });
      container.replaceChildren();
    },
    onState: (callback) => {
      notify = callback;
      void read();
    },
    progress: () => null,
  };
}
