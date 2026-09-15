import { describe, expect, it } from "vitest";
import { applyAdd, applyFlag, applyRemove, sortForDisplay } from "../src/lib/todos";
import { TodoFileSchema, type Todo } from "../src/lib/schema";
import { todoId } from "../src/lib/uid";

/**
 * The pure half of the to-do list. The quick-add box and `npm run todo` both
 * call exactly these functions, so a test here covers both writers.
 */

const at = (n: number) => `2026-09-0${n}T12:00:00.000Z`;

const todo = (over: Partial<Todo> = {}): Todo => ({
  id: "todo-2026-09-01-aaaaaaaa",
  text: "Renew the ASCAP registration",
  flagged: false,
  createdAt: at(1),
  updatedAt: at(1),
  ...over,
});

describe("applyAdd", () => {
  it("puts the new one first — the list is its own order, newest down", () => {
    const list = applyAdd([todo()], "Book the mastering session", "todo-x", at(2));
    expect(list.map((t) => t.id)).toEqual(["todo-x", "todo-2026-09-01-aaaaaaaa"]);
    expect(list[0]).toMatchObject({ text: "Book the mastering session", flagged: false });
  });

  it("trims what was typed", () => {
    expect(applyAdd([], "  milk  ", "todo-x", at(2))[0].text).toBe("milk");
  });
});

describe("applyFlag", () => {
  it("sets the desired state rather than toggling, so a double click is idempotent", () => {
    const once = applyFlag([todo()], "todo-2026-09-01-aaaaaaaa", true, at(2));
    const twice = applyFlag(once, "todo-2026-09-01-aaaaaaaa", true, at(3));
    expect(once[0].flagged).toBe(true);
    expect(twice[0].flagged).toBe(true);
    // No change, no new updatedAt — the second click was a no-op, and saying
    // otherwise would rewrite the file for nothing.
    expect(twice[0].updatedAt).toBe(at(2));
  });

  it("stamps updatedAt when the flag actually moves", () => {
    const list = applyFlag([todo()], "todo-2026-09-01-aaaaaaaa", true, at(2));
    expect(list[0].updatedAt).toBe(at(2));
  });

  it("leaves an unknown id alone", () => {
    expect(applyFlag([todo()], "todo-nope", true, at(2))).toEqual([todo()]);
  });
});

describe("applyRemove", () => {
  it("removes by id and is a no-op for one that isn't there", () => {
    expect(applyRemove([todo()], "todo-2026-09-01-aaaaaaaa")).toEqual([]);
    expect(applyRemove([todo()], "todo-nope")).toHaveLength(1);
  });
});

describe("sortForDisplay", () => {
  it("floats flagged to the top and keeps the rest in file order", () => {
    const list = [
      todo({ id: "a", text: "a" }),
      todo({ id: "b", text: "b", flagged: true }),
      todo({ id: "c", text: "c" }),
    ];
    expect(sortForDisplay(list).map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate what it was given", () => {
    const list = [todo({ id: "a" }), todo({ id: "b", flagged: true })];
    sortForDisplay(list);
    expect(list.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("TodoFileSchema", () => {
  it("rejects empty text and text past 500 characters", () => {
    expect(TodoFileSchema.safeParse([todo({ text: "" })]).success).toBe(false);
    expect(TodoFileSchema.safeParse([todo({ text: "x".repeat(501) })]).success).toBe(false);
    expect(TodoFileSchema.safeParse([todo({ text: "x".repeat(500) })]).success).toBe(true);
  });

  it("defaults flagged, so a hand-written entry without it still loads", () => {
    const parsed = TodoFileSchema.parse([
      { id: "todo-x", text: "milk", createdAt: at(1), updatedAt: at(1) },
    ]);
    expect(parsed[0].flagged).toBe(false);
  });
});

describe("todoId", () => {
  it("is unique across a thousand mints on the same day", () => {
    const day = new Date("2026-09-06T12:00:00.000Z");
    const ids = new Set(Array.from({ length: 1000 }, () => todoId(day)));
    expect(ids.size).toBe(1000);
  });

  it("carries the date it was made, for reading the file by eye", () => {
    expect(todoId(new Date("2026-09-06T12:00:00.000Z"))).toMatch(/^todo-2026-09-06-[0-9a-f]{8}$/);
  });
});
