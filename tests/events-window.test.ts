import { describe, expect, it } from "vitest";
import { groupByDay, inWindow, sortEvents } from "../src/lib/events";
import type { DayboardEvent } from "../src/lib/schema";

/**
 * What an agenda anchored at a date is allowed to drop.
 *
 * The case that made this file: a timed event starting and ending on the anchor
 * day was filtered out of its own agenda, because the old rule collapsed it to
 * [start date, end date) and midnight is not after midnight. Nobody saw it as a
 * missing fixture — they saw the Health tab's Start button disappear, since the
 * button lives on the row that was never rendered.
 */

const base: Omit<DayboardEvent, "id" | "start" | "end" | "allDay" | "title"> = {
  layer: "personal",
  tz: "America/New_York",
  source: { kind: "curated" },
  status: "confirmed",
  seq: 0,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const timed = (id: string, start: string, end?: string): DayboardEvent => ({
  ...base,
  id,
  title: id,
  start,
  end,
  allDay: false,
});

const allDay = (id: string, start: string, end?: string): DayboardEvent => ({
  ...base,
  id,
  title: id,
  start,
  end,
  allDay: true,
});

const ids = (events: DayboardEvent[]) => events.map((event) => event.id);
const ANCHOR = "2026-09-07";

describe("inWindow, timed events", () => {
  it("keeps one that starts and ends on the anchor day", () => {
    // The regression. A 4:30pm session ending at 4:43pm is the whole of today's
    // programme, and it was invisible on today's agenda.
    const session = timed("today", "2026-09-07T16:30:00-04:00", "2026-09-07T16:43:00-04:00");
    expect(ids(inWindow([session], ANCHOR, 45))).toEqual(["today"]);
  });

  it("keeps one with no end at all", () => {
    expect(ids(inWindow([timed("open", "2026-09-07T19:30:00-04:00")], ANCHOR, 45))).toEqual(["open"]);
  });

  it("drops yesterday's, however late it ran", () => {
    // Ran past midnight into the anchor day. It still belongs to yesterday —
    // that is where groupByDay files it, and a Yesterday heading above Today is
    // exactly what an agenda must not print.
    const late = timed("late", "2026-09-06T23:30:00-04:00", "2026-09-07T02:00:00-04:00");
    expect(ids(inWindow([late], ANCHOR, 45))).toEqual([]);
  });

  it("keeps the last day of the window and drops the first day past it", () => {
    const inside = timed("inside", "2026-09-08T20:00:00-04:00");
    const outside = timed("outside", "2026-09-09T20:00:00-04:00");
    expect(ids(inWindow([inside, outside], ANCHOR, 2))).toEqual(["inside"]);
  });
});

describe("inWindow, all-day events", () => {
  it("keeps a one-day event on the anchor, whose exclusive end is tomorrow", () => {
    expect(ids(inWindow([allDay("birthday", "2026-09-07", "2026-09-08")], ANCHOR, 45))).toEqual([
      "birthday",
    ]);
  });

  it("drops one whose exclusive end IS the anchor — it finished yesterday", () => {
    expect(ids(inWindow([allDay("over", "2026-09-06", "2026-09-07")], ANCHOR, 45))).toEqual([]);
  });

  it("keeps a multi-day span that started before the anchor", () => {
    const major = allDay("riptide", "2026-09-05", "2026-09-14");
    expect(ids(inWindow([major], ANCHOR, 45))).toEqual(["riptide"]);
  });
});

describe("inWindow agrees with groupByDay", () => {
  it("puts today's timed session in a group for today", () => {
    // The two have to use one rule. This is the assertion that fails if either
    // side is changed on its own.
    const events = sortEvents([
      timed("session", "2026-09-07T16:30:00-04:00", "2026-09-07T16:43:00-04:00"),
      allDay("holiday", "2026-09-07", "2026-09-08"),
      timed("tomorrow", "2026-09-08T11:45:00-04:00", "2026-09-08T12:03:00-04:00"),
    ]);
    const grouped = groupByDay(inWindow(events, ANCHOR, 45));
    expect(grouped[0]?.date).toBe(ANCHOR);
    expect(ids(grouped[0]!.events)).toEqual(["holiday", "session"]);
  });
});
