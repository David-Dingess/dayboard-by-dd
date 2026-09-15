"use client";

/**
 * "Start this" — pressed on an agenda row, answered by the Health tab.
 *
 * The Planner and the Health widget are in different panels and never meet in
 * the tree, so they meet here instead, the way a video tile and the player meet
 * through `watching.ts`. localStorage rather than a module variable because the
 * two are separate concerns as far as either is concerned, and because a `storage`
 * event makes a second window of the board behave the same way.
 *
 * IT IS A REQUEST, NOT A MODE. Whoever acts on it clears it immediately, and
 * anything older than a minute is ignored — a stale key must never be able to
 * throw the board into a workout the next morning.
 *
 * Deliberately NOT a `useSyncExternalStore` hook: acting on this means changing
 * a view, and a render-phase subscription would mean doing that from an effect.
 * A plain subscription hands the callback the moment the write happens instead,
 * which is where a side effect belongs.
 */

const KEY = "dayboard.health.start";
const STALE_MS = 60_000;

export interface StartRequest {
  /** The session's date, so a row for tomorrow cannot start today's. */
  date: string;
  at: number;
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeStart(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/** The pending request, if there is a fresh one. Reading it does not clear it. */
export function readStart(now = Date.now()): StartRequest | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StartRequest;
    if (!parsed?.date || typeof parsed.at !== "number") return null;
    if (now - parsed.at > STALE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function requestStart(date: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ date, at: Date.now() } satisfies StartRequest));
  } catch {
    // A private window loses the handoff; the tab still comes forward.
  }
  notify();
}

export function clearStart() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
  notify();
}
