import { describe, expect, it } from "vitest";
import { applyUnwatched, applyWatched, watchedIds, WATCHED_CAP } from "../src/lib/watched";
import { WatchedFileSchema, type WatchedFile } from "../src/lib/schema";

/**
 * The cleared-videos list.
 *
 * Pure functions over a literal, the same way todos.test.ts works — no jsdom and
 * no filesystem, because the fs half is four lines that lib/todos.ts already
 * proves. This used to stub localStorage; the list is a file now, which is the
 * whole point (see WatchedFileSchema).
 */

const file = (ids: Record<string, string> = {}): WatchedFile => ({ ids });

describe("clearing one video", () => {
  it("adds an id to an empty file", () => {
    expect(applyWatched(file(), "abc", "2026-09-08")).toEqual({ ids: { abc: "2026-09-08" } });
  });

  it("keeps what is already there — the player must not clobber the list's writes", () => {
    const before = file({ one: "2026-09-01", two: "2026-09-02" });
    expect(applyWatched(before, "three", "2026-09-08").ids).toEqual({
      one: "2026-09-01",
      two: "2026-09-02",
      three: "2026-09-08",
    });
  });

  it("is idempotent, so a doubled end event cannot move the date it already had", () => {
    const once = applyWatched(file(), "abc", "2026-09-01");
    expect(applyWatched(once, "abc", "2026-09-08")).toBe(once);
  });

  it("does not mutate what it was handed", () => {
    const before = file({ one: "2026-09-01" });
    applyWatched(before, "two", "2026-09-08");
    expect(before.ids).toEqual({ one: "2026-09-01" });
  });
});

describe("restoring one", () => {
  it("takes the id back out", () => {
    const before = file({ one: "2026-09-01", two: "2026-09-02" });
    expect(applyUnwatched(before, "one").ids).toEqual({ two: "2026-09-02" });
  });

  it("is a no-op for an id that was never cleared", () => {
    const before = file({ one: "2026-09-01" });
    expect(applyUnwatched(before, "nope")).toBe(before);
  });
});

describe("the bound on the list", () => {
  const many = (n: number, date = "2026-01-01") =>
    file(Object.fromEntries(Array.from({ length: n }, (_, i) => [`v${i}`, date])));

  it(`keeps only ${WATCHED_CAP}, because the feed only ever shows recent ones`, () => {
    const full = applyWatched(many(WATCHED_CAP), "newest", "2026-09-08");
    const kept = Object.keys(full.ids);
    expect(kept).toHaveLength(WATCHED_CAP);
    expect(kept).toContain("newest");
    // The oldest goes, and on a tie that is the one added first.
    expect(kept).not.toContain("v0");
    expect(kept).toContain("v1");
  });

  it("drops by date before position, so a hand-edited file trims sensibly", () => {
    const before = file({ old: "2020-01-01", ...many(WATCHED_CAP - 1, "2026-09-01").ids });
    const kept = watchedIds(applyWatched(before, "newest", "2026-09-08"));
    expect(kept.size).toBe(WATCHED_CAP);
    expect(kept.has("old")).toBe(false);
    expect(kept.has("v0")).toBe(true);
  });
});

describe("the file on disk", () => {
  it("parses one that has no ids yet", () => {
    expect(WatchedFileSchema.parse({})).toEqual({ ids: {} });
  });

  it("refuses a date that is not a date, so a bad hand edit fails loudly", () => {
    expect(() => WatchedFileSchema.parse({ ids: { abc: "yesterday" } })).toThrow();
  });
});
