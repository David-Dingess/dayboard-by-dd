"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useClockBucket } from "@/components/clock";
import { saveNotesText } from "@/lib/notes-actions";

/**
 * One page, one textarea, saved five seconds after you stop typing.
 *
 * THE TEXTAREA IS UNCONTROLLED, and on this board that is not a shortcut — it
 * is the only thing that works. AutoRefresh re-renders every server component
 * every thirty seconds, quite possibly mid-word. React reconciles rather than
 * remounting, so an uncontrolled field keeps its value and its caret straight
 * through that; a `value` fed from a server prop would eat characters twice a
 * minute. Same rule and same reason as the Planner's capture box.
 *
 * WHICH LEAVES THE HARD PART: the server keeps sending its copy of the text,
 * and most of the time that copy is older than what is on screen. The rule is
 * "a new server value is only accepted while this browser has nothing unsaved":
 *
 *   dirty     → keep what is typed, and SAY the file moved underneath it.
 *   not dirty → adopt it. That is `npm run notes -- append` or the chat skill
 *               writing the file, and it should appear here within a tick.
 *
 * Never silently overwrite either way. Losing a paragraph to a background
 * refresh is the one failure that would stop this being used for what it is
 * for.
 *
 * THE DRAFT IN localStorage IS A CRASH NET, not the state. It is written on
 * every keystroke and cleared on every successful save, so the only time it
 * survives is the one that matters: the tab died with something unsaved in it.
 * On mount it is restored if it is newer than the file and different from it.
 */

const DRAFT = "dayboard.notes.draft";
const IDLE_MS = 5_000;

type Status =
  | { kind: "idle" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "elsewhere" }
  | { kind: "error"; message: string };

function readDraft(): { text: string; at: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { text: string; at: number };
    return typeof parsed?.text === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function NotesEditor({
  text,
  updatedAt,
  writable,
  reason,
}: {
  text: string;
  updatedAt: string;
  writable: boolean;
  reason: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // What the file holds, as far as this browser knows. Compared against the
  // server prop to tell "someone else wrote it" from "this is my own save
  // coming back".
  const lastSaved = useRef(text);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const flush = useCallback(async () => {
    const el = ref.current;
    if (!el || !dirty.current || !writable) return;
    const value = el.value;
    if (timer.current) clearTimeout(timer.current);
    setStatus({ kind: "saving" });

    const result = await saveNotesText(value);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error ?? "That didn't save." });
      return;
    }
    // Anything typed WHILE the save was in flight stays unsaved: comparing
    // against the box rather than assuming it settles means the debounce that
    // follows picks the rest up instead of losing it.
    lastSaved.current = value;
    dirty.current = ref.current ? ref.current.value !== value : false;
    if (!dirty.current) {
      try {
        localStorage.removeItem(DRAFT);
      } catch {
        // Private window. The save landed; only the crash net is missing.
      }
    }
    setStatus({ kind: "saved", at: Date.now() });
  }, [writable]);

  const onInput = () => {
    dirty.current = true;
    setStatus({ kind: "unsaved" });
    try {
      localStorage.setItem(DRAFT, JSON.stringify({ text: ref.current?.value ?? "", at: Date.now() }));
    } catch {
      // Full or private. Autosave still runs; only the crash net is missing.
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), IDLE_MS);
  };

  /**
   * A new server value. See the docblock: adopt it only while nothing here is
   * unsaved, and never overwrite what is being typed.
   */
  useEffect(() => {
    if (text === lastSaved.current) return;
    if (dirty.current) {
      setStatus({ kind: "elsewhere" });
      return;
    }
    if (ref.current) ref.current.value = text;
    lastSaved.current = text;
  }, [text]);

  // Restore a draft the tab died with, and save on every exit the browser will
  // still let us act on. beforeunload is best effort by design — the draft
  // above is what actually covers a kill.
  useEffect(() => {
    const draft = readDraft();
    if (draft && draft.text !== lastSaved.current && draft.at > Date.parse(updatedAt || 0 as never)) {
      if (ref.current) ref.current.value = draft.text;
      dirty.current = true;
      setStatus({ kind: "unsaved" });
    }

    const onHidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onLeave = () => void flush();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("beforeunload", onLeave);
      if (timer.current) clearTimeout(timer.current);
    };
    // Mount only: `flush` is stable for a given `writable`, and re-running this
    // would re-restore a draft you had already dismissed by typing over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <textarea
        ref={ref}
        className="notes-text"
        defaultValue={text}
        onInput={onInput}
        onBlur={() => void flush()}
        onKeyDown={(e) => {
          // Ctrl+S is muscle memory, and it should mean this rather than "save
          // the page as HTML".
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            void flush();
          }
        }}
        readOnly={!writable}
        spellCheck
        maxLength={50_000}
        placeholder="Anything you don't want to lose."
        aria-label="Notes"
      />
      <NotesStatus status={status} writable={writable} reason={reason} />
    </>
  );
}

function NotesStatus({
  status,
  writable,
  reason,
}: {
  status: Status;
  writable: boolean;
  reason: string;
}) {
  // Ticks so "saved 12s ago" ages honestly. Bucket 0 is the server, which has
  // no clock — it draws nothing, and so does the first client paint.
  const bucket = useClockBucket(1_000);

  if (!writable) return <p className="todonote">{reason}</p>;

  switch (status.kind) {
    case "saving":
      return <p className="todonote">Saving…</p>;
    case "unsaved":
      return <p className="todonote">Unsaved.</p>;
    case "error":
      return <p className="todonote is-error">{status.message}</p>;
    case "elsewhere":
      return (
        <p className="todonote is-error">
          Changed somewhere else. Saving will overwrite that.
        </p>
      );
    case "saved": {
      if (bucket === 0) return <p className="todonote">Saved.</p>;
      const seconds = Math.max(0, Math.round((bucket * 1_000 - status.at) / 1000));
      return (
        <p className="todonote">
          {seconds < 5 ? "Saved." : `Saved ${seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`} ago.`}
        </p>
      );
    }
    default:
      return <p className="todonote">Saves five seconds after you stop typing.</p>;
  }
}
