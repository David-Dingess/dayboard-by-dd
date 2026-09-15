import { readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic";
import { TodoFileSchema, type Todo } from "./schema";

/**
 * The to-do list: `data/todos.json`, the repo's only file the board itself
 * writes.
 *
 * IT LIVES OUTSIDE data/layers/ ON PURPOSE. `loadCuratedEvents()` parses every
 * JSON file in that directory — and in data/cache/ — as an array of events, so
 * a to-do file in either place would be read, rejected and logged on every
 * render. data/config/ is "what to fetch", stable between changes to the board;
 * this changes several times a day. So: its own file, at the top of data/.
 *
 * NOTHING IN HERE MAY IMPORT FROM `next/*`, and this file must never carry a
 * "use server" directive. It is loaded by `scripts/todo.ts` under plain tsx as
 * well as by the app, and that is the whole point — the CLI (and therefore the
 * chat skill) and the quick-add box write through exactly the same validation
 * and the same atomic save, so neither can produce a file the other rejects.
 * The Next-only half — the gate, revalidatePath — is in todo-actions.ts.
 */

const FILE = path.join(process.cwd(), "data", "todos.json");

/* ---------------------------------------------------------------- pure ---- */

export function applyAdd(list: Todo[], text: string, id: string, now: string): Todo[] {
  return [{ id, text: text.trim(), flagged: false, createdAt: now, updatedAt: now }, ...list];
}

/** Takes the DESIRED state, not a toggle — see the note in todo-actions.ts. */
export function applyFlag(list: Todo[], id: string, flagged: boolean, now: string): Todo[] {
  return list.map((todo) =>
    todo.id === id && todo.flagged !== flagged ? { ...todo, flagged, updatedAt: now } : todo,
  );
}

export function applyRemove(list: Todo[], id: string): Todo[] {
  return list.filter((todo) => todo.id !== id);
}

/**
 * Flagged first, then newest first. Stable within each half, so flagging
 * something moves it up and unflagging puts it back where it was rather than
 * shuffling the list.
 */
export function sortForDisplay(list: Todo[]): Todo[] {
  return [...list].sort((a, b) => Number(b.flagged) - Number(a.flagged));
}

/* ------------------------------------------------------------------ fs ---- */

/**
 * Read every single time. Deliberately NOT cached the way layers.ts caches.
 *
 * That cache is safe because layer files cannot change without a restart. This
 * file has writers OUTSIDE this process — scripts/todo.ts, and the chat skill
 * through it — so the same argument runs the other way. It is also what makes
 * the quick-add box work at all: a Server Action writes the file and calls
 * revalidatePath("/"), and a cached read would then re-render the board from
 * the list as it was before the write.
 */
export function loadTodos(): Todo[] {
  try {
    return TodoFileSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch (err) {
    // A missing file is an empty list, not a broken board.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    console.error(`dayboard: todos unreadable — ${(err as Error).message.split("\n")[0]}`);
    return [];
  }
}

/**
 * Write, atomically: validate, write a sibling temp file, rename over the
 * target. A reader — the next render, the CLI, `cat` in a chat session — can
 * otherwise catch a half-written file, and JSON.parse of half a file throws.
 * The temp file is in the same directory because a rename is only atomic within
 * a volume.
 */
export function saveTodos(next: Todo[]): void {
  writeJsonAtomic(FILE, JSON.stringify(TodoFileSchema.parse(next), null, 2) + "\n");
}
