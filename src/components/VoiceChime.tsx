"use client";

import { useEffect, useRef } from "react";
import { primeAudio, sounds } from "@/components/health/beeps";

/**
 * A bell when somebody joins a call you are not in.
 *
 * ONLY ON THE EDGE, and only in that direction. The board re-renders every
 * thirty seconds, so "somebody is in there" is true on every tick for as long as
 * the call lasts — ringing on the state rather than on the change would be a
 * bell every half minute until they hang up. This fires on the transition from
 * nobody-calling to somebody-calling and then stays quiet.
 *
 * IT DOES NOT RING ON ARRIVAL. The first render seeds the ref rather than
 * comparing against it, so opening the board onto a call that has been running
 * for an hour is silent. The thing worth hearing is somebody turning up, not
 * the fact that they are there.
 *
 * And never while you are already in the channel — `calling` is false then, by
 * the same rule that makes the panel red-and-still instead of green-and-pulsing.
 * There is nothing to call you over to.
 *
 * MOUNT IT UNCONDITIONALLY. The edge this watches is nobody→somebody, which is
 * exactly the render where a conditionally-mounted copy would first appear —
 * and a first render seeds the ref instead of ringing, so a copy that only
 * exists while a call is live can never catch a call starting. It must sit at a
 * fixed spot in the tree that survives the empty state, the same discipline
 * HealthAlert and WatchAlert keep, so the false it sees between calls is what
 * makes the next true an edge. See DiscordWidget, which renders one of these
 * above the roster rather than one per occupied channel.
 */
export function VoiceChime({ calling, enabled }: { calling: boolean; enabled: boolean }) {
  // undefined means "we have not seen a render yet", which is different from
  // false and is what keeps the page-load case silent.
  const was = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    const previous = was.current;
    was.current = calling;
    if (previous === undefined || !enabled) return;
    if (calling && !previous) {
      // Prime first: on a board nobody has clicked the AudioContext is
      // suspended and drops the note silently, the same guard HealthAlert runs
      // before a nudge. It costs nothing when the context is already running.
      primeAudio();
      sounds.voice();
    }
  }, [calling, enabled]);

  return null;
}
