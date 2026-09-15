import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { applyDrink, buildWaterSnapshot, emptyWater, expectedBy } from "../src/lib/water";
import { zone } from "../src/lib/time";

/**
 * The water log. The rule worth pinning is the streak: a day in progress must
 * not be counted, or the number silently drops at midnight.
 */

const T = "2026-09-07";

describe("applyDrink", () => {
  it("adds up over the day", () => {
    let f = applyDrink(emptyWater(), T, 16);
    f = applyDrink(f, T, 40);
    expect(f.days[T]).toBe(56);
  });

  it("takes some back, and never goes below zero", () => {
    const f = applyDrink(applyDrink(emptyWater(), T, 8), T, -40);
    // An undo pressed twice is a slip; a day that owes water is not a state.
    expect(f.days[T]).toBeUndefined();
  });
});

describe("the streak", () => {
  const met = (days: string[]) => {
    let f = emptyWater();
    for (const d of days) f = applyDrink(f, d, 80);
    return f;
  };

  it("does not count today until today is done", () => {
    // Yesterday and the day before are at goal; today has had one glass. The
    // streak is 2 — counting today would show a 3 that becomes a 2 at midnight.
    let f = met(["2026-09-05", "2026-09-06"]);
    f = applyDrink(f, T, 16);
    expect(buildWaterSnapshot(f, T).streak).toBe(2);
  });

  it("extends the moment the goal is met", () => {
    const f = met(["2026-09-05", "2026-09-06", T]);
    expect(buildWaterSnapshot(f, T).streak).toBe(3);
  });

  it("stops at the first day that fell short", () => {
    const f = met(["2026-09-01", "2026-09-02", "2026-09-06", T]);
    expect(buildWaterSnapshot(f, T).streak).toBe(2);
  });
});

describe("the snapshot", () => {
  it("caps the fill — a bottle cannot fill past its own top", () => {
    const f = applyDrink(emptyWater(), T, 500);
    const s = buildWaterSnapshot(f, T);
    expect(s.fill).toBe(1);
    expect(s.ounces).toBe(500);
  });

  it("hands back the calendar week, Sunday first", () => {
    // 2026-09-07 is a Monday, so the strip runs from Sunday the 6th — the same
    // Sunday-first week the calendar grid and the month view draw.
    const s = buildWaterSnapshot(emptyWater(), T);
    expect(s.week).toHaveLength(7);
    expect(s.week[0]!.date).toBe("2026-09-06");
    expect(s.week.at(-1)!.date).toBe("2026-09-12");
    expect(s.week.map((d) => d.short).join("")).toBe("SMTWTFS");
    expect(s.week.find((d) => d.isToday)!.date).toBe(T);
  });
});

describe("pace", () => {
  const at = (hhmm: string) => DateTime.fromISO(`${T}T${hhmm}`, { zone: zone() });

  it("owes nothing before the day starts", () => {
    expect(expectedBy(80, at("06:00"))).toBe(0);
    expect(expectedBy(80, at("08:00"))).toBe(0);
  });

  it("owes the whole goal by bedtime", () => {
    expect(expectedBy(80, at("22:00"))).toBe(80);
    expect(expectedBy(80, at("23:30"))).toBe(80);
  });

  it("spreads it across the waking day", () => {
    // 8am to 10pm is fourteen hours; 3pm is half way.
    expect(expectedBy(80, at("15:00"))).toBe(40);
  });

  it("reports how far behind, and never how far ahead", () => {
    const dry = buildWaterSnapshot(emptyWater(), T, at("15:00"));
    expect(dry.expectedOz).toBe(40);
    expect(dry.behind).toBeCloseTo(0.5);

    // Ahead of pace is not a state worth drawing.
    const keen = buildWaterSnapshot(applyDrink(emptyWater(), T, 70), T, at("15:00"));
    expect(keen.behind).toBe(0);
  });
});
