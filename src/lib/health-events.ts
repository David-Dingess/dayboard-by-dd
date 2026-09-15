import { DateTime } from "luxon";
import type { DayboardEvent } from "./schema";
import type { HealthFile } from "./schema";
import { contextOf } from "./health-store";
import { getSessionForDate, minutesOfDay, addDays, type Session } from "./health";
import { zone } from "./time";

/**
 * The program, on the calendar.
 *
 * A session you have not done yet is a plan with a time attached — a walk at
 * 11:45, strength at 16:30 — which is exactly what a calendar is for. Without
 * this the board could tell you what today held only while you were looking at the
 * Health tab, and the phone could not tell you at all.
 *
 * These are GENERATED, not stored: there is no `data/layers/health.json` and
 * nothing writes one. The program is a function of the start date and the
 * weekday, so a file would be a cache of arithmetic that can never be stale on
 * its own but can very easily be stale against `data/health.json` — the day
 * after a restart, every one of those rows would be wrong. Generating them at
 * read time means the two cannot disagree.
 *
 * WHICH DAYS APPEAR. Only the ones with a time to propose: strength, mobility
 * and walk days take the matching nudge slot's time. A rest day is nothing to
 * put on a calendar, and the five-minute minimum is an offer rather than a
 * plan, so neither is here.
 *
 * The slot's time is used whether or not its nudge is switched off. Turning off
 * a nudge says "do not interrupt me about this", not "this is not the plan".
 */

const LAYER = "health";

/** How far either side of today to generate. Past days keep the week strip and
 *  the month view honest; the future bound keeps the ICS feed a sane size. */
const PAST_DAYS = 7;
const FUTURE_DAYS = 120;

/** The nudge slot whose time a session kind is scheduled at. */
function timeFor(file: HealthFile, session: Session): string | null {
  const wanted =
    session.kind === "walk" ? "walk" : session.kind === "strength" || session.kind === "mobility" ? "strength" : null;
  if (!wanted) return null;
  return file.settings.slots.find((slot) => slot.kind === wanted)?.time ?? null;
}

function toEvent(file: HealthFile, date: string, session: Session, time: string): DayboardEvent {
  const start = DateTime.fromISO(`${date}T${time}`, { zone: zone() });
  const minutes = Math.max(5, session.targetMinutes ?? session.estMinutes);

  return {
    // One session a day, so the date is the identity. Deliberately NOT keyed on
    // the kind: after a restart, a Tuesday that was strength becomes a walk, and
    // a phone matching on UID should see that as this event changing rather than
    // as one cancelled and another created.
    id: `${LAYER}:${date}`,
    layer: LAYER,
    title: session.title,
    start: start.toISO({ suppressMilliseconds: true })!,
    end: start.plus({ minutes }).toISO({ suppressMilliseconds: true })!,
    allDay: false,
    tz: zone(),
    notes: session.subtitle,
    source: { kind: "generated", ref: "health" },
    status: "confirmed",
    seq: 0,
    // A stable stamp, not `now`: these events change when the program is
    // restarted or the slot times move, and nothing else should look like a
    // change to a calendar client.
    updatedAt: `${file.settings.programStartDate}T00:00:00.000Z`,
  };
}

/**
 * The scheduled sessions around `today`, as calendar events.
 *
 * Returns nothing at all while the program is paused — a paused program is one
 * you have told to leave you alone, and a calendar full of plans you have opted
 * out of is the loudest possible way to ignore that.
 */
export function healthEvents(file: HealthFile, today: string): DayboardEvent[] {
  if (file.settings.paused) return [];

  const ctx = contextOf(file);
  const events: DayboardEvent[] = [];

  for (let i = -PAST_DAYS; i <= FUTURE_DAYS; i++) {
    const date = addDays(today, i);
    const session = getSessionForDate(ctx, date);
    const time = timeFor(file, session);
    if (!time) continue;
    // A slot time that will not parse would put the whole board's calendar an
    // hour into 1970; the schema's HH:mm regex is what normally prevents it.
    if (!Number.isFinite(minutesOfDay(time))) continue;
    events.push(toEvent(file, date, session, time));
  }

  return events;
}
