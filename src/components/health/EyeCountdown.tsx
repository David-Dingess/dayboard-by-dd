"use client";

import { useClockBucket } from "@/components/clock";
import { useEyeClock } from "./eye-clock";

/**
 * How long until the next eye break.
 *
 * THIS IS THE ANSWER TO "IS 20/20/20 EVEN WORKING". Counting draws nothing on
 * its own by design, which meant a feature that had quietly stood down —
 * bedtime, a stale busy flag — looked exactly like one that was running. So it
 * says which, in one line, from the stack.
 *
 * There is no "held" reading any more: hidden time counts now (see
 * lib/health/eyebreak.ts), so a board that has been behind another window comes
 * back showing a clock that kept running, which is the truth.
 *
 * Two subscriptions, doing different jobs: the eye clock publishes a DEADLINE
 * whenever the reducer steps (every five seconds at most), and the one-second
 * bucket is what turns that deadline into a number that moves. Neither makes
 * EyeBreak re-render.
 *
 * Bucket 0 is the server, which has no browser and therefore no clock: it draws
 * the dash, and so does the first client paint, so hydration matches.
 */

const REASON: Record<string, string> = {
  disabled: "off",
  quiet: "quiet",
  busy: "session",
  idle: "—",
};

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function EyeCountdown() {
  const clock = useEyeClock();
  const bucket = useClockBucket(1_000);
  const now = bucket * 1_000;

  if (bucket === 0) return <span className="quick-value">—</span>;

  switch (clock.phase) {
    case "counting":
      return <span className="quick-value">{mmss(clock.nextAt - now)}</span>;
    case "warning":
    case "breaking":
      return <span className="quick-value is-live">{mmss(clock.endsAt - now)}</span>;
    default:
      return <span className="quick-value is-quiet">{REASON[clock.reason] ?? "—"}</span>;
  }
}
