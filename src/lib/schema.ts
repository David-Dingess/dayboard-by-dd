import { z } from "zod";

/**
 * The canonical Dayboard event. Everything — curated JSON, parsed upstream ICS,
 * Google/Outlook passthrough — is normalised to this shape
 * before it reaches the UI or the ICS writer.
 *
 * `start`/`end` are either an ISO instant with an explicit offset
 * ("2027-05-29T20:12:00-04:00") or, when `allDay`, a plain date ("2027-05-29").
 * All-day `end` is EXCLUSIVE, per RFC 5545.
 */

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const sourceKinds = [
  "curated",
  "upstream",
  "generated",
  "passthrough",
] as const;

export const eventStatuses = ["confirmed", "tentative", "cancelled"] as const;

export const SourceSchema = z.object({
  kind: z.enum(sourceKinds),
  /** upstream id, generator name, feed label — whatever produced this event */
  ref: z.string().optional(),
  fetchedAt: z.string().optional(),
});

/**
 * Minutes relative to `start`. Positive = before (60 = an hour ahead of kickoff),
 * negative = after (-540 = 9:00am on the day of an all-day event, which is where
 * a birthday reminder actually wants to land).
 */
export const AlarmSchema = z.object({
  minutesBefore: z.number().int(),
});

/**
 * Where to watch, when the event is a fixture. `precision` is the honesty dial:
 * "deep-link" is this exact match, "network" is the named broadcaster for this
 * fixture, "competition" is the right service for the competition rather than a
 * promise about this particular game.
 */
export const WatchSchema = z.object({
  url: z.string().url(),
  service: z.string().min(1),
  precision: z.enum(["deep-link", "network", "competition"]),
  note: z.string().optional(),
  eventUrl: z.string().url().optional(),
  checkedAt: z.string().optional(),
});

export type Watch = z.infer<typeof WatchSchema>;

/**
 * How an event repeats.
 *
 * IT WAS `{ freq: "YEARLY" }` AND NOTHING ELSE — enough for 62 birthdays, which
 * is all that ever used it. An editor that lets you say "every other Tuesday"
 * needs the rest, and the shape is RFC 5545's because that is what the ICS feed
 * has to speak on the way out.
 *
 * A file written before this still parses: `interval` defaults to 1 and the
 * other three are optional, so `{ freq: "YEARLY" }` means exactly what it always
 * meant. ics.ts leans on that — a plain yearly all-day rule is still emitted as
 * one VEVENT with an RRULE, so no phone sees a birthday change.
 *
 * `byDay` applies to WEEKLY only. MONTHLY and YEARLY repeat on the date they
 * started, and an occurrence that would need a 31st of February is skipped
 * rather than moved — see lib/recur.ts.
 */
export const RecurrenceSchema = z.object({
  freq: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  interval: z.number().int().min(1).max(365).default(1),
  byDay: z.array(z.enum(["SU", "MO", "TU", "WE", "TH", "FR", "SA"])).max(7).optional(),
  /** Inclusive, a plain date. The last day it may occur. */
  until: z.string().regex(DATE_ONLY).optional(),
  /** How many times in total, counted from the first occurrence. */
  count: z.number().int().min(1).max(1000).optional(),
});

export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const EventSchema = z
  .object({
    id: z.string().min(1),
    layer: z.string().min(1),
    title: z.string().min(1),
    start: z.string().min(1),
    end: z.string().min(1).optional(),
    allDay: z.boolean().default(false),
    tz: z.string().default("America/New_York"),
    location: z.string().optional(),
    url: z.string().url().optional(),
    notes: z.string().optional(),
    source: SourceSchema,
    /** per-event overrides of the layer's mark: one holiday feed, many faces */
    emoji: z.string().optional(),
    color: z.string().optional(),
    watch: WatchSchema.optional(),
    alarm: AlarmSchema.nullish(),
    recurrence: RecurrenceSchema.optional(),
    status: z.enum(eventStatuses).default("confirmed"),
    seq: z.number().int().min(0).default(0),
    updatedAt: z.string(),
  })
  .superRefine((ev, ctx) => {
    const dateOnly = DATE_ONLY.test(ev.start);
    if (ev.allDay && !dateOnly) {
      ctx.addIssue({
        code: "custom",
        message: `all-day event ${ev.id} needs a YYYY-MM-DD start, got "${ev.start}"`,
      });
    }
    if (!ev.allDay && dateOnly) {
      ctx.addIssue({
        code: "custom",
        message: `timed event ${ev.id} needs a full ISO start, got "${ev.start}"`,
      });
    }
    if (ev.end && ev.end < ev.start) {
      ctx.addIssue({ code: "custom", message: `event ${ev.id} ends before it starts` });
    }
  });

