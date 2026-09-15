"use client";

import { useSyncExternalStore } from "react";

/**
 * One ticking clock, shared by everything on the board that counts.
 *
 * The board refreshes every thirty seconds, but two things on it have to move in
 * between: the "updated 2m ago" label, and the minutes-to-arrival on the train
 * tiles. Both are the same shape — read the board clock, re-render — and both are
 * wrong to write as `setState` in an effect, so they share this.
 *
 * The snapshot IS the bucket, not the timestamp. That keeps render pure (a
 * component never reads the clock itself), and it means a re-render only happens
 * when the bucket actually turns over rather than on every tick of a timer.
 *
 * The server snapshot is 0, which is a sentinel, not a time: it means "there is
 * no clock here". Callers branch on it to render whatever was true at build
 * time, so SSR and first paint agree and hydration doesn't mismatch. React swaps
 * in the real snapshot immediately after.
 *
 * Timers are shared per bucket size and torn down when the last listener leaves,
 * so a board with four train tiles and a freshness label runs two intervals, not
 * five.
 */

const timers = new Map<
  number,
  { listeners: Set<() => void>; handle: ReturnType<typeof setInterval> | null }
>();

/** Stable per bucket size — useSyncExternalStore resubscribes if this changes. */
const subscribers = new Map<number, (callback: () => void) => () => void>();

function subscriberFor(bucketMs: number) {
  let subscribe = subscribers.get(bucketMs);
  if (subscribe) return subscribe;

  subscribe = (callback: () => void) => {
    let entry = timers.get(bucketMs);
    if (!entry) {
      entry = { listeners: new Set(), handle: null };
      timers.set(bucketMs, entry);
    }
    entry.listeners.add(callback);
    if (!entry.handle) {
      entry.handle = setInterval(() => {
        for (const listener of entry!.listeners) listener();
      }, bucketMs);
    }
    return () => {
      entry!.listeners.delete(callback);
      if (!entry!.listeners.size && entry!.handle) {
        clearInterval(entry!.handle);
        entry!.handle = null;
      }
    };
  };
  subscribers.set(bucketMs, subscribe);
  return subscribe;
}

const snapshots = new Map<number, () => number>();

function snapshotFor(bucketMs: number) {
  let snapshot = snapshots.get(bucketMs);
  if (!snapshot) {
    snapshot = () => Math.floor(Date.now() / bucketMs);
    snapshots.set(bucketMs, snapshot);
  }
  return snapshot;
}

const serverSnapshot = () => 0;

/**
 * The current time floored to `bucketMs`, as a bucket index. 0 on the server and
 * during hydration — see above.
 */
export function useClockBucket(bucketMs: number): number {
  return useSyncExternalStore(
    subscriberFor(bucketMs),
    snapshotFor(bucketMs),
    serverSnapshot,
  );
}
