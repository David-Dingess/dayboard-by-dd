import type { DeckEvent } from "./deck";

/**
 * The one-hop bus between a Stream Deck key and the board's own browser.
 *
 * IN MEMORY, AND THAT IS NOT A SHORTCUT. `scripts/serve.ps1` runs one
 * `next start` process bound to 127.0.0.1, guarded by a named mutex so a second
 * one cannot exist — so a module-scope Set genuinely is every subscriber there
 * is. Persisting these would be actively wrong: a button press is an instruction
 * about the screen right now, and replaying yesterday's "switch to Health" to a
 * board that just booted is not a feature.
 *
 * WHY NOT THE AGENT'S SSE, which already reaches this browser. Because that
 * stream carries `levels` at roughly 30Hz for the EQ, and a deck subscriber
 * would share its fate; because tabs and videos are the web app's business and
 * not facts about the machine; and because the board's controls should keep
 * working on a machine where the agent is not running, which is every machine
 * except this one.
 *
 * Same module-store shape as components/audio-state.ts and
 * components/tab-status.ts — a Set of callbacks, a publish that walks it. It is
 * the pattern this codebase already reaches for when two things that never meet
 * in the tree have to agree.
 */

type Listener = (event: DeckEvent, id: number) => void;

const listeners = new Set<Listener>();

/**
 * Monotonic, and sent as the SSE event id.
 *
 * Not for replay — nothing here is replayable. It is so a reconnecting board can
 * be told in its logs whether it missed anything, and so two identical commands
 * in a row (press "Health" twice) are distinguishable frames rather than one the
 * browser might coalesce.
 */
let seq = 0;

export function publishDeck(event: DeckEvent): number {
  seq += 1;
  for (const listener of listeners) {
    try {
      listener(event, seq);
    } catch {
      // A dead stream must not take the others down with it. The subscriber's
      // own abort handler is what removes it; this just refuses to care.
    }
  }
  return seq;
}

export function subscribeDeck(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** How many boards are listening. Only the stream route uses it, for its log line. */
export function deckSubscriberCount(): number {
  return listeners.size;
}
