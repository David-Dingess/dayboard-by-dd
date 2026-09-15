"use client";

import { useEffect } from "react";
import { selectTab } from "@/components/Panel";
import { anythingPlaying } from "@/components/watching";

/**
 * Brings the Watch tab forward when a game kicks off. Once.
 *
 * The tab appears on its own when something is on. The tab
 * also pulses — see the `alert` flag in page.tsx — but a pulse is a suggestion
 * and a kickoff is a deadline, so this goes one step further and switches the
 * panel for you.
 *
 * IT HAS TO BE ONCE PER FIXTURE, and that is the whole reason this is a
 * component rather than three lines somewhere. The board re-renders every thirty
 * seconds; without a record, every one of those ticks would drag the panel back
 * off the calendar you had just chosen. The fixture id goes in localStorage, so
 * the switch survives being overruled — you can go straight back to the calendar
 * and stay there.
 *
 * It also never interrupts something already playing. Pulling a video you picked
 * off the screen to announce a game you did not is the one behaviour that would
 * make this feature something to turn off.
 *
 * WHY THE WATCH TAB PULSES AT ALL, when TwitchWidget records that you did not
 * want a stream going live to pulse: those are different things. A streamer
 * coming online is an invitation with no clock on it. A kickoff has a clock, and
 * missing the first twenty minutes is the thing the tab exists to save you from.
 */

const ANNOUNCED = "dayboard.watch.announced";

export function WatchAlert({
  fixtureId,
  tab = "watch",
}: {
  fixtureId: string | null;
  /** Sports for a team's match, Watch for anything else that kicks off. */
  tab?: string;
}) {
  useEffect(() => {
    if (!fixtureId) return;
    try {
      if (localStorage.getItem(ANNOUNCED) === fixtureId) return;
      localStorage.setItem(ANNOUNCED, fixtureId);
      // Said its piece. Even if the panel is busy, this game does not get to ask
      // again on the next tick.
      if (anythingPlaying()) return;
    } catch {
      return;
    }
    selectTab("center", tab);
  }, [fixtureId, tab]);

  return null;
}
