import type { Session, Station } from "./types";

/**
 * The linear list of work and rest periods a session's timer walks through.
 * Pulled out of the standalone app's `useIntervalTimer` so it can be tested without
 * React, and so the preview can say how many steps a session is.
 */
export interface Step {
  key: string;
  kind: "work" | "rest" | "roundrest";
  seconds: number;
  station?: Station;
  blockId: string;
  blockLabel: string;
  round: number;
  rounds: number;
}

/**
 * Flattens a session into blocks × rounds × stations. Trailing rest is dropped —
 * nothing is more deflating than a finished workout that makes you wait twenty
 * seconds to say so.
 */
export function buildSteps(session: Session): Step[] {
  const steps: Step[] = [];

  for (const block of session.blocks) {
    for (let round = 1; round <= block.rounds; round++) {
      block.stations.forEach((station, i) => {
        const base = `${block.id}-${round}-${i}`;
        steps.push({
          key: `${base}-work`,
          kind: "work",
          seconds: station.workSec,
          station,
          blockId: block.id,
          blockLabel: block.label,
          round,
          rounds: block.rounds,
        });
        if (station.restSec > 0) {
          steps.push({
            key: `${base}-rest`,
            kind: "rest",
            seconds: station.restSec,
            station,
            blockId: block.id,
            blockLabel: block.label,
            round,
            rounds: block.rounds,
          });
        }
      });
      if (round < block.rounds && block.roundRestSec > 0) {
        steps.push({
          key: `${block.id}-${round}-roundrest`,
          kind: "roundrest",
          seconds: block.roundRestSec,
          blockId: block.id,
          blockLabel: block.label,
          round,
          rounds: block.rounds,
        });
      }
    }
  }

  while (steps.length > 0 && steps[steps.length - 1].kind !== "work") steps.pop();
  return steps;
}
