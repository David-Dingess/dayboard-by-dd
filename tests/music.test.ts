import { describe, expect, it } from "vitest";
import { artworkUrl, isMusicUrl, MUSIC_HOME, MusicCommandSchema, transportScript } from "../src/lib/music";
import { sameSite } from "../src/lib/stream";

describe("the music window's commands", () => {
  const parse = (body: unknown) => MusicCommandSchema.safeParse(body);

  it("opens music.apple.com by default, as a restore", () => {
    const out = parse({ action: "open" });
    expect(out.success).toBe(true);
    expect(out.data).toEqual({ action: "open", url: MUSIC_HOME, fresh: false });
  });

  it("will not become a second stream browser", () => {
    expect(parse({ action: "open", url: "https://tv.apple.com/" }).success).toBe(false);
    expect(parse({ action: "open", url: "http://music.apple.com/" }).success).toBe(false);
    expect(parse({ action: "open", url: "https://music.apple.com.evil.example/" }).success).toBe(false);
    expect(parse({ action: "open", url: "https://music.apple.com/us/playlist/x/pl.123" }).success).toBe(true);
  });

  it("has no mute and no close — hiding the tab must never stop the music", () => {
    expect(parse({ action: "mute", on: true }).success).toBe(false);
    expect(parse({ action: "close" }).success).toBe(false);
  });

  it("takes a box and the transport", () => {
    expect(parse({ action: "place", x: 10, y: 20, w: 1400, h: 900 }).success).toBe(true);
    expect(parse({ action: "place", x: 10, y: 20, w: 0, h: 900 }).success).toBe(false);
    // The corner player, cut out of the window so it stays visible over it.
    const placed = parse({ action: "place", x: 10, y: 20, w: 1400, h: 900, holes: [[900, 600, 480, 300, 12]] });
    expect(placed.success && placed.data.action === "place" && placed.data.holes).toEqual([[900, 600, 480, 300, 12]]);
    expect(parse({ action: "place", x: 10, y: 20, w: 1400, h: 900 }).data).toMatchObject({ holes: [] });
    expect(parse({ action: "place", x: 1, y: 1, w: 9, h: 9, holes: [[1, 1, 1, 1]] }).success).toBe(false);
    for (const action of ["play", "pause", "next", "previous", "back", "home", "reload"]) {
      expect(parse({ action }).success).toBe(true);
    }
  });
});

describe("music helpers", () => {
  it("recognises only music.apple.com over https", () => {
    expect(isMusicUrl("https://music.apple.com/us/home")).toBe(true);
    expect(isMusicUrl("https://apple.com/")).toBe(false);
    expect(isMusicUrl("https://music.youtube.com/")).toBe(true);
    expect(isMusicUrl("http://music.apple.com/")).toBe(false);
    expect(isMusicUrl("not a url")).toBe(false);
  });

  it("fills Apple's artwork templates", () => {
    expect(artworkUrl("https://is1.mzstatic.com/image/thumb/x/{w}x{h}bb.jpg", 300)).toBe(
      "https://is1.mzstatic.com/image/thumb/x/300x300bb.jpg",
    );
    expect(artworkUrl("https://example.com/a.jpg", 300)).toBe("https://example.com/a.jpg");
    expect(artworkUrl(null, 300)).toBeNull();
  });

  it("leaves a board reload inside Apple Music alone", () => {
    expect(sameSite("https://music.apple.com/us/album/x/1", MUSIC_HOME)).toBe(true);
  });

  it("presses the page's own MusicKit", () => {
    expect(transportScript("next")).toContain("mk.skipToNextItem()");
    expect(transportScript("pause")).toContain("mk.pause()");
  });
});