export type DayboardEvent = z.infer<typeof EventSchema>;

/**
 * What the editor sends, as against what gets stored.
 *
 * A separate schema because the two are genuinely different shapes: a form
 * gives a date and a time as text and knows nothing about ids, offsets, `seq`
 * or `source`. buildCuratedEvent turns one into the other.
 *
 * EVERY STRING IS BOUNDED. This is the second schema in the repo parsing input
 * from a browser (TodoSchema was the first), and the reason is the same — an
 * unbounded string is an unbounded file write, and this one goes into the
 * calendar the phone subscribes to.
 */
export const EventInputSchema = z.object({
  layer: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  /** "2026-10-04" for all-day, or "2026-10-04 19:30" / full ISO for timed. */
  start: z.string().min(1).max(40),
  end: z.string().max(40).optional(),
  location: z.string().max(200).optional(),
  url: z.string().url().max(500).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().max(2000).optional(),
  status: z.enum(eventStatuses).default("confirmed"),
  recurrence: RecurrenceSchema.optional(),
});

export type EventInput = z.infer<typeof EventInputSchema>;
export type EventSource = z.infer<typeof SourceSchema>;

/** A layer file is just an array of events. */
export const EventFileSchema = z.array(EventSchema);

export const LayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
  /** a crest image: a path under public/ or an https URL; takes precedence over emoji */
  logo: z.string().optional(),
  /** used when there is no logo */
  emoji: z.string().optional(),
  order: z.number().int(),
  /** included in dayboard.ics (the feed the phone subscribes to) */
  inFeed: z.boolean().default(true),
  /** shown without the user un-hiding it */
  showByDefault: z.boolean().default(true),
  /**
   * Events in this layer are things that kick off — a match, a tournament — so
   * the Watch panel should surface them while they are on. Config rather than a
   * check on the "sports-" prefix, because that prefix is a convention here and
   * nothing enforces it; this way a new layer joins in without a code change.
   */
  fixture: z.boolean().default(false),
  /** applied to timed events in this layer that carry no alarm of their own */
  defaultAlarmMinutes: z.number().int().nullable().default(null),
  /** applied to all-day events; -540 = 9:00am on the day */
  defaultAlarmMinutesAllDay: z.number().int().nullable().default(null),
});

export type Layer = z.infer<typeof LayerSchema>;
export const LayersFileSchema = z.array(LayerSchema);

export const UpstreamSchema = z.object({
  id: z.string().min(1),
  layer: z.string().min(1),
  /** an https URL, or "env:VAR_NAME" to read it from the environment */
  url: z.string().min(1),
  fallbackUrl: z.string().optional(),
  enabled: z.boolean().default(true),
  window: z
    .object({ pastDays: z.number().int().min(0), futureDays: z.number().int().min(1) })
    .default({ pastDays: 30, futureDays: 240 }),
  /**
   * "upstream" hashes the feed's own UID (stable feeds).
   * "title-date" derives one from title + local date (feeds that regenerate UIDs
   * on every build, which would otherwise duplicate every event on the phone).
   */
  uidStrategy: z.enum(["upstream", "title-date"]).default("upstream"),
  alarmMinutes: z.number().int().nullable().default(null),
  /** the team this feed follows; turns a postal address into "Home · Venue" */
  team: z.string().optional(),
  /** shown for home fixtures when the feed names the club instead of the ground */
  homeVenue: z.string().optional(),
  /** competition keys from src/lib/watch.ts, most likely first */
  competitions: z.array(z.string()).default([]),
  /** TBD kickoffs arrive as local midnight; treat those as all-day instead */
  forceAllDayIfMidnight: z.boolean().default(true),
  titleRewrite: z
    .array(z.object({ pattern: z.string(), replace: z.string() }))
    .default([]),
  /** regexes; a matching SUMMARY is dropped entirely */
  drop: z.array(z.string()).default([]),
});

export type Upstream = z.infer<typeof UpstreamSchema>;
export const UpstreamsFileSchema = z.array(UpstreamSchema);

