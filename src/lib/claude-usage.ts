import { agentBase } from "@/lib/nowplaying";
import type { Level } from "@/lib/vitals";

/**
 * The shape `agent/nowplaying`'s /claude route speaks, mirroring Claude.cs.
 *
 * Read in the BROWSER, like /vitals and for a sharper version of the same
 * reason: the numbers come from an OAuth token in %USERPROFILE%\.claude, which a
 * a remote host process cannot read and must never be handed. The agent holds the token
 * and the answer; the board only ever sees percentages.
 */

export type ClaudeState =
  | "ok"
  | "no-credentials"
  | "expired"
  | "rate-limited"
  | "error"
  | "looking";

/**
 * One bar, passed through from the API's `limits` array.
 *
 * DELIBERATELY NOT THREE NAMED FIELDS. The usage response's top level carries a
 * rotating set of codenames — nimbus_quill, tangelo, juniper_tide — nearly all
 * null, and Fable is not reachable under any guessable key. The array is the
 * real payload and names its own contents, so the widget renders whatever
 * arrives: three bars today, and a fourth appears by itself if Anthropic adds
 * one.
 */
export interface ClaudeLimit {
  /** "session", "weekly_all", "weekly_scoped", or whatever comes next. */
  kind: string;
  /** "session" | "weekly". Grouped on this rather than on kind. */
  group: string | null;
  /** A scoped cap's model name — "Fable". Null for the whole-plan windows. */
  label: string | null;
  /** 0–100. Not 0–1. */
  percent: number;
  /** The server's own call: "normal" | "warning" | "critical". */
  severity: string | null;
  resetsAt: string | null;
  isActive: boolean;
}

export interface ClaudeUsage {
  state: ClaudeState;
  /** Unix ms of the last successful upstream read — null until the first lands. */
  fetchedAt: number | null;
  plan: string | null;
  tier: string | null;
  limits: ClaudeLimit[];
  /** Why state is not "ok", written for you to read verbatim. */
  note: string | null;
}

export function claudeUrl(): string {
  return `${agentBase()}/claude`;
}

/**
 * What Claude is doing right now, mirroring ClaudeSessions.cs.
 *
 * A SECOND ROUTE, not a field on the one above, because the two move at
 * completely different speeds: the bars change every five minutes and this
 * changes every couple of seconds. One payload would force the widget to poll
 * both at the faster rate for no benefit.
 */
export interface ClaudeActivity {
  /** Worst-state-wins across every live session: waiting beats working. */
  activity: "working" | "waiting" | "chilling";
  /** How many Claude Code processes are alive. */
  live: number;
  /** Folder name of the session that set the state. */
  where: string | null;
  quietFor: number | null;
}

export function claudeActivityUrl(): string {
  return `${agentBase()}/claude/activity`;
}

/**
 * What the cat is doing, said plainly. Sits beside the shelf, not on it.
 *
 * "NEEDS YOUR OK", NOT "WAITING ON YOU". The state means one specific thing —
 * a permission prompt nobody answered — and the vaguer wording claimed
 * something false about every finished conversation, which is exactly the
 * complaint that narrowed the state in the first place. A session you
 * considers done says nothing at all; it just counts towards the total.
 */
export function activityLabel(a: ClaudeActivity | null): string {
  if (!a || a.live === 0) return "nothing running";
  const many = a.live === 1 ? "1 session" : `${a.live} sessions`;
  const where = a.where ? ` in ${a.where}` : "";
  if (a.activity === "working") return `working${where} · ${many}`;
  if (a.activity === "waiting") return `needs your OK${where} · ${many}`;
  return `idle · ${many}`;
}

/**
 * What to call each bar.
 *
 * The API's own words where it has them — a scoped cap already carries its
 * model's display name, which is the only reason "Fable" appears on the board at
 * all — and the CLI's own words where it does not. "5-hour" rather than "session"
 * because that is what the CLI calls it, and because "session" is ambiguous on a
 * board that also shows a browser and a player.
 */
export function limitLabel(limit: ClaudeLimit): string {
  if (limit.label) return limit.label;
  if (limit.kind === "session") return "5-hour";
  if (limit.kind === "weekly_all") return "Weekly";
  // Something new. Say its kind rather than inventing a name for it.
  return limit.kind.replace(/_/g, " ");
}

/**
 * Bars are ordered shortest window first, so the one that moves fastest is the
 * one nearest the eye. Anything unrecognised sorts to the end rather than
 * disappearing.
 */
const ORDER: Record<string, number> = { session: 0, weekly_all: 1, weekly_scoped: 2 };

export function orderLimits(limits: ClaudeLimit[]): ClaudeLimit[] {
  return [...limits].sort(
    (a, b) => (ORDER[a.kind] ?? 90) - (ORDER[b.kind] ?? 90) || a.percent - b.percent,
  );
}

/**
 * Where a bar stops being fine.
 *
 * The SERVER'S severity wins when it says something is wrong, because Anthropic
 * knows things about the account that a percentage does not carry — a scoped cap
 * that is about to lock, an overage setting. Our own threshold only ever adds
 * the amber step it does not send, so the board can go yellow before it goes
 * red rather than jumping between two states.
 */
const WARN_AT = 75;
const CRIT_AT = 90;

export function levelOf(limit: ClaudeLimit): Level {
  if (limit.severity === "critical") return "crit";
  if (limit.severity === "warning") return "warn";
  if (limit.percent >= CRIT_AT) return "crit";
  if (limit.percent >= WARN_AT) return "warn";
  return "ok";
}

/**
 * "resets in 2h 14m" — a duration, not a clock time.
 *
 * A board is read from across the room and "4am Friday" makes you do the
 * subtraction yourself. Shaped on uptimeLabel in lib/vitals.ts, but rounding UP
 * on the minute: a limit that clears in 61 seconds should not read "resets in
 * 1m" for a whole minute and then jump to "now".
 */
export function resetLabel(resetsAt: string | null, now = Date.now()): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return null;
  const seconds = Math.round((at - now) / 1000);
  if (seconds <= 0) return "resetting";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  if (days > 0) return `resets in ${days}d ${hours}h`;
  if (hours > 0) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${minutes}m`;
}

/** "updated 4m ago". Null until the first successful read. */
export function ageLabel(fetchedAt: number | null, now = Date.now()): string | null {
  if (!fetchedAt) return null;
  const minutes = Math.floor((now - fetchedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
