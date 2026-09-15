"use client";

import { useSyncExternalStore } from "react";
import type { SlotRoute } from "@/lib/health";

/**
 * The nudge that is currently waiting to be answered.
 *
 * Written by HealthAlert, which is mounted at the top of the board and runs the
 * clock; read by the Health tab, which draws the banner. They never meet in the
 * tree — the same problem `watching.ts` solves for the player, solved the same
 * way, and for the same reason it is in localStorage rather than a module
 * variable: a nudge that fired at 4:30 should still be waiting after a reload at
 * 4:40, because the session has still not been done.
 */

const KEY = "dayboard.health.due";

export interface HealthDue {
  slotId: string;
  title: string;
  body: string;
  route: SlotRoute;
  /** Epoch ms, so a stale one can be dropped. */
  at: number;
}

/** Six hours. Long past the point where "you have not done today's session" is news. */
const STALE_MS = 6 * 60 * 60 * 1000;

/**
 * When this tab loaded, taken once at module scope — reading the clock during a
 * render is neither pure nor allowed here. The same trick, for the same reason,
 * as watching.ts. It makes the cutoff "six hours before this page opened", which
 * for a banner about today is the same answer.
 */
const PAGE_LOADED_AT = Date.now();

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  // Another tab of the same board answering a nudge should clear it here too.
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const unknown = () => null;

export function writeDue(due: HealthDue) {
  try {
    localStorage.setItem(KEY, JSON.stringify(due));
  } catch {
    // A private window loses the banner on reload and nothing else.
  }
  notify();
}

export function clearDue() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
  notify();
}

/**
 * Subscribe to the store directly, for a consumer that has to react to the
 * ARRIVAL of a nudge rather than render its presence.
 *
 * The takeover needs the edge, not the state: a due sits there until it is
 * answered, so anything driven off the rendered value would fire again on every
 * refresh tick. Same shape as `subscribeStart` — a store notification, so the
 * setState happens in a callback rather than in an effect body.
 */
export function subscribeDue(onChange: (due: HealthDue | null) => void): () => void {
  return subscribe(() => onChange(currentDue()));
}

/** The parsed value, for callers outside a render. */
export function currentDue(): HealthDue | null {
  return parseDue(read());
}

function parseDue(raw: string | null): HealthDue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as HealthDue;
    if (!parsed?.slotId || typeof parsed.at !== "number") return null;
    if (parsed.at < PAGE_LOADED_AT - STALE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function useDue(): HealthDue | null {
  return parseDue(useSyncExternalStore(subscribe, read, unknown));
}