export const ManifestSchema = z.object({
  updatedAt: z.string(),
  upstreams: z.record(
    z.string(),
    z.object({
      fetchedAt: z.string().nullable(),
      ok: z.boolean(),
      status: z.union([z.number(), z.string()]).nullable(),
      count: z.number().int(),
      previousCount: z.number().int().nullable(),
      consecutiveFailures: z.number().int(),
      error: z.string().nullable(),
      urlUsed: z.string().nullable(),
    }),
  ),
  counts: z.record(z.string(), z.number().int()),
  lastUesSweep: z.string().nullable().default(null),
});

export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * A to-do. Deliberately NOT an event.
 *
 * It has no date, which `EventSchema` requires and every consumer in
 * `lib/events.ts` assumes; and it has no "done", which would have to be spelled
 * `status: "cancelled"` and would reach the phone as a CANCELLED event. Bending
 * the event schema to fit would cost both of those and buy nothing — a to-do is
 * not on the calendar and never goes in the ICS feed.
 *
 * `.max(500)` is the one load-bearing rule here: this is the only schema in the
 * repo parsing input from a browser, and an unbounded string is an unbounded
 * file write.
 *
 * There is no `order` field. The array IS the order — newest first — and
 * flagged items are floated at render time, so there is nothing to keep in step.
 */
export const TodoSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(500),
  flagged: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Todo = z.infer<typeof TodoSchema>;
export const TodoFileSchema = z.array(TodoSchema);

/**
 * `data/notes.json` — one page of text, and nothing else.
 *
 * NOT A LIST, which is the whole difference from the to-dos above. A to-do is a
 * thing with a life cycle: it is added, flagged, and finishing it is deleting
 * it. This is a scratch pad — the place a thought goes at the moment it arrives,
 * before it is anything shaped enough to be an item. Splitting it into records
 * would mean deciding where one note ends, which is exactly the decision that
 * makes people stop writing things down.
 *
 * So: one string, one timestamp, and the newlines in it are the user's problem
 * in the good sense. `.max(50_000)` is the load-bearing part, for the same
 * reason TodoSchema bounds its text — this parses input from a browser, and an
 * unbounded string is an unbounded file write. Fifty thousand characters is
 * about twenty pages; nothing typed by hand into a second-monitor dashboard gets near it.
 */
export const NotesFileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  text: z.string().max(50_000).default(""),
  updatedAt: z.string().default(""),
});

export type NotesFile = z.infer<typeof NotesFileSchema>;

/**
 * `data/water.json` — how much water was drunk, by day.
 *
 * One number per date and a goal, which is the whole model. There is no log of
 * individual drinks: a timestamped list would let the widget draw a nice chart
 * of WHEN, and nobody has ever wanted that from a water tracker — the only
 * question is "have I had enough today", and the only correction needed is
 * "that last one was a mistake", which subtracting handles.
 *
 * Ounces because that is what the bottles on the desk are marked in.
 */
export const WaterFileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** The daily target. 80oz is two of the big bottle; edit it here or by CLI. */
  goalOz: z.number().int().min(8).max(400).default(80),
  /** date → ounces. Days with nothing logged are simply absent. */
  days: z.record(z.string().regex(DATE_ONLY), z.number().int().min(0).max(1000)).default({}),
});

export type WaterFile = z.infer<typeof WaterFileSchema>;

/* ---------------------------------------------------------------- watched --- */

/**
 * Which videos are off the Watch list, as YouTube id to the date they went.
 *
 * WHY THIS IS A FILE AND NOT localStorage, WHICH IS WHERE IT LIVED. Clearing a
 * video is a decision, and every other decision this board records — a hidden
 * job, a ticked to-do, a walk marked done — is a line in `data/`. This one was
 * the exception, and it kept getting thrown away by things that had nothing to
 * do with it: localStorage is keyed by profile AND origin, so moving the board
 * from port 3000 to 6767 wiped it once and giving the display its own Chrome
 * profile wiped it again. Neither change was about videos, and both looked from
 * the sofa like the board forgetting what you had cleared.
 *
 * The three localStorage keys that remain are per-device on purpose — which tab
 * each panel is showing, what is in the player and where it got to, which nudges
 * have already spoken on this machine. Those SHOULD differ between the board and
 * a phone. "I have seen this video" should not.
 *
 * A date rather than `true` because it costs
 * nothing, it makes the file readable when you open it, and it is what the cap
 * in lib/watched.ts trims by.
 */
