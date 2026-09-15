import { describe, expect, it } from "vitest";
import {
  applyAttachVideo,
  applyClearDay,
  applyDeleteWalk,
  applyDetachVideo,
  applyFeedback,
  applyLogChair,
  applyLogWalk,
  applyRecordDay,
  applyRestart,
  applySettings,
  buildSnapshot,
  chairMinutes,
  chairOn,
  emptyHealth,
  validVideoKey,
  videoKeyLabel,
  videoKeysFor,
} from "../src/lib/health-store";
import {
  HealthFileSchema,
  HealthVideoSchema,
  HealthVideosFileSchema,
  type HealthVideosFile,
} from "../src/lib/schema";
import { getSessionForDate, type ChairEntry, type DayRecord, type WalkEntry } from "../src/lib/health";

/**
 * The pure half of the Health file. `npm run health` and every button in the tab
 * call exactly these, so a test here covers both writers.
 */

// A Monday: the program starts, and the first session is Strength A.
const START = "2026-09-07";
const file = () => emptyHealth(START);

const record = (over: Partial<DayRecord> = {}): DayRecord => ({
  date: START,
  sessionId: "w1-d1-strength-A",
  kind: "strength",
  status: "completed",
  completedAt: `${START}T17:00:00.000Z`,
  durationSec: 900,
  exercises: [
    { exerciseId: "squat-chair", patternId: "squat", rungIndex: 0, roundsCompleted: 2, skipped: false },
  ],
  ...over,
});

const walk = (over: Partial<WalkEntry> = {}): WalkEntry => ({
  id: "walk-2026-09-07-aaaaaaaa",
  date: START,
  loggedAt: `${START}T12:00:00.000Z`,
  durationMin: 30,
  source: "manual",
  outdoors: true,
  ...over,
});

describe("the file's defaults", () => {
  it("fills everything but the start date, so today's file still parses next year", () => {
    const parsed = HealthFileSchema.parse({ settings: { programStartDate: START } });
    expect(parsed.settings.slots.map((s) => s.time)).toEqual([
      "11:45",
      "16:30",
      "20:00",
      "09:45",
      "14:45",
      "18:45",
      "21:45",
    ]);
    expect(parsed.chair).toEqual([]);
    expect(parsed.settings.quietHours).toEqual({ start: "23:00", end: "07:00" });
    expect(parsed.settings.eyeBreaks).toEqual({
      enabled: true,
      everyMinutes: 20,
      forSeconds: 20,
      // Null, not the nudge hours: eyes at 11pm are the ones that need this.
      quietHours: null,
    });
    expect(parsed.settings.graceMinutes).toBe(20);
    expect(parsed.days).toEqual({});
  });

  it("refuses a file with no start date rather than guessing one", () => {
    expect(HealthFileSchema.safeParse({ settings: {} }).success).toBe(false);
  });

  it("refuses a nudge time that is not a clock", () => {
    const bad = { programStartDate: START, slots: [{ id: "walk", time: "25:00", label: "x", kind: "walk" }] };
    expect(HealthFileSchema.safeParse({ settings: bad }).success).toBe(false);
  });
});

describe("applyRecordDay", () => {
  it("writes the day and leaves the ladders alone when nothing is due", () => {
    const next = applyRecordDay(file(), record());
    expect(next.days[START].sessionId).toBe("w1-d1-strength-A");
    expect(next.adjustments).toEqual([]);
    expect(next.settings.patternLevels).toEqual({});
  });

  it("moves a rung once eight sessions already stand at it", () => {
    // The threshold counts the history as it was, not counting the one being
    // logged — so eight days in the file, and this ninth is the one that moves.
    let f = file();
    for (let i = 1; i <= 8; i++) {
      const date = `2026-08-0${i}`;
      f = { ...f, days: { ...f.days, [date]: record({ date }) } };
    }
    const next = applyRecordDay(f, record());
    expect(next.adjustments.map((a) => a.reason)).toEqual(["auto_progress"]);
    expect(next.settings.patternLevels.squat).toBe(1);
  });

  it("waits, with seven behind it", () => {
    let f = file();
    for (let i = 1; i <= 7; i++) {
      const date = `2026-08-0${i}`;
      f = { ...f, days: { ...f.days, [date]: record({ date }) } };
    }
    expect(applyRecordDay(f, record()).adjustments).toEqual([]);
  });
});

