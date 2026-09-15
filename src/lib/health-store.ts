import { readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic";
import {
  HealthFileSchema,
  HealthVideosFileSchema,
  type HealthFile,
  type HealthSettingsFile,
  type HealthVideo,
  type HealthVideosFile,
} from "./schema";
import {
  LADDERS,
  PATTERN_IDS,
  addDays,
  applyAdjustments,
  chairExtraFor,
  chairSlotsDone,
  computeAdherence,
  computeStreak,
  defaultSettings,
  evaluateProgression,
  formatDayLabel,
  formatShortDay,
  getMinimumDose,
  getSessionForDate,
  minutesOnDate,
  nowMinutes,
  phaseForWeek,
  rungAt,
  startOfWeek,
  trailingWeekMinutes,
  weekForDate,
  type ChairEntry,
  type DayRecord,
  type DifficultyAdjustment,
  type Feedback,
  type PatternId,
  type PhaseInfo,
  type Session,
  type SessionKind,
  videoKeysFor,
  type WalkEntry,
} from "./health";

/**
 * The Health tab's file, `data/health.json`, and everything the widget renders.
 *
 * Named `health-store` rather than `health` because `lib/health/` is the ported
 * engine and owns that import path. This is the half that knows about disk.
 *
 * Same shape as lib/todos.ts and lib/water.ts, for the same reasons, and the rule
 * at the top of todos.ts applies here word for word: NOTHING IN THIS FILE MAY
 * IMPORT FROM `next/*`, and it must never carry a "use server" directive. It is
 * loaded by scripts/health.ts under plain tsx as well as by the app, which is
 * the whole point — the CLI (and therefore the chat skill) and the buttons on
 * the board write through exactly the same validation and the same atomic save,
 * so neither can produce a file the other rejects. The Next-only half — the
 * gate, revalidatePath — is in health-actions.ts.
 *
 * It lives at the top of data/ rather than in data/layers/, because
 * loadCuratedEvents() parses every JSON file in there as an array of events.
 * (What the program does put ON the calendar is generated: see health-events.ts.)
 */

const FILE = path.join(process.cwd(), "data", "health.json");
const VIDEOS = path.join(process.cwd(), "data", "config", "health-videos.json");

/* ---------------------------------------------------------------- pure ---- */

export function emptyHealth(startDate: string): HealthFile {
  return HealthFileSchema.parse({ settings: { programStartDate: startDate } });
}

/** The engine's view of the file. `Settings` is structurally this already. */
export function contextOf(file: HealthFile) {
  return {
    programStartDate: file.settings.programStartDate,
    patternLevels: file.settings.patternLevels,
  };
}

/**
 * Log a finished session, and let the ladders move.
 *
 * Ports the standalone app's `recordDay` (ipc.ts and memoryAdapter.ts did the same
 * three steps): evaluate the progression against the history as it was, write
 * the day, then apply the adjustments to the stored levels. Order matters — the
 * auto-progress counter asks how many sessions have been completed at the
 * current rung, and today's is one of them.
 */
export function applyRecordDay(file: HealthFile, record: DayRecord): HealthFile {
  const adjustments = evaluateProgression({
    date: record.date,
    record,
    levels: file.settings.patternLevels,
    days: file.days,
    adjustments: file.adjustments,
  });
  return {
    ...file,
    days: { ...file.days, [record.date]: record },
    adjustments: [...file.adjustments, ...adjustments],
    settings: {
      ...file.settings,
      patternLevels: applyAdjustments(file.settings.patternLevels, adjustments),
    },
  };
}

/** "How did that feel?" — attaches the signal and re-runs the progression. */
export function applyFeedback(file: HealthFile, date: string, signal: Feedback): HealthFile {
  const record = file.days[date];
  if (!record) return file;
  const withFeedback: DayRecord = { ...record, feedback: signal };
  const adjustments = evaluateProgression({
    date,
    record: withFeedback,
    levels: file.settings.patternLevels,
    days: file.days,
    adjustments: file.adjustments,
  });
  return {
    ...file,
    days: { ...file.days, [date]: withFeedback },
    adjustments: [...file.adjustments, ...adjustments],
    settings: {
      ...file.settings,
      patternLevels: applyAdjustments(file.settings.patternLevels, adjustments),
    },
  };
}

export function applyClearDay(file: HealthFile, date: string): HealthFile {
  if (!file.days[date]) return file;
  const days = { ...file.days };
  delete days[date];
  return { ...file, days };
}

export function applyLogWalk(file: HealthFile, walk: WalkEntry): HealthFile {
  return { ...file, walks: [...file.walks, walk] };
}

/**
 * A finished chair routine. Kept apart from `days` and `walks` on purpose: it
 * is not the programme, so it must never make a day "done", extend a streak, or
 * answer last call. Five minutes of wrist stretches is not a workout.
 */
export function applyLogChair(file: HealthFile, entry: ChairEntry): HealthFile {
  return { ...file, chair: [...file.chair, entry] };
}

/** Today's chair routines, oldest first. */
export function chairOn(file: HealthFile, date: string): ChairEntry[] {
  return file.chair
    .filter((entry) => entry.date === date)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
}

/**
 * The New York minute of day each routine finished at — what a chair nudge is
 * answered by. Derived from the stored instant, so it carries no clock of its own.
 */
export function chairMinutes(entries: readonly ChairEntry[]): number[] {
  return entries
    .map((entry) => Date.parse(entry.completedAt))
    .filter((ms) => Number.isFinite(ms))
    .map((ms) => nowMinutes(new Date(ms)));
}

export function applyDeleteWalk(file: HealthFile, id: string): HealthFile {
  return { ...file, walks: file.walks.filter((w) => w.id !== id) };
}

/**
 * A shallow merge, re-validated. Callers hand over whole sub-objects
 * (`quietHours`, `eyeBreaks`, the slot array) rather than paths, so there is no
 * deep-merge behaviour to reason about.
 */
export function applySettings(file: HealthFile, patch: Partial<HealthSettingsFile>): HealthFile {
  return { ...file, settings: { ...file.settings, ...patch } };
}

/**
 * Back to week 1, keeping every day and walk already logged.
 *
 * The history stays because it is true — those sessions happened. What goes is
 * the ladder position and the adjustment trail, because the program is starting
 * over from the bottom rung and a stale trail would make the auto-progress
 * counter measure from a date that no longer means anything.
 */
export function applyRestart(file: HealthFile, startDate: string): HealthFile {
  return {
    ...file,
    settings: { ...file.settings, programStartDate: startDate, patternLevels: {} },
    adjustments: [],
  };
}

/* --------------------------------------------------------------- videos --- */

/**
 * The key helpers live in the engine (lib/health/videos.ts), not here: the paste
 * box and the tiles are client components, and this file reads `node:fs`, which
 * cannot be in a browser bundle at all. Re-exported so the CLI and the actions
 * have one import to reach for.
 */
export { VIDEO_SLOTS, validVideoKey, videoKeyLabel, videoKeysFor } from "./health/videos";

/** Newest first, deduped on the video id, and capped so the schema still parses. */
export function applyAttachVideo(
  file: HealthVideosFile,
  key: string,
  video: HealthVideo,
): HealthVideosFile {
  const existing = (file.videos[key] ?? []).filter((v) => v.id !== video.id);
  return { ...file, videos: { ...file.videos, [key]: [video, ...existing].slice(0, 12) } };
}

export function applyDetachVideo(file: HealthVideosFile, key: string, id: string): HealthVideosFile {
  const left = (file.videos[key] ?? []).filter((v) => v.id !== id);
  const videos = { ...file.videos };
  if (left.length) videos[key] = left;
  else delete videos[key];
  return { ...file, videos };
}

/* ------------------------------------------------------------ snapshot ---- */

/**
 * One line under the stats tying the day's work back to why you are doing it.
 * Rotates by date so it is a small recurring nudge rather than wallpaper.
 */
const NOTES = [
  "In an eight-week walking study, men went from waking 3.3 times a night to 1.9 — and two thirds reported deeper sleep.",
  "A walk before dinner alone cut nightly bathroom trips from 2.3 to 1.6.",
  "Exercise training lowers apnea severity and daytime sleepiness on its own, without any weight change.",
  "Midday daylight is when skin actually makes vitamin D — about three times the yield of early morning.",
  "Men active an hour a week or more are 34% less likely to report severe nocturia.",
  "Missing one day has no measurable effect on a forming habit. Missing two in a row does.",
  "Sitting for hours is its own risk factor, separate from how much you exercise. Standing up is the intervention.",
];

export interface WeekCell {
  date: string;
  short: string;
  kind: SessionKind;
  estMinutes: number;
  minutes: number;
  isToday: boolean;
  isPast: boolean;
}

export interface LoggedRow {
  key: string;
  date: string;
  label: string;
  title: string;
  minutes: number;
  feedback?: Feedback;
  /** Set when this row is a walk, which is the only kind that can be removed singly. */
  walkId?: string;
}

export interface LadderRow {
  patternId: PatternId;
  label: string;
  rung: string;
  shown: number;
  total: number;
  capped: boolean;
}

export interface HealthSnapshot {
  today: string;
  dayLabel: string;
  session: Session;
  minimum: Session;
  record: DayRecord | null;
  walksToday: WalkEntry[];
  done: boolean;
  streak: { current: number; forgivenGap: boolean };
  adherence: { done: number; scheduled: number; pct: number };
  trailingMinutes: number;
  week: WeekCell[];
  recent: LoggedRow[];
  ladders: LadderRow[];
  settings: HealthSettingsFile;
  phase: PhaseInfo;
  weekNumber: number;
  note: string;
  /** Only the keys today can show, so the client is not handed the whole map. */
  videos: Record<string, HealthVideo[]>;
  chair: {
    /** How many routines were finished today, which also picks the next extra. */
    doneToday: number;
    /** The rotating minute the NEXT routine will carry, e.g. "hips". */
    nextExtra: string;
    /**
     * Today's chair slots in clock order, with whether each has been done. Whether
     * an undone one is due or still ahead is a question about the time, which
     * this snapshot never asks — the card works that out in the browser.
     */
    slots: Array<{ id: string; time: string; label: string; enabled: boolean; done: boolean }>;
  };
}

/**
 * Everything the widget draws, computed on the server from one date key.
 *
 * Deliberately free of `Date.now()`: `today` comes from `todayLocal()` and every
 * label is a fixed-locale format, so the markup the server sends is the markup
 * the browser would have produced. Anything that has to know the actual time —
 * the countdown, the nudge tick, the eye-break clock — is client-side and says
 * so.
 */
export function buildSnapshot(
  file: HealthFile,
  today: string,
  videos: HealthVideosFile = { videos: {} },
): HealthSnapshot {
  const ctx = contextOf(file);
  const history = { days: file.days, walks: file.walks };
  const session = getSessionForDate(ctx, today);
  const record = file.days[today] ?? null;
  const walksToday = file.walks.filter((w) => w.date === today);
  const chairToday = chairOn(file, today);

  const weekStart = startOfWeek(today);
  const week: WeekCell[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const day = getSessionForDate(ctx, date);
    return {
      date,
      short: formatShortDay(date),
      kind: day.kind,
      estMinutes: day.estMinutes,
      minutes: minutesOnDate(history, date),
      isToday: date === today,
      isPast: date < today,
    };
  });

  const recent: LoggedRow[] = [];
  for (let i = 0; i < 28 && recent.length < 14; i++) {
    const date = addDays(today, -i);
    const day = file.days[date];
    if (day && day.status !== "skipped") {
      recent.push({
        key: `day-${date}`,
        date,
        label: formatDayLabel(date),
        title: day.kind === "minimum" ? "Five-minute minimum" : getSessionForDate(ctx, date).title,
        minutes: Math.round(day.durationSec / 60),
        feedback: day.feedback,
      });
    }
    for (const walk of file.walks.filter((w) => w.date === date)) {
      recent.push({
        key: `walk-${walk.id}`,
        date,
        label: formatDayLabel(date),
        title: walk.outdoors ? "Walk · outdoors" : "Walk",
        minutes: walk.durationMin,
        walkId: walk.id,
      });
    }
  }

  const weekNumber = weekForDate(file.settings.programStartDate, today);
  const phase = phaseForWeek(weekNumber);

  const ladders: LadderRow[] = PATTERN_IDS.map((patternId) => {
    const stored = file.settings.patternLevels[patternId] ?? 0;
    const total = LADDERS[patternId].rungs.length;
    const shown = Math.min(stored, phase.rungCap, total - 1);
    return {
      patternId,
      label: LADDERS[patternId].label,
      rung: rungAt(patternId, shown).name,
      shown,
      total,
      capped: stored > shown,
    };
  });

  const keys = new Set(videoKeysFor(session));
  keys.add("minimum");
  const forToday: Record<string, HealthVideo[]> = {};
  for (const key of keys) {
    const list = videos.videos[key];
    if (list?.length) forToday[key] = list;
  }

  return {
    today,
    dayLabel: formatDayLabel(today),
    session,
    minimum: getMinimumDose(today, ctx),
    record,
    walksToday,
    done: (record != null && record.status !== "skipped") || walksToday.length > 0,
    streak: computeStreak(ctx, history, today),
    adherence: computeAdherence(ctx, history, today),
    trailingMinutes: trailingWeekMinutes(history, today),
    week,
    recent,
    ladders,
    settings: file.settings,
    phase: { index: phase.index, name: phase.name, startWeek: phase.startWeek, endWeek: phase.endWeek, blurb: phase.blurb },
    weekNumber,
    note: NOTES[Number(today.replaceAll("-", "")) % NOTES.length],
    videos: forToday,
    chair: {
      doneToday: chairToday.length,
      nextExtra: chairExtraFor(chairToday.length).name,
      slots: chairSlotsDone(file.settings.slots, chairMinutes(chairToday)),
    },
  };
}

