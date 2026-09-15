"use client";

import { useState } from "react";
import { postAudio, useAudioState } from "@/components/audio-state";

/**
 * Mute, where the sound comes out, and the microphone — always on the board,
 * not only while something is playing.
 *
 * They lived on the player bar for a while, which was a good argument — you
 * switch to headphones because of what is playing — and a bad location: the bar
 * is part of the player, and the player is not on screen most of the day, so
 * most of the day the board could not move its own sound. Here they are always
 * there, so the bar's copies were deleted rather than left as a second set of
 * buttons for the same three facts.
 *
 * MUTE IS NOT A THIRD OUTPUT. `output` picks a room; mute silences whichever
 * room was picked, and the agent remembers which it was so unmuting puts the
 * sound back where it came from rather than defaulting to headphones.
 *
 * THERE WAS A MICROPHONE BUTTON HERE AND IT IS GONE. Muting the mic honestly
 * meant muting Windows capture endpoints, because Voicemeeter's own strip mute
 * only reaches an app listening to that strip — and once it worked it still did
 * not do what was wanted, which was Discord's own mute. Two mechanisms, three
 * places a mute could live, and a button whose state depended on which app you
 * asked. A Stream Deck key already does the thing meant. Removed rather than
 * kept as an approximation.
 */

function HeadphonesIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      {/* Band over the top, and a cup each side. Deliberately not another cone:
          this sits one button away from the video's own mute speaker. */}
      <path d="M3.2 10V8a4.8 4.8 0 0 1 9.6 0v2" />
      <rect x="1.9" y="9.4" width="2.8" height="4.2" rx="1.2" />
      <rect x="11.3" y="9.4" width="2.8" height="4.2" rx="1.2" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      {/* A box on a desk with two drivers — a shape, not a volume glyph. */}
      <rect x="3.4" y="1.9" width="9.2" height="12.2" rx="1.4" />
      <circle cx="8" cy="10.2" r="2.1" />
      <circle cx="8" cy="5" r="1" />
    </svg>
  );
}


function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M8.6 2.4 4.9 5.3H2.3v5.4h2.6l3.7 2.9z" />
      {muted ? (
        <path d="M11.2 6.2 14.4 9.8M14.4 6.2 11.2 9.8" />
      ) : (
        <>
          <path d="M11.4 6.1a2.7 2.7 0 0 1 0 3.8" />
          <path d="M13.2 4.4a5.2 5.2 0 0 1 0 7.2" />
        </>
      )}
    </svg>
  );
}

export function AudioQuick() {
  const audio = useAudioState();
  const [busy, setBusy] = useState(false);

  const post = async (body: Record<string, string>) => {
    setBusy(true);
    await postAudio(body);
    setBusy(false);
  };

  // No agent, or Voicemeeter's window is closed. Say which rather than drawing
  // three dead buttons — this row is at the bottom of the stack where the
  // absence of a control is easy to misread as a bug in the board.
  if (!audio?.running) {
    return <span className="quick-value is-quiet">agent off</span>;
  }

  const muted = audio.live === "none";
  // What the icon SAYS it will do. The agent works the flip out for itself from
  // the live state — see below — so this is only ever a label.
  const target = audio.live === "headphones" ? "speakers" : "headphones";

  return (
    <span className="quick-acts">
      <button
        type="button"
        className="watchbtn"
        disabled={busy}
        aria-pressed={muted}
        onClick={() => void post({ mute: muted ? "off" : "on" })}
        aria-label={muted ? "Unmute the machine" : "Mute the machine"}
        title={muted ? "Muted — click to put the sound back" : "Mute everything"}
      >
        <MuteIcon muted={muted} />
      </button>

      {/* "toggle", not a computed target: this widget reads /audio on mount and
          on visibility and never polls, so after a change made in Voicemeeter's
          own window the icon here is stale — and an absolute target derived from
          a stale icon sends the sound to the room when you asked for headphones.
          The agent reads the live state a millisecond before it acts. */}
      <button
        type="button"
        className="watchbtn"
        disabled={busy || !audio[target]?.device}
        onClick={() => void post({ output: "toggle" })}
        aria-label={`Sound is on the ${audio.live}. Switch to the ${target}.`}
        title={
          audio[target]?.device
            ? `Switch to the ${target}`
            : `No ${target} output assigned in Voicemeeter`
        }
      >
        {audio.live === "speakers" ? <SpeakerIcon /> : <HeadphonesIcon />}
      </button>

    </span>
  );
}