describe("applyFeedback", () => {
  it('lowers a rung on "too hard" and remembers why', () => {
    const logged = applyRecordDay(applySettings(file(), { patternLevels: { squat: 2 } }), record());
    const next = applyFeedback(logged, START, "too_hard");
    expect(next.days[START].feedback).toBe("too_hard");
    expect(next.settings.patternLevels.squat).toBe(1);
    expect(next.adjustments[0]).toMatchObject({ fromRung: 2, toRung: 1, reason: "too_hard" });
  });

  it("does nothing at all when there is no session to attach it to", () => {
    const f = file();
    expect(applyFeedback(f, START, "too_easy")).toBe(f);
  });
});

describe("walks and clearing", () => {
  it("appends a walk and removes it by id", () => {
    const one = applyLogWalk(file(), walk());
    expect(one.walks).toHaveLength(1);
    expect(applyDeleteWalk(one, walk().id).walks).toEqual([]);
  });

  it("keeps two walks on one day — a Saturday can hold both", () => {
    const two = applyLogWalk(applyLogWalk(file(), walk()), walk({ id: "walk-b", durationMin: 45 }));
    expect(two.walks.map((w) => w.durationMin)).toEqual([30, 45]);
  });

  it("clears a logged day and leaves everything else standing", () => {
    const logged = applyLogWalk(applyRecordDay(file(), record()), walk());
    const cleared = applyClearDay(logged, START);
    expect(cleared.days).toEqual({});
    expect(cleared.walks).toHaveLength(1);
  });
});

describe("applyRestart", () => {
  it("keeps the history and drops the ladder position", () => {
    const before = applyLogWalk(applyRecordDay(applySettings(file(), { patternLevels: { squat: 3 } }), record()), walk());
    const after = applyRestart(before, "2026-10-05");
    expect(after.settings.programStartDate).toBe("2026-10-05");
    expect(after.settings.patternLevels).toEqual({});
    expect(after.adjustments).toEqual([]);
    // The sessions and walks happened. They stay.
    expect(Object.keys(after.days)).toEqual([START]);
    expect(after.walks).toHaveLength(1);
  });
});

describe("video keys", () => {
  it("accepts the session kinds, the two block names, and any rung id", () => {
    expect(validVideoKey("strength")).toBe(true);
    expect(validVideoKey("warmup")).toBe(true);
    expect(validVideoKey("squat-goblet")).toBe(true);
    expect(validVideoKey("push-ups")).toBe(false);
    expect(validVideoKey("rest")).toBe(false);
  });

  it("names a key the way the tile will", () => {
    expect(videoKeyLabel("warmup")).toBe("Warm-up");
    expect(videoKeyLabel("squat-goblet")).toBe("Goblet squat");
  });

  it("offers a strength day its kind, its warm-up and cool-down, and its exercises", () => {
    const keys = videoKeysFor(getSessionForDate({ programStartDate: START, patternLevels: {} }, START));
    expect(keys[0]).toBe("strength");
    expect(keys).toContain("warmup");
    expect(keys).toContain("cooldown");
    expect(keys).toContain("squat-chair");
    expect(keys.every((k) => validVideoKey(k))).toBe(true);
  });

  it("has nothing to offer a rest day", () => {
    // Wednesday of week 1.
    expect(videoKeysFor(getSessionForDate({ programStartDate: START, patternLevels: {} }, "2026-09-09"))).toEqual([]);
  });
});

