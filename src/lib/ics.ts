import ical, {
  ICalAlarmType,
  ICalAlarmRelatesTo,
  ICalEventStatus,
  ICalCalendarMethod,
} from "ical-generator";
import { DateTime } from "luxon";
import type { DayboardEvent } from "./schema";
import { uidFor } from "./uid";
import { zone, addDays } from "./time";
import { expandRecurrence } from "./recur";

/**
 * Building the feed the phone subscribes to.
 *
 * Timed events are emitted as UTC instants with X-WR-TIMEZONE for display. Every
 * timed event we hold is a concrete moment with a known offset, so UTC is exact
 * and immune to DST; a VTIMEZONE block would only matter for floating or
 * recurring timed events, and the only recurring events here are all-day
 * birthdays, which carry no time at all.
 */

export interface BuildOptions {
  name: string;
  events: DayboardEvent[];
  ttlMinutes?: number;
  siteUrl?: string;
}

function alarmTrigger(event: DayboardEvent): number | null {
  if (!event.alarm) return null;
  // ical-generator takes seconds before the event; a negative value means after,
  // which is how an all-day birthday gets a 9am ping instead of a midnight one.
  return event.alarm.minutesBefore * 60;
}

/**
 * Which rules survive as an RRULE, and which are written out date by date.
 *
 * A yearly all-day birthday is one VEVENT with `RRULE:FREQ=YEARLY`, exactly as
 * it has been since the feed existed — the phone expands it forever and the UID
 * never moves.
 *
 * EVERYTHING ELSE IS EXPANDED HERE, and the reason is three lines up in this
 * file's own docblock: this calendar carries no VTIMEZONE and writes timed
 * events as UTC instants. An RRULE on a weekly 6pm rehearsal would be read
 * against those instants, so every occurrence after the November clock change
 * would arrive at 5pm — correct arithmetic, wrong meeting. A concrete instance
 * carries the offset that applied on its own date and cannot drift.
 *
 * The cost is size: a weekly event is ~57 VEVENTs a year instead of one. For a
 * calendar of a few hundred events that is nothing, and the alternative is a
 * feed that is quietly wrong for half the year.
 */
function isPlainYearly(rule: DayboardEvent["recurrence"]): boolean {
  return (
    rule?.freq === "YEARLY" && rule.interval === 1 && !rule.byDay && !rule.until && !rule.count
  );
}

/** Expand every rule the feed cannot express safely, and leave the rest alone. */
export function expandForFeed(events: DayboardEvent[], today: string): DayboardEvent[] {
  const out: DayboardEvent[] = [];
  for (const event of events) {
    if (!event.recurrence || isPlainYearly(event.recurrence)) out.push(event);
    else out.push(...expandRecurrence(event, addDays(today, -30), addDays(today, 400)));
  }
  return out;
}

export function buildCalendar({ name, events, ttlMinutes = 120, siteUrl }: BuildOptions): string {
  const calendar = ical({
    name,
    prodId: { company: "dayboard", product: "dayboard", language: "EN" },
    // Deliberately NO calendar-level timezone: setting one makes ical-generator
    // emit floating local times (DTSTART:20261108T113000), which a phone in
    // another timezone reads as its own 11:30. Left unset, every timed event is
    // written as a UTC instant, which is exact everywhere and DST-proof.
    // X-WR-TIMEZONE below is only a display hint.
    ttl: ttlMinutes * 60,
    method: ICalCalendarMethod.PUBLISH,
  });
  calendar.x("X-WR-TIMEZONE", zone());

  for (const event of events) {
    const isAllDay = event.allDay;
    const start = isAllDay
      ? DateTime.fromISO(event.start, { zone: zone() }).toJSDate()
      : DateTime.fromISO(event.start, { setZone: true }).toJSDate();
    const end = event.end
      ? isAllDay
        ? DateTime.fromISO(event.end, { zone: zone() }).toJSDate()
        : DateTime.fromISO(event.end, { setZone: true }).toJSDate()
      : undefined;

    // The phone is where he'll be at kickoff, so the watch link goes into both
    // the URL property (tappable in iOS Calendar) and the description (which
    // every client renders).
    const watchLine = event.watch
      ? `Watch on ${event.watch.service}: ${event.watch.url}`
      : null;
    const primaryUrl = event.watch?.url ?? event.url;
    const descriptionParts = [event.notes, watchLine, event.url].filter(
      Boolean,
    ) as string[];

    const created = calendar.createEvent({
      id: uidFor(event),
      sequence: event.seq,
      stamp: new Date(event.updatedAt),
      start,
      end,
      allDay: isAllDay,
      summary: event.title,
      location: event.location,
      description: descriptionParts.length ? descriptionParts.join("\n\n") : undefined,
      url: primaryUrl,
      categories: [{ name: event.layer }],
      status:
        event.status === "cancelled"
          ? ICalEventStatus.CANCELLED
          : event.status === "tentative"
            ? ICalEventStatus.TENTATIVE
            : ICalEventStatus.CONFIRMED,
      timezone: isAllDay ? null : undefined,
      x: siteUrl ? [{ key: "X-DAYBOARD-URL", value: `${siteUrl}/event/${encodeURIComponent(event.id)}` }] : [],
    });

    // A PLAIN YEARLY ALL-DAY RULE STAYS AN RRULE, and everything else was
    // already expanded before it got here — see expandForFeed below.
    if (isPlainYearly(event.recurrence)) {
      created.repeating({ freq: "YEARLY" as never });
    }

    const trigger = alarmTrigger(event);
    if (trigger !== null) {
      const alarm = created.createAlarm({
        type: ICalAlarmType.display,
        trigger,
        description: event.title,
      });
      // relatesTo is a method, not a constructor option. A negative trigger
      // otherwise defaults to RELATED=END, which on an all-day event means the
      // following midnight; anchoring to START turns "-540 minutes" into 9am on
      // the day itself.
      if (trigger < 0) alarm.relatesTo(ICalAlarmRelatesTo.start);
    }
  }

  return calendar.toString();
}
