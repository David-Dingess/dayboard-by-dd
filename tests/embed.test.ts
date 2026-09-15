import { describe, expect, it } from "vitest";
import { parentHosts, parseWatchUrl, twitchOptions, youtubeVars } from "../src/lib/embed";

describe("twitch parent hosts", () => {
  it("puts the live page host first, because that is the one Twitch checks", () => {
    expect(parentHosts("https://board.example.com", "192.168.1.40")).toEqual([
      "192.168.1.40",
      "localhost",
      "board.example.com",
    ]);
  });

  it("does not repeat localhost when that is already the page host", () => {
    expect(parentHosts("https://board.example.com", "localhost")).toEqual([
      "localhost",
      "board.example.com",
    ]);
  });

  it("survives a site URL that is not a URL", () => {
    expect(parentHosts("not a url", "localhost")).toEqual(["localhost"]);
    expect(parentHosts(undefined, undefined)).toEqual(["localhost"]);
  });
});

describe("player options", () => {
  it("hides YouTube's own fullscreen button, so the panel keeps that job", () => {
    expect(youtubeVars({ autoplay: true, origin: "http://localhost:3000" }).fs).toBe(0);
  });

  it("carries the origin the JS API needs, and the autoplay flag both ways", () => {
    const on = youtubeVars({ autoplay: true, origin: "http://localhost:3000" });
    const off = youtubeVars({ autoplay: false, origin: "http://localhost:3000" });
    expect(on.autoplay).toBe(1);
    expect(off.autoplay).toBe(0);
    expect(on.origin).toBe("http://localhost:3000");
    expect(on.enablejsapi).toBe(1);
  });

  it("hands Twitch every parent, since a wrong one renders black in silence", () => {
    const options = twitchOptions("somestreamer", {
      autoplay: false,
      parents: ["localhost", "board.example.com"],
    });
    expect(options.channel).toBe("somestreamer");
    expect(options.parent).toEqual(["localhost", "board.example.com"]);
    expect(options.autoplay).toBe(false);
  });
});

describe("parsing a pasted link", () => {
  it("takes every shape YouTube hands out", () => {
    const id = "aqz-KE-bpKQ";
    for (const input of [
      id,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/watch?v=${id}&t=90s`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `youtube.com/watch?v=${id}`,
    ]) {
      expect(parseWatchUrl(input), input).toEqual({ kind: "youtube", key: id });
    }
  });

  it("takes a Twitch channel, however it was written", () => {
    expect(parseWatchUrl("https://www.twitch.tv/SomeStreamer")).toEqual({
      kind: "twitch",
      key: "somestreamer",
    });
    expect(parseWatchUrl("twitch.tv/somestreamer")).toEqual({
      kind: "twitch",
      key: "somestreamer",
    });
    expect(parseWatchUrl("https://player.twitch.tv/?channel=somestreamer&parent=x")).toEqual({
      kind: "twitch",
      key: "somestreamer",
    });
  });

  it("refuses what the player cannot actually show", () => {
    // Twitch's own pages that are not channels, and a VOD, which needs a
    // different set of options than this carries.
    expect(parseWatchUrl("https://www.twitch.tv/videos/123456")).toBeNull();
    expect(parseWatchUrl("https://www.twitch.tv/directory/following/live")).toBeNull();
    // A page on YouTube that is not a video is still not a video.
    expect(parseWatchUrl("https://www.youtube.com/feed/subscriptions")).toBeNull();
    // Nor is a site that is not a streaming service, or one over plain http.
    expect(parseWatchUrl("https://www.google.com/search?q=football")).toBeNull();
    expect(parseWatchUrl("http://www.peacocktv.com/sports")).toBeNull();
    expect(parseWatchUrl("https://www.amazon.com/dp/B0CHX1W1XY")).toBeNull();
    expect(parseWatchUrl("nonsense")).toBeNull();
    expect(parseWatchUrl("")).toBeNull();
    // Right shape, wrong length — an 11-character id is the whole rule.
    expect(parseWatchUrl("https://youtu.be/tooshort")).toBeNull();
  });
});

describe("stream links", () => {
  it("opens a streaming service's own pages in the stream window", () => {
    expect(parseWatchUrl("https://www.peacocktv.com/sports/premier-league")).toEqual({
      kind: "stream",
      key: "https://www.peacocktv.com/sports/premier-league",
      service: "Peacock",
    });
    expect(parseWatchUrl("tv.apple.com/us/channel/mls/tvs.sbd.7000")).toEqual({
      kind: "stream",
      key: "https://tv.apple.com/us/channel/mls/tvs.sbd.7000",
      service: "Apple TV",
    });
  });

  it("tells the more specific host apart from the one it ends in", () => {
    expect(parseWatchUrl("https://plus.espn.com/")?.service).toBe("ESPN+");
    expect(parseWatchUrl("https://www.espn.com/watch/")?.service).toBe("ESPN");
    expect(parseWatchUrl("https://www.amazon.com/gp/video/storefront")?.service).toBe("Prime Video");
  });

  it("does not let a look-alike host through on a shared suffix", () => {
    expect(parseWatchUrl("https://notpeacocktv.com/")).toBeNull();
    expect(parseWatchUrl("https://espn.com.evil.example/")).toBeNull();
  });
});
