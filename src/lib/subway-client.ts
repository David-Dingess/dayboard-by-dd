/**
 * The subway pieces the BROWSER needs: the line colours and the countdown.
 *
 * Split from lib/subway.ts because that file reads settings (and so the
 * filesystem) to know which lines to watch, and a client component may not
 * import anything that reaches node:fs — the bundler refuses the page. The
 * line status badges and the train tiles only need these, so they get only
 * these. subway.ts re-exports them, so a server caller sees one module.
 */

export interface Arrival {
  route: string;
  /**
   * When the train is predicted at the platform, epoch milliseconds.
   *
   * The feed states arrivals as an absolute POSIX timestamp with second
   * precision, so this is the number as given rather than a difference — which
   * is what lets the tile keep counting down between fetches instead of holding
   * whatever minute the server happened to land on. See components/TrainTimes.
   */
  at: number;
  /**
   * The same thing already rounded to minutes, against the clock at fetch time.
   * Only the server render and the hydration pass use it; after that the tile
   * recomputes from `at`.
   */
  minutes: number;
}

export interface Alert {
  id: string;
  routes: string[];
  type: string;
  text: string;
  planned: boolean;
}

/** Official MTA line colours — riders navigate by these. */
const LINE_COLORS: Record<string, string> = {
  "1": "#ee352e", "2": "#ee352e", "3": "#ee352e",
  "4": "#00933c", "5": "#00933c", "6": "#00933c",
  "7": "#b933ad",
  A: "#0039a6", C: "#0039a6", E: "#0039a6",
  B: "#ff6319", D: "#ff6319", F: "#ff6319", M: "#ff6319",
  G: "#6cbe45",
  J: "#996633", Z: "#996633",
  L: "#a7a9ac",
  N: "#fccc0a", Q: "#fccc0a", R: "#fccc0a", W: "#fccc0a",
  S: "#808183", SI: "#0039a6",
};

export function lineColor(route: string): string {
  return LINE_COLORS[route.toUpperCase()] ?? "#6e7783";
}

/** Yellow lines need dark ink; the rest take white. */
export function lineInk(route: string): string {
  return ["N", "Q", "R", "W"].includes(route.toUpperCase()) ? "#1a1a1a" : "#ffffff";
}

/**
 * A train more than `GONE_MS` past its predicted arrival is dropped rather than
 * shown as "0 min" forever: the feed is a prediction, and a train that has not
 * been re-predicted half a minute after it was due has gone.
 */
const GONE_MS = 30_000;

export function countdown(arrivals: Arrival[], now: number): number[] {
  return arrivals
    .filter((a) => a.at - now > -GONE_MS)
    .map((a) => Math.max(0, Math.round((a.at - now) / 60_000)));
}
