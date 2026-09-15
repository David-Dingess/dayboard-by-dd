import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  bodyFor,
  defaultSettings,
  evaluateSlots,
  firesOn,
  relevant,
  satisfied,
  snoozeAt,
  type FiredMarker,
} from "../src/lib/health";
import { zone } from "../src/lib/time";

/**
 * The nudge rules, carried over from the standalone app's scheduler tests. That suite
 * mocked Electron so the decision could be tested as plain code; here the
 * decision IS plain code, and this is the same fifteen cases against it.
 *
 * Every one of them is a rule about when NOT to interrupt someone: stale
 * notifications after a machine wakes up, nags after the work is done, anything
 * at all after bedtime, and duplicates from a tick that runs every thirty
 * seconds.
 */

// A Monday, so the schedule calls for a strength session.
const TODAY = "2026-08-10";
const settings = () => defaultSettings(TODAY);

/** A wall-clock time in New York, which is the only clock this program keeps. */
const at = (hhmm: string) => DateTime.fromISO(`${TODAY}T${hhmm}`, { zone: zone() }).toJSDate();

function run(over: Partial<Parameters<typeof evaluateSlots>[0]> = {}, time = "16:30") {
  return evaluateSlots({
    settings: settings(),
    logged: false,
    walked: false,
    today: TODAY,
    fired: {},
    snooze: null,
    now: at(time),
    ...over,
  });
}

const marked = (decision: ReturnType<typeof evaluateSlots>, slotId: string) =>
  decision.marks.find((m) => m.slotId === slotId)?.value;

describe("firing a nudge", () => {
  it("fires the strength nudge at its time on a strength day", () => {
    const decision = run();
    expect(decision.fire.map((f) => f.slotId)).toEqual(["strength"]);
    expect(decision.fire[0].title).toBe("Strength session");
    expect(decision.fire[0].route).toBe("session");
    expect(marked(decision, "strength")).toBe("fired");
  });

  it("does not fire before the slot time", () => {
    expect(run({}, "16:29").fire).toEqual([]);
  });

  it("fires only once, even though the tick runs constantly", () => {
    // The second tick sees the marker the first one wrote.
    const fired: Record<string, Record<string, FiredMarker>> = { [TODAY]: { strength: "fired" } };
    expect(run({ fired }, "16:31").fire).toEqual([]);
  });
});

describe("not firing", () => {
  it("stays silent past the grace window, and records the miss", () => {
    // The case that matters: a machine asleep all afternoon should not spray
    // three stale nudges across the screen the moment it wakes up.
    // 19:10 rather than 19:00: the evening chair routine is at 18:45, and at
    // 19:00 it is still inside its own twenty minutes of grace.
    const decision = run({}, "19:10");
    expect(decision.fire).toEqual([]);
    expect(marked(decision, "strength")).toBe("missed");
    expect(marked(decision, "walk")).toBe("missed");
  });

  it("stays silent once the session is already logged", () => {
    expect(run({ logged: true }).fire).toEqual([]);
  });

  it("stays silent during quiet hours, and deliberately leaves no marker", () => {
    // Quiet hours suppress; they do not consume the slot. A marker would record
    // this as something you ignored, which is not what happened.
    const late = { ...settings(), slots: settings().slots.map((s) => (s.id === "strength" ? { ...s, time: "23:30" } : s)) };
    const decision = run({ settings: late }, "23:30");
    expect(decision.fire).toEqual([]);
    expect(marked(decision, "strength")).toBeUndefined();
  });

  it("does not send a walk nudge on a strength day", () => {
    const decision = run({}, "11:45");
    expect(decision.fire).toEqual([]);
    expect(marked(decision, "walk")).toBe("missed");
  });

  it("sends nothing at all when the program is paused", () => {
    const decision = run({ settings: { ...settings(), paused: true } });
    expect(decision.fire).toEqual([]);
    expect(decision.marks).toEqual([]);
  });

  it("sends nothing on a rest day", () => {
    // Wednesday of week 1 is a scheduled rest day.
    const wednesday = "2026-08-12";
    const decision = evaluateSlots({
      settings: settings(),
      logged: false,
      walked: false,
      today: wednesday,
      fired: {},
      snooze: null,
      now: DateTime.fromISO(`${wednesday}T16:30`, { zone: zone() }).toJSDate(),
    });
    expect(decision.fire).toEqual([]);
  });

  it("skips a disabled slot entirely", () => {
    const off = { ...settings(), slots: settings().slots.map((s) => ({ ...s, enabled: false })) };
    const decision = run({ settings: off });
    expect(decision.fire).toEqual([]);
    expect(decision.marks).toEqual([]);
  });
});

