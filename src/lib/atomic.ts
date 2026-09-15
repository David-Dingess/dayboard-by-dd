import { renameSync, writeFileSync } from "node:fs";

/**
 * Write a file the way this board writes every file it owns: to a sibling temp
 * file, then rename over the target.
 *
 * A reader — the next render, a CLI, `cat` in a chat session — can otherwise
 * catch a half-written file, and JSON.parse of half a file throws. The temp file
 * is in the same directory because a rename is only atomic within a volume.
 *
 * Lifted out of lib/todos.ts when a second file arrived with
 * this problem. Both are read on every render and written from more than one
 * process, so both need the same care.
 */
export function writeJsonAtomic(file: string, body: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, body, "utf8");

  // Windows fails a rename over a file another process has open. readFileSync
  // opens and closes fast enough that the window is tiny, but "tiny" on a board
  // that re-renders twice a minute is a bug you hit once a month and can never
  // reproduce.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      lastErr = err;
      sleepSync(20);
    }
  }
  throw lastErr;
}

/** Blocks without spinning. These writes are synchronous by design — every
 *  caller wants the file on disk before it returns — so this cannot be a promise. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
