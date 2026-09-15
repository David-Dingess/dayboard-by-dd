import { readFileSync } from "node:fs";
import { applyText, loadNotes, saveNotes } from "../src/lib/notes";
import { notifyBoard } from "./notify-board";

/**
 * The notepad from a terminal or a chat session.
 *
 *   npm run notes -- show
 *   npm run notes -- append "the thing you just thought of"
 *   npm run notes -- set "replaces everything"
 *   npm run notes -- set --file notes.txt
 *   npm run notes -- clear
 *
 * Same code path as the textarea: both call `applyText` and the same atomic
 * save, so neither can write a file the other rejects.
 *
 * A WRITE FROM HERE REACHES THE BOARD WITHIN A TICK — but only if nothing is
 * half-typed in the textarea. NotesEditor refuses to overwrite unsaved text and
 * says the file moved instead. That is deliberate: this is the second writer,
 * and the person at the keyboard wins.
 */

const argv = process.argv.slice(2);
const command = argv[0];
const rest = argv.slice(1);

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const option = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

const file = loadNotes();
const now = new Date().toISOString();

function bodyFromArgs(): string {
  const path = option("file");
  if (path) return readFileSync(path, "utf8");
  const text = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--file").join(" ");
  if (!text) die('Nothing to write. Pass some text, or --file <path>.');
  return text;
}

if (command === "show") {
  if (!file.text) console.log("(empty)");
  else console.log(file.text);
  if (file.updatedAt) console.error(`\n— ${file.text.length} characters, last written ${file.updatedAt}`);
} else if (command === "append") {
  const addition = bodyFromArgs();
  // A blank line between what was there and what is new, so appended thoughts
  // do not run into the end of the last one.
  const joined = file.text.trim() ? `${file.text.replace(/\s+$/, "")}\n\n${addition}` : addition;
  saveNotes(applyText(file, joined, now));
  console.log(`appended ${addition.length} characters`);
} else if (command === "set") {
  const body = bodyFromArgs();
  saveNotes(applyText(file, body, now));
  console.log(`wrote ${body.length} characters`);
} else if (command === "clear") {
  saveNotes(applyText(file, "", now));
  console.log("cleared");
} else {
  die(
    [
      "Usage:",
      "  npm run notes -- show",
      '  npm run notes -- append "text"   [--file path]',
      '  npm run notes -- set "text"      [--file path]',
      "  npm run notes -- clear",
    ].join("\n"),
  );
}

// `show` only read; everything else wrote. Ping the board to pull it now.
if (command !== "show") notifyBoard();
