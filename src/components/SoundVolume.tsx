"use client";

import { useSyncExternalStore } from "react";
import {
  getSoundVolume,
  primeAudio,
  setSoundVolume,
  sounds,
  subscribeVolume,
} from "@/components/health/beeps";

/**
 * The board's master volume, on the controls row beside the clock and the mixer.
 *
 * One knob over everything the board synthesises — ticks, interval tones, the
 * nudge and its takeover, the eye chimes, the Discord doorbell — and nothing it
 * does not: the videos and the music play through their own outputs and are not
 * this slider's business. The value lives in localStorage (see beeps.ts), so
 * this is board-local and needs no gate: a phone looking at the board sets its
 * own speaker, which is the honest thing for a per-device volume.
 *
 * SEEDED ON THE CLIENT, not at render. Reading localStorage during the server
 * render would hydrate one value and then correct to another; starting at 100
 * and syncing in an effect keeps the first paint matching the server's.
 *
 * A tap of the nudge on release, so the level you just set is the level you
 * hear — and priming first, because the board may not have been touched since it
 * booted and a suspended context would swallow the preview.
 */
export function SoundVolume() {
  // Read through the store: full on the server, the board's real level once
  // hydrated, with no effect seeding state. See beeps.ts subscribeVolume.
  const volume = useSyncExternalStore(subscribeVolume, getSoundVolume, () => 1);
  const pct = Math.round(volume * 100);

  const preview = () => {
    primeAudio();
    sounds.nudge();
  };

  return (
    <li className="quick-item is-volume">
      <span className="quick-label">
        <VolumeIcon />
        Volume
      </span>
      <input
        className="quick-volume"
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        aria-label="dashboard sound volume"
        onChange={(e) => setSoundVolume(Number(e.target.value) / 100)}
        onPointerUp={preview}
        onKeyUp={preview}
      />
    </li>
  );
}

/* A speaker and one arc, to the same rules as EyeIcon and NudgeIcon: a 16-unit
   box, currentColor, 1.6 stroke, no fill. */
function VolumeIcon() {
  return (
    <svg className="quick-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M8.5 2.5 4.8 5.5H2.2v5h2.6l3.7 3V2.5Z" />
      <path d="M11 5.5a3.4 3.4 0 0 1 0 5" />
    </svg>
  );
}
