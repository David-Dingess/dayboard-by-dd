"use client";

import { useClockBucket } from "@/components/clock";

/**
 * "updated 2m ago" — the honest half of what the refresh button used to do.
 *
 * The button is gone because the board refreshes itself; this label is what is
 * left, and it earns its space on a second-monitor dashboard for one reason: a frozen board
 * looks exactly like a live one. Train times go wrong fast, and the only way to
 * tell a 6 that is four minutes out from a 6 that was four minutes out ten
 * minutes ago is to say when the number was fetched.
 *
 * `fetchedAt` is the real load time from lib/memo.ts, not the time of the render,
 * so a cache hit reads as the half-minute-old thing it is.
 *
 * The clock comes from components/clock.ts — see there for why it is an external
 * store rather than state set in an effect.
 */

const BUCKET_MS = 10_000;

export function Freshness({
  fetchedAt,
  /**
   * When silence starts meaning trouble, which is a per-source question: the MTA
   * feed is stale at three minutes, a 15-minute forecast is not.
   */
  staleAfterMs = 180_000,
}: {
  fetchedAt: string;
  staleAfterMs?: number;
}) {
  const bucket = useClockBucket(BUCKET_MS);

  // Bucket 0 is the server's snapshot: it has no clock to compare against, so it
  // renders the one label that is true at the moment the page is built.
  const seconds =
    bucket === 0
      ? 0
      : Math.max(0, Math.round((bucket * BUCKET_MS - Date.parse(fetchedAt)) / 1000));

  const age =
    seconds < 20
      ? "just now"
      : seconds < 90
        ? `${seconds}s ago`
        : seconds < 5400
          ? `${Math.round(seconds / 60)}m ago`
          : `${Math.round(seconds / 3600)}h ago`;

  return (
    <span className={`freshness${seconds * 1000 > staleAfterMs ? " is-stale" : ""}`}>
      updated {age}
    </span>
  );
}