describe("attaching videos", () => {
  const video = (id: string) => HealthVideoSchema.parse({ id, title: `Video ${id}` });

  it("puts the newest first and never lists one twice", () => {
    const one = applyAttachVideo({ videos: {} }, "strength", video("aaaaaaaaaaa"));
    const two = applyAttachVideo(one, "strength", video("bbbbbbbbbbb"));
    const again = applyAttachVideo(two, "strength", video("aaaaaaaaaaa"));
    expect(again.videos.strength.map((v) => v.id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  });

  it("caps a key at twelve, which is what the schema will accept", () => {
    let f: HealthVideosFile = { videos: {} };
    for (let i = 0; i < 15; i++) f = applyAttachVideo(f, "strength", video(`vid${String(i).padStart(8, "0")}`));
    expect(f.videos.strength).toHaveLength(12);
    expect(HealthVideosFileSchema.safeParse(f).success).toBe(true);
  });

  it("drops the key entirely when its last video goes", () => {
    const one = applyAttachVideo({ videos: {} }, "warmup", video("aaaaaaaaaaa"));
    expect(applyDetachVideo(one, "warmup", "aaaaaaaaaaa").videos).toEqual({});
  });

  it("refuses anything that is not an eleven-character YouTube id", () => {
    expect(HealthVideoSchema.safeParse({ id: "tooshort", title: "x" }).success).toBe(false);
    expect(HealthVideoSchema.safeParse({ id: "dQw4w9WgXcQ", title: "x" }).success).toBe(true);
  });
});

describe("buildSnapshot", () => {
  it("describes the day the widget is about to draw", () => {
    const snapshot = buildSnapshot(file(), START);
    expect(snapshot.dayLabel).toBe("Monday, September 7");
    expect(snapshot.weekNumber).toBe(1);
    expect(snapshot.phase.index).toBe(1);
    expect(snapshot.session.title).toBe("Strength A");
    expect(snapshot.minimum.kind).toBe("minimum");
    expect(snapshot.done).toBe(false);
    expect(snapshot.week).toHaveLength(7);
    expect(snapshot.week[0].date).toBe(START); // the week starts on Monday
    expect(snapshot.week[0].isToday).toBe(true);
    expect(snapshot.ladders).toHaveLength(8);
  });

  it("counts a walk as today being done, which is the whole point of the floor", () => {
    const snapshot = buildSnapshot(applyLogWalk(file(), walk()), START);
    expect(snapshot.done).toBe(true);
    expect(snapshot.trailingMinutes).toBe(30);
    expect(snapshot.recent[0]).toMatchObject({ title: "Walk · outdoors", minutes: 30 });
  });

  it("marks a ladder held by the phase rather than pretending it advanced", () => {
    const eager = applySettings(file(), { patternLevels: { squat: 4 } });
    const row = buildSnapshot(eager, START).ladders.find((l) => l.patternId === "squat")!;
    expect(row.capped).toBe(true);
    expect(row.shown).toBe(1); // phase 1's rungCap
  });

  it("hands the client only the video keys today can use", () => {
    const videos = { videos: { strength: [HealthVideoSchema.parse({ id: "dQw4w9WgXcQ", title: "x" })], "hinge-rdl-single": [HealthVideoSchema.parse({ id: "eeeeeeeeeee", title: "y" })] } };
    const snapshot = buildSnapshot(file(), START, videos);
    expect(Object.keys(snapshot.videos)).toEqual(["strength"]);
  });
});

describe("chair five", () => {
  // 10:30 and 14:50 New York on START, which is EDT (UTC-4).
  const entry = (hhmmUtc: string, over: Partial<ChairEntry> = {}): ChairEntry => ({
    id: `chair-${hhmmUtc}`,
    date: START,
    completedAt: `${START}T${hhmmUtc}:00.000Z`,
    routineId: "chair-neck",
    durationSec: 300,
    skipped: [],
    ...over,
  });

  it("parses a file written before the routine existed", () => {
    const old = { schemaVersion: 1, settings: { programStartDate: START }, days: {}, walks: [], adjustments: [] };
    expect(HealthFileSchema.parse(old).chair).toEqual([]);
  });

  it("logs without touching the day, the streak or the week's minutes", () => {
    const logged = applyLogChair(file(), entry("14:30"));
    expect(chairOn(logged, START)).toHaveLength(1);
    const snapshot = buildSnapshot(logged, START);
    expect(snapshot.done).toBe(false);
    expect(snapshot.trailingMinutes).toBe(0);
    expect(snapshot.chair.doneToday).toBe(1);
    expect(snapshot.chair.nextExtra).toBe("hips");
  });

  it("reads the finish time as a New York minute of day", () => {
    expect(chairMinutes([entry("14:30")])).toEqual([10 * 60 + 30]);
  });

  it("lights only the dot whose window the routine landed in", () => {
    // 10:30 answers 9:45; 14:50 answers 14:45; 18:45 and 21:45 are still open.
    const both = applyLogChair(applyLogChair(file(), entry("14:30")), entry("18:50"));
    const dots = buildSnapshot(both, START).chair.slots;
    expect(dots.map((d) => [d.time, d.done])).toEqual([
      ["09:45", true],
      ["14:45", true],
      ["18:45", false],
      ["21:45", false],
    ]);
  });

  it("does not light the first dot for a routine done before 8:45", () => {
    const early = applyLogChair(file(), entry("12:30"));
    expect(buildSnapshot(early, START).chair.slots[0].done).toBe(false);
  });
});
