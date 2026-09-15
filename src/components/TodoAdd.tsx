"use client";

import { useState } from "react";
import { addTodo } from "@/lib/todo-actions";
import { addPending, clearPending } from "@/components/pending-todos";

/**
 * The line you type a task into, at the top of Notes / To-Do.
 *
 * It was the Planner's box until the to-dos moved; it is the same box, and it is
 * now directly above the page you type paragraphs into, which is where it should
 * always have been — one tab, one act.
 *
 * THE INPUT IS UNCONTROLLED, and that is not laziness. AutoRefresh calls
 * router.refresh() every thirty seconds, quite possibly mid-sentence. React
 * reconciles rather than remounting, so an uncontrolled input keeps its value
 * and its caret straight through that; an input whose `value` came from a server
 * prop would eat characters every half minute. React 19 also resets a form for
 * you when its `action` is a function, which is why this is a form action and
 * not an onClick — one fewer ref, and the reset happens at the right moment.
 *
 * The text goes into the pending store before the action is awaited, so the
 * ghost tile is on screen in the same frame as the empty box. See
 * pending-todos.ts.
 */
export function TodoAdd({ writable, reason }: { writable: boolean; reason: string }) {
  const [error, setError] = useState<string | null>(null);

  async function submit(form: FormData) {
    const text = String(form.get("text") ?? "").trim();
    if (!text) return;

    setError(null);
    addPending(text);
    try {
      const result = await addTodo(text);
      if (!result.ok) setError(result.error ?? "That didn't save.");
    } finally {
      clearPending(text);
    }
  }

  return (
    <div className="todoadd">
      <form action={submit} className="todoadd-form">
        <input
          type="text"
          name="text"
          className="todoadd-input"
          placeholder={writable ? "Add a to-do" : "To-dos are read-only here"}
          aria-label="Add a to-do"
          autoComplete="off"
          maxLength={500}
          disabled={!writable}
        />
        <button type="submit" className="todoadd-go" disabled={!writable}>
          Add
        </button>
      </form>
      {!writable && <p className="todonote">{reason}</p>}
      {error && <p className="todonote is-error">{error}</p>}
    </div>
  );
}
