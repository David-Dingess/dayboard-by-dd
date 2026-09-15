"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { readPanelTab, selectTab } from "@/components/Panel";
import { setExpanded, writeWatching } from "@/components/watching";
import { refreshAudio } from "@/components/audio-state";
import { primeAudio } from "@/components/health/beeps";
import { reloadWhenBack } from "@/components/BoardHealth";
import type { DeckEvent } from "@/lib/deck";

/**
 * The Stream Deck's hands inside the page.
 *
 * Everything a key can ask for already had a function; none of them could be
 * reached from outside the browser. This component is the whole of that gap: it
 * holds one EventSource open to /api/deck/stream and calls the same exported
 * functions VideoList and StreamList call on a click. There is no new behaviour
 * here on purpose — a key press and a click land in exactly the same place, so
 * they cannot drift apart.
 *
 * PROPLESS AND MOUNTED AT THE TOP OF page.tsx, beside AutoRefresh and
 * WatchPlayer, for their reason: nothing server-derived to key on means the
 * refresh tick cannot remount it, and a remount here would drop the stream and
 * open a second one every thirty seconds.
 *
 * IT RECONNECTS ITSELF. EventSource retries on its own, but only for a clean
 * disconnect; a board that is up before the server is (they are separate
 * scheduled tasks with no ordering, the same race audio-state.ts describes) gets
 * an error instead, and the browser gives up. On a second monitor nobody reloads, so the
 * cost of not handling that is a deck that silently does nothing until somebody
 * notices. Hence the explicit backoff.
 */

/** First retry. Doubles to CAP_MS, so a server that is still booting is caught fast. */
const BASE_MS = 1000;
const CAP_MS = 30_000;

function apply(event: DeckEvent) {
  switch (event.type) {
    case "tab":
      selectTab(event.side, event.id);
      break;
    case "play": {
      // The same two calls, in the same order, as VideoList's onClick — or, for
      // a team's stream, as TeamTiles'. `at` is stamped now rather than by the
      // sender because that timestamp is what decides autoplay, and it means
      // "somebody asked for this a moment ago" — a clock on another process has no
      // business answering that.
      const home = event.kind === "stream" ? "sports" : "watch";
      writeWatching({
        kind: event.kind,
        key: event.key,
        title: event.title,
        channel: event.channel,
        href: event.href,
        at: Date.now(),
        origin: home,
      });
      selectTab("center", home);
      break;
    }
    case "reset":
      // The deck's reset key: the server restart already ran in the route, so
      // this is only the half BoardReset does after it — wait, then reload.
      reloadWhenBack(event.restarted);
      break;
    case "expand":
      // Whichever player is docked in the tab on screen: the Sports tab's is
      // the stream window, every other tab's is the video.
      setExpanded(event.on, readPanelTab("center") === "sports" ? "stream" : "main");
      break;
    case "alerts":
      // The same two things AlertsPrompt's button does, in the same order.
      //
      // NO USER GESTURE HERE, AND IT STILL WORKS — for the audio half, which is
      // the half that keeps bringing the banner back. The board's Chrome carries
      // --autoplay-policy=no-user-gesture-required (scripts/_common.ps1), so
      // resuming the context off a network event is allowed on this display and
      // nowhere else. The banner re-checks every four seconds and takes itself
      // down.
      //
      // The notification grant is per-profile and permanent, so by the time this
      // key is worth pressing it has usually already been given. Asking for it
      // is attempted anyway and simply refused without a gesture, which costs
      // nothing and leaves the banner up to say so.
      primeAudio();
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => {
          // No gesture behind this one. Chrome says no; the banner stays.
        });
      }
      break;
    case "refresh-audio":
      // The mixer moved under us. audio-state.ts would find out within thirty
      // seconds anyway; this is so the icon is right before the finger leaves
      // the key.
      void refreshAudio();
      break;
  }
}

export function DeckBridge() {
  // The router in a ref, the same trick HealthAlert uses: the stream is opened
  // once in an effect with no deps, and reading router through a ref keeps that
  // effect from tearing the EventSource down and reopening it on every render.
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let wait = BASE_MS;
    let stopped = false;

    // Named events, not the default `message` one, so a frame is routed by its
    // name and the payload is only ever read for its fields. Every name gets the
    // same handler; the name is in the payload too.
    const onFrame = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as DeckEvent;
        // The one frame that is not a deck command: a writer somewhere said the
        // files moved, so pull the new render now rather than on the next tick.
        if (event.type === "refresh") routerRef.current.refresh();
        else apply(event);
      } catch {
        // A frame this build does not understand — a newer key against an older
        // board. Ignore it rather than tearing the stream down over it.
      }
    };

    const open = () => {
      if (stopped) return;
      source = new EventSource("/api/deck/stream");

      for (const kind of ["tab", "play", "expand", "alerts", "reset", "refresh-audio", "refresh"] as const) {
        source.addEventListener(kind, onFrame as EventListener);
      }

      source.onopen = () => {
        wait = BASE_MS;
      };

      source.onerror = () => {
        // EventSource may be retrying by itself here, so close first — otherwise
        // the reconnect below is a second stream, not a replacement.
        source?.close();
        source = null;
        if (stopped) return;
        retry = setTimeout(open, wait);
        wait = Math.min(wait * 2, CAP_MS);
      };
    };

    open();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, []);

  return null;
}
