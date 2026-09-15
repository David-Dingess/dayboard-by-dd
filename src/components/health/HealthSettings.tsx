"use client";

import { useState } from "react";
import { formatTime } from "@/lib/health";
import { restartProgram, updateHealthSettings } from "@/lib/health-actions";
import { audioArmed, primeAudio, sounds } from "./beeps";
import type { HealthSnapshot } from "@/lib/health-store";

/**
 * How the program behaves. The standalone app's Settings screen, minus everything
 * that was about being a Windows app — launch at login, close to tray, export
 * and import a JSON file. The file is `data/health.json` in this repo now, so
 * the backup is git and the export is `cat`.
 *
 * EVERY INPUT IS UNCONTROLLED, `defaultValue` plus `onBlur`. The board
 * re-renders every server component every thirty seconds; an input whose value
 * came from that would eat a keystroke every half minute. Same reason and same
 * shape as the Planner's capture box.
 */
export function HealthSettings({
  snapshot,
  writable,
  onBack,
}: {
  snapshot: HealthSnapshot;
  writable: boolean;
  onBack: () => void;
}) {
  const { settings } = snapshot;
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [permission, setPermission] = useState<string>(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  // Read once, on the render after mount at the latest — it only ever goes from
  // false to true, and pressing the button below is what flips it.
  const armed = audioArmed();

  const save = async (patch: Parameters<typeof updateHealthSettings>[0], said: string) => {
    setError(null);
    const result = await updateHealthSettings(patch);
    if (!result.ok) setError(result.error ?? "That didn't save.");
    else setNote(said);
  };

  const setSlot = (id: string, patch: { time?: string; enabled?: boolean }) =>
    save(
      { slots: settings.slots.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)) },
      "Saved.",
    );

  return (
    <>
      <p className="health-eyebrow">Settings</p>
      <h3 className="healthcard-title">How this behaves</h3>
      {note && <p className="healthnote">{note}</p>}
      {error && <p className="healthnote is-error">{error}</p>}
      {!writable && <p className="healthnote">Settings can only be changed on the machine the board runs on.</p>}

      <section className="healthblock">
        <p className="health-eyebrow">Nudges</p>
        <p className="healthblock-note">
          Each one only fires if the day calls for it and nothing has answered it yet. Nothing fires
          during quiet hours. The time is also what puts the session on the calendar.
        </p>
        <ul className="healthslots">
          {settings.slots.map((slot) => (
            <li key={slot.id}>
              <input
                className="healthinput"
                type="time"
                defaultValue={slot.time}
                disabled={!writable}
                aria-label={`${slot.label} time`}
                onBlur={(e) => {
                  if (e.target.value && e.target.value !== slot.time) void setSlot(slot.id, { time: e.target.value });
                }}
              />
              <span className="healthslot-body">
                <span className="healthstation-name">{slot.label}</span>
                <span className="healthstation-cue">
                  {slot.kind === "walk"
                    ? "On walk days. Midday puts you in the daylight window."
                    : slot.kind === "strength"
                      ? "On strength and mobility days."
                      : slot.kind === "chair"
                        ? "Chair five, every day. Doing one in the hour before answers it."
                        : "Only if nothing has been logged all day."}
                </span>
              </span>
              <label className="healthcheck">
                <input
                  type="checkbox"
                  checked={slot.enabled}
                  disabled={!writable}
                  onChange={(e) => void setSlot(slot.id, { enabled: e.target.checked })}
                />
                on
              </label>
            </li>
          ))}
        </ul>

        <div className="healthquiet">
          <span className="healthcard-sub">Quiet from</span>
          <input
            className="healthinput"
            type="time"
            defaultValue={settings.quietHours.start}
            disabled={!writable}
            aria-label="quiet hours start"
            onBlur={(e) =>
              e.target.value !== settings.quietHours.start &&
              void save({ quietHours: { ...settings.quietHours, start: e.target.value } }, "Saved.")
            }
          />
          <span className="healthcard-sub">until</span>
          <input
            className="healthinput"
            type="time"
            defaultValue={settings.quietHours.end}
            disabled={!writable}
            aria-label="quiet hours end"
            onBlur={(e) =>
              e.target.value !== settings.quietHours.end &&
              void save({ quietHours: { ...settings.quietHours, end: e.target.value } }, "Saved.")
            }
          />
        </div>
        <p className="healthblock-note">
          Hard exercise inside the last couple of hours before bed is the one timing that reliably
          delays sleep onset — which is the opposite of the point.
        </p>

        <div className="healthfoot-acts">
          <button
            type="button"
            className="healthbtn is-quiet"
            disabled={permission !== "default"}
            onClick={() => void Notification.requestPermission().then(setPermission)}
          >
            {permission === "granted"
              ? "Desktop notifications on"
              : permission === "denied"
                ? "Desktop notifications blocked"
                : permission === "unsupported"
                  ? "No desktop notifications here"
                  : "Allow desktop notifications"}
          </button>
        </div>
        <p className="healthblock-note">
          Optional. Without it a nudge still chimes, pulses the tab and brings this panel forward —
          it just cannot reach you behind another window.
        </p>
      </section>

      <section className="healthblock">
        <p className="health-eyebrow">This tab</p>
        <ul className="healthtoggles">
          <li>
            <label className="healthcheck">
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                disabled={!writable}
                onChange={(e) => void save({ soundEnabled: e.target.checked }, "Saved.")}
              />
              Sounds
            </label>
            <span className="healthstation-cue">
              Countdown ticks, interval tones, and the two eye-break chimes.{" "}
              {/* There is no way to make audio work in a page nobody has touched,
                  so the honest thing is to say so rather than leave you
                  wondering why a chime never came. Pressing this is itself the
                  gesture that arms it. */}
              <button
                type="button"
                className="healthlink"
                onClick={() => {
                  primeAudio();
                  sounds.eyeWarn();
                }}
              >
                {armed ? "hear it" : "click to arm the sound, then hear it"}
              </button>
            </span>
          </li>
          <li>
            <label className="healthcheck">
              <input
                type="checkbox"
                checked={settings.eyeBreaks.enabled}
                disabled={!writable}
                onChange={(e) =>
                  void save({ eyeBreaks: { ...settings.eyeBreaks, enabled: e.target.checked } }, "Saved.")
                }
              />
              Eye breaks
            </label>
            <span className="healthstation-cue">
              Every{" "}
              <input
                className="healthinput is-narrow"
                type="number"
                min={5}
                max={120}
                defaultValue={settings.eyeBreaks.everyMinutes}
                disabled={!writable}
                aria-label="minutes between eye breaks"
                onBlur={(e) => {
                  const everyMinutes = Number(e.target.value);
                  if (everyMinutes !== settings.eyeBreaks.everyMinutes) {
                    void save({ eyeBreaks: { ...settings.eyeBreaks, everyMinutes } }, "Saved.");
                  }
                }}
              />{" "}
              minutes of screen time, this panel takes the screen for{" "}
              {settings.eyeBreaks.forSeconds} seconds. Never during a session or a walk. Time in
              another window pauses the count; two minutes away starts it over.
            </span>
            <span className="healthstation-cue">
              <label className="healthcheck">
                <input
                  type="checkbox"
                  checked={settings.eyeBreaks.quietHours !== null}
                  disabled={!writable}
                  onChange={(e) =>
                    void save(
                      {
                        eyeBreaks: {
                          ...settings.eyeBreaks,
                          quietHours: e.target.checked ? { start: "23:00", end: "07:00" } : null,
                        },
                      },
                      "Saved.",
                    )
                  }
                />
                quiet hours of its own
              </label>
              {settings.eyeBreaks.quietHours && (
                <span className="healthquiet is-inline">
                  <input
                    className="healthinput"
                    type="time"
                    defaultValue={settings.eyeBreaks.quietHours.start}
                    disabled={!writable}
                    aria-label="eye break quiet hours start"
                    onBlur={(e) =>
                      settings.eyeBreaks.quietHours &&
                      e.target.value !== settings.eyeBreaks.quietHours.start &&
                      void save(
                        {
                          eyeBreaks: {
                            ...settings.eyeBreaks,
                            quietHours: { ...settings.eyeBreaks.quietHours, start: e.target.value },
                          },
                        },
                        "Saved.",
                      )
                    }
                  />
                  <span className="healthcard-sub">to</span>
                  <input
                    className="healthinput"
                    type="time"
                    defaultValue={settings.eyeBreaks.quietHours.end}
                    disabled={!writable}
                    aria-label="eye break quiet hours end"
                    onBlur={(e) =>
                      settings.eyeBreaks.quietHours &&
                      e.target.value !== settings.eyeBreaks.quietHours.end &&
                      void save(
                        {
                          eyeBreaks: {
                            ...settings.eyeBreaks,
                            quietHours: { ...settings.eyeBreaks.quietHours, end: e.target.value },
                          },
                        },
                        "Saved.",
                      )
                    }
                  />
                </span>
              )}
            </span>
          </li>
          <li>
            <label className="healthcheck">
              <input
                type="checkbox"
                checked={settings.paused}
                disabled={!writable}
                onChange={(e) => void save({ paused: e.target.checked }, "Saved.")}
              />
              Pause the program
            </label>
            <span className="healthstation-cue">
              Stops every nudge, stops counting missed days, and clears the sessions off the
              calendar. History is kept.
            </span>
          </li>
        </ul>
      </section>

      <section className="healthblock">
        <p className="health-eyebrow">Program</p>
        <p className="healthcard-sub">
          Week {snapshot.weekNumber} of 52 · Phase {snapshot.phase.index}, {snapshot.phase.name}
        </p>
        <p className="healthblock-note">{snapshot.phase.blurb}</p>
        <div className="healthfoot-acts">
          <span className="healthcard-sub">Started {settings.programStartDate}</span>
          {confirmRestart ? (
            <>
              <button
                type="button"
                className="healthbtn is-primary"
                disabled={!writable}
                onClick={() => {
                  setConfirmRestart(false);
                  void restartProgram(snapshot.today).then((result) => {
                    if (!result.ok) setError(result.error ?? "That didn't save.");
                    else setNote("Back to week 1. Sessions and walks already logged were kept.");
                  });
                }}
              >
                Yes, restart at week 1
              </button>
              <button type="button" className="healthlink" onClick={() => setConfirmRestart(false)}>
                cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="healthbtn is-quiet"
              disabled={!writable}
              onClick={() => setConfirmRestart(true)}
            >
              Restart at week 1
            </button>
          )}
        </div>
      </section>

      <p className="healthblock-note mono">
        quiet {formatTime(settings.quietHours.start)}–{formatTime(settings.quietHours.end)} · data/health.json
      </p>

      <div className="healthfoot">
        <button type="button" className="healthbtn is-quiet" onClick={onBack}>
          Back
        </button>
      </div>
    </>
  );
}
