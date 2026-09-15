import { readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic";
import { WatchedFileSchema, type WatchedFile } from "./schema";

/**
 * The videos you have cleared off the Watch list.
 *
 * Same shape as lib/todos.ts and for the same reasons: pure functions that a test
 * can call with a literal, an uncached read because the board renders twice a
 * minute and a Server Action writes between two of those renders, and an atomic
 * write because a CLI and a render can be looking at the file at the same
 * moment. The schema docblock is where the "why a file at all" argument lives.
 *
 * NOTHING IN HERE MAY IMPORT FROM `next/*` — the same rule lib/todos.ts and
 * lib/todos.ts keep, so the file stays loadable from a plain `tsx` script.
 */

const FILE = path.join(process.cwd(), "data", "watched.json");

/**
 * How many ids are worth keeping.
 *
 * The feed is the last twenty videos of one channel, capped at ninety days
 * (data/config/youtube.json), so an id that has fallen off the end can never
 * come back and asking the file about it is dead weight. Four hundred is a year
 * of a daily channel with room to spare, and it bounds a file on disk.
 */
export const WATCHED_CAP = 400;

const EMPTY: WatchedFile = { ids: {} };

/* ---------------------------------------------------------------- pure ---- */

/**
 * Clear one video, keeping the date it already had if it has one.
 *
 * IDEMPOTENT ON PURPOSE, and that is load-bearing rather than tidy: the player
 * marks a video when it reaches the end, and a doubled `ended` event or a click
 * on the eye of something already gone would otherwise move its date forward and
 * quietly push a genuinely older id out through the cap.
 */
export function applyWatched(file: WatchedFile, id: string, date: string): WatchedFile {
  if (file.ids[id]) return file;
  return { ids: trim({ ...file.ids, [id]: date }) };
}

/** Back on the list. The undo, for a hand edit or a script. */
export function applyUnwatched(file: WatchedFile, id: string): WatchedFile {
  if (!file.ids[id]) return file;
  const ids = { ...file.ids };
  delete ids[id];
  return { ids };
}

/** What the list filters against. */
export function watchedIds(file: WatchedFile): Set<string> {
  return new Set(Object.keys(file.ids));
}

/**
 * Drop the oldest down to the cap.
 *
 * Ordered by date first and by position in the file second. Dates here have
 * day resolution, so everything cleared in one sitting ties — and insertion
 * order is the only thing that can break that tie, which is exactly the order
 * they were cleared in. The survivors are put back in file order so the file
 * still reads chronologically after a trim rather than newest-first.
 */
function trim(ids: Record<string, string>): Record<string, string> {
  const entries = Object.entries(ids);
  if (entries.length <= WATCHED_CAP) return ids;

  const kept = entries
    .map((entry, at) => ({ entry, at }))
    .sort((a, b) => a.entry[1].localeCompare(b.entry[1]) || a.at - b.at)
    .slice(entries.length - WATCHED_CAP)
    .sort((a, b) => a.at - b.at);

  return Object.fromEntries(kept.map(({ entry }) => entry));
}

/* ------------------------------------------------------------------ fs ---- */

/**
 * Read the file, uncached.
 *
 * A missing file is the normal state of a fresh clone, not a fault. Anything
 * else — bad JSON, a shape the schema refuses — is logged and treated as empty,
 * which shows the whole feed rather than a broken panel. That is the same trade
 * loadJobsState makes: a board that over-shows is legible, one that throws is
 * not.
 */
export function loadWatched(): WatchedFile {
  try {
    return WatchedFileSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    console.error(`dayboard: watched.json unreadable — ${(err as Error).message.split("\n")[0]}`);
    return EMPTY;
  }
}

export function saveWatched(next: WatchedFile): void {
  writeJsonAtomic(FILE, JSON.stringify(WatchedFileSchema.parse(next), null, 2) + "\n");
}
