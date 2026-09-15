"use client";

import { useSyncExternalStore } from "react";

/**
 * To-dos that have been typed but are not on disk yet.
 *
 * The quick-add box and the tile list are in two different rows of the Notes /
 * To-Do grid — the box has to sit outside the scroller and the tiles have to sit
 * inside it — so they never meet in the tree and cannot share state through a
 * prop. They meet here instead, through a store, exactly the way `Panel` lets a
 * tile in the right column switch the centre panel.
 *
 * Why bother at all: adding a to-do writes a file AND revalidates the whole
 * board, which is a few hundred milliseconds. That is a long time to stare at a
 * box that just ate what you typed, and a capture box you distrust is a capture
 * box you stop using. So the text goes up as a ghost tile immediately and is
 * dropped the moment the real one arrives.
 *
 * Not localStorage, unlike the board's other three stores: this is in-flight
 * state, and an entry surviving a reload would be a ghost of something that was
 * never saved. Module scope is exactly the right lifetime.
 */

const listeners = new Set<() => void>();
let pending: string[] = [];

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function read(): string[] {
  return pending;
}

// The server renders no ghosts. A stable reference, or useSyncExternalStore
// re-renders forever.
const NONE: string[] = [];
function none(): string[] {
  return NONE;
}

function announce() {
  for (const listener of listeners) listener();
}

export function addPending(text: string) {
  pending = [...pending, text];
  announce();
}

export function clearPending(text: string) {
  const at = pending.indexOf(text);
  if (at === -1) return;
  pending = [...pending.slice(0, at), ...pending.slice(at + 1)];
  announce();
}

export function usePendingTodos(): string[] {
  return useSyncExternalStore(subscribe, read, none);
}
