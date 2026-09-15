import { LADDERS, PATTERN_IDS } from "./ladders";
import type { Session } from "./types";

/**
 * What a follow-along video can be attached to.
 *
 * These live in the engine rather than beside the file that stores them, and
 * that is not tidiness: the paste box and the tiles are client components, and a
 * module that reads `node:fs` cannot be imported into the browser bundle at all.
 * The keys are a fact about the program — its session kinds and its exercises —
 * so this is where they belong anyway.
 */

/** The keys that are not exercises: a kind of session, or a block within one. */
export const VIDEO_SLOTS = ["strength", "walk", "mobility", "minimum", "warmup", "cooldown"] as const;

export function validVideoKey(key: string): boolean {
  if ((VIDEO_SLOTS as readonly string[]).includes(key)) return true;
  return PATTERN_IDS.some((p) => LADDERS[p].rungs.some((r) => r.id === key));
}

/** What a key is called on screen: "Strength", "Warm-up", "Goblet squat". */
export function videoKeyLabel(key: string): string {
  const slot: Record<string, string> = {
    strength: "Strength",
    walk: "Walk",
    mobility: "Mobility",
    minimum: "Five minutes",
    warmup: "Warm-up",
    cooldown: "Cool-down",
  };
  if (slot[key]) return slot[key];
  for (const pattern of PATTERN_IDS) {
    const rung = LADDERS[pattern].rungs.find((r) => r.id === key);
    if (rung) return rung.name;
  }
  return key;
}

/**
 * Which keys today can show, most general first: the session kind, the warm-up
 * and cool-down it actually contains, then every exercise in it. A rest day has
 * none — there is nothing to follow along with.
 */
export function videoKeysFor(session: Session): string[] {
  const keys: string[] = [];
  if (session.kind !== "rest") keys.push(session.kind);
  for (const block of session.blocks) {
    if (block.kind === "warmup") keys.push("warmup");
    else if (block.kind === "cooldown") keys.push("cooldown");
    else for (const station of block.stations) keys.push(station.exerciseId);
  }
  return [...new Set(keys)];
}
