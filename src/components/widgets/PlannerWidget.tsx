import Link from "next/link";
import type { DayboardEvent, Layer } from "@/lib/schema";
import { sortEvents } from "@/lib/events";
import { todayLocal } from "@/lib/time";
import { AgendaList } from "@/components/AgendaList";

/**
 * What is coming: the agenda, from today, and nothing else.
 *
 * This was the Agenda tab, then for a while it was the agenda with the board's
 * capture box and to-do tiles stacked on top of it. Both of those have moved to
 * Notes / To-Do, next door. The reason is that they were never about the agenda:
 * a to-do is the thing that has NO day on it, so putting it above a list grouped
 * by day made the widget answer two questions in one column and pushed the first
 * real date halfway down the panel. It now does the one thing.
 *
 * It is deliberately the same list the centre panel's agenda mode renders — the
 * point was never a second view but a second PLACE, so that looking at the week
 * grid and asking "what is after that" does not mean switching the centre away
 * from the thing you were looking at.
 *
 * Events come from page.tsx, which already read them to work out which fixture
 * is live.
 *
 * Anchored to today and nothing else: the calendar owns the idea of a period you
 * step through, and a second stepper on the board would be two things claiming
 * to say where you are.
 */
export function PlannerWidget({
  events,
  layers,
}: {
  events: DayboardEvent[];
  layers: Map<string, Layer>;
}) {
  return (
    <div className="widget planner">
      <div className="widget-head">
        <h2 className="widget-title">Planner</h2>
        <span className="widget-meta">agenda from today</span>
        {/* Something without a date goes in the capture box next door. This is
            the other half: something that belongs on a day goes to the
            calendar's editor, in the panel beside this one, on today. */}
        <Link className="headlink" href={`/?cal=week&on=${todayLocal()}&edit=new`}>
          + Event
        </Link>
      </div>

      <div className="widget-scroll">
        <AgendaList anchor={todayLocal()} all={sortEvents(events)} layers={layers} />
      </div>
    </div>
  );
}
