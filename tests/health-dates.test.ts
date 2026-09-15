import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfWeek,
  daysBetween,
  formatDayLabel,
  formatDuration,
  formatShortDay,
  formatTime,
  inQuietHours,
  minutesOfDay,
  monthLabel,
  nowMinutes,
  startOfWeek,
  todayKey,
  toKey,
} from "../src/lib/health/dates";

/**
 * The one file of the engine that was rewritten rather than copied, so it is the
 * one that needs its own proof.
 *
 * the standalone app ran in one process on one machine, so "local" was unambiguous.
 * Here the same functions run on a a remote host server in UTC and in a browser in New
 * York, and every one of these tests is a case where those two would otherwise
 * disagree about what day it is — which would corrupt a streak, a fired marker,
 * or which session is today.
 */

// An instant, not a wall clock: 02:30 UTC is 22:30 the previous day in NY.
const utc = (iso: string) => new Date(iso);

describe("what day it is", () => {
  it("is still Monday at 10:30pm New York, though UTC has moved on", () => {
    expect(todayKey(utc("2026-09-08T02:30:00Z"))).toBe("2026-09-07");
    expect(dayOfWeek(todayKey(utc("2026-09-08T02:30:00Z")))).toBe(1);
  });

  it("has already turned over at 1am New York", () => {
    expect(toKey(utc("2026-09-08T05:00:00Z"))).toBe("2026-09-08");
  });

  it("counts Sunday as 0, the way Date#getDay does — the Sunday reset depends on it", () => {
    expect(dayOfWeek("2026-09-06")).toBe(0); // Sunday
    expect(dayOfWeek("2026-09-07")).toBe(1); // Monday
    expect(dayOfWeek("2026-09-12")).toBe(6); // Saturday
  });
});

describe("date arithmetic", () => {
  it("counts whole calendar days across the autumn clock change", () => {
    // 2026-11-01 is the fall-back Sunday: that day is 25 hours long, so an
    // epoch-millisecond division would give 2.04 days and round the wrong way
    // for a longer span.
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2); // and the spring change
  });

  it("goes backwards, and returns a negative for a date before the start", () => {
    expect(addDays("2026-09-07", -1)).toBe("2026-09-06");
    expect(daysBetween("2026-09-07", "2026-09-01")).toBe(-6);
  });

  it("steps across a month boundary", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("starts the week on Monday, including for a Sunday", () => {
    expect(startOfWeek("2026-09-13")).toBe("2026-09-07"); // Sunday → the Monday before
    expect(startOfWeek("2026-09-07")).toBe("2026-09-07"); // Monday → itself
    expect(startOfWeek("2026-09-12")).toBe("2026-09-07"); // Saturday
  });
});

describe("times of day", () => {
  it("reads the clock in New York, not UTC", () => {
    // 23:30 UTC is 19:30 in New York. Read as UTC, a 16:30 slot would look four
    // hours overdue and be marked missed every single day.
    expect(nowMinutes(utc("2026-09-07T23:30:00Z"))).toBe(19 * 60 + 30);
  });

  it("parses and prints an HH:mm", () => {
    expect(minutesOfDay("16:30")).toBe(990);
    expect(formatTime("16:30")).toBe("4:30pm");
    expect(formatTime("00:05")).toBe("12:05am");
    expect(formatTime("12:00")).toBe("12:00pm");
  });

  it("wraps quiet hours around midnight", () => {
    const quiet = (iso: string) => inQuietHours("21:00", "07:00", utc(iso));
    expect(quiet("2026-09-08T01:30:00Z")).toBe(true); // 21:30 zone() — just inside
    expect(quiet("2026-09-08T02:00:00Z")).toBe(true); // 22:00 zone()
    expect(quiet("2026-09-08T05:00:00Z")).toBe(true); // 01:00 zone() — past midnight, still inside
    expect(quiet("2026-09-07T20:30:00Z")).toBe(false); // 16:30 zone() — the strength slot
    expect(quiet("2026-09-07T09:00:00Z")).toBe(true); // 05:00 zone()
    expect(quiet("2026-09-07T12:00:00Z")).toBe(false); // 08:00 zone() — the day has started
  });

  it("formats a stopwatch", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3600)).toBe("60:00");
  });
});

describe("labels", () => {
  it("uses a fixed locale, so the server and the browser render the same string", () => {
    expect(formatDayLabel("2026-09-07")).toBe("Monday, September 7");
    expect(formatShortDay("2026-09-07")).toBe("Mon");
    // `month` is zero-based, as the original had it.
    expect(monthLabel(2026, 8)).toBe("September 2026");
  });
});
