"use client";

import { useSyncExternalStore } from "react";

/**
 * Which pulsing tabs have been looked at.
 *
 * A tab pulses green for "new, and you have not dealt with it". Hiding it only
 * while you are ON that tab was not enough: the Watch tab alerts for as long as
 * a game is live, so every time you looked at something else it started nagging
 * again about the thing you had just watched. Opening it IS dealing with it.
 *
 * So: selecting a tab that is pulsing acknowledges it, and it stays quiet until
 * the alert actually goes away and comes back. Edge-triggered, not timed — a
 * second game kicking off later is genuinely new and says so, while the one you
 * already saw does not get to ask twice.
 *
 * The tile inside the widget keeps its own green marker. That one is about a
 * video, and it is cleared by watching the video, not by glancing at the tab.
 *
 * MODULE SCOPE, NOT localStorage, for the reason tab-status.ts gives: this is
 * state about right now. The board refreshes itself every thirty seconds without
 * remounting, so an acknowledgement outlives every tick it needs to; a full
 * reload is a fresh look at the board and may as well start over.
 */

const listeners = new Set<() => void>();
let acked: Record<string, true> = {};

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function emit() {
  // A new object identity each time, or useSyncExternalStore keeps the old one.
  acked = { ...acked };
  for (const listener of listeners) listener();
}

export const ackKey = (side: string, tabId: string) => `${side}:${tabId}`;

export function ackTab(key: string) {
  if (acked[key]) return;
  acked[key] = true;
  emit();
}

/** The alert went away, so the next one is worth hearing about. */
export function clearAck(key: string) {
  if (!acked[key]) return;
  delete acked[key];
  emit();
}

export function useAcks(): Record<string, true> {
  return useSyncExternalStore(
    subscribe,
    () => acked,
    // Nothing is acknowledged on the server, and nothing is pulsing there
    // either, so this matches what it renders.
    () => EMPTY,
  );
}

const EMPTY: Record<string, true> = {};
