"use client";

import { useSyncExternalStore } from "react";
import type { EyeClock } from "@/lib/health";

/**
 * Where the eye break is, for anyone outside the Health tab.
 *
 * EyeBreak.tsx keeps its position in a ref on purpose: counting draws nothing
 * inside that tab, and a five-second tick that re-rendered the panel would be
 * five seconds of work for an unchanged screen. But the Quick row in the left
 * stack wants exactly that number — "12:04 until the next one" is the only way
 * to tell a feature that is working from one that quietly stood down hours ago,
 * which is the complaint that started this.
 *
 * So the position is published here instead: a module-scope store, the same
 * shape as tab-status.ts, and for the same reason NO localStorage. This is
 * live state about right now. A countdown restored from a previous page load
 * would be a confident lie about a clock that is no longer running.
 *
 * The value carries deadlines (`nextAt`, `endsAt`), never remainders, so a
 * consumer ticking its own clock subtracts `now` itself and cannot drift
 * against the five-second tick that produced it.
 */

const listeners = new Set<() => void>();

// A stable reference, or useSyncExternalStore re-renders forever. It is also
// the honest server snapshot: no browser, no clock, nothing counting.
const OFF: EyeClock = { phase: "off", reason: "idle" };
let clock: EyeClock = OFF;

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function same(a: EyeClock, b: EyeClock): boolean {
  if (a.phase !== b.phase) return false;
  if (a.phase === "off" && b.phase === "off") return a.reason === b.reason;
  if (a.phase === "counting" && b.phase === "counting") return a.nextAt === b.nextAt;
  if ((a.phase === "warning" || a.phase === "breaking") && "endsAt" in b) return a.endsAt === b.endsAt;
  return false;
}

export function publishEye(next: EyeClock) {
  if (same(clock, next)) return; // no wake-up for an unchanged position
  clock = next;
  for (const listener of listeners) listener();
}

function read(): EyeClock {
  return clock;
}

function none(): EyeClock {
  return OFF;
}

export function useEyeClock(): EyeClock {
  return useSyncExternalStore(subscribe, read, none);
}
