import { describe, expect, it } from "vitest";
import { youtubeState } from "../src/lib/embed";

/**
 * The one line auto-advance rests on.
 *
 * YouTube reports "the video finished" (0) and "the player has not started yet"
 * (-1, 5) as different numbers, and the adapter used to flatten all three into
 * "idle". Telling 0 apart from the rest is what makes it possible to start the
 * next video without also starting one every time a player mounts.
 */
describe("reading YouTube's state numbers", () => {
  it("calls 1 playing, and 3 playing too — buffering is on its way to playing", () => {
    expect(youtubeState(1)).toBe("playing");
    expect(youtubeState(3)).toBe("playing");
  });

  it("calls 2 paused", () => {
    expect(youtubeState(2)).toBe("paused");
  });

  it("calls 0 ended, which is the whole point", () => {
    expect(youtubeState(0)).toBe("ended");
  });

  it("does NOT call unstarted or cued ended — a fresh player must not advance", () => {
    expect(youtubeState(-1)).toBe("idle");
    expect(youtubeState(5)).toBe("idle");
  });

  it("treats anything unexpected as idle rather than throwing", () => {
    expect(youtubeState(99)).toBe("idle");
  });
});
