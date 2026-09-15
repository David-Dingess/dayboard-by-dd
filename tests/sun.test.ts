import { describe, expect, it } from "vitest";
import { sunBar as bar } from "../src/lib/sun";

/** One point on Manhattan's Upper East Side, the place these almanac numbers are for. */
const UES = { lat: 40.7736, lon: -73.9566 };
const sunBar = (now: number) => bar(now, "America/New_York", UES)!;

/**
 * The daylight bar. Pure astronomy for one point on the Upper East Side, so
 * these are pinned against real dates rather than mocked — the numbers are
 * checkable against any almanac, which is the point of not using a provider.
 */

/** 2026-09-07, 3:00pm New York. */
const SEPT = Date.UTC(2026, 8, 7, 19, 0);
/** The solstices, where the bar is at its two extremes. */
const JUNE = Date.UTC(2026, 5, 21, 16, 0);
const DECEMBER = Date.UTC(2026, 11, 21, 17, 0);

describe("sunBar", () => {
  it("puts the day where the almanac puts it", () => {
    const bar = sunBar(SEPT);
    expect(bar.sunrise).toBe("6:28am");
    expect(bar.sunset).toBe("7:18pm");
    expect(bar.length).toBe("12h 49m");
  });

  it("covers the whole day with no gaps and no overlaps", () => {
    // Each band starts where the last one ended, which is what makes the bar a
    // picture of a day rather than seven separate facts about one.
    for (const now of [SEPT, JUNE, DECEMBER]) {
      const { bands } = sunBar(now);
      expect(bands[0].from).toBe(0);
      expect(bands[bands.length - 1].to).toBe(100);
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i].from).toBe(bands[i - 1].to);
        expect(bands[i].to).toBeGreaterThan(bands[i].from);
      }
    }
  });

  it("opens and closes in the dark, so the marker's position keeps meaning something", () => {
    const { bands } = sunBar(SEPT);
    expect(bands[0].kind).toBe("night");
    expect(bands[bands.length - 1].kind).toBe("night");
  });

  it("gives June a long day and December a short one", () => {
    const june = sunBar(JUNE);
    const december = sunBar(DECEMBER);
    expect(june.length).toBe("15h 06m");
    expect(december.length).toBe("9h 15m");

    const daylight = (bar: ReturnType<typeof sunBar>) =>
      bar.bands.filter((b) => b.kind === "day" || b.kind === "golden").reduce((n, b) => n + b.to - b.from, 0);
    expect(daylight(june)).toBeGreaterThan(daylight(december));
  });

  it("puts the marker where the clock is, in New York and not in UTC", () => {
    // 3:00pm local is 62.5% through the day. Read as UTC it would be 79%, which
    // is the mistake that would put an afternoon marker after sunset.
    expect(sunBar(SEPT).at).toBeCloseTo(62.5, 1);
  });
});
