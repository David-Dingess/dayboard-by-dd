import { todayKey } from "./dates";
import type { NotificationSlot, Settings } from "./store-types";

export const PROGRAM_WEEKS = 52;

/**
 * Default nudge times, and why they are what they are:
 *
 *  11:45 — the midday daylight window (roughly 10am–2pm) is when skin actually
 *          synthesises vitamin D, and it breaks up a long seated morning.
 *  16:30 — strength in the late afternoon, which lands more than four hours
 *          before a midnight bedtime. Exercise that close to sleep is fine;
 *          exercise inside the last two hours is what delays sleep onset.
 *  20:00 — last call, and only if nothing has been logged. This is the five
 *          minute floor, not a guilt trip.
 *
 * And the chair routine four times across a day that starts at nine and runs
 * late: 9:45, 14:45, 18:45 and 21:45. The first lands once the morning has
 * settled, the last is for the long evening at the desk.
 *
 * Quiet hours start at 23:00 so a nudge can still reach the last hours of a
 * long desk day. Every one of these is a sample schedule: the Nudges editor on
 * the board and the Health tab's settings change all of it.
 * The eye breaks are the 20/20/20 rule as written: every twenty minutes, look
 * twenty feet away for twenty seconds.
 */
export const DEFAULT_SLOTS: NotificationSlot[] = [
  { id: "walk", time: "11:45", label: "Midday walk", kind: "walk", enabled: true },
  { id: "strength", time: "16:30", label: "Strength session", kind: "strength", enabled: true },
  { id: "last-call", time: "20:00", label: "Last call", kind: "last_call", enabled: true },
  { id: "chair-am", time: "09:45", label: "Chair five", kind: "chair", enabled: true },
  { id: "chair-pm", time: "14:45", label: "Chair five", kind: "chair", enabled: true },
  { id: "chair-eve", time: "18:45", label: "Chair five", kind: "chair", enabled: true },
  { id: "chair-late", time: "21:45", label: "Chair five", kind: "chair", enabled: true },
];

export function defaultSettings(startDate = todayKey()): Settings {
  return {
    programStartDate: startDate,
    patternLevels: {},
    slots: DEFAULT_SLOTS.map((slot) => ({ ...slot })),
    quietHours: { start: "23:00", end: "07:00" },
    graceMinutes: 20,
    soundEnabled: true,
    paused: false,
    eyeBreaks: { enabled: true, everyMinutes: 20, forSeconds: 20, quietHours: null },
  };
}
