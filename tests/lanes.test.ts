import { beforeEach, describe, expect, it } from "vitest";
import {
  anythingPlaying,
  clearWatching,
  homeFor,
  laneFor,
  migrateLegacyStream,
  peekWatching,
  writeWatching,
  type Watching,
} from "../src/components/watching";

/** Same stub as positions.test.ts: the store reads storage lazily, so no jsdom. */
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
  return map;
}

const twitch: Watching = {
  kind: "twitch",
  key: "vgbootcamp",
  title: "Riptide",
  channel: "VGBootCamp",
  href: "https://www.twitch.tv/vgbootcamp",
  at: Date.now(),
  origin: "watch",
};

const match: Watching = {
  kind: "stream",
  key: "https://tv.apple.com/us/channel/mls/tvs.sbd.7000",
  title: "D.C. United vs Atlanta United",
  channel: "Apple TV",
  href: "https://tv.apple.com/us/channel/mls/tvs.sbd.7000",
  at: Date.now(),
  origin: "sports",
};

describe("two lanes", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    storage = stubStorage();
  });

  it("sends a stream and a video to different players", () => {
    expect(laneFor("stream")).toBe("stream");
    expect(laneFor("twitch")).toBe("main");
    expect(laneFor("youtube")).toBe("main");
  });

  it("lets a match and a Twitch stream be on at the same time", () => {
    writeWatching(match);
    writeWatching(twitch);
    expect(peekWatching("stream")?.key).toBe(match.key);
    expect(peekWatching("main")?.key).toBe(twitch.key);
  });

  it("closes one without touching the other", () => {
    writeWatching(match);
    writeWatching(twitch);
    clearWatching("main");
    expect(peekWatching("main")).toBeNull();
    expect(peekWatching("stream")?.key).toBe(match.key);
    expect(anythingPlaying()).toBe(true);
    clearWatching("stream");
    expect(anythingPlaying()).toBe(false);
  });

  it("never reads a stream out of the video player's slot, or the reverse", () => {
    storage.set("dayboard.watching", JSON.stringify(match));
    storage.set("dayboard.watching.stream", JSON.stringify(twitch));
    expect(peekWatching("main")).toBeNull();
    expect(peekWatching("stream")).toBeNull();
  });

  it("moves a stream saved before there were two lanes into its own slot", () => {
    storage.set("dayboard.watching", JSON.stringify(match));
    migrateLegacyStream();
    expect(storage.has("dayboard.watching")).toBe(false);
    expect(peekWatching("stream")?.key).toBe(match.key);
  });

  it("leaves a video in the main slot alone", () => {
    storage.set("dayboard.watching", JSON.stringify(twitch));
    migrateLegacyStream();
    expect(peekWatching("main")?.key).toBe(twitch.key);
  });
});

describe("homeFor", () => {
  it("docks a stream in Sports whatever it claims", () => {
    expect(homeFor({ kind: "stream", origin: "watch" })).toBe("sports");
    expect(homeFor({ kind: "stream" })).toBe("sports");
  });

  it("never docks a video in Sports, so the two stages cannot collide", () => {
    expect(homeFor({ kind: "twitch", origin: "sports" })).toBe("watch");
    expect(homeFor({ kind: "youtube", origin: "health" })).toBe("health");
    expect(homeFor({ kind: "youtube" })).toBe("watch");
  });
});
