import { todoId } from "../src/lib/uid";
import {
  applyAdd,
  applyFlag,
  applyRemove,
  loadTodos,
  saveTodos,
  sortForDisplay,
} from "../src/lib/todos";
import { notifyBoard } from "./notify-board";

/**
 * One to-do in, flagged, or out — from a terminal or a chat session.
 *
 *   npm run todo -- list
 *   npm run todo -- add "Renew the ASCAP registration"
 *   npm run todo -- flag todo-2026-09-06-1a2b3c4d
 *   npm run todo -- unflag todo-2026-09-06-1a2b3c4d
 *   npm run todo -- remove todo-2026-09-06-1a2b3c4d
 *
 * This and the quick-add box on the board are the same code: both call the pure
 * trio in src/lib/todos.ts and the same atomic `saveTodos`. NEVER hand-edit
 * data/todos.json — not because an id is sacred the way an event's is, but
 * because that is the only way the file can end up in a shape the board then
 * logs and ignores.
 */

const argv = process.argv.slice(2);
const command = argv[0];
const arg = argv[1];

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const todos = loadTodos();
const now = new Date();

function requireId(): string {
  const id = arg ?? die(`${command} needs an id — run "npm run todo -- list" to see them.`);
  if (!todos.some((todo) => todo.id === id)) die(`No to-do with id "${id}".`);
  return id;
}

if (command === "list") {
  if (!todos.length) {
    console.log("Nothing on the list.");
  } else {
    for (const todo of sortForDisplay(todos)) {
      console.log(`${todo.flagged ? "!" : " "} ${todo.id}  ${todo.text}`);
    }
    console.log(`\n${todos.length} to-do(s), ${todos.filter((t) => t.flagged).length} flagged`);
  }
} else if (command === "add") {
  const text = (arg ?? die('Usage: npm run todo -- add "the thing"')).trim();
  if (!text) die("Nothing to add.");
  if (text.length > 500) die("That's too long for a to-do (500 characters).");
  const id = todoId(now);
  saveTodos(applyAdd(todos, text, id, now.toISOString()));
  console.log(`added ${id}  ${text}`);
} else if (command === "flag" || command === "unflag") {
  const id = requireId();
  saveTodos(applyFlag(todos, id, command === "flag", now.toISOString()));
  console.log(`${command}ged ${id}`);
} else if (command === "remove") {
  const id = requireId();
  const gone = todos.find((todo) => todo.id === id)!;
  saveTodos(applyRemove(todos, id));
  console.log(`removed ${id}  ${gone.text}`);
} else {
  die("Usage: npm run todo -- <list|add|flag|unflag|remove> [text|id]");
}

// `list` only read; add/flag/unflag/remove all wrote. Ping the board to pull it now.
if (command !== "list") notifyBoard();
