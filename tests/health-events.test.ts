import { describe, expect, it } from "vitest";
import { healthEvents } from "../src/lib/health-events";
import { applySettings, emptyHealth } from "../src/lib/health-store";
import { EventFileSchema } from "../src/lib/schema";

/**
 * The program on the calendar. These are generated on every read rather than
 * stored, so the thing worth pinning is that they are real events — the ICS
 * writer and the week grid both take them at face value — and that they carry
 * the time the nudge would have fired at.
 */

const START = "2026-09-07"; // a Monday
const file = () => emptyHealth(START);

const on = (events: ReturnType<typeof healthEvents>, date: string) =>
  events.find((e) => e.start.startsWith(date));

describe("healthEvents", () => {
  it("passes the board's own event schema, so nothing downstream has to special-case it", () => {
    expect(EventFileSchema.safeParse(healthEvents(file(), START)).success).toBe(true);
  });

  it("puts a walk at the walk nudge and strength at the strength nudge", () => {
    const events = healthEvents(file(), START);
    expect(on(events, START)).toMatchObject({ title: "Strength A", layer: "health" });
    expect(on(events, START)!.start).toBe("2026-09-07T16:30:00-04:00");
    // Tuesday is a walk day in phase 1.
    expect(on(events, "2026-09-08")!.start).toBe("2026-09-08T11:45:00-04:00");
    expect(on(events, "2026-09-08")!.title).toBe("Walk");
  });

  it("gives the block the session's own length", () => {
    const walk = on(healthEvents(file(), START), "2026-09-08")!;
    // Week 1 walks are 18 minutes.
    expect(walk.end).toBe("2026-09-08T12:03:00-04:00");
  });

  it("leaves rest days empty — there is nothing to be at", () => {
    // Wednesday of week 1 is the mid-week rest day.
    expect(on(healthEvents(file(), START), "2026-09-09")).toBeUndefined();
  });

  it("puts the Sunday reset on at the strength time", () => {
    const sunday = on(healthEvents(file(), START), "2026-09-13")!;
    expect(sunday.title).toBe("Mobility and reset");
    expect(sunday.start).toBe("2026-09-13T16:30:00-04:00");
  });

  it("follows a nudge time that has been moved", () => {
    const moved = applySettings(file(), {
      slots: [
        { id: "walk", time: "07:30", label: "Midday walk", kind: "walk", enabled: true },
        { id: "strength", time: "18:00", label: "Strength session", kind: "strength", enabled: true },
        { id: "last-call", time: "20:00", label: "Last call", kind: "last_call", enabled: true },
      ],
    });
    const events = healthEvents(moved, START);
    expect(on(events, START)!.start).toBe("2026-09-07T18:00:00-04:00");
    expect(on(events, "2026-09-08")!.start).toBe("2026-09-08T07:30:00-04:00");
  });

  it("still schedules a session whose nudge is switched off", () => {
    // Turning off a nudge says "do not interrupt me", not "this is not the plan".
    const quiet = applySettings(file(), {
      slots: [
        { id: "walk", time: "11:45", label: "Midday walk", kind: "walk", enabled: false },
        { id: "strength", time: "16:30", label: "Strength session", kind: "strength", enabled: false },
        { id: "last-call", time: "20:00", label: "Last call", kind: "last_call", enabled: true },
      ],
    });
    expect(on(healthEvents(quiet, START), START)).toBeDefined();
  });

  it("empties the calendar while the program is paused", () => {
    expect(healthEvents(applySettings(file(), { paused: true }), START)).toEqual([]);
  });

  it("keeps one id per day, so a phone sees a changed plan rather than a duplicate", () => {
    const events = healthEvents(file(), START);
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(on(events, START)!.id).toBe("health:2026-09-07");

    // Which weekday is a strength day never moves, but how heavy it is does. A
    // restart a week later takes 2026-10-12 out of the deload week it was in.
    // Same id, different session — which is an update on the phone, not a
    // cancellation and a new invitation.
    const restarted = applySettings(file(), { programStartDate: "2026-09-14" });
    const before = on(events, "2026-10-12")!;
    const after = on(healthEvents(restarted, START), "2026-10-12")!;
    expect(before.title).toBe("Strength A (deload)");
    expect(after.title).toBe("Strength A");
    expect(after.id).toBe(before.id);
  });

  it("stamps updatedAt from the program rather than the clock, so a re-read is not a change", () => {
    const a = healthEvents(file(), START);
    const b = healthEvents(file(), START);
    expect(a[0].updatedAt).toBe(b[0].updatedAt);
    expect(a[0].updatedAt).toBe(`${START}T00:00:00.000Z`);
  });

  it("covers the week behind and a season ahead", () => {
    const events = healthEvents(file(), START);
    expect(events[0].start < START).toBe(true);
    expect(events[events.length - 1].start > "2027-01-01").toBe(true);
  });
});
