"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The board keeps itself current, so nothing on it has a refresh button.
 *
 * `router.refresh()` re-runs every server component on the route and merges the
 * new payload in without remounting anything — client state (the subway hover
 * card, the Now Playing EventSource) and scroll position both survive, which is
 * the whole reason this can run every thirty seconds without being noticed.
 *
 * THIRTY SECONDS IS NOT THE POLL RATE. It is how often the board is willing to
 * ask; each source decides whether the question reaches the provider, through
 * the TTLs in lib/memo.ts and the `revalidate` values on the slower feeds. A tick
 * with nothing stale costs one server render and no outbound requests. The
 * number is set by the fastest thing on the board — the MTA regenerates its trip
 * feeds every 30s, and there is nothing to gain by asking sooner.
 *
 * A hidden tab is skipped entirely rather than refreshed and thrown away, and
 * becoming visible refreshes immediately: coming back to the board should never
 * show you a train that has already left while you wait out the interval.
 */

const EVERY_MS = 30_000;

export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";

    const timer = setInterval(() => {
      if (visible()) router.refresh();
    }, EVERY_MS);

    const onVisibility = () => {
      if (visible()) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return null;
}
