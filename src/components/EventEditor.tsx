"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { removeEvent, saveEvent } from "@/lib/event-actions";
import type { DayboardEvent } from "@/lib/schema";

/**
 * Adding and editing an event, beside the calendar rather than over it.
 *
 * A PANE, NOT A MODAL. The grid stays on screen while you fill this in, which is
 * the whole reason it is here: picking a date is easier when you can see the
 * week you are picking it in, and a dialog that covers the calendar to ask you
 * about the calendar is a dialog you have to remember around.
 *
 * EVERY FIELD IS UNCONTROLLED, `defaultValue` plus the form's own FormData. Same
 * reason as the Planner's capture box and the Notes page: AutoRefresh re-renders
 * every server component every thirty seconds, and a value fed from a server
 * prop would eat a keystroke every half minute. The only React state here is
 * what changes the SHAPE of the form — all-day hides the times, weekly reveals
 * the weekday buttons — plus the error line.
 *
 * IT EDITS THE SERIES, NEVER THE OCCURRENCE. Open the second Tuesday of a weekly
 * event and this opens the rule behind it. An occurrence is arithmetic rather
 * than a stored row, so "just this one" has nothing to write to — and quietly
 * moving every Tuesday because you thought you were moving one is the worst
 * thing a calendar can do. The form says so above the buttons.
 */

const DAYS = [
  { code: "SU", label: "S" },
  { code: "MO", label: "M" },
  { code: "TU", label: "T" },
  { code: "WE", label: "W" },
  { code: "TH", label: "T" },
  { code: "FR", label: "F" },
  { code: "SA", label: "S" },
] as const;

