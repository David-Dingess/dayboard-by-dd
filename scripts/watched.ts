import {
  applyUnwatched,
  applyWatched,
  loadWatched,
  saveWatched,
  WATCHED_CAP,
} from "../src/lib/watched";
import { todayLocal } from "../src/lib/time";

/**
 * The cleared-videos list from a terminal or a chat session.
 *
 *   npm run watched -- list
 *   npm run watched -- clear vdLvdpv4j68      same as pressing the eye
 *   npm run watched -- restore vdLvdpv4j68    the undo
 *
 * `restore` is why this file exists. Clearing a tile removes the only control
 * there was to click, so the board itself cannot offer the undo — it used to be
 * "one line in the browser console against localStorage", which is a thing you
 * have to know rather than a thing you can find. data/watched.json is also a
 * file you can open, and `git checkout data/watched.json` is the bigger undo.
 *
 * This and the eye are the same code: both call the pure pair in
 * src/lib/watched.ts and the same atomic save.
 */

const argv = process.argv.slice(2);
const command = argv[0] ?? "list";
const id = argv[1];

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

if (command === "list") {
  const entries = Object.entries(loadWatched().ids);
  if (!entries.length) {
    console.log("Nothing cleared.");
  } else {
    for (const [key, date] of entries) console.log(`  ${date}  ${key}`);
    console.log(`\n${entries.length} of ${WATCHED_CAP}`);
  }
  process.exit(0);
}

if (command !== "clear" && command !== "restore") {
  die(`Unknown command "${command}". Try: list, clear <id>, restore <id>`);
}
if (!id) die(`${command} needs a YouTube video id.`);

const before = loadWatched();
const after = command === "clear" ? applyWatched(before, id, todayLocal()) : applyUnwatched(before, id);

if (after === before) {
  console.log(command === "clear" ? `${id} was already cleared.` : `${id} was not cleared.`);
  process.exit(0);
}

saveWatched(after);
console.log(command === "clear" ? `Cleared ${id}.` : `Restored ${id} to the list.`);
