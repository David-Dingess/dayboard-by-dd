import { describe, expect, it } from "vitest";
import {
  chromeArgs,
  pageTargets,
  sameSite,
  StreamCommandSchema,
  toClientRect,
} from "../src/lib/stream";

describe("toClientRect", () => {
  it("is the CSS box itself at a device pixel ratio of 1", () => {
    expect(toClientRect({ left: 1040, top: 378, width: 1492, height: 946 }, 1)).toEqual({
      x: 1040,
      y: 378,
      w: 1492,
      h: 946,
    });
  });

  it("scales by the ratio and never leaves a seam on the far edges", () => {
    // Left 12.5 rounds to 13; the bottom edge at 75.25 rounds OUT to 76, not in.
    expect(toClientRect({ left: 10, top: 10, width: 100.4, height: 50.2 }, 1.25)).toEqual({
      x: 13,
      y: 13,
      w: 125,
      h: 63,
    });
  });

  it("treats a nonsense ratio as 1 rather than collapsing the box", () => {
    expect(toClientRect({ left: 0, top: 0, width: 10, height: 10 }, 0).w).toBe(10);
    expect(toClientRect({ left: 0, top: 0, width: 10, height: 10 }, Number.NaN).w).toBe(10);
  });
});

describe("StreamCommandSchema", () => {
  it("wants all four numbers to place the window", () => {
    expect(StreamCommandSchema.safeParse({ action: "place", x: 1, y: 2, w: 3 }).success).toBe(false);
    expect(StreamCommandSchema.safeParse({ action: "place", x: 1, y: 2, w: 3, h: 4 }).success).toBe(true);
  });

  it("only opens https pages", () => {
    expect(StreamCommandSchema.safeParse({ action: "open", url: "https://www.peacocktv.com/" }).success).toBe(true);
    expect(StreamCommandSchema.safeParse({ action: "open", url: "http://www.peacocktv.com/" }).success).toBe(false);
    expect(StreamCommandSchema.safeParse({ action: "open", url: "file:///C:/Windows" }).success).toBe(false);
    expect(StreamCommandSchema.safeParse({ action: "home", url: "javascript:alert(1)" }).success).toBe(false);
  });

  it("treats an open with no word on it as a restore", () => {
    const parsed = StreamCommandSchema.parse({ action: "open", url: "https://tv.apple.com/" });
    expect(parsed).toEqual({ action: "open", url: "https://tv.apple.com/", fresh: false });
  });
});

describe("pageTargets", () => {
  it("keeps the tabs and drops DevTools, extensions and service workers", () => {
    const ws = "ws://127.0.0.1:9224/devtools/page/x";
    const targets = [
      { id: "1", type: "page", url: "https://tv.apple.com/", title: "Apple TV", webSocketDebuggerUrl: ws },
      { id: "2", type: "page", url: "devtools://devtools/bundled/inspector.html", title: "", webSocketDebuggerUrl: ws },
      { id: "3", type: "service_worker", url: "https://tv.apple.com/sw.js", title: "", webSocketDebuggerUrl: ws },
      { id: "4", type: "page", url: "chrome-extension://abc/page.html", title: "", webSocketDebuggerUrl: ws },
      { id: "5", type: "page", url: "https://www.peacocktv.com/", title: "Peacock" },
    ];
    expect(pageTargets(targets).map((t) => t.id)).toEqual(["1"]);
  });
});

describe("sameSite", () => {
  it("matches a service across its subdomains", () => {
    expect(sameSite("https://www.peacocktv.com/watch/x", "https://peacocktv.com/")).toBe(true);
    expect(sameSite("https://tv.apple.com/us/channel/mls", "https://apple.com/")).toBe(true);
  });

  it("does not match different services, or nothing", () => {
    expect(sameSite("https://www.peacocktv.com/", "https://plus.espn.com/")).toBe(false);
    expect(sameSite(null, "https://plus.espn.com/")).toBe(false);
    expect(sameSite("about:blank", "https://plus.espn.com/")).toBe(false);
  });
});

describe("chromeArgs", () => {
  it("puts the page last and the window on the board's monitor", () => {
    const args = chromeArgs({
      profile: "C:\\p",
      port: 9224,
      url: "https://tv.apple.com/",
      monitor: { x: 0, y: -1440 },
    });
    expect(args[0]).toBe("--kiosk");
    expect(args).toContain("--user-data-dir=C:\\p");
    expect(args).toContain("--remote-debugging-port=9224");
    expect(args).toContain("--window-position=40,-1400");
    expect(args.at(-1)).toBe("https://tv.apple.com/");
  });
});
