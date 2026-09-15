import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { buildCalendar, expandForFeed } from "../src/lib/ics";
import { parseIcs } from "../src/lib/ical-parse";
import type { DayboardEvent } from "../src/lib/schema";

const base = {
  tz: "America/New_York",
  source: { kind: "curated" as const },
  status: "confirmed" as const,
  seq: 0,
  updatedAt: "2026-09-05T00:00:00.000Z",
};

const timed: DayboardEvent = {
  ...base,
  id: "sports-spurs:test-match",
  layer: "sports-spurs",
  title: "Tottenham Hotspur - Arsenal",
  start: "2026-11-08T11:30:00-05:00",
  end: "2026-11-08T13:30:00-05:00",
  allDay: false,
  location: "Tottenham Hotspur Stadium",
  alarm: { minutesBefore: 60 },
};

const allDay: DayboardEvent = {
  ...base,
  id: "nyc:test-parade",
  layer: "nyc",
  title: "Macy's Thanksgiving Day Parade",
  start: "2026-11-26",
  end: "2026-11-27",
  allDay: true,
  alarm: { minutesBefore: -540 },
};

const recurring: DayboardEvent = {
  ...base,
  id: "birthdays:test-person",
  layer: "birthdays",
  title: "Test Person — birthday",
  start: "2026-03-14",
  end: "2026-03-15",
  allDay: true,
  recurrence: { freq: "YEARLY", interval: 1 },
};

const noAlarm: DayboardEvent = {
  ...base,
  id: "tournament:test-major",
  layer: "tournament",
  title: "GENESIS X4",
  start: "2027-02-12",
  end: "2027-02-15",
  allDay: true,
  alarm: null,
};

function build(events: DayboardEvent[]) {
  return buildCalendar({ name: "Dayboard", events });
}

describe("ICS output", () => {
  const ics = build([timed, allDay, recurring, noAlarm]);

  it("is parseable and names itself", () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    expect(comp.getFirstPropertyValue("x-wr-calname")).toBe("Dayboard");
    expect(comp.getAllSubcomponents("vevent")).toHaveLength(4);
  });

  it("writes all-day events as DATE values, not midnight timestamps", () => {
    const parade = ics.split("BEGIN:VEVENT").find((b) => b.includes("Thanksgiving"))!;
    expect(parade).toMatch(/DTSTART;VALUE=DATE:20261126/);
    expect(parade).toMatch(/DTEND;VALUE=DATE:20261127/);
  });

  it("emits timed events as UTC instants", () => {
    const match = ics.split("BEGIN:VEVENT").find((b) => b.includes("Arsenal"))!;
    // 11:30 EST is 16:30 UTC.
    expect(match).toMatch(/DTSTART:20261108T163000Z/);
  });

  it("carries a stable UID and the sequence number", () => {
    expect(ics).toContain("UID:sports-spurs:test-match@dayboard.local");
    expect(ics).toMatch(/SEQUENCE:0/);
  });

  it("adds an alarm only where one was asked for", () => {
    const blocks = ics.split("BEGIN:VEVENT");
    const major = blocks.find((b) => b.includes("GENESIS"))!;
    const match = blocks.find((b) => b.includes("Arsenal"))!;
    const parade = blocks.find((b) => b.includes("Thanksgiving"))!;
    expect(major).not.toContain("BEGIN:VALARM");
    expect(match).toContain("BEGIN:VALARM");
    expect(match).toMatch(/TRIGGER:-PT1H/);
    // Negative minutesBefore means after the start: 9am on the day itself.
    expect(parade).toMatch(/TRIGGER;RELATED=START:PT9H/);
  });

  it("tags every event with its layer so a reader can split them again", () => {
    expect(ics).toContain("CATEGORIES:sports-spurs");
    expect(ics).toContain("CATEGORIES:nyc");
  });

  it("repeats birthdays yearly", () => {
    const birthday = ics.split("BEGIN:VEVENT").find((b) => b.includes("Test Person"))!;
    expect(birthday).toMatch(/RRULE:FREQ=YEARLY/);
  });

  it("survives a round trip through our own parser with times intact", () => {
    const back = parseIcs(ics, {
      layer: "roundtrip",
      window: { pastDays: 3650, futureDays: 3650 },
    });
    const match = back.find((e) => e.title.includes("Arsenal"))!;
    expect(match.start).toBe("2026-11-08T11:30:00-05:00");
    expect(match.allDay).toBe(false);

    const parade = back.find((e) => e.title.includes("Thanksgiving"))!;
    expect(parade.allDay).toBe(true);
    expect(parade.start).toBe("2026-11-26");
  });

  it("marks a cancelled event rather than dropping it", () => {
    const cancelled = build([{ ...timed, status: "cancelled", seq: 2 }]);
    expect(cancelled).toContain("STATUS:CANCELLED");
    expect(cancelled).toContain("SEQUENCE:2");
  });
});

describe("recurrence in the feed", () => {
  const today = "2026-09-07";

  it("keeps a plain yearly birthday as ONE event with an RRULE", () => {
    // The UID must not move: iOS matches on it, and 62 birthdays turning into
    // 62 cancellations and 62 invitations is the worst possible update.
    const out = expandForFeed([recurring], today);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(recurring.id);
    expect(buildCalendar({ name: "t", events: out })).toMatch(/RRULE:FREQ=YEARLY/);
  });

  it("writes a weekly timed event out date by date, with no RRULE", () => {
    // This calendar carries no VTIMEZONE and emits UTC instants, so an RRULE on
    // a 6pm rehearsal would land at 5pm for every week after the November clock
    // change. Concrete instances carry their own offset.
    const weekly: DayboardEvent = {
      ...recurring,
      id: "personal:rehearsal-2026-10-29",
      title: "Rehearsal",
      start: "2026-10-29T18:00:00-04:00",
      end: "2026-10-29T20:00:00-04:00",
      allDay: false,
      recurrence: { freq: "WEEKLY", interval: 1 },
    };
    const out = expandForFeed([weekly], today);
    // A year of Thursdays, give or take the window edges.
    expect(out.length).toBe(50);

    const ics = buildCalendar({ name: "t", events: out });
    expect(ics).not.toMatch(/RRULE/);
    // 6pm on 29 October is 22:00Z; 6pm on 5 November, after the clock change,
    // is 23:00Z. Both are in there, which is the whole point.
    expect(ics).toMatch(/DTSTART:20261029T220000Z/);
    expect(ics).toMatch(/DTSTART:20261105T230000Z/);
  });
});
