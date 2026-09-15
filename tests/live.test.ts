import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { liveNow } from "../src/lib/events";
import type { DayboardEvent } from "../src/lib/schema";

const base = {
  id: "x",
  layer: "sports-spurs",
  allDay: false,
  tz: "America/New_York",
  source: { kind: "curated" as const },
  status: "confirmed" as const,
  seq: 0,
  updatedAt: "2026-09-05T00:00:00.000Z",
};

const ev = (o: Partial<DayboardEvent>): DayboardEvent =>
  ({ ...base, title: "Nottingham Forest - Tottenham Hotspur", start: "2026-09-05T10:00:00-04:00", ...o }) as DayboardEvent;

/** Kickoff was at 10:00; this is half an hour in. */
const now = DateTime.fromISO("2026-09-05T10:30:00-04:00", { setZone: true });

describe("what is on right now", () => {
  it("finds a match that has kicked off and not finished", () => {
    const match = ev({ end: "2026-09-05T11:45:00-04:00" });
    expect(liveNow([match], now).map((e) => e.id)).toEqual(["x"]);
  });

  it("ignores one that has not started and one that is over", () => {
    const later = ev({ id: "later", start: "2026-09-05T15:00:00-04:00", end: "2026-09-05T17:00:00-04:00" });
    const done = ev({ id: "done", start: "2026-09-05T06:00:00-04:00", end: "2026-09-05T08:00:00-04:00" });
    expect(liveNow([later, done], now)).toEqual([]);
  });

  it("falls back to three hours when the feed gave no end time", () => {
    // hasFinished owns that guess; this only checks liveNow inherits it rather
    // than inventing a second rule.
    const noEnd = ev({ end: undefined });
    expect(liveNow([noEnd], now)).toHaveLength(1);
    const longGone = ev({ id: "old", start: "2026-09-05T05:00:00-04:00", end: undefined });
    expect(liveNow([longGone], now)).toEqual([]);
  });

  it("never counts an all-day event, however long it runs", () => {
    // A tournament runs Thursday to Sunday. Treating that as live would leave
    // the Watch tab shouting for four days.
    const major = ev({
      id: "genesis",
      layer: "tournament",
      allDay: true,
      start: "2026-09-04",
      end: "2026-09-07",
    });
    expect(liveNow([major], now)).toEqual([]);
  });

  it("drops a cancelled fixture", () => {
    const off = ev({ end: "2026-09-05T11:45:00-04:00", status: "cancelled" });
    expect(liveNow([off], now)).toEqual([]);
  });

  it("puts the earliest kickoff first when two overlap", () => {
    const early = ev({ id: "early", start: "2026-09-05T09:00:00-04:00", end: "2026-09-05T11:00:00-04:00" });
    const late = ev({ id: "late", start: "2026-09-05T10:15:00-04:00", end: "2026-09-05T12:00:00-04:00" });
    expect(liveNow([late, early], now).map((e) => e.id)).toEqual(["early", "late"]);
  });
});
