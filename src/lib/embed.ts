import { serviceForUrl } from "./watch";

/**
 * The two players the board can embed, the one it cannot, and how to address
 * all three.
 *
 * WHY ONLY TWO EMBEDS. Everything else refuses to be framed. youtube.com sends
 * `X-Frame-Options: SAMEORIGIN` on its home page, and so does every sports
 * service in lib/watch.ts — Peacock, NBA, Apple TV, ESPN, FOX, Paramount+,
 * Prime, all of them, checked. Only the dedicated player surfaces are open:
 * youtube.com/embed/<id> and player.twitch.tv.
 *
 * THE THIRD KIND IS NOT AN EMBED. A "stream" is a whole streaming site running
 * in a real Chrome window that agent/stream parents into the board and sizes to
 * the player's rectangle — see that program's docblock for why a window and not
 * an iframe. It shares the player's modes, bar and geometry, and nothing here
 * pretends it is a frame.
 *
 * Pure functions only. No React, no DOM — components/players.ts owns the SDKs
 * and the mounting; this file just says what to ask them for, so it can be
 * tested without a browser.
 *
 * NOT TO BE CONFUSED WITH lib/watch.ts, which is about US broadcast rights —
 * though the streaming hosts live there, because a host is a fact about a
 * service.
 */

/** nocookie, not www. Both frame fine; this one sets no tracking cookie until
 *  playback and never nags about signing in — and there is no session on the
 *  board to personalise anything with anyway. */
export const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";

export type WatchKind = "youtube" | "twitch" | "stream";

/**
 * What a player is doing. Shared vocabulary for both adapters, so it sits beside
 * WatchKind rather than in components/players.ts — which re-exports it, so every
 * consumer still imports it from the seam it belongs to.
 */
export type PlayState = "playing" | "paused" | "idle" | "ended";

/**
 * YouTube's state numbers, and the one distinction that matters.
 *
 * 1 playing, 3 buffering (on its way to playing), 2 paused, 0 ENDED — and
 * everything else, -1 unstarted and 5 cued, is idle. 0 used to fall in with that
 * remainder, which made "the video finished" indistinguishable from "the player
 * has not started yet". Telling those two apart is the whole of auto-advance,
 * and getting it wrong in the un-ended direction would start a new video every
 * time a player mounted.
 *
 * Here rather than inline in the adapter for the reason the file's docblock
 * gives: this half can be tested without a browser, and the SDK-bound half
 * cannot be imported at all under a plain node test runner.
 */
export function youtubeState(data: number): PlayState {
  if (data === 1 || data === 3) return "playing";
  if (data === 2) return "paused";
  if (data === 0) return "ended";
  return "idle";
}

/** The hostname out of a URL, or null if it was not one. */
function hostOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

/**
 * The `parent` values Twitch's player demands.
 *
 * Twitch matches this against THE EMBEDDING PAGE'S hostname and, when it does
 * not match, renders a black rectangle — no error, no console message, nothing
 * to debug. So the load-bearing entry is `window.location.hostname`, which is
 * the one value that is always right, including when you open the board from
 * a tablet at http://192.168.1.x:3000. A build-time constant alone would leave
 * that case silently black.
 *
 * The site URL and localhost ride along so a page opened some other way still
 * works. Multiple parents are allowed; duplicates are not a problem but are
 * dropped anyway to keep the URL readable.
 */
export function parentHosts(siteUrl?: string | null, pageHost?: string | null): string[] {
  const hosts = [pageHost, "localhost", hostOf(siteUrl)];
  return [...new Set(hosts.filter((h): h is string => Boolean(h)))];
}

/**
 * YouTube IFrame API player vars.
 *
 * `fs: 0` is the one worth explaining: it removes YouTube's own fullscreen
 * button, because Fullscreen is meant to fill the dashboard panel rather
 * than the screen. WatchPlayer catches the other routes to fullscreen; this just
 * means it rarely has to.
 *
 * `enablejsapi` and `origin` are what let the board ask the player where it has
 * got to, which is how a video resumes after a reload. They were put here before
 * anything read them, precisely because adding them later would have meant
 * changing a running player's parameters — and that is a reload.
 */
export function youtubeVars(opts: {
  autoplay: boolean;
  origin: string;
  /** Seconds in to begin at — where you got to last time. Omitted when 0. */
  start?: number;
}): Record<string, number | string> {
  return {
    ...(opts.start && opts.start > 0 ? { start: Math.floor(opts.start) } : {}),
    autoplay: opts.autoplay ? 1 : 0,
    // Since 2018 this only restricts related videos to the same channel rather
    // than hiding them. Kept because that is still better than nothing.
    rel: 0,
    modestbranding: 1,
    playsinline: 1,
    enablejsapi: 1,
    fs: 0,
    origin: opts.origin,
  };
}

/** Twitch embed options. `muted` is false on purpose — the click on the tile is
 *  a user gesture on the top-level document, so sound is allowed to start. */
export function twitchOptions(login: string, opts: { autoplay: boolean; parents: string[] }) {
  return {
    channel: login,
    parent: opts.parents,
    autoplay: opts.autoplay,
    muted: false,
    width: "100%",
    height: "100%",
  };
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Paste-a-link: pull a playable thing out of whatever was pasted.
 *
 * A YouTube video, a Twitch channel, or a page on a streaming service the stream
 * window can open — the last is how a match on a service no team tile points at
 * still gets onto the board.
 *
 * Twitch VODs (twitch.tv/videos/123) return null deliberately: the player can do
 * them, but a channel and a VOD need different options and there is no reason to
 * carry the second shape until something asks for it.
 */
export function parseWatchUrl(
  input: string,
): { kind: WatchKind; key: string; service?: string } | null {
  const text = input.trim();
  if (!text) return null;

  // A bare id, which is what you get pasting from YouTube's own share sheet.
  if (YT_ID.test(text)) return { kind: "youtube", key: text };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    return parts[0] && YT_ID.test(parts[0]) ? { kind: "youtube", key: parts[0] } : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && YT_ID.test(v)) return { kind: "youtube", key: v };
    // /live/, /embed/ and /shorts/ all carry the id in the same slot.
    if (parts.length >= 2 && ["live", "embed", "shorts", "v"].includes(parts[0])) {
      return YT_ID.test(parts[1]) ? { kind: "youtube", key: parts[1] } : null;
    }
    return null;
  }

  if (host === "twitch.tv" || host === "player.twitch.tv") {
    const channel = url.searchParams.get("channel");
    if (channel) return { kind: "twitch", key: channel.toLowerCase() };
    // Twitch's own pages that are not channels. A login cannot collide with
    // these, so refusing them is free.
    const reserved = new Set(["videos", "directory", "settings", "downloads", "store", "u", "moderator"]);
    if (parts.length === 1 && !reserved.has(parts[0].toLowerCase())) {
      return { kind: "twitch", key: parts[0].toLowerCase() };
    }
    return null;
  }

  // Https only: the stream window is a real browser with your logins in it,
  // and it has no business being pointed at anything that is not.
  const service = url.protocol === "https:" ? serviceForUrl(url) : null;
  if (service) return { kind: "stream", key: url.href, service };

  return null;
}
