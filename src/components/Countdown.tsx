"use client";

import { useClockBucket } from "@/components/clock";
import { untilLabel } from "@/lib/time";

/**
 * How long until kickoff, ticking.
 *
 * A one-second bucket, where TrainTimes uses five, because this shows seconds
 * once it is inside the final hour. That is one span whose text is identical on
 * fifty-nine of every sixty renders, so the DOM write is a no-op — the same
 * trade Freshness already makes.
 *
 * BUCKET 0 IS THE SERVER SNAPSHOT, and `serverLabel` is what the server computed
 * with the same formatter — which is why untilLabel lives in lib/time.ts and not
 * in here: a function exported from a "use client" module cannot be called on
 * the server at all. Rendering anything else at bucket 0 is a hydration mismatch
 * on every single load. React swaps in the real bucket immediately afterwards.
 *
 * It survives the 30-second AutoRefresh tick for free: useClockBucket is an
 * external store, so this component holds no state to lose, and router.refresh()
 * reconciles rather than remounting. The only way to break that is to remount
 * it — so nothing above this may be keyed on anything that changes per tick.
 */

const BUCKET_MS = 1_000;

export function Countdown({ start, serverLabel }: { start: string; serverLabel: string }) {
  const bucket = useClockBucket(BUCKET_MS);
  // The bucket index IS the clock, floored — the same read Freshness makes, and
  // pure, where calling Date.now() during a render is not.
  if (bucket === 0) return <>{serverLabel}</>;
  return <>{untilLabel(start, bucket * BUCKET_MS)}</>;
}
