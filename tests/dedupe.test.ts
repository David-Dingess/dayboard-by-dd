import { describe, expect, it } from "vitest";
import { contentKey } from "../src/lib/layers";
import type { DayboardEvent } from "../src/lib/schema";

const base = {
  id: "x",
  layer: "l",
  allDay: false,
  tz: "America/New_York",
  source: { kind: "curated" as const },
  status: "confirmed" as const,
  seq: 0,
  updatedAt: "2026-09-05T00:00:00.000Z",
};

const ev = (o: Partial<DayboardEvent>): DayboardEvent =>
  ({ ...base, title: "t", start: "2026-09-09T19:30:00-04:00", ...o }) as DayboardEvent;

describe("duplicate detection across sources", () => {
  it("matches the same fixture from the catalogue and from a personal calendar", () => {
    // Subscribe to a club's own calendar and every match arrives
    // twice with different ids. Only the content can tell they are one event.
    const fromCatalogue = ev({ id: "sports-atlutd:u-abc", title: "Atlanta United vs Orlando City SC" });
    const fromICloud = ev({ id: "sub-sam:u-zzz", title: "Atlanta United vs Orlando City SC" });
    expect(contentKey(fromICloud)).toBe(contentKey(fromCatalogue));
  });

  it("ignores punctuation and case differences between the two sources", () => {
    expect(contentKey(ev({ title: "Atlanta United vs. Orlando City SC" }))).toBe(
      contentKey(ev({ title: "atlanta united  vs orlando city sc" })),
    );
  });

  it("ignores seconds, which the two sources need not agree on", () => {
    expect(contentKey(ev({ start: "2026-09-09T19:30:00-04:00" }))).toBe(
      contentKey(ev({ start: "2026-09-09T19:30:45-04:00" })),
    );
  });

  it("keeps genuinely different events apart", () => {
    const a = ev({ title: "Atlanta United vs Orlando City SC" });
    const b = ev({ title: "Atlanta United vs Inter Miami CF" });
    expect(contentKey(a)).not.toBe(contentKey(b));

    const later = ev({ title: "Atlanta United vs Orlando City SC", start: "2026-09-09T20:30:00-04:00" });
    expect(contentKey(a)).not.toBe(contentKey(later));
  });

  it("compares all-day events by date alone", () => {
    const a = ev({ title: "Labor Day", start: "2026-09-07", allDay: true });
    const b = ev({ title: "Labor Day", start: "2026-09-07", allDay: true, id: "other" });
    expect(contentKey(a)).toBe(contentKey(b));
  });
});

describe("holiday styling", () => {
  it("gives the well-known holidays their own face and colour", async () => {
    const { styleForHoliday } = await import("../src/lib/holidays");
    expect(styleForHoliday("Halloween")).toEqual({ emoji: "🎃", color: "#ff7518" });
    expect(styleForHoliday("Christmas Day").emoji).toBe("🎄");
    expect(styleForHoliday("Thanksgiving Day").emoji).toBe("🦃");
    expect(styleForHoliday("Independence Day").emoji).toBe("🎆");
    expect(styleForHoliday("Labor Day").emoji).toBe("🛠️");
  });

  it("matches the specific rule before the general one", () => {
    // "New Year's Eve" must not fall through to the "New Year" rule.
    return import("../src/lib/holidays").then(({ styleForHoliday }) => {
      expect(styleForHoliday("New Year's Eve").emoji).toBe("🥂");
      expect(styleForHoliday("New Year's Day").emoji).toBe("🎉");
      expect(styleForHoliday("Christmas Eve").emoji).toBe("🕯️");
      expect(styleForHoliday("Christmas Day").emoji).toBe("🎄");
    });
  });

  it("falls back rather than leaving an unknown holiday blank", async () => {
    const { styleForHoliday } = await import("../src/lib/holidays");
    const style = styleForHoliday("Some Regional Observance");
    expect(style.emoji).toBe("🗓️");
    expect(style.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("only styles calendars that are actually holiday feeds", async () => {
    const { isHolidayCalendar } = await import("../src/lib/holidays");
    expect(isHolidayCalendar("Holidays")).toBe(true);
    expect(isHolidayCalendar("US Holidays")).toBe(true);
    expect(isHolidayCalendar("Hayley and Sam")).toBe(false);
    expect(isHolidayCalendar("Partiful")).toBe(false);
  });
});
