import Link from "next/link";
import type { DayboardEvent, Layer } from "@/lib/schema";
import { DateTime } from "luxon";
import { loadAllEvents } from "@/lib/layers";
import { hasFinished, sortEvents } from "@/lib/events";
import { placeDay, hourRange, weekDays, weekStart, datesCovered, monthGrid } from "@/lib/grid";
import { zone, todayLocal, formatTimeOnly, localDate } from "@/lib/time";
import { layerColor } from "@/components/EventRow";
import { LayerMark } from "@/components/LayerMark";
import { dayLabel } from "@/components/Chrome";
import { EventEditor } from "@/components/EventEditor";
import { loadLayerFile, writableLayers } from "@/lib/events-store";
import { masterId } from "@/lib/recur";
import { todoGate } from "@/lib/todo-actions";

/**
 * Week and month in one widget, with its own mode toggle above the grid.
 *
 * Mode and anchor date live in the URL rather than in client state, so the
 * server renders exactly the period being looked at and prev/next are ordinary
 * links — no client-side data fetching, and a reload keeps your place.
 *
 * THERE WAS A THIRD MODE, and it is gone deliberately. The agenda was a mode
 * here before the right column had one, and once the Planner existed the board
 * had the same list in two places, one of which you had to give up the calendar
 * to read. So this is the grid, and the list is the Planner's. `?cal=agenda`
 * still parses — it lands on the week, because an old link should show something
 * rather than nothing.
 */

/**
 * The week always shows at least 6am to midnight, and stretches those hours to
 * fill whatever height the panel gives it. A fixed pixel-per-hour left the grid
 * ending halfway down a 1440px screen with dead space under it.
 *
 * They are a FLOOR, not a clamp: an event at 3am widens the window rather than
 * being drawn at the wrong time or vanishing. Everything inside is positioned as
 * a percentage of the resulting span, so the same markup fits any height.
 */
const DAY_FROM_HOUR = 6;
const DAY_TO_HOUR = 24;

const MAX_PER_CELL = 4;

export type CalendarMode = "week" | "month";

export interface CalendarParams {
  mode: CalendarMode;
  anchor: string;
  /** "new", or the id of an event to edit. Absent means no editor. */
  edit?: string;
}

export function readCalendarParams(search: Record<string, string | string[] | undefined>): CalendarParams {
  const raw = Array.isArray(search.cal) ? search.cal[0] : search.cal;
  // Anything unrecognised — including the retired "agenda" — is the week.
  const mode: CalendarMode = raw === "month" ? "month" : "week";
  const anchorRaw = Array.isArray(search.on) ? search.on[0] : search.on;
  const anchor = anchorRaw && /^\d{4}-\d{2}-\d{2}$/.test(anchorRaw) ? anchorRaw : todayLocal();
  const editRaw = Array.isArray(search.edit) ? search.edit[0] : search.edit;
  return { mode, anchor, edit: editRaw || undefined };
}

/**
 * The calendar's own URL. Mode, date and the editor all live in it — so the
 * editor survives a reload, is linkable from the Planner and the event page,
 * and closes by going back rather than by a piece of client state nobody else
 * can see.
 */
