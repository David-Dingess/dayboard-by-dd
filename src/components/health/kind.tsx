import type { SessionKind } from "@/lib/health";

/**
 * What a kind of day looks like: a coloured dot and a word. Shared by the today
 * card, the week strip and the history list so a walk is the same green
 * everywhere.
 *
 * The colours are the board's, not the standalone app's — its warm paper palette had
 * nothing to say about a dark panel. Walks take the "live" green because a walk
 * is the thing that most often turns a day green; strength takes the accent.
 */
const KIND: Record<SessionKind, { label: string; color: string }> = {
  strength: { label: "Strength", color: "var(--accent)" },
  walk: { label: "Walk", color: "var(--voice-live)" },
  mobility: { label: "Mobility", color: "#b18ade" },
  minimum: { label: "Five minutes", color: "var(--accent)" },
  rest: { label: "Rest", color: "var(--line-strong)" },
};

export function kindLabel(kind: SessionKind): string {
  return KIND[kind].label;
}

export function kindColor(kind: SessionKind): string {
  return KIND[kind].color;
}

export function KindDot({ kind }: { kind: SessionKind }) {
  return <span className="healthdot" style={{ background: kindColor(kind) }} aria-hidden />;
}
