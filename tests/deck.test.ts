import { describe, expect, it } from "vitest";
import {
  DECK_TABS,
  DeckCommandSchema,
  buildDeckState,
  eventsFor,
  isTab,
  type DeckCommand,
} from "../src/lib/deck";
import { buildWaterSnapshot, emptyWater, applyDrink } from "../src/lib/water";
import type { Video, YouTubeChannel } from "../src/lib/youtube";
import type { LiveStream } from "../src/lib/twitch";

/**
 * The Stream Deck's vocabulary.
 *
 * The rules worth pinning are the ones a bad key would otherwise break
 * silently: a tab id that Panel would fall back out of, an audio command that
 * names both a destination and a mute, and the fact that only three of the six
 * commands are supposed to reach the browser at all.
 */

const parse = (body: unknown) => DeckCommandSchema.safeParse(body);
const ok = (body: unknown) => {
  const r = parse(body);
  if (!r.success) throw new Error(r.error.issues[0]?.message);
  return r.data;
};

describe("the tab lists", () => {
  it("are the ids page.tsx declares, in order", () => {
    // If this fails, page.tsx and lib/deck.ts have drifted — fix deck.ts, not
    // this test, and read the DECK_TABS docblock first.
    expect(DECK_TABS.center).toEqual(["calendar", "music", "watch", "sports", "health"]);
    expect(DECK_TABS.right).toEqual(["planner", "notes", "pc", "mail", "amazon"]);
  });

  it("do not leak across panels", () => {
    expect(isTab("center", "watch")).toBe(true);
    // A real tab, on the wrong side. Panel would ignore it and quietly show
    // tabs[0], which reads as a dead button.
    expect(isTab("center", "mail")).toBe(false);
  });
});

describe("the command schema", () => {
  it("takes a tab that exists", () => {
    expect(ok({ cmd: "tab", side: "right", id: "notes" })).toEqual({
      cmd: "tab",
      side: "right",
      id: "notes",
    });
  });

  it("refuses a tab that does not", () => {
    expect(parse({ cmd: "tab", side: "center", id: "nope" }).success).toBe(false);
    expect(parse({ cmd: "tab", side: "center", id: "mail" }).success).toBe(false);
    expect(parse({ cmd: "tab", side: "middle", id: "watch" }).success).toBe(false);
  });

  it("refuses a command it has never heard of", () => {
    expect(parse({ cmd: "reboot" }).success).toBe(false);
    expect(parse({}).success).toBe(false);
    expect(parse("tab").success).toBe(false);
  });

  it("fills in what a play key did not bother to send", () => {
    const c = ok({ cmd: "play", kind: "youtube", key: "abc123" }) as Extract<
      DeckCommand,
      { cmd: "play" }
    >;
    expect(c.title).toBe("");
    expect(c.href).toBe("");
  });

  it("holds the same water bound the widget does", () => {
    expect(parse({ cmd: "water", ounces: 16 }).success).toBe(true);
    expect(parse({ cmd: "water", ounces: -8 }).success).toBe(true);
    // Zero is a key that does nothing, and 500oz is a slipped finger on a
    // number field, not a drink.
    expect(parse({ cmd: "water", ounces: 0 }).success).toBe(false);
    expect(parse({ cmd: "water", ounces: 500 }).success).toBe(false);
    expect(parse({ cmd: "water", ounces: 8.5 }).success).toBe(false);
  });

  it("plays a team's stream, but only an https site", () => {
    expect(
      parse({ cmd: "play", kind: "stream", key: "https://tv.apple.com/", href: "https://tv.apple.com/" }).success,
    ).toBe(true);
    expect(parse({ cmd: "play", kind: "stream", key: "x", href: "javascript:alert(1)" }).success).toBe(false);
    expect(parse({ cmd: "play", kind: "stream", key: "x" }).success).toBe(false);
  });

  it("takes the reset, and the route — not the event list — answers it", () => {
    expect(parse({ cmd: "reset" }).success).toBe(true);
    expect(eventsFor(ok({ cmd: "reset" }))).toEqual([]);
  });

  it("makes audio pick one thing to do", () => {
    expect(parse({ cmd: "audio", output: "toggle" }).success).toBe(true);
    expect(parse({ cmd: "audio", mute: "on" }).success).toBe(true);
    // Both, or neither, is a key whose behaviour depends on which branch the
    // agent happens to check first.
    expect(parse({ cmd: "audio", output: "toggle", mute: "on" }).success).toBe(false);
    expect(parse({ cmd: "audio" }).success).toBe(false);
  });
});