export const WatchedFileSchema = z.object({
  ids: z
    .record(z.string().min(1), z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .default({}),
});

export type WatchedFile = z.infer<typeof WatchedFileSchema>;

/* ----------------------------------------------------------------- health --- */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const HealthSlotSchema = z.object({
  id: z.string().min(1).max(40),
  /** "HH:mm", New York — the same clock every date in this repo keeps. */
  time: z.string().regex(HHMM),
  label: z.string().min(1).max(60),
  /**
   * What the nudge is about. The first three are tied to the exercise
   * programme — they only fire on a day that calls for them, and logging the
   * work answers them.
   *
   * "reminder" is the odd one and the reason it exists: a vitamin at 9am has
   * nothing to do with which session today is, nothing satisfies it but
   * dismissing it, and it fires every single day. Bending one of the other
   * three to mean that would have made `relevant()` and `satisfied()` lie.
   *
   * "chair" is the five-minute chair routine (lib/health/chair.ts): every day,
   * rest days included, and answered by finishing a routine within the hour
   * before it.
   */
  kind: z.enum(["walk", "strength", "last_call", "reminder", "chair"]),
  enabled: z.boolean().default(true),
  /**
   * The recurrence, as a choice between two shapes that are never both set:
   *
   *  - `days`: the weekdays a RECURRING nudge fires on. Absent or empty means
   *    every day, which is every programme slot and a plain "vitamins at 9am".
   *  - `date`: a JUST-TODAY one-shot, stamped with the New York date it was made
   *    on. The user never types a date — the editor offers "recurring" or "just
   *    today" and "just today" is this. It fires once on its day and is inert
   *    before and after, so a spent one sits harmlessly until the next save drops
   *    it. See slots.ts `onThisDay` for the guard that enforces both.
   */
  days: z.array(z.enum(["SU", "MO", "TU", "WE", "TH", "FR", "SA"])).max(7).optional(),
  date: z.string().regex(DATE_ONLY).optional(),
});

/**
 * How the program is set up. Every field but the start date has a default, so a
 * file written today keeps parsing as this grows — the same rule every stored
 * file here keeps. The start date has none on purpose: a missing one would
 * silently restart the program at whatever day the file was read.
 */
export const HealthSettingsSchema = z.object({
  programStartDate: z.string().regex(DATE_ONLY),
  /** Rung index per movement pattern. The engine owns the semantics. */
  patternLevels: z.record(z.string().min(1), z.number().int().min(0).max(20)).default({}),
  slots: z
    .array(HealthSlotSchema)
    // Raised from 8 when the reminders arrived: three programme nudges plus a
    // day's worth of "have you eaten" is comfortably past the old cap.
    .max(24)
    .default([
      { id: "walk", time: "11:45", label: "Midday walk", kind: "walk", enabled: true },
      { id: "strength", time: "16:30", label: "Strength session", kind: "strength", enabled: true },
      { id: "last-call", time: "20:00", label: "Last call", kind: "last_call", enabled: true },
      { id: "chair-am", time: "09:45", label: "Chair five", kind: "chair", enabled: true },
      { id: "chair-pm", time: "14:45", label: "Chair five", kind: "chair", enabled: true },
      { id: "chair-eve", time: "18:45", label: "Chair five", kind: "chair", enabled: true },
      { id: "chair-late", time: "21:45", label: "Chair five", kind: "chair", enabled: true },
    ]),
  quietHours: z
    .object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) })
    .default({ start: "23:00", end: "07:00" }),
  /** How late a missed nudge may still fire. */
  graceMinutes: z.number().int().min(0).max(180).default(20),
  soundEnabled: z.boolean().default(true),
  paused: z.boolean().default(false),
  /** The 20/20/20 rule: every 20 minutes, 20 feet away, 20 seconds. */
  eyeBreaks: z
    .object({
      enabled: z.boolean().default(true),
      everyMinutes: z.number().int().min(5).max(120).default(20),
      forSeconds: z.number().int().min(10).max(120).default(20),
      /**
       * Its own, and null by default rather than borrowing the nudge hours
       * above. Those exist so the board does not shout about a walk at 11pm;
       * eyes at 11pm are the ones with the most screen behind them. Sharing the
       * setting meant eye breaks silently stopped every evening at nine.
       */
      quietHours: z
        .object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) })
        .nullable()
        .default(null),
    })
    .default({ enabled: true, everyMinutes: 20, forSeconds: 20, quietHours: null }),
});

