"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * Where the corner player was left.
 *
 * ONLY THE CORNER PLAYER MOVES. Docked and filled are measured against a panel
 * — see WatchPlayer's layout effect — so dragging either would be overwritten by
 * the next ResizeObserver tick. Mini is the only mode that owns its own
 * position, which is also the only one that is an object floating on top of the
 * board rather than filling a slot.
 *
 * localStorage, beside `dayboard.watch.*` and for the same reason as the panel
 * tabs: where you parked the player is a fact about this screen, not about the
 * program, and it must survive a reload — the board is a page that stays open
 * for days. It also has to survive `next start` under docs/running-without-
 * claude.md option A, which it does precisely because it is not server state.
 */

/**
 * ONE CORNER, SHARED BY BOTH PLAYERS. Whichever player is not on the big screen
 * sits in it, at the same spot and the same size, so switching between Watch
 * and Sports reads as the two swapping places rather than as two different
 * mini-players. Moving or resizing either one moves the corner for both.
 */
const KEY = "dayboard.watch.pip";
type PipLane = "main" | "stream";
/** Clear of the board's own 14px padding, so a parked player never touches an edge. */
const MARGIN = 8;

export interface PipPoint {
  left: number;
  top: number;
}

/**
 * Pull a point back inside the window.
 *
 * Applied on read as well as on write, because the position outlives the
 * viewport that produced it: the player was parked bottom-right at 3440x1440,
 * Chrome opens narrower after a reboot, and a stored 3100px left would put the
 * player somewhere you can never reach it — with no way back except clearing
 * localStorage.
 */
export function clampPip(point: PipPoint, width: number, height: number): PipPoint {
  const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN);
  const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);
  return {
    left: Math.min(Math.max(point.left, MARGIN), maxLeft),
    top: Math.min(Math.max(point.top, MARGIN), maxTop),
  };
}

export function readPip(): PipPoint | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PipPoint>;
    if (typeof value?.left !== "number" || typeof value?.top !== "number") return null;
    if (!Number.isFinite(value.left) || !Number.isFinite(value.top)) return null;
    return { left: value.left, top: value.top };
  } catch {
    return null;
  }
}

/* ---- how big it was made ------------------------------------------------ */

/** The corner player's own width bounds. Its height follows at 16:9 plus the bar. */
export const PIP_MIN_WIDTH = 280;
const WIDTH_KEY = "dayboard.watch.pipwidth";

/** Picture at 16:9, the 44px bar and a 1px border top and bottom. */
export function pipHeightFor(width: number): number {
  return Math.round((width * 9) / 16) + 46;
}

/**
 * The widest a corner player at `point` may be: no wider than 60% of the
 * window, and small enough that its right and bottom edges stay on screen.
 */
export function maxPipWidth(point: PipPoint): number {
  const byWidth = window.innerWidth - point.left - MARGIN;
  const byHeight = ((window.innerHeight - point.top - MARGIN - 46) * 16) / 9;
  return Math.max(PIP_MIN_WIDTH, Math.floor(Math.min(window.innerWidth * 0.6, byWidth, byHeight)));
}

export function readPipWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value >= PIP_MIN_WIDTH ? value : null;
  } catch {
    return null;
  }
}

function writePipWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Resizes fine, forgets on reload.
  }
}

/* ---- whether it was muted ----------------------------------------------- */

const MUTED_KEYS = { main: "dayboard.watch.muted", stream: "dayboard.watch.muted.stream" } as const;

/**
 * Which thing you muted, per lane.
 *
 * Remembered against the thing itself (a video id, a channel, a page), so a
 * reload or a deploy brings a muted Twitch stream back muted, and picking
 * something new starts with sound.
 */
export function recallMuted(key: string, lane: PipLane = "main"): boolean {
  try {
    return localStorage.getItem(MUTED_KEYS[lane]) === key;
  } catch {
    return false;
  }
}

export function rememberMuted(key: string, muted: boolean, lane: PipLane = "main"): void {
  try {
    if (muted) localStorage.setItem(MUTED_KEYS[lane], key);
    else if (localStorage.getItem(MUTED_KEYS[lane]) === key) localStorage.removeItem(MUTED_KEYS[lane]);
  } catch {
    // Nothing to remember with.
  }
}

function writePip(point: PipPoint): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(point));
  } catch {
    // A private window drags fine and forgets on reload.
  }
}

/* ---- the store both players read ---------------------------------------- */

export interface Corner {
  /** Where it was parked, or null for the CSS corner. */
  point: PipPoint | null;
  /** How wide it was made, or null for the CSS default. */
  width: number | null;
}

const listeners = new Set<() => void>();
/** A drag or resize in progress: shown to both players, written to storage on release. */
let live: Corner | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function snapshot(): string {
  return JSON.stringify(live ?? { point: readPip(), width: readPipWidth() });
}

/** Move or resize the corner for both players, without writing it down yet. */
export function previewCorner(corner: Corner): void {
  live = corner;
  emit();
}

/** Keep it. Written once on release: a drag is hundreds of pointer events. */
export function commitCorner(corner: Corner): void {
  live = null;
  if (corner.point) writePip(corner.point);
  if (corner.width) writePipWidth(corner.width);
  emit();
}

export function useCorner(): Corner {
  // The server has no storage and renders no corner player, so its snapshot is
  // simply "nothing parked".
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  return useMemo(() => {
    if (!raw) return { point: null, width: null };
    try {
      return JSON.parse(raw) as Corner;
    } catch {
      return { point: null, width: null };
    }
  }, [raw]);
}

/** The CSS corner player's width: clamp(280px, 22vw, 420px). */
export function defaultPipWidth(): number {
  return Math.min(420, Math.max(PIP_MIN_WIDTH, window.innerWidth * 0.22));
}

/** Where the CSS corner puts a player of this size: 14px in, clear of the tab row. */
export function defaultCornerPoint(width: number, height: number): PipPoint {
  return { left: window.innerWidth - 14 - width, top: window.innerHeight - (14 + 57 + 9) - height };
}
