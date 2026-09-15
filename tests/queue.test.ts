import { beforeEach, describe, expect, it } from "vitest";
import { nextAfter, publishQueue } from "../src/components/queue";
import type { Watching } from "../src/components/watching";

/**
 * What plays after this one. The queue is a plain module variable — nothing
 * renders from it — so these run with no storage stub and no jsdom at all.
 */

function video(key: string): Watching {
  return {
    kind: "youtube",
    key,
    title: `Video ${key}`,
    channel: "A channel",
    href: `https://www.youtube.com/watch?v=${key}`,
    at: 0,
  };
}

beforeEach(() => publishQueue([]));

describe("what comes next", () => {
  it("hands back the one after the current video", () => {
    publishQueue([video("a"), video("b"), video("c")]);
    expect(nextAfter("a")?.key).toBe("b");
    expect(nextAfter("b")?.key).toBe("c");
  });

  it("stops at the end of the list rather than wrapping round to the top", () => {
    publishQueue([video("a"), video("b")]);
    expect(nextAfter("b")).toBeNull();
  });

  it("refuses a key that was never in the list, so a pasted URL does not start the queue", () => {
    publishQueue([video("a"), video("b")]);
    expect(nextAfter("zz")).toBeNull();
  });

  it("refuses everything before the list has mounted, and an empty list after", () => {
    expect(nextAfter("a")).toBeNull();
    publishQueue([]);
    expect(nextAfter("a")).toBeNull();
  });

  it("carries the whole entry, so the player needs nothing else to start it", () => {
    publishQueue([video("a"), video("b")]);
    const next = nextAfter("a");
    expect(next).toMatchObject({
      kind: "youtube",
      key: "b",
      title: "Video b",
      channel: "A channel",
      href: "https://www.youtube.com/watch?v=b",
    });
  });

  it("reads the list as it stands now, not as it stood when it was published", () => {
    publishQueue([video("a"), video("b"), video("c")]);
    // What VideoList does after something is marked watched: republish without it.
    publishQueue([video("a"), video("c")]);
    expect(nextAfter("a")?.key).toBe("c");
  });
});
