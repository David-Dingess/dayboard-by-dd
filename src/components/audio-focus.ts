"use client";

import { useSyncExternalStore } from "react";

/**
 * Which of the two players you hear when both are unmuted.
 *
 * THE ONE ON THE BIG SCREEN. With a match and a Twitch stream both on, the one
 * docked in the panel is the one being watched, and the corner player is there
 * to glance at. So while both are unmuted, the corner one is silenced — without
 * touching its own mute button, which keeps saying what you chose.
 *
 * "The big screen" is the player most recently docked or filled, not merely the
 * one docked right now: go from Sports to the calendar and both players are in
 * the corner, but the match was the one being watched a moment ago and it keeps
 * the sound. If that player is muted by hand, or closed, the other one sounds.
 *
 * Pressing the speaker on a silenced player hands it the sound: it becomes the
 * one you hear, and the other goes quiet.
 *
 * A module store rather than React context, for the same reason as the panel
 * tabs: the two players sit at the top of the tree and never share a parent
 * worth threading props through.
 */

export type AudioLane = "main" | "stream";

interface LaneAudio {
  /** Something is loaded in this lane. */
  present: boolean;
  /** Its own mute button is on. */
  muted: boolean;
}

const lanes: Record<AudioLane, LaneAudio> = {
  main: { present: false, muted: false },
  stream: { present: false, muted: false },
};

let focus: AudioLane | null = null;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function publishLane(lane: AudioLane, present: boolean, muted: boolean): void {
  const was = lanes[lane];
  if (was.present === present && was.muted === muted) return;
  lanes[lane] = { present, muted };
  emit();
}

/** This lane is on the big screen now, or was asked to be heard. */
export function takeFocus(lane: AudioLane): void {
  if (focus === lane) return;
  focus = lane;
  emit();
}

/** Pure, for the tests: whether `lane` should be silent given the whole picture. */
export function silencedGiven(
  lane: AudioLane,
  state: Record<AudioLane, LaneAudio>,
  focused: AudioLane | null,
): boolean {
  if (focused === null || focused === lane) return false;
  const other = state[focused];
  return other.present && !other.muted;
}

export function isSilenced(lane: AudioLane): boolean {
  return silencedGiven(lane, lanes, focus);
}

export function useSilenced(lane: AudioLane): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isSilenced(lane),
    () => false,
  );
}
