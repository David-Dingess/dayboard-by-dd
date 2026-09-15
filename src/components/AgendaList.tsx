import { DateTime } from "luxon";
import type { DayboardEvent, Layer } from "@/lib/schema";
import { groupByDay, inWindow, relativeDay } from "@/lib/events";
import { zone, todayLocal } from "@/lib/time";
import { EventRow } from "@/components/EventRow";

/**
 * What is coming, day by day.
 *
 * Lifted out of CalendarWidget when the right column grew an agenda too. It has
 * one caller again now — the Planner — because the centre's agenda MODE was
 * retired once the board had the same list in two places and one of them cost
 * you the calendar. Kept as its own component rather than folded back in: it is
 * the whole reason there is only one way a day heading gets written.
 *
 * It takes events rather than loading them. page.tsx has already paid for
 * loadAllEvents() to work out which fixture is live, and reading the same files
 * again to render the same days would be silly.
 */

/** How far ahead an agenda looks from its anchor. */
export const AGENDA_DAYS = 45;

export function AgendaList({
  anchor,
  all,
  layers,
  days = AGENDA_DAYS,
}: {
  anchor: string;
  all: DayboardEvent[];
  layers: Map<string, Layer>;
  days?: number;
}) {
  const today = todayLocal();
  const grouped = groupByDay(inWindow(all, anchor, days));

  if (grouped.length === 0) {
    return <p className="empty">Nothing in the {days} days from here.</p>;
  }

  return (
    <>
      {grouped.map((day) => {
        const date = DateTime.fromISO(day.date, { zone: zone() });
        const relative = relativeDay(day.date, today);
        return (
          <section key={day.date} className="day">
            <div className="day-head">
              <span className="day-date">{date.toFormat("d LLLL")}</span>
              {relative && <span className="day-rel">{relative}</span>}
              <span className="day-weekday">{date.toFormat("cccc")}</span>
            </div>
            <ul className="events">
              {day.events.map((event) => (
                <EventRow
                  key={`${day.date}:${event.id}`}
                  event={event}
                  layer={layers.get(event.layer)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
