import type { DateKey } from "./dates";

/**
 * What the program remembers. Ported from the standalone app's `shared/types.ts`,
 * minus three things that were facts about one running desktop app rather than
 * about the program: `launchAtLogin` and `closeToTray` (there is no app), and
 * `firedMarkers` / `pendingSnooze` (which nudges have fired is a fact about the
 * browser looking at the board, so it lives in that browser's localStorage —
 * see components/HealthAlert.tsx).
 *
 * The zod versions of these, which are what actually parse data/health.json,
 * are in lib/schema.ts. These stay as plain interfaces because the engine files
 * were written against them and copy over unchanged.
 */

export type SlotKind = "walk" | "strength" | "last_call" | "reminder" | "chair";

/** Weekday codes, indexed to Date#getDay: SU=0 … SA=6. */
export type DayCode = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";

export interface NotificationSlot {
  id: string;
  /** "HH:mm", New York. */
  time: string;
  label: string;
  kind: SlotKind;
  enabled: boolean;
  /** A recurring nudge's weekdays; absent/empty is every day. See slots.ts. */
  days?: DayCode[];
  /** A "just today" one-shot, stamped with the NY date ("YYYY-MM-DD") it fires.
   *  Never both this and `days`. See slots.ts and schema.ts. */
  date?: string;
}

export interface EyeBreakSettings {
  enabled: boolean;
  everyMinutes: number;
  forSeconds: number;
  /** Null means none — see the schema for why these are not the nudge hours. */
  quietHours: { start: string; end: string } | null;
}

export interface Settings {
  programStartDate: DateKey;
  /** Current rung index per movement pattern; the engine owns the semantics. */
  patternLevels: Record<string, number>;
  slots: NotificationSlot[];
  quietHours: { start: string; end: string };
  /** How late a missed nudge may still fire, in minutes. */
  graceMinutes: number;
  soundEnabled: boolean;
  /** Pauses nudges and the streak's expectations without losing history. */
  paused: boolean;
  eyeBreaks: EyeBreakSettings;
}

export type DayStatus = "completed" | "partial" | "skipped";
export type Feedback = "too_easy" | "just_right" | "too_hard";

export interface ExerciseResult {
  exerciseId: string;
  patternId: string;
  rungIndex: number;
  roundsCompleted: number;
  skipped: boolean;
}

export interface DayRecord {
  date: DateKey;
  sessionId: string;
  kind: "strength" | "walk" | "mobility" | "minimum";
  status: DayStatus;
  /** ISO datetime. */
  completedAt: string;
  durationSec: number;
  exercises: ExerciseResult[];
  feedback?: Feedback;
  notes?: string;
}

export interface WalkEntry {
  id: string;
  date: DateKey;
  /** ISO datetime. */
  loggedAt: string;
  durationMin: number;
  source: "timer" | "manual";
  outdoors: boolean;
}

/** One finished chair routine — see lib/health/chair.ts. Not a session, not a walk. */
export interface ChairEntry {
  id: string;
  date: DateKey;
  /** ISO datetime. What a chair nudge is answered by, via its NY minute of day. */
  completedAt: string;
  routineId: string;
  durationSec: number;
  /** Step keys skipped along the way. */
  skipped: string[];
}

export interface DifficultyAdjustment {
  id: string;
  date: DateKey;
  patternId: string;
  fromRung: number;
  toRung: number;
  reason: "too_easy" | "too_hard" | "auto_progress";
}

export type FiredMarker = "fired" | "missed";
