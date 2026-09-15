import { readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic";
import { NotesFileSchema, type NotesFile } from "./schema";

/**
 * The notepad: `data/notes.json`, the fourth file the board writes itself.
 *
 * Same shape as todos.ts and health-store.ts, and for the same reasons — a pure
 * half that imports nothing from `next/*`, an uncached read, an atomic write,
 * and a CLI (`scripts/notes.ts`) on exactly this code path so the chat skill and
 * the textarea cannot produce a file the other rejects. The Next-only half —
 * the gate, revalidatePath — is in notes-actions.ts.
 *
 * WHITESPACE IS NOT TRIMMED, unlike a to-do's text. A trailing blank line in a
 * to-do is a mistake; in a scratch pad it is where the next thought goes, and
 * trimming it on every autosave would move the caret out from under the cursor
 * mid-sentence.
 */

const FILE = path.join(process.cwd(), "data", "notes.json");

/* ---------------------------------------------------------------- pure ---- */

export const emptyNotes = (): NotesFile => NotesFileSchema.parse({});

export function applyText(file: NotesFile, text: string, now: string): NotesFile {
  // An unchanged save is a no-op rather than a new timestamp: the editor flushes
  // on blur and on losing visibility as well as on the timer, so the same text
  // arrives several times over, and each one would otherwise say "saved just
  // now" about a save that changed nothing.
  if (text === file.text) return file;
  return { ...file, text, updatedAt: now };
}

/* ------------------------------------------------------------------ fs ---- */

/** Read every time — see loadTodos for why nothing under data/ is cached. */
export function loadNotes(): NotesFile {
  try {
    return NotesFileSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyNotes();
    console.error(`dayboard: notes unreadable — ${(err as Error).message.split("\n")[0]}`);
    return emptyNotes();
  }
}

export function saveNotes(next: NotesFile): void {
  writeJsonAtomic(FILE, JSON.stringify(NotesFileSchema.parse(next), null, 2) + "\n");
}
