"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { WatchKind } from "@/lib/embed";

/**
 * What is in the Watch player right now, and whether it is filling the panel.
 *
 * ONE LETTER FROM WHAT USED TO BE ITS NEIGHBOUR, so worth saying plainly: the
 * list of videos you have already seen is data/watched.json now and is not in
 * this browser at all; `dayboard.watching` is the one thing playing, which is a
 * fact about this screen and belongs here. They were never the same kind of
 * thing — see the WatchedFileSchema docblock for why only one of them moved.
 *
 * WHY THIS PERSISTS RATHER THAN LIVING IN MEMORY. A second-monitor dashboard gets
 * reloaded — HMR, a dev-server restart, F5 — and the thing on screen should
 * still be there afterwards. For a Twitch stream that is a perfect restore; for
 * a YouTube video it comes back at 0:00, which is the honest cost and the reason
 * for both of the rules below.
 *
 * EXPIRY. An entry older than six hours is treated as absent, so closing the
 * laptop and coming back tomorrow gives a clean board rather than one insisting
 * it is still playing last night's video. This reads the clock, but only ever on
 * the client — getServerSnapshot returns null — so there is no hydration
 * mismatch.
 *
 * THE AUTOPLAY RULE. PAGE_LOADED_AT is captured when this module first runs, so
 * `at > PAGE_LOADED_AT` means "you clicked this a moment ago" and anything
 * else means "this was restored from a previous page life". Clicked plays;
 * restored shows a poster and waits. That is both the behaviour you want and the
 * only one the browser would allow — an autoplay with no user gesture behind it
 * gets blocked anyway.
 */

/**
 * TWO LANES, SO A MATCH AND A STREAM CAN PLAY AT ONCE.
 *
 * "main" is YouTube and Twitch, which dock in Watch (or Health); "stream" is the
 * Sports tab's stream window. Each lane has its own entry and its own player, so
 * putting a Twitch stream on no longer takes the match off, and the other way
 * round. The lane is decided by the entry's KIND, in writeWatching, so no caller
 * has to know there are two.
 *
 * The main lane keeps the original keys, so nothing already stored moves.
 */
export type Lane = "main" | "stream";

const KEYS: Record<Lane, string> = {
  main: "dayboard.watching",
  stream: "dayboard.watching.stream",
};

const EXPANDED_KEYS: Record<Lane, string> = {
  main: "dayboard.watch.expanded",
  stream: "dayboard.watch.expanded.stream",
};

export function laneFor(kind: WatchKind): Lane {
  return kind === "stream" ? "stream" : "main";
}

export function otherLane(lane: Lane): Lane {
  return lane === "stream" ? "main" : "stream";
}

/** Six hours. Long enough for a match and a film, short enough to forget. */
const STALE_MS = 6 * 60 * 60 * 1000;

/** When this tab loaded. Anything stamped before it was restored, not chosen. */
const PAGE_LOADED_AT = Date.now();

const listeners = new Set<() => void>();

export interface Watching {
  kind: WatchKind;
  /**
   * A YouTube video id, a Twitch channel login, or for a stream the page the
   * stream window opens — all the player needs.
   */
  key: string;
  title: string;
  channel: string;
  /** The real site, for the escape hatch. Taken straight off the tile. */
  href: string;
  /** Epoch ms this was sent to the player. See the autoplay rule above. */
  at: number;
  /**
   * WHICH TAB PUT IT THERE — "watch" (the Watch tab, whose id predates its
   * name), "sports" or "health".
   *
   * There is one player on this board and it is never reparented, so before
   * this it filled whichever of the two staged tabs happened to be showing. The
   * result was a VOD sitting in the middle of the Health tab, under a
   * warm-up you were trying to find, which reads as a bug even though every
   * part of it was working as designed.
   *
   * So a video is staged only in the tab it was started from, and anywhere else
   * it keeps playing in the corner. Optional because an entry written before
   * this field existed is still in somebody's localStorage; missing means
   * "watch", which is where every video came from until the Health tab arrived.
   */
  origin?: WatchOrigin;
}

export type WatchOrigin = "watch" | "sports" | "health";

const ORIGINS: readonly string[] = ["watch", "sports", "health"];

/**
 * The tab an entry docks in, which is not always the tab it says it came from.
 *
 * A stream always docks in Sports and a video never does, whatever `origin`
 * claims: a Twitch link pasted into the Sports tab plays in the corner there,
 * rather than in the one stage the match is already using. That is the rule that
 * keeps the two players from ever being staged in the same rectangle.
 */
export function homeFor(entry: Pick<Watching, "kind" | "origin">): WatchOrigin {
  if (entry.kind === "stream") return "sports";
  return entry.origin === "health" ? "health" : "watch";
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function announce() {
  for (const listener of listeners) listener();
}

function readRaw(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeRaw(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // A private window still works for this session.
  }
  announce();
}

const readers: Record<Lane, () => string> = {
  main: () => readRaw(KEYS.main),
  stream: () => readRaw(KEYS.stream),
};

const expandedReaders: Record<Lane, () => string> = {
  main: () => readRaw(EXPANDED_KEYS.main),
  stream: () => readRaw(EXPANDED_KEYS.stream),
};

/** Nothing to read from, and no way to pretend otherwise. */
function unknown(): null {
  return null;
}

function parse(raw: string | null, lane: Lane): Watching | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (o.kind !== "youtube" && o.kind !== "twitch" && o.kind !== "stream") return null;
    if (laneFor(o.kind) !== lane) return null;
    if (typeof o.key !== "string" || !o.key) return null;
    const at = typeof o.at === "number" ? o.at : 0;
    if (Date.now() - at > STALE_MS) return null;
    return {
      kind: o.kind,
      key: o.key,
      title: typeof o.title === "string" ? o.title : "",
      channel: typeof o.channel === "string" ? o.channel : "",
      href: typeof o.href === "string" ? o.href : "",
      at,
      // Every writer has set this since the Health tab arrived, and until now
      // it was dropped right here on the way back out of storage — so after
      // any reload every entry claimed to come from the Watch tab, and a
      // follow-along video docked there instead of in Health.
      origin:
        typeof o.origin === "string" && ORIGINS.includes(o.origin)
          ? (o.origin as WatchOrigin)
          : undefined,
    };
  } catch {
    return null;
  }
}

