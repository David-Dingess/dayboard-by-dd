"use client";

import type { Watching } from "@/components/watching";

/**
 * What to play after this one — published by the list that knows the order, read
 * by the player that has no props.
 *
 * VideoList already has it: the list as rendered, newest first and already
 * short — the cleared ones were filtered out on the server. WatchPlayer is
 * deliberately propless and mounted outside every panel, so the two never meet
 * in the tree. They meet here instead, the way watching and the panel selection
 * already do.
 *
 * NO SUBSCRIBERS, AND SO NO STORE. Every other module-level store on this board
 * is read during render and therefore needs useSyncExternalStore and a listener
 * set. This one is read exactly once, imperatively, inside the callback that
 * fires when a video ends — nothing renders from it. A plain module variable is
 * the whole mechanism, which also means republishing on every AutoRefresh tick
 * costs nothing and cannot loop.
 *
 * NOT PERSISTED. It is a view of the last server render; a stored copy could
 * only ever disagree with the render it came from.
 *
 * IT NO LONGER HAS A "NOT KNOWN YET" STATE. While the cleared list lived in
 * localStorage, publishing before that had been read would have handed the
 * player videos you had already seen, so this held null until the list was
 * sure. The server filters now, so the first published list is already the right
 * one and empty means empty.
 */

let queue: Watching[] = [];

export function publishQueue(next: Watching[]) {
  queue = next;
}

/**
 * What follows `key` in the list as it stands right now.
 *
 * Null at the end, null before this list has mounted, and null for a key that
 * is not in it at all — a pasted URL or a stream. That last case is deliberate:
 * finishing something that was never part of the queue should not start the
 * queue, or every stray link would end in the subscriptions feed.
 */
export function nextAfter(key: string): Watching | null {
  const at = queue.findIndex((item) => item.key === key);
  if (at < 0) return null;
  return queue[at + 1] ?? null;
}
