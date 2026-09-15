import { describe, expect, it } from "vitest";
import { silencedGiven } from "../src/components/audio-focus";
import { nearestFirst } from "../src/lib/fixture-text";

describe("which player you hear", () => {
  const on = { present: true, muted: false };
  const mutedByHand = { present: true, muted: true };
  const empty = { present: false, muted: false };

  it("silences the corner player while the big-screen one has sound", () => {
    const state = { main: on, stream: on };
    expect(silencedGiven("main", state, "stream")).toBe(true);
    expect(silencedGiven("stream", state, "stream")).toBe(false);
  });

  it("lets the corner player sound when the big-screen one is muted or closed", () => {
    expect(silencedGiven("main", { main: on, stream: mutedByHand }, "stream")).toBe(false);
    expect(silencedGiven("main", { main: on, stream: empty }, "stream")).toBe(false);
  });

  it("silences nothing before either player has been on the big screen", () => {
    expect(silencedGiven("main", { main: on, stream: on }, null)).toBe(false);
  });
});

describe("nearestFirst", () => {
  const when = (t: { live: boolean; start: number } | null) => t;

  it("puts what is on now first, then soonest, then nothing scheduled", () => {
    const teamA = { live: false, start: 500 };
    const teamB = { live: false, start: 200 };
    const teamD = { live: true, start: 100 };
    const atl = { live: true, start: 150 };
    const teamC = null;
    expect(nearestFirst([teamA, teamC, teamB, atl, teamD], when)).toEqual([
      teamD,
      atl,
      teamB,
      teamA,
      teamC,
    ]);
  });

  it("keeps the original order for a tie", () => {
    const a = { live: false, start: 1 };
    const b = { live: false, start: 1 };
    expect(nearestFirst([a, b], when)[0]).toBe(a);
    expect(nearestFirst([b, a], when)[0]).toBe(b);
  });
});
