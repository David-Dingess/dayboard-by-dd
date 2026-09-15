/**
 * The shape the local agent speaks, shared by nobody but the widget — kept here
 * so the contract with `agent/nowplaying` is written down in one place rather
 * than implied by a fetch call.
 *
 * Everything here is read in the BROWSER, not on the server: the data is a fact
 * about this PC, and the server could be anywhere. The browser sitting on that
 * same PC is the only party that can see both. See the widget for why loopback works
 * from an HTTPS page.
 */

export interface NowPlaying {
  ok: boolean;
  source: string | null;
  app: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  /** SMTC's own vocabulary: Playing, Paused, Stopped, Closed, Changing. */
  status: string;
  positionMs: number;
  durationMs: number;
  /** When Windows sampled the position — the anchor for extrapolating it. */
  positionAt: string;
  artUrl: string | null;
  updatedAt: string;
}

/** How many bars the agent sends, and the widget draws. */
export const BANDS = 24;

/** Where the agent listens — see lib/runtime.ts for why it is 127.0.0.1. */
import { agentBase } from "./runtime";
export { agentBase };

/** The four things the buttons beside the progress bar can ask for. */
export type Transport = "play" | "pause" | "next" | "previous";

/**
 * Where the transport buttons POST — the same route the widget already GETs.
 *
 * Unlike /audio, this answers with an acknowledgement and not with the new
 * state, because the SSE stream is already open and pushes a `track` frame the
 * moment the status actually changes. See the agent's WriteTransportAsync.
 */
export function transportUrl(): string {
  return `${agentBase()}/nowplaying`;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
