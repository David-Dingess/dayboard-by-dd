import { beforeEach, describe, expect, it } from "vitest";
import { recallPosition, rememberPosition } from "../src/components/watching";

/**
 * The store reads localStorage lazily, inside each function rather than at
 * import, so a plain stub assigned before the call is enough — no jsdom.
 */
function stubStorage() {
  const map = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(stubStorage);

describe("remembering where a video got to", () => {
  it("comes back to the second it was left on", () => {
    rememberPosition("abc", 372.6, 3378);
    expect(recallPosition("abc")).toBe(372);
  });

  it("knows nothing about a video it has never seen", () => {
    expect(recallPosition("never")).toBe(0);
  });

  it("ignores the first few seconds — that is not a place to come back to", () => {
    rememberPosition("abc", 4, 3378);
    expect(recallPosition("abc")).toBe(0);
  });

  it("forgets a video watched to the end, so it starts over next time", () => {
    rememberPosition("abc", 600, 3378);
    expect(recallPosition("abc")).toBe(600);
    // Played on to the credits.
    rememberPosition("abc", 3370, 3378);
    expect(recallPosition("abc")).toBe(0);
  });

  it("forgets one that was restarted from the top", () => {
    rememberPosition("abc", 900, 3378);
    rememberPosition("abc", 2, 3378);
    expect(recallPosition("abc")).toBe(0);
  });

  it("trusts the position when the player has not worked out the length yet", () => {
    // getDuration() is 0 until the player is ready; that must not read as
    // "twenty seconds from the end of a zero-length video".
    rememberPosition("abc", 90, 0);
    expect(recallPosition("abc")).toBe(90);
  });

  it("keeps several videos at once, which is the point of a list", () => {
    rememberPosition("one", 100, 3378);
    rememberPosition("two", 200, 3378);
    expect(recallPosition("one")).toBe(100);
    expect(recallPosition("two")).toBe(200);
  });

  it("does not grow without bound", () => {
    for (let i = 0; i < 40; i++) rememberPosition(`v${i}`, 100 + i, 3378);
    expect(recallPosition("v39")).toBe(139);
    // The oldest have been dropped rather than kept forever.
    expect(recallPosition("v0")).toBe(0);
  });

  it("survives junk in storage rather than throwing", () => {
    localStorage.setItem("dayboard.watch.positions", "{not json");
    expect(recallPosition("abc")).toBe(0);
    rememberPosition("abc", 100, 3378);
    expect(recallPosition("abc")).toBe(100);
  });
});
