import { NotesEditor } from "@/components/NotesEditor";
import { TodoAdd } from "@/components/TodoAdd";
import { TodoList } from "@/components/TodoList";
import { loadNotes } from "@/lib/notes";
import { loadTodos, sortForDisplay } from "@/lib/todos";
import { todoGate } from "@/lib/todo-actions";

/**
 * The board's one capture tab: a checklist on top, a page to type on below.
 *
 * THE TWO HALVES ARE THE SAME ACT. Both are "get it out of your head before it
 * is lost", and the only difference is whether the thing has a shape yet. A line
 * that is already a task goes in the box and becomes a tile you can tick off; a
 * thought that is not shaped enough to be an item goes in the page underneath
 * and stays prose. Splitting them across two tabs — the to-dos above the agenda
 * in the Planner, the notepad at the far end of the tab row — meant deciding
 * which one a half-formed sentence was BEFORE writing it down, which is exactly
 * the decision that makes people stop writing things down.
 *
 * FIVE GRID ROWS, and the split is the point — see .widget.notes in globals.css.
 * The head and the add box are pinned, the checklist takes the top half and
 * scrolls, the page takes the bottom half, and the save line is pinned under it.
 * The add box is outside the scroller for the same reason it always was:
 * a capture box you have to scroll back up to find is a capture box you stop
 * using.
 *
 * To-dos are read here, fresh, every render — see lib/todos.ts for why that file
 * is deliberately not cached. The gate is read for the look of the thing; both
 * actions re-check it, and that is the check that counts.
 */
export async function NotesWidget() {
  const notes = loadNotes();
  const todos = loadTodos();
  const gate = await todoGate();
  const flagged = todos.filter((todo) => todo.flagged).length;

  return (
    <div className="widget notes">
      <div className="widget-head">
        <h2 className="widget-title">Notes / To-Do</h2>
        <span className="widget-meta">
          {todos.length > 0 &&
            `${todos.length} to-do${todos.length === 1 ? "" : "s"}${
              flagged ? ` · ${flagged} flagged` : ""
            } · `}
          {notes.text.length > 0
            ? `${notes.text.length.toLocaleString()} characters`
            : "page empty"}
        </span>
      </div>

      <TodoAdd writable={gate.ok} reason={gate.reason} />

      <div className="widget-scroll notes-todos">
        <TodoList todos={sortForDisplay(todos)} writable={gate.ok} />
      </div>

      <NotesEditor
        text={notes.text}
        updatedAt={notes.updatedAt}
        writable={gate.ok}
        reason={gate.reason}
      />
    </div>
  );
}
