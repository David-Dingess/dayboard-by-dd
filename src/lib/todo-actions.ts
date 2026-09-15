"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { todoId } from "./uid";
import {
  applyAdd,
  applyFlag,
  applyRemove,
  loadTodos,
  saveTodos,
} from "./todos";

/**
 * The three writes behind the quick-add box, and the gate in front of them.
 *
 * This is the second write path in the app after engine-actions.ts, and the
 * first one that touches the repo. It follows that file exactly: every action
 * returns a result instead of throwing, because a failed button should say so
 * inside the widget rather than replacing the whole board with an error
 * overlay.
 */

export interface TodoResult {
  ok: boolean;
  error?: string;
}

/**
 * `next dev` binds 0.0.0.0 and prints a Network URL, so "anything on the LAN can
 * POST to a file-writing endpoint" is a real state of this machine, not a
 * hypothesis. The gate is therefore "did this request come from this machine" —
 * a fact, not a flag somebody has to remember to set. An ENGINE_CONTROL-style
 * env var would have been wrong here for one reason: a capture box that is
 * silently off until you set a variable is a capture box you stop using.
 *
 * NOT AN AUTHENTICATION BOUNDARY. Host is client-controlled. This stops a casual
 * hit from the LAN, not a determined one, and it fails the right way if the
 * board is ever put behind a hostname again — writes refuse, reads carry on.
 *
 * As in engine-control.ts, it is checked twice: once at render time to decide
 * what the widget draws, and once in here, which is the only one that counts.
 * Render-time gating is not a security boundary — a disabled button in the UI
 * stops nobody from sending the same request.
 */
export async function todoGate(): Promise<{ ok: boolean; reason: string }> {
  if (process.env.DAYBOARD_TODOS === "0") {
    return { ok: false, reason: "To-dos are read-only here." };
  }
  const host = ((await headers()).get("host") ?? "").split(":")[0].toLowerCase();
  const local = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (local.has(host)) return { ok: true, reason: "" };
  return {
    ok: false,
    reason: "To-dos can only be changed from the machine the board runs on.",
  };
}

async function apply(mutate: () => void): Promise<TodoResult> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };
  try {
    mutate();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  // The board reads todos.json fresh on every render (see todos.ts), so this is
  // all it takes for the new list to be on screen.
  revalidatePath("/");
  return { ok: true };
}

export async function addTodo(text: string): Promise<TodoResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Nothing to add." };
  if (trimmed.length > 500) return { ok: false, error: "That's too long for a to-do." };
  const now = new Date();
  return apply(() =>
    saveTodos(applyAdd(loadTodos(), trimmed, todoId(now), now.toISOString())),
  );
}

/**
 * Takes the DESIRED state rather than toggling, the way `setEnabled(next)` does
 * in engine-actions.ts. A toggle read-modify-writes against whatever the client
 * last saw, so a double-click lands twice and ends where it started.
 */
export async function flagTodo(id: string, flagged: boolean): Promise<TodoResult> {
  return apply(() => saveTodos(applyFlag(loadTodos(), id, flagged, new Date().toISOString())));
}

export async function deleteTodo(id: string): Promise<TodoResult> {
  return apply(() => saveTodos(applyRemove(loadTodos(), id)));
}
