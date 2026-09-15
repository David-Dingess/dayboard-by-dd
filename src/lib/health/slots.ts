import { dayOfWeek, inQuietHours, minutesOfDay, nowMinutes, todayKey } from "./dates";
import { chairAnswered } from "./chair";
import { getMinimumDose, getSessionForDate } from "./session";
import type { DayCode, FiredMarker, NotificationSlot, Settings } from "./store-types";

/** Indexed to match dayOfWeek / Date#getDay: 0 = Sunday … 6 = Saturday. */
const DAY_CODES: readonly DayCode[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Does this slot run on `today`, given its weekday set and one-shot date?
 *  Exported so the "next nudge" readout in QuickWidget filters by the same rule
 *  the tick fires by, rather than keeping a second copy that can drift. */
export function firesOn(slot: NotificationSlot, today: string): boolean {
  // A one-shot ("just today") fires only on the date it was stamped with, and is
  // inert before and after — the guard that also lets a spent one sit harmlessly.
  if (slot.date) return slot.date === today;
  // A recurring nudge may be pinned to certain weekdays; empty or absent is every
  // day, which is every programme slot and a plain daily reminder.
  if (slot.days && slot.days.length) return slot.days.includes(DAY_CODES[dayOfWeek(today)]);
  return true;
}

/**
 * Time-of-day nudges, as a decision rather than an action.
 *
 * the standalone app ran this inside an Electron tray process and fired a toast at
 * the end. Here the same logic runs in the browser on the board's own tick, so
 * the function returns what should happen and `components/HealthAlert.tsx` does
 * it. That split is worth having on its own: every rule below is a rule about
 * when NOT to interrupt someone, and those are the ones worth testing.
 *
 * IT IS A CHEAP IDEMPOTENT TICK, NOT A TIMER PER SLOT. A computed setTimeout
 * drifts and dies silently across sleep and hibernate, which is exactly what a
 * desktop machine does at night — so every thirty seconds it asks a simple
 * question instead: is this slot due, still fresh, unfired today, outside quiet
 * hours, and not already answered by something logged?
 *
 * Fired markers are keyed by the New York date, so they survive a reload
 * mid-day, reset naturally at midnight, and never do arithmetic on epoch times
 * across a clock change.
 */

/** Which view of the Health tab a nudge is offering to open. */
export type SlotRoute = "walk" | "session" | "minimum" | "chair" | "none";

export interface SlotFire {
  slotId: string;
  title: string;
  body: string;
  route: SlotRoute;
}

export interface SlotMark {
  date: string;
  slotId: string;
  value: FiredMarker;
}

export interface SlotInput {
  settings: Settings;
  /** A session was logged today and not skipped. */
  logged: boolean;
  /** At least one walk was logged today. */
  walked: boolean;
  /**
   * Minutes of day, New York, of each chair routine finished today. Optional so
   * every caller written before the chair routine keeps compiling as "none".
   */
  chairAt?: readonly number[];
  today: string;
  fired: Record<string, Record<string, FiredMarker>>;
  snooze: { slotId: string; fireAt: number } | null;
  now: Date;
}

export interface SlotDecision {
  fire: SlotFire[];
  marks: SlotMark[];
  clearSnooze: boolean;
  /** Date keys whose markers can go. Nothing older than a week is useful. */
  prune: string[];
}

const MARKER_DAYS = 7;

function routeFor(slot: NotificationSlot): SlotRoute {
  if (slot.kind === "walk") return "walk";
  if (slot.kind === "last_call") return "minimum";
  // A reminder has nothing to start. The banner shows it with a Dismiss and
  // nothing else, which is the whole of what it is for.
  if (slot.kind === "reminder") return "none";
  if (slot.kind === "chair") return "chair";
  return "session";
}

/**
 * Has this slot already been answered today? A nudge that arrives after the work
 * is done is the fastest way to teach someone to ignore notifications.
 */
export function satisfied(
  slot: NotificationSlot,
  logged: boolean,
  walked: boolean,
  chairAt: readonly number[] = [],
): boolean {
  // Nothing on this board knows whether you took a vitamin, so nothing can
  // answer a reminder except dismissing it.
  if (slot.kind === "reminder") return false;
  // Only a chair routine answers a chair nudge — a strength session in the
  // afternoon did nothing for wrists that have been typing since nine — and only
  // one done within the hour before it. See chair.ts.
  if (slot.kind === "chair") return chairAnswered(slot, chairAt);
  if (slot.kind === "walk") return walked || logged;
  // A walk does not stand in for a strength session; the other way round it does.
  if (slot.kind === "strength") return logged;
  return logged || walked;
}

/** Does today's schedule actually call for this kind of nudge? */
export function relevant(settings: Settings, slot: NotificationSlot, date: string): boolean {
  // Every day, including rest days: neither a reminder nor the chair routine is
  // part of the programme. Rest days sit at a desk too.
  if (slot.kind === "reminder" || slot.kind === "chair") return true;
  const session = getSessionForDate(settings, date);
  if (session.kind === "rest") return false;
  if (slot.kind === "walk") return session.kind === "walk";
  if (slot.kind === "strength") return session.kind === "strength" || session.kind === "mobility";
  return true;
}

export function bodyFor(settings: Settings, slot: NotificationSlot, date: string): string {
  // Its own label is the entire message — there is nothing to add about a
  // vitamin that the word "vitamins" does not already say.
  if (slot.kind === "reminder") return slot.label;
  if (slot.kind === "chair") return "Five minutes in the chair: wrists, hamstrings, calves.";
  if (slot.kind === "last_call") {
    const min = getMinimumDose(date, settings);
    return `Nothing logged yet. ${min.estMinutes} minutes on the mat still counts.`;
  }
  const session = getSessionForDate(settings, date);
  if (session.kind === "walk") {
    return `${session.targetMinutes} minutes outside. Week ${session.week} of the program.`;
  }
  return `${session.title} · about ${session.estMinutes} minutes.`;
}

/**
 * What this tick should do. Pure: the same inputs always decide the same thing,
 * and nothing here reads or writes storage.
 */
export function evaluateSlots(input: SlotInput): SlotDecision {
  const { settings, logged, walked, today, fired, snooze, now } = input;
  const chairAt = input.chairAt ?? [];
  const decision: SlotDecision = { fire: [], marks: [], clearSnooze: false, prune: [] };

  if (settings.paused) return decision;

  const quiet = inQuietHours(settings.quietHours.start, settings.quietHours.end, now);
  const current = nowMinutes(now);

  // A snooze that has come due fires once and clears, whatever the slot's own
  // window says — it was already deferred by hand. It still respects quiet hours
  // and still shuts up if the work has since been done.
  if (snooze && snooze.fireAt <= now.getTime()) {
    decision.clearSnooze = true;
    const slot = settings.slots.find((s) => s.id === snooze.slotId);
    if (
      slot &&
      firesOn(slot, today) &&
      (!quiet || slot.kind === "reminder") &&
      !satisfied(slot, logged, walked, chairAt)
    ) {
      decision.fire.push({
        slotId: slot.id,
        title: slot.label,
        body: bodyFor(settings, slot, today),
        route: routeFor(slot),
      });
    }
  }

  for (const slot of settings.slots) {
    if (!slot.enabled) continue;
    // Not today's day — a one-shot before/after its date, or a recurring nudge on
    // a weekday it is not set for. No marker either way, so an off-day never reads
    // as a missed one and a spent one-shot never fires a second time.
    if (!firesOn(slot, today)) continue;
    // Either marker consumes the slot for the day. This is the idempotency.
    if (fired[today]?.[slot.id]) continue;

    const due = current >= minutesOfDay(slot.time);
    if (!due) continue;

    // The wake-from-sleep guard: a machine that was asleep all afternoon should
    // not spray three stale nudges the moment it comes back.
    const fresh = current - minutesOfDay(slot.time) <= settings.graceMinutes;
    if (!fresh) {
      decision.marks.push({ date: today, slotId: slot.id, value: "missed" });
      continue;
    }

    // Quiet hours SUPPRESS BUT DO NOT CONSUME: no marker, so a slot sitting
    // inside them simply never fires that day rather than being recorded as
    // something you ignored.
    //
    // EXCEPT A REMINDER, WHICH IGNORES THEM ENTIRELY. Quiet hours exist to stop
    // the exercise programme nagging at night — it decided those times, so it
    // needs telling when not to. A reminder's time was chosen by hand, and
    // "bro, go to bed" at 11pm is a thing you can only mean deliberately.
    // Suppressing those would leave a nudge that silently never fires, which is
    // worse than no nudge at all.
    if (quiet && slot.kind !== "reminder") continue;

    if (!relevant(settings, slot, today)) {
      decision.marks.push({ date: today, slotId: slot.id, value: "missed" });
      continue;
    }
    if (satisfied(slot, logged, walked, chairAt)) {
      decision.marks.push({ date: today, slotId: slot.id, value: "missed" });
      continue;
    }

    decision.fire.push({
      slotId: slot.id,
      title: slot.label,
      body: bodyFor(settings, slot, today),
      route: routeFor(slot),
    });
    decision.marks.push({ date: today, slotId: slot.id, value: "fired" });
  }

  const keys = Object.keys(fired);
  if (keys.length > MARKER_DAYS) {
    const keep = new Set(keys.sort().slice(-MARKER_DAYS).concat(today));
    decision.prune = keys.filter((key) => !keep.has(key));
  }

  return decision;
}

/**
 * Park a nudge for later — or refuse to.
 *
 * A snooze that would land inside quiet hours is dropped rather than deferred:
 * the whole point of the cutoff is that late is worse than never.
 */
export function snoozeAt(
  settings: Settings,
  minutes: number,
  now: Date = new Date(),
): { fireAt: number } | { suppressed: "quiet_hours" } {
  const fireAt = new Date(now.getTime() + minutes * 60_000);
  if (inQuietHours(settings.quietHours.start, settings.quietHours.end, fireAt)) {
    return { suppressed: "quiet_hours" };
  }
  return { fireAt: fireAt.getTime() };
}

/** The browser's own answer to "what day is it", for comparing against the server's. */
export { todayKey };
