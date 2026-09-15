import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { nextHours } from "../src/lib/weather";
import { zone } from "../src/lib/time";
import type { HourWeather } from "../src/lib/weather";

/**
 * The hour grid follows the clock rather than the calendar. A fixed 8am-7pm
 * window is right at breakfast and three-quarters empty by dinner, which is
 * what this replaced.
 */

const hour = (time: string): HourWeather => ({
  time,
  date: time.slice(0, 10),
  hour: Number(time.slice(11, 13)),
  temp: 70,
  precipChance: null,
  code: 0,
  glyph: "☀️",
  label: "Clear",
});

// A day and a half, hourly, so a window can run off the end of the first day.
const series = Array.from({ length: 36 }, (_, i) =>
  hour(DateTime.fromISO("2026-09-07T00:00", { zone: zone() }).plus({ hours: i }).toFormat("yyyy-MM-dd'T'HH:mm")),
);

const at = (iso: string) => DateTime.fromISO(iso, { zone: zone() });

describe("nextHours", () => {
  it("starts at the hour we are in, not the next one", () => {
    // 5:46pm is still the 5pm hour, and the tile above already says what it is
    // doing right now — so the grid leads with the hour in progress.
    const got = nextHours(series, 12, at("2026-09-07T17:46"));
    expect(got[0]!.time).toBe("2026-09-07T17:00");
  });

  it("returns exactly twelve, crossing midnight without noticing", () => {
    const got = nextHours(series, 12, at("2026-09-07T17:46"));
    expect(got).toHaveLength(12);
    expect(got.at(-1)!.time).toBe("2026-09-08T04:00");
  });

  it("is full at eight in the morning too", () => {
    const got = nextHours(series, 12, at("2026-09-07T08:00"));
    expect(got).toHaveLength(12);
    expect(got[0]!.hour).toBe(8);
  });

  it("drops hours that have already gone", () => {
    const got = nextHours(series, 12, at("2026-09-07T23:30"));
    expect(got.every((h) => h.time >= "2026-09-07T23:00")).toBe(true);
  });

  it("returns what it has when the forecast runs out rather than padding", () => {
    expect(nextHours(series, 12, at("2026-09-08T09:00"))).toHaveLength(3);
  });
});
