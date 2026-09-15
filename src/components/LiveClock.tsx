"use client";

import { useClockBucket } from "@/components/clock";
import { clockLabel } from "@/lib/time";

/**
 * What time it is. The board's first actual clock — everything else on it is
 * relative ("updated 2m ago", "3h 12m", "Today").
 *
 * A one-second bucket, and the same bucket-0 contract as <Countdown>: the
 * server computed `serverLabel` with the same formatter, so the first paint and
 * the hydrated paint agree exactly. Anything else is a mismatch on every load,
 * every time — a clock is the easiest possible way to get that wrong.
 *
 * The formatter lives in lib/time.ts and not here for the reason that makes
 * this work at all: a function exported from a "use client" module cannot be
 * called on the server.
 */
export function LiveClock({ serverLabel }: { serverLabel: string }) {
  const bucket = useClockBucket(1_000);
  const label = bucket === 0 ? serverLabel : clockLabel(bucket * 1_000);
  const [time, date] = label.split(" · ");

  // The date goes ABOVE, where every other item in this row carries its label,
  // so the whole row shares one baseline instead of the clock alone hanging off
  // the bottom of it.
  return (
    <>
      <span className="quick-label">{date}</span>
      <span className="quick-clock">{time}</span>
    </>
  );
}
