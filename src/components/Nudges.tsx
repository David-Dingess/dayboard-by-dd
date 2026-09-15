"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { updateHealthSettings } from "@/lib/health-actions";
import type { DayCode, NotificationSlot } from "@/lib/health";
import { formatTime } from "@/lib/health";

/**
 * Every nudge, in one editable place, opened from the controls row.
 *
 * THE FIRING ENGINE IS THE ONE IN slots.ts — this writes the same `slots` array
 * the Health settings screen does, through the same gated action, so the two can
 * never disagree about what a nudge is. What it adds is the shape that was asked
 * for: a nudge is recurring on chosen weekdays, or it is just for today, and
 * both are a row you edit in place rather than a config file.
 *
 * PROGRAMME SLOTS ARE SHOWN BUT HELD. The walk, the strength session and last
 * call are nudges too and belong in the list, but their days come from the
 * 52-week programme and their labels name a thing the engine keys on — so their
 * time and their on/off are yours to change here and the rest is not. Only the
 * plain reminders are fully editable, and only they can be deleted or made
 * one-shot.
 *
 * A ONE-SHOT IS STAMPED, NOT PICKED. "Just today" writes today's date onto the
 * slot; the user never types one. It fires once and is inert after, and the next
 * save drops any whose day has passed — so the list stays what is still ahead.
 */

const WEEK: { code: DayCode; label: string }[] = [
  { code: "MO", label: "M" },
  { code: "TU", label: "T" },
  { code: "WE", label: "W" },
  { code: "TH", label: "T" },
  { code: "FR", label: "F" },
  { code: "SA", label: "S" },
  { code: "SU", label: "S" },
];
const ALL_DAYS = WEEK.map((d) => d.code);

/** The schema cap, so the add control can say "full" rather than fail on save. */
const MAX_SLOTS = 24;