/* ------------------------------------------------------------------ fs ---- */

/**
 * Read every time, like the to-dos and for the same reason: this file has
 * writers outside this process (scripts/health.ts, and the chat skill through
 * it), and a Server Action that writes it then calls revalidatePath("/") would
 * otherwise re-render the board from the state before the write.
 */
export function loadHealth(): HealthFile {
  try {
    return HealthFileSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(`dayboard: health.json unreadable — ${(err as Error).message.split("\n")[0]}`);
    }
    // A missing or broken file must not take the board down. It does mean today
    // reads as week 1, which is visibly wrong rather than quietly wrong.
    return emptyHealth(defaultSettings().programStartDate);
  }
}

export function saveHealth(next: HealthFile): void {
  writeJsonAtomic(FILE, JSON.stringify(HealthFileSchema.parse(next), null, 2) + "\n");
}

export function loadHealthVideos(): HealthVideosFile {
  try {
    return HealthVideosFileSchema.parse(JSON.parse(readFileSync(VIDEOS, "utf8")));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(`dayboard: health-videos.json unreadable — ${(err as Error).message.split("\n")[0]}`);
    }
    return { videos: {} };
  }
}

export function saveHealthVideos(next: HealthVideosFile): void {
  writeJsonAtomic(VIDEOS, JSON.stringify(HealthVideosFileSchema.parse(next), null, 2) + "\n");
}

export type { ChairEntry, DayRecord, DifficultyAdjustment, WalkEntry };
