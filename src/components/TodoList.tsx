"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Todo } from "@/lib/schema";
import { deleteTodo, flagTodo, type TodoResult } from "@/lib/todo-actions";
import { usePendingTodos } from "@/components/pending-todos";

/**
 * The checklist, in the top half of Notes / To-Do.
 *
 * TICKING THE BOX IS THE DELETE. There is no `done` field, and adding one would
 * have bought a list of things you have already finished sitting on the board
 * looking like things you have not. What ticking does is what was asked for: the
 * task fades away. The tile strikes through, goes to nothing over FADE_MS, and
 * only then is the row actually removed from data/todos.json — so the animation
 * is the receipt, and the file catches up underneath it.
 *
 * That means DELETE STILL HAS NO UNDO; the undo is `git checkout
 * data/todos.json`, written down in the skill rather than guarded by a dialog
 * nobody wants to click twice a day. The × is kept beside the box for the other
 * ending — the one where the task did not happen, it stopped mattering, and
 * ticking it would be a lie.
 *
 * One transition for the whole list, the way EngineControls does it, plus a
 * pendingId so only the tile you clicked dims. Flag is deliberately NOT
 * optimistic: it is a single click with the result right there, and an
 * optimistic flag that fails flips back, which reads worse than two hundred
 * milliseconds of honest dimming. Adding is optimistic — see pending-todos.ts —
 * and so, now, is ticking: both are the cases where the wait is longer than the
 * confidence.
 *
 * An empty list renders NOTHING. The box above it already says what this is, and
 * the board's own rule holds: an empty state is a worse way of saying nothing
 * than nothing.
 */

// Long enough to read as "that one is going", short enough that a second tick
// does not queue up behind it. Kept in step with .todo.is-done in globals.css —
// the CSS runs the fade, this only decides when the write goes out.
const FADE_MS = 420;

export function TodoList({ todos, writable }: { todos: Todo[]; writable: boolean }) {
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Ticked, faded, and on the way out. They stay listed until the server render
  // drops them, so the tile holds its place rather than the grid reflowing
  // twice.
  const [ticked, setTicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ghosts = usePendingTodos();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  const run = (id: string, action: () => Promise<TodoResult>) => {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      setPendingId(null);
    });
  };

  /**
   * Tick: fade first, write after. If the write fails the tile comes back — the
   * task is still on the list, and a checklist that quietly loses one is worse
   * than one that admits it.
   */
  const tick = (todo: Todo) => {
    if (!writable || ticked.includes(todo.id)) return;
    setError(null);
    // Pruned on the way in rather than in an effect: once the server render has
    // dropped a ticked item there is nothing left to fade, and an effect that
    // setStates to notice that is a cascading render for a list of three.
    setTicked((list) => [
      ...list.filter((id) => todos.some((item) => item.id === id)),
      todo.id,
    ]);
    timers.current.push(
      setTimeout(async () => {
        const result = await deleteTodo(todo.id);
        if (!result.ok) {
          setError(result.error ?? "That didn't work.");
          setTicked((list) => list.filter((id) => id !== todo.id));
        }
      }, FADE_MS),
    );
  };

  if (!todos.length && !ghosts.length) return null;

  return (
    <>
      {error && <p className="todonote is-error">{error}</p>}
      <ul className="todos">
        {ghosts.map((text) => (
          <li key={`ghost:${text}`} className="todo is-pending">
            <span className="todo-box" aria-hidden="true" />
            <span className="todo-text">{text}</span>
          </li>
        ))}

        {todos.map((todo) => {
          const going = ticked.includes(todo.id);
          return (
            <li
              key={todo.id}
              className={`todo${todo.flagged ? " is-flagged" : ""}${
                pendingId === todo.id ? " is-pending" : ""
              }${going ? " is-done" : ""}`}
            >
              {/* A real checkbox, not a button wearing one: this is the one
                  control on the board a keyboard and a screen reader should meet
                  as the thing it is. It never renders checked — a ticked item is
                  a deleted item — so it is uncontrolled with `checked={false}`
                  read back on every render, and the strike-through comes from
                  the class rather than from :checked. */}
              <input
                type="checkbox"
                className="todo-box"
                checked={false}
                readOnly
                disabled={!writable || going}
                title="Done"
                aria-label={`Done: "${todo.text}"`}
                onChange={() => tick(todo)}
              />

              <span className="todo-text">{todo.text}</span>

              <button
                type="button"
                className="todo-btn todo-flag"
                aria-pressed={todo.flagged}
                title={todo.flagged ? "Unflag" : "Flag"}
                aria-label={todo.flagged ? `Unflag "${todo.text}"` : `Flag "${todo.text}"`}
                disabled={!writable || pending || going}
                onClick={() => run(todo.id, () => flagTodo(todo.id, !todo.flagged))}
              >
                {todo.flagged ? "★" : "☆"}
              </button>

              <button
                type="button"
                className="todo-btn todo-del"
                title="Delete"
                aria-label={`Delete "${todo.text}"`}
                disabled={!writable || pending || going}
                onClick={() => run(todo.id, () => deleteTodo(todo.id))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