describe("last call", () => {
  it("fires when nothing has been logged all day", () => {
    const decision = run({}, "20:00");
    const call = decision.fire.find((f) => f.slotId === "last-call")!;
    expect(call.body).toContain("still counts");
    expect(call.route).toBe("minimum");
  });

  it("stays quiet when a walk was logged", () => {
    expect(run({ walked: true }, "20:00").fire).toEqual([]);
  });
});

describe("snooze", () => {
  it("fires a parked nudge when it comes due, and clears it", () => {
    const decision = run(
      { snooze: { slotId: "strength", fireAt: at("16:44").getTime() } },
      "16:45",
    );
    expect(decision.clearSnooze).toBe(true);
    expect(decision.fire.some((f) => f.slotId === "strength")).toBe(true);
  });

  it("leaves a snooze alone until it is due", () => {
    const decision = run({ snooze: { slotId: "strength", fireAt: at("17:30").getTime() } }, "16:29");
    expect(decision.clearSnooze).toBe(false);
    expect(decision.fire).toEqual([]);
  });

  it("refuses a snooze that would land after bedtime", () => {
    expect(snoozeAt(settings(), 30, at("22:55"))).toEqual({ suppressed: "quiet_hours" });
  });

  it("parks one that lands before it", () => {
    const result = snoozeAt(settings(), 15, at("16:30"));
    expect(result).toEqual({ fireAt: at("16:45").getTime() });
  });
});

describe("markers", () => {
  it("keeps a week of them and prunes the rest", () => {
    const fired: Record<string, Record<string, FiredMarker>> = {};
    for (let day = 1; day <= 9; day++) {
      fired[`2026-08-0${day}`] = { strength: "missed" };
    }
    const decision = run({ fired });
    expect(decision.prune).toEqual(["2026-08-01", "2026-08-02"]);
  });

  it("prunes nothing when there is nothing to prune", () => {
    expect(run().prune).toEqual([]);
  });
});

describe("a plain reminder", () => {
  const vitamins = {
    id: "vitamins",
    time: "09:00",
    label: "Vitamins",
    kind: "reminder" as const,
    enabled: true,
  };

  it("is relevant every day, including rest days", () => {
    // The three programme nudges only fire on a day that calls for them. A
    // vitamin does not care which session today is — or whether there is one.
    // 2026-08-16 is a Sunday in this programme — the mobility/rest end of it.
    expect(relevant({ ...settings(), slots: [vitamins] }, vitamins, "2026-08-16")).toBe(true);
  });

  it("is never satisfied by exercise", () => {
    // Nothing on this board knows whether you took it, so logging a workout must
    // not quietly answer it.
    expect(satisfied(vitamins, true, true)).toBe(false);
  });

  it("fires inside quiet hours, where the programme nudges do not", () => {
    // "Bro, go to bed" at 11pm is a thing you can only mean deliberately, and
    // quiet hours exist to muzzle the schedule, not the reminders you set by
    // hand. A suppressed one would be a nudge that silently never fires.
    const late = { ...vitamins, id: "bed", time: "23:00", label: "Go to bed." };
    const out = run({ settings: { ...settings(), slots: [late] } }, "23:00");
    expect(out.fire.map((f) => f.slotId)).toEqual(["bed"]);
  });

  it("says its own label and nothing else", () => {
    expect(bodyFor({ ...settings(), slots: [vitamins] }, vitamins, TODAY)).toBe("Vitamins");
  });
});

