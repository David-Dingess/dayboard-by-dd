"use server";

import { revalidatePath } from "next/cache";
import { todoGate, type TodoResult } from "./todo-actions";
import { applyText, loadNotes, saveNotes } from "./notes";
import { NotesFileSchema } from "./schema";

/**
 * The one write behind the notepad.
 *
 * `todoGate` is imported rather than copied, the same way health-actions.ts
 * does it: "did this request come from this machine" is one fact about the
 * deployment, and a second copy would be a second thing to keep in step.
 *
 * It returns `updatedAt` on success, which the other action files do not need
 * to. The editor shows "saved 12s ago", and the alternative — waiting for the
 * next server render to learn when the save it just made happened — would leave
 * the line blank for up to thirty seconds after every keystroke stopped.
 */

export async function saveNotesText(
  text: string,
): Promise<TodoResult & { updatedAt?: string }> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };

  // Re-parsed here, not just at the maxLength on the textarea: the render-time
  // limit is a courtesy to the typist, and this is the one that counts.
  const parsed = NotesFileSchema.shape.text.safeParse(text);
  if (!parsed.success) {
    return { ok: false, error: "That is longer than this page can hold." };
  }

  try {
    const now = new Date().toISOString();
    const next = applyText(loadNotes(), parsed.data, now);
    saveNotes(next);
    revalidatePath("/");
    return { ok: true, updatedAt: next.updatedAt };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