const FREQ = [
  { value: "", label: "Does not repeat" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
] as const;

/** "2026-10-04T19:30:00-04:00" → "19:30", and an all-day value → "". */
function timeOf(value: string | undefined): string {
  if (!value || value.length <= 10) return "";
  return value.slice(11, 16);
}

export function EventEditor({
  event,
  layers,
  defaultLayer,
  defaultDate,
  writable,
  reason,
  backHref,
}: {
  /** The stored event being changed, or null when this is a new one. */
  event: DayboardEvent | null;
  layers: string[];
  defaultLayer: string;
  defaultDate: string;
  writable: boolean;
  reason: string;
  backHref: string;
}) {
  const router = useRouter();
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [freq, setFreq] = useState(event?.recurrence?.freq ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDate = event ? event.start.slice(0, 10) : defaultDate;
  // An all-day END is stored exclusive — the morning after the last day — so it
  // is shown here as the day you actually mean.
  const endDate = event?.end
    ? event.allDay
      ? shiftBack(event.end)
      : event.end.slice(0, 10)
    : "";

  const submit = async (form: FormData) => {
    setBusy(true);
    setError(null);

    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    const endD = String(form.get("endDate") ?? "");
    const endT = String(form.get("endTime") ?? "");
    const isAllDay = form.get("allDay") === "on";

    const byDay = DAYS.map((d) => d.code).filter((code) => form.get(`day-${code}`) === "on");
    const chosen = String(form.get("freq") ?? "");
    const until = String(form.get("until") ?? "");

    const input = {
      layer: String(form.get("layer") ?? defaultLayer),
      title: String(form.get("title") ?? ""),
      start: isAllDay ? date : `${date} ${time || "09:00"}`,
      end: isAllDay
        ? endD
          ? shiftForward(endD) // back to an exclusive DTEND
          : undefined
        : endD || endT
          ? `${endD || date} ${endT || time || "09:00"}`
          : undefined,
      location: String(form.get("location") ?? "") || undefined,
      url: String(form.get("url") ?? "") || undefined,
      notes: String(form.get("notes") ?? "") || undefined,
      status: form.get("tentative") === "on" ? ("tentative" as const) : ("confirmed" as const),
      recurrence: chosen
        ? {
            freq: chosen as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY",
            interval: Math.max(1, Number(form.get("interval") ?? 1) || 1),
            byDay: chosen === "WEEKLY" && byDay.length ? byDay : undefined,
            until: until || undefined,
          }
        : undefined,
    };

    const result = await saveEvent(input, event?.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That didn't save.");
      return;
    }
    router.push(backHref);
  };

  const drop = async () => {
    if (!event) return;
    if (!window.confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
    setBusy(true);
    const result = await removeEvent(event.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That didn't delete.");
      return;
    }
    router.push(backHref);
  };

  return (
    <form className="eventeditor" action={submit}>
      <div className="eventeditor-head">
        <h3 className="healthcard-title">{event ? "Edit event" : "New event"}</h3>
        <button type="button" className="healthlink" onClick={() => router.push(backHref)}>
          close
        </button>
      </div>

      {!writable && <p className="todonote">{reason}</p>}

      <label className="eventfield">
        <span className="eventfield-label">Title</span>
        <input
          className="healthinput is-wide"
          name="title"
          defaultValue={event?.title ?? ""}
          maxLength={200}
          required
          autoFocus={!event}
        />
      </label>

      <label className="eventfield">
        <span className="eventfield-label">Layer</span>
        <select className="healthinput" name="layer" defaultValue={event?.layer ?? defaultLayer}>
          {layers.map((layer) => (
            <option key={layer} value={layer}>
              {layer}
            </option>
          ))}
        </select>
      </label>

      <label className="healthcheck eventeditor-allday">
        <input
          type="checkbox"
          name="allDay"
          defaultChecked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
        />
        All day
      </label>

      <div className="eventrow">
        <label className="eventfield">
          <span className="eventfield-label">Starts</span>
          <input className="healthinput" type="date" name="date" defaultValue={startDate} required />
        </label>
        {!allDay && (
          <label className="eventfield">
            <span className="eventfield-label">at</span>
            <input
              className="healthinput"
              type="time"
              name="time"
              defaultValue={timeOf(event?.start) || "09:00"}
            />
          </label>
        )}
      </div>

      <div className="eventrow">
        <label className="eventfield">
          <span className="eventfield-label">{allDay ? "Last day" : "Ends"}</span>
          <input className="healthinput" type="date" name="endDate" defaultValue={endDate} />
        </label>
        {!allDay && (
          <label className="eventfield">
            <span className="eventfield-label">at</span>
            <input
              className="healthinput"
              type="time"
              name="endTime"
              defaultValue={timeOf(event?.end)}
            />
          </label>
        )}
      </div>

      <div className="eventrow">
        <label className="eventfield">
          <span className="eventfield-label">Repeats</span>
          <select
            className="healthinput"
            name="freq"
            defaultValue={freq}
            onChange={(e) => setFreq(e.target.value as typeof freq)}
          >
            {FREQ.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {freq && (
          <label className="eventfield">
            <span className="eventfield-label">every</span>
            <input
              className="healthinput is-narrow"
              type="number"
              name="interval"
              min={1}
              max={365}
              defaultValue={event?.recurrence?.interval ?? 1}
            />
          </label>
        )}
      </div>

      {freq === "WEEKLY" && (
        <div className="eventdays">
          {DAYS.map((day, i) => (
            <label key={day.code} className="eventday" title={day.code}>
              <input
                type="checkbox"
                name={`day-${day.code}`}
                defaultChecked={event?.recurrence?.byDay?.includes(day.code) ?? false}
              />
              <span aria-hidden>{day.label}</span>
              <span className="visually-hidden">{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}</span>
            </label>
          ))}
        </div>
      )}

      {freq && (
        <label className="eventfield">
          <span className="eventfield-label">Until (optional)</span>
          <input
            className="healthinput"
            type="date"
            name="until"
            defaultValue={event?.recurrence?.until ?? ""}
          />
        </label>
      )}

      <label className="eventfield">
        <span className="eventfield-label">Where</span>
        <input
          className="healthinput is-wide"
          name="location"
          defaultValue={event?.location ?? ""}
          maxLength={200}
        />
      </label>

      <label className="eventfield">
        <span className="eventfield-label">Link</span>
        <input
          className="healthinput is-wide"
          name="url"
          type="url"
          defaultValue={event?.url ?? ""}
          maxLength={500}
          placeholder="https://"
        />
      </label>

      <label className="eventfield">
        <span className="eventfield-label">Notes</span>
        <textarea
          className="healthinput is-wide"
          name="notes"
          rows={3}
          defaultValue={event?.notes ?? ""}
          maxLength={2000}
        />
      </label>

      <label className="healthcheck">
        <input type="checkbox" name="tentative" defaultChecked={event?.status === "tentative"} />
        Date not certain
      </label>

      {event?.recurrence && (
        <p className="todonote">
          This changes every occurrence — the series is one entry, so there is no
          single date to change on its own.
        </p>
      )}
      {error && <p className="todonote is-error">{error}</p>}

      <div className="eventeditor-acts">
        <button type="submit" className="healthbtn is-primary" disabled={!writable || busy}>
          {busy ? "Saving…" : event ? "Save" : "Add to the calendar"}
        </button>
        {event && (
          <button type="button" className="healthbtn is-quiet" onClick={drop} disabled={!writable || busy}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

/** An exclusive DTEND back to the last day you mean. */
function shiftBack(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

/** And forward again on the way out. */
function shiftForward(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}
