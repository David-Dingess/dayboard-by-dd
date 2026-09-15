import { describe, expect, it } from "vitest";
import { competitionsForLayer, parseScoreboard } from "../src/lib/scores";
import type { EspnEvent } from "../src/lib/espn";
import type { DayboardEvent } from "../src/lib/schema";

/**
 * The parsing half of the live score, driven off a trimmed copy of what ESPN
 * actually answered — Everton 2-2 Manchester United, eng.1, 6 September 2026.
 * The fetch is not tested; the point of exporting parseScoreboard separately is
 * that everything which can be wrong about a score can be tested without it.
 */

const base = {
  id: "sports-spurs:u-abc",
  layer: "sports-spurs",
  allDay: false,
  tz: "America/New_York",
  source: { kind: "upstream" as const },
  status: "confirmed" as const,
  seq: 0,
  updatedAt: "2026-09-05T00:00:00.000Z",
};

const ev = (title: string): DayboardEvent =>
  ({ ...base, title, start: "2026-09-06T10:00:00-04:00" }) as DayboardEvent;

/** Home listed first, the way eng.1 sent it. */
const finished: EspnEvent = {
  name: "Manchester United at Everton",
  competitions: [
    {
      status: {
        clock: 5400,
        displayClock: "90'+7'",
        period: 2,
        type: { state: "post", completed: true, detail: "FT", shortDetail: "FT" },
      },
      competitors: [
        { homeAway: "home", score: "2", team: { displayName: "Everton", shortDisplayName: "Everton", abbreviation: "EVE" } },
        { homeAway: "away", score: "2", team: { displayName: "Manchester United", shortDisplayName: "Man United", abbreviation: "MAN" } },
      ],
    },
  ],
  links: [{ text: "Gamecast", href: "https://www.espn.com/soccer/match/_/gameId/704321/league/eng.1" }],
};

/** The same match in progress, with the AWAY side listed first. */
const inPlay: EspnEvent = {
  name: "Tottenham Hotspur at Arsenal",
  competitions: [
    {
      status: {
        displayClock: "0:00",
        period: 1,
        type: { state: "in", completed: false, detail: "34'", shortDetail: "34'" },
      },
      competitors: [
        { homeAway: "away", score: "1", team: { displayName: "Tottenham Hotspur", shortDisplayName: "Tottenham", abbreviation: "TOT" } },
        { homeAway: "home", score: "0", team: { displayName: "Arsenal", shortDisplayName: "Arsenal", abbreviation: "ARS" } },
      ],
    },
  ],
};

describe("parseScoreboard", () => {
  it("reads home and away off homeAway, not off array order", () => {
    const score = parseScoreboard([inPlay], ev("Arsenal - Tottenham Hotspur"))!;
    expect(score.home.name).toBe("Arsenal");
    expect(score.away.name).toBe("Tottenham");
  });

  it("coerces ESPN's string score to a number", () => {
    const score = parseScoreboard([inPlay], ev("Arsenal - Tottenham Hotspur"))!;
    expect(score.home.score).toBe(0);
    expect(score.away.score).toBe(1);
  });

  it("takes the clock from shortDetail, never displayClock", () => {
    // displayClock is "0:00" here, which is exactly the trap: it counts down per
    // period for the NFL and NBA and says nothing useful about a football match.
    const score = parseScoreboard([inPlay], ev("Arsenal - Tottenham Hotspur"))!;
    expect(score.clock).toBe("34'");
    expect(score.state).toBe("in");
  });

  it("reports a finished game as post, which is what stops the card lying", () => {
    // hasFinished() gives a fixture with no DTEND three hours, so the board
    // thinks a 90-minute match is still live long after it ended.
    const score = parseScoreboard([finished], ev("Everton - Manchester United"))!;
    expect(score.state).toBe("post");
    expect(score.clock).toBe("FT");
  });

  it("returns null when nothing on the slate is our fixture — never a phantom 0-0", () => {
    expect(parseScoreboard([finished], ev("Tottenham Hotspur - Chelsea"))).toBeNull();
    expect(parseScoreboard([], ev("Everton - Manchester United"))).toBeNull();
  });

  it("gives null scores before kickoff rather than zeroes", () => {
    const pre: EspnEvent = {
      name: "Tottenham Hotspur at Arsenal",
      competitions: [
        {
          status: { type: { state: "pre", shortDetail: "3:00 PM" } },
          competitors: [
            { homeAway: "home", score: "", team: { displayName: "Arsenal" } },
            { homeAway: "away", team: { displayName: "Tottenham Hotspur" } },
          ],
        },
      ],
    };
    const score = parseScoreboard([pre], ev("Arsenal - Tottenham Hotspur"))!;
    expect(score.state).toBe("pre");
    expect(score.home.score).toBeNull();
    expect(score.away.score).toBeNull();
  });

  it("falls back to the top-level status when the competition carries none", () => {
    const score = parseScoreboard(
      [{ ...inPlay, competitions: [{ competitors: inPlay.competitions![0].competitors }], status: { type: { state: "in", shortDetail: "62'" } } }],
      ev("Arsenal - Tottenham Hotspur"),
    )!;
    expect(score.clock).toBe("62'");
  });

  it("survives a slate entry with nothing in it", () => {
    const score = parseScoreboard(
      [{ name: "Tottenham Hotspur at Arsenal" }],
      ev("Arsenal - Tottenham Hotspur"),
    )!;
    expect(score.home.name).toBe("—");
    expect(score.home.score).toBeNull();
    expect(score.clock).toBe("");
  });

  it("carries the gamecast link, which is also the competition hint next tick", () => {
    const score = parseScoreboard([finished], ev("Everton - Manchester United"))!;
    expect(score.eventUrl).toContain("/league/eng.1");
  });
});

describe("competitionsForLayer", () => {
  it("knows nothing about a layer that is not a team", () => {
    for (const layer of ["health", "birthdays", "personal", "sub-work"]) {
      expect(competitionsForLayer(layer)).toEqual([]);
    }
  });
});
