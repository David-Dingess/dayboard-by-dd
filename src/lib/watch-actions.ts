"use server";

import { revalidatePath } from "next/cache";
import { todoGate, type TodoResult } from "./todo-actions";
import { applyUnwatched, applyWatched, loadWatched, saveWatched } from "./watched";
import { todayLocal } from "./time";

/**
 * The eye on a video tile, and the same write from the player when something
 * reaches its end.
 *
 * Gated by `todoGate` rather than a gate of its own, exactly as job-actions.ts
 * is: the rule is "this request came from the machine the board runs on", it is
 * the same rule, and its reasoning is written down once in todo-actions.ts. What
 * that costs is that the a remote host copy on a phone can no longer clear a video —
 * and that is the right side of the trade, because the copy that could was
 * clearing it only for itself.
 *
 * Returns a result instead of throwing, like every other write path here, so a
 * failed click says so inside the widget instead of replacing the board with an
 * error overlay.
 */

async function apply(mutate: () => void): Promise<TodoResult> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };
  try {
    mutate();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  // watched.json is read fresh on every render, so this is all it takes for the
  // tile to be gone and the count beside the title to move.
  revalidatePath("/");
  return { ok: true };
}

/** The eye, and what the player writes when a video runs out. */
export async function markWatched(id: string): Promise<TodoResult> {
  if (!id.trim()) return { ok: false, error: "No video to clear." };
  return apply(() => saveWatched(applyWatched(loadWatched(), id, todayLocal())));
}

/**
 * Put one back. Not on the board — clearing a tile removes the only thing there
 * was to click — but the undo has to exist somewhere, and now it is either this
 * or an edit to data/watched.json, which is a file you can open.
 */
export async function unmarkWatched(id: string): Promise<TodoResult> {
  if (!id.trim()) return { ok: false, error: "No video to restore." };
  return apply(() => saveWatched(applyUnwatched(loadWatched(), id)));
}
