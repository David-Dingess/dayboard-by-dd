import { describe, expect, it } from "vitest";
import {
  appleTvLinkFromNotes,
  competitionTarget,
  fallbackForCompetition,
  fixtureMatches,
  needsLookup,
  serviceForNetwork,
  teamsFromTitle,
  withinHorizon,
} from "../src/lib/watch";
import type { DayboardEvent } from "../src/lib/schema";

describe("network to service", () => {
  it("maps the networks ESPN actually returns", () => {
    expect(serviceForNetwork("FOX")?.service).toBe("FOX");
    expect(serviceForNetwork("Prime Video")?.url).toContain("amazon.com");
    expect(serviceForNetwork("Apple TV")?.url).toContain("tv.apple.com");
    expect(serviceForNetwork("Paramount+")?.service).toBe("Paramount+");
    expect(serviceForNetwork("NBA TV")?.url).toContain("nba.com");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(serviceForNetwork("  peacock ")?.service).toBe("Peacock");
  });

  it("keeps a regional network's own name but points at the network", () => {
    const regional = serviceForNetwork("FanDuel SN SE");
    expect(regional?.service).toBe("FanDuel SN SE");
    expect(regional?.url).toContain("fanduelsportsnetwork.com");
  });

  it("returns null rather than guessing at an unknown network", () => {
    expect(serviceForNetwork("Some Local Channel 7")).toBeNull();
    expect(serviceForNetwork(null)).toBeNull();
    expect(serviceForNetwork("")).toBeNull();
  });
});

describe("Apple TV deep links in the Atlanta United feed", () => {
  it("finds the per-match link on an away fixture", () => {
    const notes =
      "Atlanta United travels to D.C. United.\nWatch on Apple TV: https://tv.apple.com/us/sporting-event/dc-united-vs-atlanta-united/umc.cse.6sf1abc";
    expect(appleTvLinkFromNotes(notes)).toBe(
      "https://tv.apple.com/us/sporting-event/dc-united-vs-atlanta-united/umc.cse.6sf1abc",
    );
  });

  it("does NOT treat a home fixture's ticket link as a watch link", () => {
    const notes =
      "Atlanta United hosts Orlando City SC in MLS action. View tickets: https://www.atlutd.com/tickets/single-matches";
    expect(appleTvLinkFromNotes(notes)).toBeNull();
  });

  it("survives trailing punctuation and empty notes", () => {
    expect(appleTvLinkFromNotes("see https://tv.apple.com/us/sporting-event/x/umc.1.")).toBe(
      "https://tv.apple.com/us/sporting-event/x/umc.1",
    );
    expect(appleTvLinkFromNotes(undefined)).toBeNull();
  });
});

describe("matching our fixtures to ESPN's", () => {
  it("matches across ESPN's reversed 'Away at Home' wording", () => {
    // ours: Home vs Away. ESPN: Away at Home.
    expect(fixtureMatches("Atlanta Falcons at Pittsburgh Steelers", "Pittsburgh Steelers vs Atlanta Falcons")).toBe(true);
    expect(fixtureMatches("Tottenham Hotspur at Liverpool", "Liverpool - Tottenham Hotspur [LC]")).toBe(true);
    expect(fixtureMatches("Atlanta Hawks at Orlando Magic", "Orlando Magic vs Atlanta Hawks")).toBe(true);
  });

  it("ignores an appended score and a competition marker", () => {
    expect(fixtureMatches("Everton at Tottenham Hotspur", "Tottenham Hotspur - Everton (1-1)")).toBe(true);
  });

  it("tolerates the club-suffix differences between sources", () => {
    // ESPN says "Atlanta United FC", the club's own feed says "Atlanta United".
    expect(fixtureMatches("Orlando City SC at Atlanta United FC", "Atlanta United vs Orlando City SC")).toBe(true);
  });

  it("rejects a different fixture on the same day", () => {
    expect(fixtureMatches("Arsenal at Ipswich Town", "Liverpool - Tottenham Hotspur [LC]")).toBe(false);
    expect(fixtureMatches("Brentford at Reading", "Tottenham Hotspur - Everton")).toBe(false);
  });

  it("refuses a title it cannot split into two sides", () => {
    expect(fixtureMatches("Everton at Tottenham Hotspur", "Some Birthday")).toBe(false);
  });

  it("splits titles into their two sides", () => {
    expect(teamsFromTitle("Tottenham Hotspur - Everton (1-1) [LC]")).toEqual([
      "tottenham hotspur",
      "everton",
    ]);
  });
});

describe("competition fallbacks", () => {
  it("knows where each competition lives", () => {
    expect(fallbackForCompetition("epl")?.service).toBe("Peacock");
    expect(fallbackForCompetition("efl-cup")?.service).toBe("Paramount+");
    expect(fallbackForCompetition("fa-cup")?.service).toBe("ESPN+");
    expect(fallbackForCompetition("mls")?.service).toBe("Apple TV");
    expect(fallbackForCompetition("nba")?.service).toBe("NBA League Pass");
    expect(fallbackForCompetition("nope")).toBeNull();
  });

  it("carries the Premier League caveat, because that fallback can mislead", () => {
    const target = competitionTarget("epl");
    expect(target?.precision).toBe("competition");
    expect(target?.note).toMatch(/USA Network/i);
  });
});

describe("what is worth a request", () => {
  it("skips the past and anything beyond the horizon", () => {
    expect(withinHorizon("2026-09-05", "2026-09-05", 60)).toBe(true);
    expect(withinHorizon("2026-09-04", "2026-09-05", 60)).toBe(false);
    expect(withinHorizon("2026-11-04", "2026-09-05", 60)).toBe(true);
    expect(withinHorizon("2026-12-25", "2026-09-05", 60)).toBe(false);
  });

  it("re-checks a guess but never a resolved link", () => {
    const base = { id: "x", layer: "l", title: "t", start: "2026-09-09" } as DayboardEvent;
    expect(needsLookup(base)).toBe(true);
    expect(
      needsLookup({
        ...base,
        watch: { url: "https://a.example", service: "NBA League Pass", precision: "competition" },
      }),
    ).toBe(true);
    expect(
      needsLookup({
        ...base,
        watch: { url: "https://a.example", service: "FOX", precision: "network" },
      }),
    ).toBe(false);
    expect(
      needsLookup({
        ...base,
        watch: { url: "https://a.example", service: "Apple TV", precision: "deep-link" },
      }),
    ).toBe(false);
  });
});
