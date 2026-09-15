"use client";

import { useEffect, useRef } from "react";
import { selectTab } from "@/components/Panel";
import { anythingPlaying } from "@/components/watching";
import { setTabStatus } from "@/components/tab-status";
import { primeAudio, sounds } from "@/components/health/beeps";
import { clearDue, currentDue, writeDue } from "@/components/health/health-due";
import { evaluateSlots, satisfied, todayKey, type FiredMarker } from "@/lib/health";
import type { HealthSettingsFile } from "@/lib/schema";

/**
 * The three daily nudges, run in the browser.
 *
 * In the standalone app this came from, this was a tray process with a
 * thirty-second timer; the same
 * decision logic is now in lib/health/slots.ts and this is the half that owns
 * the clock, the storage and the panel. It is a null component mounted beside
 * WatchAlert at the top of the board, which is deliberate for the same reason:
 * it must run whichever tab is showing, and it must survive the refresh tick
 * without remounting, so it sits at a fixed position in the tree with nothing
 * server-derived to key on.
 *
 * WHY THE MARKERS ARE IN localStorage. Which nudges have fired today is a fact
 * about this browser, not about the program — it belongs beside
 * `dayboard.watch.announced`, not in a file that is committed to git and read by
 * a CLI. It also means a remote copy of the board open on a phone cannot silence
 * the nudge on the machine you are actually sitting at.
 *
 * The order below is WatchAlert's, and load-bearing: the marker is written
 * before anything else can bail out, so a nudge that arrives while you are
 * mid-video is still recorded as having said its piece and does not ask again
 * on the next tick.
 */

const FIRED = "dayboard.health.fired";
const SNOOZE = "dayboard.health.snooze";
/** Slot times have minute resolution, so the clock is checked on the minute. */
const MINUTE_MS = 60_000;

type FiredMap = Record<string, Record<string, FiredMarker>>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private window nudges once per reload instead of once per day.
  }
}

export function HealthAlert({
  settings,
  today,
  logged,
  walked,
  chairAt,
}: {
  settings: HealthSettingsFile;
  today: string;
  logged: boolean;
  walked: boolean;
  /** NY minutes of day of today's finished chair routines. */
  chairAt: number[];
}) {
  // Props into a ref so the timer below is installed exactly once. A dependency
  // array holding `settings` would tear it down and build a new one on every
  // render, and a tick could fall through the gap.
  const props = useRef({ settings, today, logged, walked, chairAt });

  useEffect(() => {
    props.current = { settings, today, logged, walked, chairAt };
  }, [settings, today, logged, walked, chairAt]);

  useEffect(() => {
    const tick = () => {
      // NO VISIBILITY GATE. This used to return here unless the document was
      // visible, which is exactly backwards: Chrome reports a board sitting
      // behind another window as hidden, so the one time a nudge most needs to
      // reach you — you are working in something else and have forgotten — was
      // the one time it never fired at all, chime included. The clock runs
      // whatever is in front. Only the tab switch at the bottom still checks,
      // because reshuffling panels you cannot see helps nobody.
      const {
        settings: current,
        today: day,
        logged: didSession,
        walked: didWalk,
        chairAt: chairs,
      } = props.current;

      // The browser and the last render can disagree about the date for one tick
      // around midnight. Firing then would write a marker under the wrong day.
      if (todayKey() !== day) return;

      const fired = read<FiredMap>(FIRED, {});
      const snooze = read<{ slotId: string; fireAt: number } | null>(SNOOZE, null);

      const decision = evaluateSlots({
        settings: current,
        logged: didSession,
        walked: didWalk,
        chairAt: chairs,
        today: day,
        fired,
        snooze,
        now: new Date(),
      });

      if (decision.marks.length || decision.prune.length) {
        const next: FiredMap = { ...fired };
        for (const key of decision.prune) delete next[key];
        for (const mark of decision.marks) {
          next[mark.date] = { ...(next[mark.date] ?? {}), [mark.slotId]: mark.value };
        }
        write(FIRED, next);
      }
      if (decision.clearSnooze) write(SNOOZE, null);

      if (!decision.fire.length) {
        // Nothing to raise this tick. If a nudge fired earlier today but the
        // work it asked for is now done — a session logged from the CLI or the
        // Stream Deck, a walk finished without ever opening this tab — the
        // pulse has to stop even though nobody looked. HealthApp clears it on
        // view and on Start; this is the other half, clearing when the work
        // lands by any route rather than leaving the tab pulsing green over a
        // workout already done.
        const pending = current.slots.some(
          (slot) => fired[day]?.[slot.id] === "fired" && !satisfied(slot, didSession, didWalk, chairs),
        );
        if (!pending) {
          setTabStatus("health", "ok");
          if (currentDue()) clearDue();
        }
        return;
      }

      const first = decision.fire[0];
      writeDue({ ...first, at: Date.now() });
      setTabStatus("health", "alert");
      // primeAudio first: an AudioContext that was created before any gesture
      // sits suspended, and a suspended context drops the note silently rather
      // than erroring. Calling resume here costs nothing when it is already
      // running and is the difference between a chime and nothing at all on a
      // board nobody has clicked since it booted.
      if (current.soundEnabled) {
        primeAudio();
        sounds.nudge();
      }

      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          // One tag, so a second nudge replaces the first rather than stacking.
          new Notification(first.title, { body: first.body, tag: "dayboard-health" });
        }
      } catch {
        // Notifications are optional; the pulse and the chime are the real channel.
      }

      // Never interrupt something already playing — the rule WatchAlert keeps.
      // The nudge is still recorded, still pulsing, and still chimed.
      try {
        if (anythingPlaying()) return;
      } catch {
        return;
      }
      // Only worth doing if you are looking. Hidden, the tab keeps its pulse and
      // you land on it yourself.
      if (document.visibilityState === "visible") selectTab("center", "health");
    };

    // ALIGNED TO THE CLOCK, NOT TO WHENEVER THIS MOUNTED.
    //
    // A plain setInterval every 30s is anchored to mount time, so a slot at
    // 10:00 fired on the first tick at or after it — anywhere from 0 to 30
    // seconds late, 15 on average, and audibly so when the chime is what tells
    // you the time. Slot times have minute resolution, so there is nothing to
    // gain from checking twice a minute and nothing to lose by checking exactly
    // once, on the minute.
    //
    // Rescheduled from the clock each time rather than setInterval(60_000),
    // because an interval accumulates the drift of every late callback and would
    // wander back off the minute over a display that runs for weeks. The 250ms
    // lands just inside the new minute rather than racing the boundary.
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        tick();
        schedule();
      }, MINUTE_MS - (Date.now() % MINUTE_MS) + 250);
    };

    tick();
    schedule();
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
