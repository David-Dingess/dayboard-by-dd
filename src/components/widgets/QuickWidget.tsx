import { LiveClock } from "@/components/LiveClock";
import { AudioQuick } from "@/components/AudioQuick";
import { SoundVolume } from "@/components/SoundVolume";
import { Nudges } from "@/components/Nudges";
import { BoardHealth, BoardReset } from "@/components/BoardHealth";
import { todoGate } from "@/lib/todo-actions";
import { EyeCountdown } from "@/components/health/EyeCountdown";
import { clockLabel, todayLocal } from "@/lib/time";
import { firesOn, minutesOfDay, formatTime, nowMinutes } from "@/lib/health";
import type { HealthSettingsFile } from "@/lib/schema";


/*
 * Two line icons, drawn to the same rules as the player bar's: a 16-unit box,
 * currentColor, 1.6 stroke, no fill. They sit inside the label rather than
 * beside the value, so the row still reads as label-over-number.
 */
function EyeIcon() {
  return (
    <svg className="quick-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M1.4 8s2.5-4.2 6.6-4.2S14.6 8 14.6 8s-2.5 4.2-6.6 4.2S1.4 8 1.4 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}

function NudgeIcon() {
  return (
    <svg className="quick-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      {/* A finger doing the poking, and two lines for the poke itself. */}
      <path d="M6.4 8.2V3.6a1.2 1.2 0 0 1 2.4 0v3.2" />
      <path d="M8.8 7.4a1.1 1.1 0 0 1 2.2 0v.8" />
      <path d="M11 8.2a1.1 1.1 0 0 1 2.2 0v2.2a3.4 3.4 0 0 1-3.4 3.4H8.5a3.2 3.2 0 0 1-2.5-1.2L3.6 9.8a1.2 1.2 0 0 1 1.9-1.4l.9 1.1" />
    </svg>
  );
}

/**
 * The bottom of the stack: the half-dozen things worth a glance and nothing
 * worth a click.
 *
 * IT IS TITLE-LESS, like the rest of the stack. You can tell a clock from a
 * weather panel without being told, and a label above four numbers would cost
 * more height than any of them.
 *
 * THE AUDIO BUTTONS ARE HERE AND NOWHERE ELSE. They spent a while on the player
 * bar, which reads well until you notice the bar does not exist when nothing is
 * playing — so for most of the day the board could not move its own sound. This
 * row is always on screen, so the bar's pair were deleted rather than kept as a
 * second set of buttons for one mixer.
 *
 * SUNSET USED TO BE HERE and is not any more. The weather panel grew a daylight
 * bar — the whole day as six pixels, with sunrise and sunset written at its two
 * ends — which answers "how much light is left" better than one time on its own
 * ever did, and answers it a foot higher up the same column. Two places saying
 * it was one too many.
 *
 * The one server-computed item left is free: the settings arrive as a prop from
 * the read page.tsx already does for the nudge tick.
 */
export async function QuickWidget({ settings }: { settings: HealthSettingsFile }) {
  // The reset restarts a service, so it is gated like every other write.
  const gate = await todoGate();

  return (
    <div className="widget quick">
      <div className="widget-scroll">
        <ul className="quick-row">
          <li className="quick-item is-clock">
            <LiveClock serverLabel={clockLabel()} />
          </li>
          <li className="quick-item">
            <span className="quick-label">
              <EyeIcon />
              Eyes
            </span>
            <EyeCountdown />
          </li>
          <QuickNudge slots={settings.slots} paused={settings.paused} today={todayLocal()} />
          {/* Pinned to the left of the agent-status light — it starts the
              right-aligned group (see .quick-item.is-volume) rather than floating
              after the nudge message. A master knob over every board sound. */}
          <SoundVolume />
          <li className="quick-item is-health">
            <BoardHealth />
          </li>
          <li className="quick-item is-acts">
            {/* The bell opens the editor for every nudge; it sits with the other
                "press it and the board does something" controls. */}
            <Nudges slots={settings.slots} writable={gate.ok} today={todayLocal()} />
            {/* Leftmost of the three, and beside the mixer buttons because it is
                the same kind of thing: press it and something on this machine
                changes. */}
            <BoardReset writable={gate.ok} />
            <AudioQuick />
          </li>
        </ul>
      </div>
    </div>
  );
}

/** The next nudge still ahead of it today — the program's own next appointment. */
function QuickNudge({
  slots,
  paused,
  today,
}: {
  slots: HealthSettingsFile["slots"];
  paused: boolean;
  today: string;
}) {
  const nowM = nowMinutes();
  // SORT BY TIME FIRST. `slots` is in the order the slots were added, not in
  // clock order, and `find` returns the first MATCH IN ARRAY ORDER rather than
  // the earliest one — so at 09:35 this answered "11:45 Midday walk" because
  // walk happens to sit at index 0, while the 10:00 coffee reminder added later
  // sat at index 4 and was never reached. Every slot added after the originals
  // was invisible here for as long as an earlier-indexed one was still ahead.
  //
  // Only the readout was wrong: evaluateSlots loops over every slot and judges
  // each on its own, so the nudges themselves fired on time throughout.
  const next = paused
    ? undefined
    : slots
        // Only nudges that actually fire today — a Tuesday-only reminder or a
        // spent one-shot is not this board's next appointment, same rule the
        // tick uses (firesOn).
        .filter((slot) => slot.enabled && firesOn(slot, today))
        .sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time))
        .find((slot) => minutesOfDay(slot.time) > nowM);

  return (
    <li className="quick-item">
      <span className="quick-label">
        <NudgeIcon />
        Next nudge
      </span>
      {/* The LABEL, not the id. "walk" happened to read fine; "bed-1" does not,
          and the id is a handle for the CLI rather than something to show. */}
      <span className="quick-value is-nudge" title={next ? next.label : undefined}>
        {paused ? "paused" : next ? `${formatTime(next.time)} ${next.label}` : "—"}
      </span>
    </li>
  );
}