describe("weekday and just-today nudges", () => {
  // TODAY is a Monday (code MO); 2026-08-11 is the Tuesday after it.
  const TUESDAY = "2026-08-11";
  const stand = (over: Record<string, unknown> = {}) => ({
    id: "r",
    time: "09:00",
    label: "Stand up",
    kind: "reminder" as const,
    enabled: true,
    ...over,
  });
  const onDay = (slots: ReturnType<typeof stand>[], day: string) =>
    evaluateSlots({
      settings: { ...settings(), slots },
      logged: false,
      walked: false,
      today: day,
      fired: {},
      snooze: null,
      now: DateTime.fromISO(`${day}T09:00`, { zone: zone() }).toJSDate(),
    });

  it("firesOn: no days and no date is every day", () => {
    expect(firesOn(stand(), TODAY)).toBe(true);
    expect(firesOn(stand(), TUESDAY)).toBe(true);
  });

  it("firesOn: a weekday set fires only on those weekdays", () => {
    expect(firesOn(stand({ days: ["MO"] }), TODAY)).toBe(true);
    expect(firesOn(stand({ days: ["TU"] }), TODAY)).toBe(false);
  });

  it("firesOn: a one-shot fires only on its own date", () => {
    expect(firesOn(stand({ date: TODAY }), TODAY)).toBe(true);
    expect(firesOn(stand({ date: TUESDAY }), TODAY)).toBe(false);
  });

  it("a weekday reminder fires on its day and leaves none on an off day", () => {
    expect(onDay([stand({ days: ["MO"] })], TODAY).fire.map((f) => f.slotId)).toEqual(["r"]);
    const off = onDay([stand({ days: ["TU"] })], TODAY);
    expect(off.fire).toEqual([]);
    expect(off.marks).toEqual([]);
  });

  it("a just-today one-shot fires today and is inert the next day", () => {
    const slots = [stand({ date: TODAY })];
    expect(onDay(slots, TODAY).fire.map((f) => f.slotId)).toEqual(["r"]);
    const tomorrow = onDay(slots, TUESDAY);
    expect(tomorrow.fire).toEqual([]);
    expect(tomorrow.marks).toEqual([]);
  });
});

describe("the chair routine", () => {
  const chairAm = settings().slots.find((s) => s.id === "chair-am")!;
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };

  it("is in the defaults four times, the last at 9:45pm", () => {
    const chairs = settings().slots.filter((s) => s.kind === "chair");
    expect(chairs.map((s) => s.time)).toEqual(["09:45", "14:45", "18:45", "21:45"]);
  });

  it("fires at 9:45pm, inside the day now that quiet hours start at 11", () => {
    const decision = run({}, "21:45");
    expect(decision.fire.map((f) => f.slotId)).toEqual(["chair-late"]);
  });

  it("fires at its time with a chair route", () => {
    const decision = run({}, "09:45");
    expect(decision.fire.map((f) => f.slotId)).toEqual(["chair-am"]);
    expect(decision.fire[0].route).toBe("chair");
    expect(decision.fire[0].body).toContain("wrists");
  });

  it("fires on a rest day too — rest days sit at a desk", () => {
    const wednesday = "2026-08-12";
    const decision = evaluateSlots({
      settings: settings(),
      logged: false,
      walked: false,
      today: wednesday,
      fired: {},
      snooze: null,
      now: DateTime.fromISO(`${wednesday}T14:45`, { zone: zone() }).toJSDate(),
    });
    expect(decision.fire.map((f) => f.slotId)).toEqual(["chair-pm"]);
  });

  it("is answered by a routine in the hour before it", () => {
    const decision = run({ chairAt: [minutes("09:20")] }, "09:45");
    expect(decision.fire).toEqual([]);
    expect(marked(decision, "chair-am")).toBe("missed");
    expect(satisfied(chairAm, false, false, [minutes("08:50")])).toBe(true);
  });

  it("is not answered by one done first thing, or by a workout", () => {
    expect(run({ chairAt: [minutes("08:30")] }, "09:45").fire.map((f) => f.slotId)).toEqual(["chair-am"]);
    expect(satisfied(chairAm, true, true, [])).toBe(false);
  });

  it("does not answer anything but itself", () => {
    // A chair routine is not a session: last call still speaks at eight.
    const decision = run({ chairAt: [minutes("19:55")] }, "20:00");
    expect(decision.fire.map((f) => f.slotId)).toEqual(["last-call"]);
  });

  it("keeps quiet hours like any programme slot", () => {
    const late = { ...chairAm, time: "23:30" };
    const decision = run({ settings: { ...settings(), slots: [late] } }, "23:30");
    expect(decision.fire).toEqual([]);
    expect(marked(decision, "chair-am")).toBeUndefined();
  });
});