export const HealthExerciseSchema = z.object({
  exerciseId: z.string().min(1).max(60),
  patternId: z.string().min(1).max(40),
  rungIndex: z.number().int().min(0).max(20),
  roundsCompleted: z.number().int().min(0).max(20),
  skipped: z.boolean().default(false),
});

export const HealthDaySchema = z.object({
  date: z.string().regex(DATE_ONLY),
  sessionId: z.string().min(1).max(60),
  kind: z.enum(["strength", "walk", "mobility", "minimum"]),
  status: z.enum(["completed", "partial", "skipped"]),
  completedAt: z.string().min(1),
  /** Six hours is not a workout; it is a timer somebody left running. */
  durationSec: z.number().int().min(0).max(6 * 3600),
  exercises: z.array(HealthExerciseSchema).max(60).default([]),
  feedback: z.enum(["too_easy", "just_right", "too_hard"]).optional(),
  notes: z.string().max(500).optional(),
});

export const HealthWalkSchema = z.object({
  id: z.string().min(1).max(60),
  date: z.string().regex(DATE_ONLY),
  loggedAt: z.string().min(1),
  durationMin: z.number().int().min(1).max(600),
  source: z.enum(["timer", "manual"]),
  outdoors: z.boolean().default(true),
});

/** One finished chair routine. See lib/health/chair.ts. */
export const HealthChairSchema = z.object({
  id: z.string().min(1).max(60),
  date: z.string().regex(DATE_ONLY),
  completedAt: z.string().min(1).max(40),
  routineId: z.string().min(1).max(40),
  /** Half an hour is not a five-minute routine; it is a timer left running. */
  durationSec: z.number().int().min(0).max(1800),
  skipped: z.array(z.string().min(1).max(60)).max(20).default([]),
});

export const HealthAdjustmentSchema = z.object({
  id: z.string().min(1).max(80),
  date: z.string().regex(DATE_ONLY),
  patternId: z.string().min(1).max(40),
  fromRung: z.number().int().min(0).max(20),
  toRung: z.number().int().min(0).max(20),
  reason: z.enum(["too_easy", "too_hard", "auto_progress"]),
});

/**
 * `data/health.json` — the exercise program's history and setup.
 *
 * This is the standalone app's `%APPDATA%\out-of-office\data.json`, minus two fields
 * that were facts about a running desktop app rather than about the program:
 * which nudges have already fired today, and any pending snooze. Those describe
 * the browser looking at the board, so they live in that browser's localStorage
 * (see components/HealthAlert.tsx). Everything here is history worth committing.
 *
 * Like every other schema parsing input from a browser, every string is bounded.
 */
export const HealthFileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  settings: HealthSettingsSchema,
  days: z.record(z.string().regex(DATE_ONLY), HealthDaySchema).default({}),
  walks: z.array(HealthWalkSchema).default([]),
  /** Defaulted, so every file written before the chair routine still parses. */
  chair: z.array(HealthChairSchema).max(5000).default([]),
  adjustments: z.array(HealthAdjustmentSchema).default([]),
});

export type HealthFile = z.infer<typeof HealthFileSchema>;
export type HealthSettingsFile = z.infer<typeof HealthSettingsSchema>;

/**
 * `data/config/health-videos.json` — the follow-along videos, keyed by what they
 * are for: a session kind (`strength`, `walk`, `mobility`, `minimum`), `warmup`,
 * `cooldown`, or a rung id from the ladders (`squat-goblet`).
 *
 * Separate from health.json because the two change on completely different
 * clocks. History is written by finishing a workout, several times a week, and a
 * bad write there costs a streak. This is "which video to show for a kind",
 * edited a handful of times a year. data/config is where "what to fetch and
 * what to show" already lives.
 */
export const HealthVideoSchema = z.object({
  /** A YouTube id, which is the only thing the board's player can take. */
  id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().min(1).max(200),
  channel: z.string().max(100).optional(),
  addedAt: z.string().regex(DATE_ONLY).optional(),
});

export const HealthVideosFileSchema = z.object({
  videos: z.record(z.string().regex(/^[a-z0-9-]+$/), z.array(HealthVideoSchema).max(12)).default({}),
});

export type HealthVideo = z.infer<typeof HealthVideoSchema>;
export type HealthVideosFile = z.infer<typeof HealthVideosFileSchema>;