function href(mode: CalendarMode, anchor: string, edit?: string): string {
  const base = `/?cal=${mode}&on=${anchor}`;
  return edit ? `${base}&edit=${encodeURIComponent(edit)}` : base;
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/** An event may override its layer's mark — see holidays.ts. */
function markFor(event: DayboardEvent, layers: Map<string, Layer>): Layer | undefined {
  const base = layers.get(event.layer);
  if (!base) return undefined;
  return event.emoji ? { ...base, emoji: event.emoji, logo: undefined } : base;
}

function Pill({
  event,
  layers,
  size = 16,
  past = false,
}: {
  event: DayboardEvent;
  layers: Map<string, Layer>;
  size?: number;
  /** Already finished, so it recedes. Computed once per grid, never per pill. */
  past?: boolean;
}) {
  const base = layers.get(event.layer);
  return (
    <Link
      href={`/event/${encodeURIComponent(event.id)}`}
      className={`pill${past ? " is-past" : ""}`}
      style={{ ["--layer-color" as string]: layerColor(event.layer, event.color ?? base?.color) }}
      title={event.title}
    >
      <LayerMark layer={markFor(event, layers)} size={size} />
      <span className="pill-text">{event.title}</span>
    </Link>
  );
}

function WeekGrid({ anchor, all, layers }: { anchor: string; all: DayboardEvent[]; layers: Map<string, Layer> }) {
  const first = weekStart(anchor);
  const days = weekDays(first);
  const today = todayLocal();
  // One clock for the whole grid. hasFinished() builds its own DateTime when you
  // let it, and a week can hold a hundred events.
  const now = DateTime.now().setZone(zone());
  const index = new Map(days.map((d, i) => [d, i]));

  const timed: DayboardEvent[][] = days.map(() => []);
  const allDay: DayboardEvent[][] = days.map(() => []);
  for (const event of all) {
    if (event.allDay) {
      for (const date of datesCovered(event)) {
        const i = index.get(date);
        if (i !== undefined) allDay[i].push(event);
      }
    } else {
      const i = index.get(localDate(event.start));
      if (i !== undefined) timed[i].push(event);
    }
  }

  const placed = timed.map(placeDay);
  const [fromHour, toHour] = hourRange(placed, DAY_FROM_HOUR, DAY_TO_HOUR);
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);
  // Everything below is a share of this, which is what lets the grid stretch.
  const spanMin = (toHour - fromHour) * 60;

  return (
    <div className="weekinner" style={{ ["--hour-count" as string]: hours.length }}>
      <div className="weekhead">
        <div className="weekhead-cell" />
        {days.map((date) => {
          const { num, dow } = dayLabel(date);
          return (
            <div key={date} className={`weekhead-cell${date === today ? " is-today" : ""}`}>
              <span className="weekhead-dow">{dow}</span>
              <span className="weekhead-num">{num}</span>
            </div>
          );
        })}
      </div>

      <div className="weekallday">
        <div className="weekallday-label">all day</div>
        {days.map((date, i) => (
          <div key={date} className="weekallday-cell">
            {allDay[i].map((event) => (
              <Pill
                key={`${date}:${event.id}`}
                event={event}
                layers={layers}
                past={hasFinished(event, now)}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="weekgrid">
        <div className="weekhours">
          {hours.map((hour) => (
            <div key={hour} className="weekhour">
              {hourLabel(hour)}
            </div>
          ))}
        </div>
        {days.map((date, i) => (
          <div key={date} className={`weekcol${date === today ? " is-today" : ""}`}>
            {placed[i].map(({ event, startMin, endMin, lane, lanes }) => {
              const top = ((startMin - fromHour * 60) / spanMin) * 100;
              const blockHeight = ((endMin - startMin) / spanMin) * 100;
              const width = 100 / lanes;
              return (
                <Link
                  key={event.id}
                  href={`/event/${encodeURIComponent(event.id)}`}
                  className={`weekevent${hasFinished(event, now) ? " is-past" : ""}`}
                  style={{
                    top: `${top}%`,
                    height: `${blockHeight}%`,
                    left: `calc(${lane * width}% + 2px)`,
                    width: `calc(${width}% - 4px)`,
                    ["--layer-color" as string]: layerColor(event.layer, layers.get(event.layer)?.color),
                  }}
                  title={`${formatTimeOnly(event.start)} · ${event.title}`}
                >
                  <span className="weekevent-time">{formatTimeOnly(event.start)}</span>
                  <span className="weekevent-body">
                    <LayerMark layer={markFor(event, layers)} size={14} className="weekevent-mark" />
                    <span className="weekevent-text">{event.title}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthGrid({ anchor, all, layers }: { anchor: string; all: DayboardEvent[]; layers: Map<string, Layer> }) {
  const ym = anchor.slice(0, 7);
  const { days, month } = monthGrid(ym);
  const today = todayLocal();
  // A month grid renders six weeks of cells; letting each pill construct its own
  // "now" would be a couple of hundred DateTimes for one answer.
  const now = DateTime.now().setZone(zone());

  const byDate = new Map<string, DayboardEvent[]>();
  for (const event of all) {
    for (const date of event.allDay ? datesCovered(event) : [localDate(event.start)]) {
      const list = byDate.get(date);
      if (list) list.push(event);
      else byDate.set(date, [event]);
    }
  }

  return (
    <div className="monthgrid">
      <div className="monthdow">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="monthweeks">
        {days.map((date) => {
          const dt = DateTime.fromISO(date, { zone: zone() });
          const events = byDate.get(date) ?? [];
          const shown = events.slice(0, MAX_PER_CELL);
          const hidden = events.length - shown.length;
          const outside = dt.month !== month;
          return (
            <div
              key={date}
              className={`monthcell${outside ? " is-outside" : ""}${date === today ? " is-today" : ""}`}
            >
              <div className="monthcell-head">
                <span className="monthnum">{dt.toFormat("d")}</span>
              </div>
              {shown.map((event) => (
                <Pill
                  key={`${date}:${event.id}`}
                  event={event}
                  layers={layers}
                  size={15}
                  past={hasFinished(event, now)}
                />
              ))}
              {hidden > 0 && (
                <Link className="monthmore" href={href("week", weekStart(date))}>
                  +{hidden} more
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export async function CalendarWidget({ mode, anchor, edit }: CalendarParams) {
  const { events, layers } = await loadAllEvents();
  const all = sortEvents(events);
  const anchorDt = DateTime.fromISO(anchor, { zone: zone() });

  // The STORED event, not the occurrence: an instance is arithmetic, so editing
  // the second Tuesday of a series opens the series. loadLayerFile rather than
  // the expanded list for the same reason.
  const writable = writableLayers();
  const gate = await todoGate();
  const editing =
    edit && edit !== "new"
      ? (writable
          .flatMap((layer) => loadLayerFile(layer))
          .find((e) => e.id === masterId(edit)) ?? null)
      : null;

  const step = mode === "week" ? { weeks: 1 } : { months: 1 };
  const prev = anchorDt.minus(step).toISODate()!;
  const next = anchorDt.plus(step).toISODate()!;

  const title =
    mode === "month"
      ? anchorDt.toFormat("LLLL yyyy")
      : (() => {
          const first = DateTime.fromISO(weekStart(anchor), { zone: zone() });
          const last = first.plus({ days: 6 });
          return first.month === last.month
            ? first.toFormat("LLLL yyyy")
            : `${first.toFormat("LLL")} – ${last.toFormat("LLL yyyy")}`;
        })();

  return (
    <div className="widget">
      <div className="widget-head">
        <nav className="viewswitch" aria-label="Calendar mode">
          <Link href={href("week", anchor)} aria-current={mode === "week" ? "page" : undefined}>
            Week
          </Link>
          <Link href={href("month", anchor)} aria-current={mode === "month" ? "page" : undefined}>
            Month
          </Link>
        </nav>
        <h2 className="widget-title">{title}</h2>
        <Link className="headlink" href={href(mode, anchor, "new")}>
          + Event
        </Link>
        <div className="stepper">
          <Link href={href(mode, prev)} aria-label="Previous">
            ‹
          </Link>
          <Link href={href(mode, todayLocal())}>Today</Link>
          <Link href={href(mode, next)} aria-label="Next">
            ›
          </Link>
        </div>
      </div>

      {/* The week grid sizes itself to the panel, so it is the one view that must
          not live in a scroller — that would give it an unbounded height to
          stretch into and it would never settle.

          With the editor open the two share the row: the grid keeps most of it
          and the form takes a fixed column beside it, because choosing a date is
          easier while you can still see the week. */}
      <div className={`widget-scroll${mode === "week" ? " is-fixed" : ""}${edit ? " is-split" : ""}`}>
        {/* NO WRAPPER WHEN THE EDITOR IS CLOSED. The week grid stretches to fill
            whatever height it is given, so an extra element between it and the
            scroller is not neutral — it changed the row it was measuring against
            and both views came out cramped. Closed, this is exactly the markup
            it was before the editor existed. */}
        {edit ? (
          <div className="calgrid">
            {mode === "week" ? (
              <WeekGrid anchor={anchor} all={all} layers={layers} />
            ) : (
              <MonthGrid anchor={anchor} all={all} layers={layers} />
            )}
          </div>
        ) : mode === "week" ? (
          <WeekGrid anchor={anchor} all={all} layers={layers} />
        ) : (
          <MonthGrid anchor={anchor} all={all} layers={layers} />
        )}
        {edit && (
          <div className="caleditor">
            <EventEditor
              event={editing}
              layers={writable}
              defaultLayer={writable.includes("personal") ? "personal" : (writable[0] ?? "personal")}
              defaultDate={anchor}
              writable={gate.ok}
              reason={gate.reason}
              backHref={href(mode, anchor)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
