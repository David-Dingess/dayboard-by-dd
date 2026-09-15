"use client";

import { useSyncExternalStore } from "react";
import { audioUrl, type AudioState } from "@/lib/vitals";

/**
 * The machine's mixer, in one place, because two things now draw it.
 *
 * These buttons have moved twice: the Computer tab, then the player bar, then
 * the Quick row at the bottom of the left stack, where they are now and where
 * they stay — the bar does not exist when nothing is playing, so for most of the
 * day the board had no output control at all.
 *
 * It is a store rather than component state because a second consumer is always
 * one request away, and TWO COPIES WOULD DISAGREE THE MOMENT EITHER IS CLICKED:
 * whichever one was not pressed keeps drawing the old state until its next
 * visibility change, which is the board telling you two different things about
 * one machine. One POST, one response, everything redraws.
 *
 * NOT localStorage, for the same reason as tab-status.ts: this is live state
 * about a mixer that is running right now. A remembered value would be a
 * confident lie about a machine whose audio has since moved.
 *
 * The GET happens once, on the first mount, and again whenever the tab comes
 * back to the front. There is no polling — the POST response carries every
 * change the board makes, and Voicemeeter's own window is the only other
 * writer.
 */

const listeners = new Set<() => void>();
let audio: AudioState | null = null;
let started = false;

function subscribe(callback: () => void) {
  listeners.add(callback);
  // The first subscriber arms the fetch; the rest just join. Deliberately here
  // rather than in an effect: whichever component mounts first should not be the
  // one that owns the request.
  if (!started) {
    started = true;
    void refreshAudio();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refreshAudio();
    });
    // AND A POLL, BECAUSE ON THE BOARD NOTHING ELSE EVER ASKS AGAIN.
    //
    // The fetch above runs once, and the only other trigger was a tab becoming
    // visible — which never happens to a board that is fullscreen and never
    // hidden. So a single failure at load was permanent: the agent dot sat red
    // and the mixer stayed missing until somebody reloaded the page by hand.
    //
    // That is not an edge case here. The server and the agent are separate
    // scheduled tasks with no ordering between them, so after a reboot the board
    // can easily render before the agent has answered once — and the agent is
    // also restarted on its own whenever it is rebuilt. Thirty seconds matches
    // AutoRefresh, and the request is a loopback GET.
    setInterval(() => void refreshAudio(), 30_000);
  }
  return () => {
    listeners.delete(callback);
  };
}

function publish(next: AudioState | null) {
  audio = next;
  for (const listener of listeners) listener();
}

export async function refreshAudio(): Promise<void> {
  try {
    const res = await fetch(audioUrl(), { cache: "no-store" });
    publish((await res.json()) as AudioState);
  } catch {
    // No agent on this machine, or it is not running. Say nothing rather than
    // drawing controls that cannot work.
    publish(null);
  }
}

/**
 * One change, and the new truth. The agent answers a POST with the snapshot
 * after the change rather than an acknowledgement, so there is no optimistic
 * update here and therefore no flicker back when a switch is refused.
 */
export async function postAudio(body: Record<string, string>): Promise<void> {
  try {
    const res = await fetch(audioUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) return; // an older agent without this route: keep what we had
    publish((await res.json()) as AudioState);
  } catch {
    // Leave the last known state up: it is still the best answer anyone has,
    // and the next visibility change re-reads it.
  }
}

function read(): AudioState | null {
  return audio;
}

// Stable, or useSyncExternalStore re-renders forever. The server has no mixer.
function none(): AudioState | null {
  return null;
}

export function useAudioState(): AudioState | null {
  return useSyncExternalStore(subscribe, read, none);
}