describe("what reaches the browser", () => {
  it("is the three things that live only in localStorage", () => {
    expect(eventsFor(ok({ cmd: "tab", side: "center", id: "health" }))).toHaveLength(1);
    expect(eventsFor(ok({ cmd: "expand", on: true }))).toHaveLength(1);
    expect(eventsFor(ok({ cmd: "play", kind: "twitch", key: "somestreamer" }))).toHaveLength(1);
  });

  it("carries the alerts poke, which has no payload at all", () => {
    expect(eventsFor(ok({ cmd: "alerts" }))).toEqual([{ type: "alerts" }]);
  });

  it("is a nudge, for audio", () => {
    // The agent already made the change; the board only needs telling to look.
    expect(eventsFor(ok({ cmd: "audio", output: "toggle" }))).toEqual([
      { type: "refresh-audio" },
    ]);
  });

  it("is nothing at all for water and pin", () => {
    // Water arrives through the normal render path, and the pin is not a fact
    // about the page. A frame for either would be a frame nobody reads.
    expect(eventsFor(ok({ cmd: "water", ounces: 8 }))).toEqual([]);
    expect(eventsFor(ok({ cmd: "pin", pin: "toggle" }))).toEqual([]);
  });
});

describe("buildDeckState", () => {
  const NOW = Date.parse("2026-09-08T18:00:00Z");
  const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

  const video = (id: string, title: string, minutesAgo: number): Video => ({
    id,
    title,
    channel: "SomeStreamer",
    channelId: "UC3tNpTOHsTnkmbwztCs30sA",
    published: iso(minutesAgo),
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  });

  const nl: YouTubeChannel = {
    id: "UC3tNpTOHsTnkmbwztCs30sA",
    name: "SomeStreamer",
    titleFormat: "statement-game",
  };

  const stream: LiveStream = {
    id: "42",
    login: "somestreamer",
    name: "SomeStreamer",
    title: "the eternal jester",
    game: "",
    viewers: 4200,
    startedAt: iso(75),
    url: "https://www.twitch.tv/somestreamer",
    avatar: null,
    preview: "",
  };

  const build = (over: Partial<Parameters<typeof buildDeckState>[0]> = {}) =>
    buildDeckState({
      videos: [video("aaa", "a soul for a soul (Slay the Spire 2)", 10)],
      cleared: new Set<string>(),
      channels: [nl],
      streams: [stream],
      water: buildWaterSnapshot(applyDrink(emptyWater(), "2026-09-08", 24), "2026-09-08"),
      audio: null,
      board: null,
      now: NOW,
      ...over,
    });

  it("splits a SomeStreamer title so a 72px key can lead with the game", () => {
    const [v] = build().videos;
    expect(v.game).toBe("Slay the Spire 2");
    expect(v.statement).toBe("a soul for a soul");
    // The whole title survives too — the key shows one, the log wants the other.
    expect(v.title).toBe("a soul for a soul (Slay the Spire 2)");
  });

  it("leaves a channel that does not write titles that way alone", () => {
    const [v] = build({ channels: [{ ...nl, titleFormat: "plain" }] }).videos;
    expect(v.game).toBeNull();
    expect(v.statement).toBe("a soul for a soul (Slay the Spire 2)");
  });

  it("drops what the board has already cleared", () => {
    // The deck and the panel must be looking at the same list, or pressing key
    // 3 plays something other than the third tile.
    expect(build({ cleared: new Set(["aaa"]) }).videos).toHaveLength(0);
  });

  it("settles the clock here, not on the deck", () => {
    const [v] = build().videos;
    expect(v.ago).toBe("10m ago");
    expect(v.fresh).toBe(true);
    expect(build().streams[0].uptime).toBe("1h15m");
    expect(build().streams[0].viewers).toBe("4.2k");
  });

  it("calls an empty category Just Chatting, like the panel does", () => {
    expect(build().streams[0].game).toBe("Just Chatting");
  });

  it("carries the water numbers a key draws on itself", () => {
    expect(build().water.ounces).toBe(24);
    expect(build().water.goalOz).toBe(80);
  });

  it("says the agent is absent rather than inventing a mixer", () => {
    expect(build().audio).toBeNull();
    expect(build().board).toBeNull();
  });
});