/** Send something to its player. Every caller stamps `at` with Date.now(). */
export function writeWatching(entry: Watching) {
  writeRaw(KEYS[laneFor(entry.kind)], JSON.stringify(entry));
}

export function clearWatching(lane: Lane = "main") {
  writeRaw(KEYS[lane], null);
}

export function useWatching(lane: Lane = "main"): { entry: Watching | null; autoplay: boolean } {
  const raw = useSyncExternalStore(subscribe, readers[lane], unknown);
  return useMemo(() => {
    const entry = parse(raw, lane);
    return { entry, autoplay: entry !== null && entry.at > PAGE_LOADED_AT };
  }, [raw, lane]);
}

/** The same answer read once, for timers. See readPanelTab for why not a hook. */
export function peekWatching(lane: Lane): Watching | null {
  return parse(readRaw(KEYS[lane]), lane);
}

/** Either player has something on. The alerts never pull the panel out from under it. */
export function anythingPlaying(): boolean {
  return peekWatching("main") !== null || peekWatching("stream") !== null;
}

/**
 * A stream written before there were two lanes sits in the main key, where the
 * main player no longer accepts it. Moved across once, as this module loads, so
 * a match that was on when the new build arrived is still on after it.
 */
export function migrateLegacyStream(): void {
  try {
    const raw = localStorage.getItem(KEYS.main);
    if (!raw) return;
    const value = JSON.parse(raw) as { kind?: unknown };
    if (value?.kind !== "stream") return;
    if (!localStorage.getItem(KEYS.stream)) localStorage.setItem(KEYS.stream, raw);
    localStorage.removeItem(KEYS.main);
  } catch {
    // No storage, or nothing worth moving.
  }
}

if (typeof window !== "undefined") migrateLegacyStream();

/**
 * How far into a video you got, so coming back to it does not mean scrubbing.
 *
 * THIS DELIBERATELY DOES NOT GO IN THE `watching` ENTRY, and the reason is the
 * one rule the whole player is built around. useWatching memoises on the raw
 * storage string, and WatchPlayer rebuilds its player whenever that entry
 * changes — that is what makes clicking the same video again restart it. Write a
 * position into the entry every few seconds and every one of those writes would
 * be a new entry, a new object, and a torn-down player. Once every five seconds.
 *
 * So it lives under its own key, and `writeRaw` is deliberately NOT used: these
 * writes tell no listener and re-render nothing. Nothing needs to watch a number
 * that is only ever read back at mount.
 *
 * A short list rather than one entry, because you move between videos — putting
 * something on, going back to the one from this morning, and having both pick up
 * where they were is the whole point. Capped, oldest dropped.
 */
const POSITIONS_KEY = "dayboard.watch.positions";

/** Enough for a few days of the feed; the feed only shows recent ones anyway. */
const KEEP_POSITIONS = 24;

/** Under this and you had barely started — resuming there would be noise. */
const FLOOR_S = 12;

/** This close to the end it is finished. Coming back should start it over. */
const ENDING_S = 20;

interface Mark {
  k: string;
  s: number;
}

function readMarks(): Mark[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is Mark =>
        Boolean(m) && typeof m === "object" && typeof m.k === "string" && typeof m.s === "number",
    );
  } catch {
    return [];
  }
}

/**
 * Note where a video has got to — or forget it, when there is nothing worth
 * remembering. Both of those are this one function on purpose: the moments that
 * clear a mark are the same moments that would otherwise set a useless one.
 */
export function rememberPosition(key: string, seconds: number, duration: number) {
  const rest = readMarks().filter((m) => m.k !== key);
  const worth =
    Number.isFinite(seconds) &&
    seconds >= FLOOR_S &&
    // A duration of 0 means the player has not worked it out yet; trust the
    // position but not the "is it nearly over" test.
    (duration <= 0 || seconds < duration - ENDING_S);

  const next = worth ? [{ k: key, s: Math.floor(seconds) }, ...rest] : rest;
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(next.slice(0, KEEP_POSITIONS)));
  } catch {
    // A private window simply does not remember.
  }
}

/** Where to pick this one up, or 0 for the beginning. */
export function recallPosition(key: string): number {
  return readMarks().find((m) => m.k === key)?.s ?? 0;
}

/**
 * Whether the player fills the whole centre panel.
 *
 * Its own key rather than a field on Watching, because it is a standing
 * preference about the panel and not a fact about the current video — put it on
 * the entry and it would reset every time you picked something new.
 */
export function setExpanded(expanded: boolean, lane: Lane = "main") {
  writeRaw(EXPANDED_KEYS[lane], expanded ? "1" : null);
}

export function useExpanded(lane: Lane = "main"): boolean {
  return useSyncExternalStore(subscribe, expandedReaders[lane], unknown) === "1";
}