function mintId(): string {
  return `reminder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function isProgram(slot: NotificationSlot): boolean {
  return slot.kind !== "reminder";
}

export function Nudges({
  slots,
  writable,
  today,
}: {
  slots: NotificationSlot[];
  writable: boolean;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes it, like the takeover — a thing over the board must always
  // have a way out that is not hunting for a button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // A spent one-shot never fires again (slots.ts guards it), but it should not
  // clutter the list either — drop yesterday's on the way to any save.
  const clean = (arr: NotificationSlot[]) =>
    arr.filter((s) => !(s.date && s.date < today));

  const save = async (next: NotificationSlot[]) => {
    setBusy(true);
    setError(null);
    const result = await updateHealthSettings({ slots: clean(next) });
    setBusy(false);
    if (!result.ok) setError(result.error ?? "That didn't save.");
  };

  const patch = (id: string, fn: (slot: NotificationSlot) => NotificationSlot) =>
    save(slots.map((s) => (s.id === id ? fn(s) : s)));

  const remove = (id: string) => save(slots.filter((s) => s.id !== id));

  const addNudge = (time: string, text: string) => {
    const label = text.trim();
    if (!label || slots.length >= MAX_SLOTS) return;
    // New nudges start recurring every day; the row's controls narrow it.
    void save([...slots, { id: mintId(), time, label, kind: "reminder", enabled: true }]);
  };

  const visible = slots.filter((s) => !(s.date && s.date < today));

  return (
    <>
      <button
        type="button"
        className="watchbtn"
        aria-label="Nudges"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 16 16" aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth={1.6}>
          {/* A bell — the shape a nudge already wears elsewhere on the board. */}
          <path d="M4 7a4 4 0 0 1 8 0c0 3 1 4 1 4H3s1-1 1-4Z" />
          <path d="M6.6 13a1.6 1.6 0 0 0 2.8 0" />
        </svg>
      </button>

      {/* Only rendered after a click, so document.body is always there by now —
          and `open` is false through SSR and hydration, so there is nothing to
          mismatch. */}
      {open &&
        createPortal(
          <div className="nudges-overlay" role="dialog" aria-modal="true" aria-label="Nudges" onClick={() => setOpen(false)}>
            <div className="nudges-modal" onClick={(e) => e.stopPropagation()}>
              <div className="nudges-head">
                <h2>Nudges</h2>
                <button type="button" className="nudges-x" aria-label="Close" onClick={() => setOpen(false)}>
                  ✕
                </button>
              </div>

              {!writable && (
                <p className="nudges-note">Nudges can only be changed on the machine the board runs on.</p>
              )}
              {error && <p className="nudges-note is-error">{error}</p>}

              <ul className="nudges-list">
                {visible.map((slot) => (
                  <NudgeRow
                    key={slot.id}
                    slot={slot}
                    today={today}
                    writable={writable && !busy}
                    onPatch={patch}
                    onRemove={remove}
                  />
                ))}
                {visible.length === 0 && <li className="nudges-empty">No nudges yet.</li>}
              </ul>

              <AddNudge
                disabled={!writable || busy || slots.length >= MAX_SLOTS}
                full={slots.length >= MAX_SLOTS}
                onAdd={addNudge}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function NudgeRow({
  slot,
  today,
  writable,
  onPatch,
  onRemove,
}: {
  slot: NotificationSlot;
  today: string;
  writable: boolean;
  onPatch: (id: string, fn: (slot: NotificationSlot) => NotificationSlot) => void;
  onRemove: (id: string) => void;
}) {
  const program = isProgram(slot);
  const once = Boolean(slot.date);
  // Absent/empty days means every day, so an untouched recurring nudge shows all
  // seven ticked rather than none.
  const activeDays = slot.days && slot.days.length ? slot.days : ALL_DAYS;

  const setMode = (mode: "recurring" | "once") =>
    onPatch(slot.id, (s) => {
      const { id, time, label, kind, enabled } = s;
      // Rebuilt rather than spread-with-undefined, so the dropped key is truly
      // gone over the wire rather than a serialised `undefined`.
      return mode === "once"
        ? { id, time, label, kind, enabled, date: today }
        : { id, time, label, kind, enabled };
    });

  const toggleDay = (code: DayCode) =>
    onPatch(slot.id, (s) => {
      const current = s.days && s.days.length ? s.days : ALL_DAYS;
      const next = current.includes(code) ? current.filter((d) => d !== code) : [...current, code];
      // A recurring nudge on no days is not a thing; keep the last one.
      const days = next.length ? ALL_DAYS.filter((d) => next.includes(d)) : current;
      const { id, time, label, kind, enabled } = s;
      return { id, time, label, kind, enabled, days };
    });

  return (
    <li className={`nudges-row${slot.enabled ? "" : " is-off"}`}>
      <label className="nudges-onoff">
        <input
          type="checkbox"
          checked={slot.enabled}
          disabled={!writable}
          onChange={(e) => onPatch(slot.id, (s) => ({ ...s, enabled: e.target.checked }))}
        />
      </label>

      <input
        className="nudges-time"
        type="time"
        defaultValue={slot.time}
        disabled={!writable}
        aria-label={`${slot.label} time`}
        onBlur={(e) => {
          if (e.target.value && e.target.value !== slot.time) {
            onPatch(slot.id, (s) => ({ ...s, time: e.target.value }));
          }
        }}
      />

      <span className="nudges-text">
        {program ? (
          <span className="nudges-label is-program">
            {slot.label}
            <span className="nudges-tag">{slot.kind === "chair" ? "chair five" : "program"}</span>
          </span>
        ) : (
          <input
            className="nudges-label-input"
            type="text"
            defaultValue={slot.label}
            maxLength={60}
            disabled={!writable}
            aria-label="nudge text"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== slot.label) onPatch(slot.id, (s) => ({ ...s, label: v }));
            }}
          />
        )}
      </span>

      <span className="nudges-when">
        {program ? (
          <span className="nudges-cue">{slot.kind === "chair" ? "every day" : "on program days"}</span>
        ) : (
          <>
            <span className="nudges-seg">
              <button
                type="button"
                className={!once ? "is-on" : ""}
                disabled={!writable}
                onClick={() => once && setMode("recurring")}
              >
                Recurring
              </button>
              <button
                type="button"
                className={once ? "is-on" : ""}
                disabled={!writable}
                onClick={() => !once && setMode("once")}
              >
                Just today
              </button>
            </span>
            {once ? (
              <span className="nudges-cue">once, {formatTime(slot.time)} today</span>
            ) : (
              <span className="nudges-days">
                {WEEK.map((d) => (
                  <button
                    key={d.code}
                    type="button"
                    className={`nudges-day${activeDays.includes(d.code) ? " is-on" : ""}`}
                    disabled={!writable}
                    aria-pressed={activeDays.includes(d.code)}
                    aria-label={d.code}
                    title={d.code}
                    onClick={() => toggleDay(d.code)}
                  >
                    {d.label}
                  </button>
                ))}
              </span>
            )}
          </>
        )}
      </span>

      <span className="nudges-del">
        {!program && (
          <button
            type="button"
            className="nudges-x is-small"
            aria-label={`Delete ${slot.label}`}
            disabled={!writable}
            onClick={() => onRemove(slot.id)}
          >
            ✕
          </button>
        )}
      </span>
    </li>
  );
}

function AddNudge({
  disabled,
  full,
  onAdd,
}: {
  disabled: boolean;
  full: boolean;
  onAdd: (time: string, text: string) => void;
}) {
  const [time, setTime] = useState("09:00");
  const [text, setText] = useState("");

  const submit = () => {
    if (!text.trim()) return;
    onAdd(time, text);
    setText("");
  };

  return (
    <div className="nudges-add">
      <input
        className="nudges-time"
        type="time"
        value={time}
        disabled={disabled}
        aria-label="new nudge time"
        onChange={(e) => setTime(e.target.value)}
      />
      <input
        className="nudges-label-input"
        type="text"
        placeholder={full ? "Nudge list is full" : "what to nudge — e.g. stand up and stretch"}
        value={text}
        maxLength={60}
        disabled={disabled}
        aria-label="new nudge text"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <button type="button" className="healthbtn is-primary" disabled={disabled || !text.trim()} onClick={submit}>
        Add
      </button>
    </div>
  );
}
