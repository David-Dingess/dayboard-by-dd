import { agentBase } from "./nowplaying";
import type { DeckBoard } from "./deck";
import type { AudioState } from "./vitals";

/**
 * The agent, called from the Next server rather than from the browser.
 *
 * EVERY OTHER CALLER OF 127.0.0.1:7343 IS A BROWSER — see lib/nowplaying.ts, and
 * the long note in the agent about loopback being "potentially trustworthy" to
 * Chrome. The deck is not a browser, and the Stream Deck plugin deliberately
 * does not learn the agent's address: it talks to /api/deck and nothing else, so
 * there is one door to reason about instead of two.
 *
 * Same trick engine-control.ts relies on: a fetch made from the Next server
 * carries no Origin header, and the agent's rule is `origin is not null &&
 * !allowed` — an absent Origin passes, a wrong one is refused. Nothing had to be
 * loosened for this.
 *
 * Everything fails soft. A dead or unbuilt agent means the mixer keys grey out;
 * it must never be the reason a water button or a tab button stops working.
 */

/** Loopback, and the agent answers in microseconds or not at all. */
const TIMEOUT_MS = 2500;

async function agentJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${agentBase()}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Not running, not built, or an older build without the route.
    return null;
  }
}

export function readAudio(): Promise<AudioState | null> {
  return agentJson<AudioState>("/audio");
}

export function readBoard(): Promise<DeckBoard | null> {
  return agentJson<DeckBoard>("/board");
}

/**
 * Both writes answer with the state AFTER the change rather than an
 * acknowledgement, which is the agent's own convention for /audio and the reason
 * audio-state.ts needs no follow-up GET. The deck gets the same deal.
 */
export function writeAudio(body: Record<string, string>): Promise<AudioState | null> {
  return agentJson<AudioState>("/audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function writeBoard(pin: string): Promise<DeckBoard | null> {
  return agentJson<DeckBoard>("/board", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin }),
  });
}
