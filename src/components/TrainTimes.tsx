"use client";

import { useClockBucket } from "@/components/clock";
import { countdown, type Arrival } from "@/lib/subway-client";

/**
 * The minutes on a train tile, counted down against a live clock.
 *
 * The feed hands out absolute arrival times to the second, and the board only
 * re-renders every thirty seconds, so without this the tile spends half its life
 * a minute wrong — and spends it looking exactly as confident as when it is
 * right. A train that is 4 minutes out at :00 is 3 minutes out at :30, and on a
 * second-monitor dashboard the difference is whether you put your shoes on now.
 *
 * Five-second buckets. The number only changes on a minute boundary, so the
 * bucket decides how late it is allowed to change, and five seconds of lag is
 * invisible on a countdown. It costs twelve re-renders a minute across four
 * tiles, which is nothing beside the full server render the board already does
 * every thirty seconds.
 *
 * Nothing here fetches. It re-reads the same arrivals the server sent until the
 * next refresh replaces them, which is the point: the tile stays honest between
 * refreshes instead of waiting for one.
 */

const BUCKET_MS = 5_000;

export function TrainTimes({ arrivals }: { arrivals: Arrival[] }) {
  const bucket = useClockBucket(BUCKET_MS);

  // Bucket 0 is the server (and the hydration pass): no clock, so show the
  // minutes the server worked out, which is what the HTML already says.
  const minutes =
    bucket === 0
      ? arrivals.map((a) => a.minutes)
      : countdown(arrivals, bucket * BUCKET_MS);

  // A stalled feed empties itself here rather than leaving a stack of trains
  // frozen at "now" — the same thing the tile already says when nothing is due.
  // Two lines, not one: the times beside it stack, so a single wide phrase sat
  // off-centre against them and made the tile look broken rather than empty.
  if (!minutes.length)
    return (
      <span className="traintile-none">
        nothing
        <br />
        soon
      </span>
    );

  return (
    <ol className="traintile-times">
      {minutes.map((m, i) => (
        <li key={i} className={i === 0 ? "is-next" : undefined}>
          <span className="traintile-min">{m === 0 ? "now" : m}</span>
          {m > 0 && <span className="traintile-unit">min</span>}
        </li>
      ))}
    </ol>
  );
}
