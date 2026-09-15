import { describe, expect, it } from "vitest";
import { expandAll, expandRecurrence, masterId, occurrences } from "../src/lib/recur";
import type { DayboardEvent, Recurrence } from "../src/lib/schema";

/**
 * Repeating events. The rules that matter are the ones a calendar gets wrong:
 * a clock change moving a weekly meeting an hour, a monthly rule inventing a
 * 30th of February, and an id that changes and reaches iOS as a duplicate.
 */

const rule = (over: Partial<Recurrence> & Pick<Recurrence, "freq">): Recurrence => ({
  interval: 1,
  ...over,
});

const dates = (
  start: string,
  allDay: boolean,
  r: Recurrence,
  from: string,
  to: string,
) => occurrences(start, allDay, r, from, to).map((dt) => dt.toISODate());

const times = (start: string, r: Recurrence, from: string, to: string) =>
  occurrences(start, false, r, from, to).map((dt) => dt.toFormat("yyyy-MM-dd HH:mm"));

describe("daily and weekly", () => {
  it("repeats daily inside the window", () => {
    expect(dates("2026-09-07", true, rule({ freq: "DAILY" }), "2026-09-07", "2026-09-10")).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
    ]);
  });

  it("honours an interval", () => {
    expect(
      dates("2026-09-07", true, rule({ freq: "WEEKLY", interval: 2 }), "2026-09-07", "2026-10-06"),
    ).toEqual(["2026-09-07", "2026-09-21", "2026-10-05"]);
  });

  it("fires on each named weekday, and never before the event itself", () => {
    // Starts Wednesday; Monday of that same week is behind it and must not appear.
    const got = dates(
      "2026-09-09",
      true,
      rule({ freq: "WEEKLY", byDay: ["MO", "WE"] }),
      "2026-09-01",
      "2026-09-22",
    );
    expect(got).toEqual(["2026-09-09", "2026-09-14", "2026-09-16", "2026-09-21"]);
  });
});

describe("the clock change", () => {
  it("keeps a weekly 6pm at 6pm across the November fall-back", () => {
    // The one that would betray a naive implementation: adding 7*24 hours moves
    // the meeting to 5pm for the rest of the year.
    const got = times(
      "2026-10-28T18:00:00-04:00",
      rule({ freq: "WEEKLY" }),
      "2026-10-28",
      "2026-11-12",
    );
    expect(got).toEqual([
      "2026-10-28 18:00",
      "2026-11-04 18:00",
      "2026-11-11 18:00",
    ]);
  });
});

describe("months that do not have the day", () => {
  it("skips them rather than moving the event", () => {
    // RFC 5545: a monthly rule on the 31st simply does not occur in November.
    // September, November and February have no 31st, so the series skips them
    // outright rather than landing on the 30th and drifting from there.
    const got = dates("2026-08-31", true, rule({ freq: "MONTHLY" }), "2026-08-01", "2027-03-31");
    expect(got).toEqual(["2026-08-31", "2026-10-31", "2026-12-31", "2027-01-31", "2027-03-31"]);
  });

  it("does the same for a leap day", () => {
    const got = dates("2028-02-29", true, rule({ freq: "YEARLY" }), "2028-01-01", "2033-12-31");
    expect(got).toEqual(["2028-02-29", "2032-02-29"]);
  });
});

describe("stopping", () => {
  it("stops at until, inclusive", () => {
    const got = dates(
      "2026-09-07",
      true,
      rule({ freq: "DAILY", until: "2026-09-09" }),
      "2026-09-07",
      "2026-12-31",
    );
    expect(got).toEqual(["2026-09-07", "2026-09-08", "2026-09-09"]);
  });

  it("counts from the first occurrence, not from the window", () => {
    // Three in total, two of which are behind the window: only the third shows.
    const got = dates(
      "2026-09-07",
      true,
      rule({ freq: "DAILY", count: 3 }),
      "2026-09-09",
      "2026-12-31",
    );
    expect(got).toEqual(["2026-09-09"]);
  });
});

/* ------------------------------------------------------------- events ---- */

const base: DayboardEvent = {
  id: "personal:standup-2026-09-07",
  layer: "personal",
  title: "Standup",
  start: "2026-09-07T09:30:00-04:00",
  end: "2026-09-07T09:45:00-04:00",
  allDay: false,
  tz: "America/New_York",
  source: { kind: "curated" },
  status: "confirmed",
  seq: 0,
  updatedAt: "2026-09-01T00:00:00.000Z",
  recurrence: { freq: "WEEKLY", interval: 1 },
};

describe("expandRecurrence", () => {
  const got = expandRecurrence(base, "2026-09-07", "2026-09-25");

  it("leaves the master's own id alone — iOS matches on it", () => {
    expect(got[0]!.id).toBe("personal:standup-2026-09-07");
    expect(got[0]!.recurrence).toEqual({ freq: "WEEKLY", interval: 1 });
  });

  it("gives every other occurrence a dated id and no rule of its own", () => {
    expect(got.map((e) => e.id)).toEqual([
      "personal:standup-2026-09-07",
      "personal:standup-2026-09-07@2026-09-14",
      "personal:standup-2026-09-07@2026-09-21",
    ]);
    expect(got.slice(1).every((e) => e.recurrence === undefined)).toBe(true);
  });

  it("carries the duration, not the end time", () => {
    expect(got[1]!.start).toBe("2026-09-14T09:30:00-04:00");
    expect(got[1]!.end).toBe("2026-09-14T09:45:00-04:00");
  });

  it("finds its way home", () => {
    expect(masterId(got[1]!.id)).toBe(base.id);
    expect(masterId(base.id)).toBe(base.id);
  });

  it("leaves a one-off event exactly as it was", () => {
    const once = { ...base, recurrence: undefined };
    expect(expandRecurrence(once, "2026-09-07", "2026-09-25")).toEqual([once]);
  });
});

describe("expandAll", () => {
  it("puts a birthday on the wall next year, which is the bug it was written for", () => {
    // Stored dated 2026 with a yearly rule. Nothing but the ICS writer ever read
    // that rule, so on 2027-01-01 all 62 of them would have disappeared from the
    // board while still repeating on the phone.
    const birthday: DayboardEvent = {
      ...base,
      id: "birthdays:zach-cook",
      title: "Zach Cook — birthday",
      start: "2026-01-27",
      end: "2026-01-28",
      allDay: true,
      recurrence: { freq: "YEARLY", interval: 1 },
    };
    const got = expandAll([birthday], "2027-01-20");
    expect(got.map((e) => e.start)).toContain("2027-01-27");
    expect(got.find((e) => e.start === "2027-01-27")!.id).toBe("birthdays:zach-cook@2027-01-27");
  });
});
