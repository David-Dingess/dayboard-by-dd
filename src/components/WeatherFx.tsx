import type { WeatherFx as Kind } from "@/lib/weather";

/**
 * Weather happening behind a weather tile.
 *
 * SAME IDEA AS THE WATER BOTTLE, and deliberately: fixed markup, CSS keyframes,
 * no canvas and no JavaScript at all. The board already runs one rAF loop for
 * the Now Playing EQ; six tiles each running their own particle system would be
 * six more, on a display that stays on all day.
 *
 * THE POSITIONS ARE A FIXED TABLE, not Math.random(). This renders on the server
 * and hydrates on the client, and a random left offset would differ between the
 * two — which React reports as a hydration mismatch and then quietly repaints.
 * A hand-written spread looks scattered enough and is the same on both sides.
 *
 * Everything is faint accent on the tile's own surface, the same wash the water
 * uses, because this sits behind text that still has to be readable at a glance
 * from across the room.
 */

/** left %, animation delay, and a duration scale — scattered, but the same every render. */
const DROPS = [
  [6, 0, 1], [18, 0.7, 0.86], [29, 1.4, 1.1], [41, 0.35, 0.94],
  [53, 1.05, 1.18], [64, 0.2, 0.8], [76, 1.6, 1.02], [88, 0.9, 0.9],
] as const;

const FLAKES = [
  [8, 0, 1], [22, 1.2, 1.15], [35, 2.4, 0.9], [48, 0.6, 1.25],
  [61, 1.8, 0.95], [73, 3, 1.1], [86, 2.1, 1], [95, 0.9, 1.2],
] as const;

const GUSTS = [
  [14, 0, 1], [38, 1.1, 0.9], [58, 2.2, 1.1], [78, 0.6, 1],
] as const;

export function WeatherFx({ kind }: { kind: Kind | null }) {
  if (!kind) return null;

  return (
    <span className={`wfx is-${kind}`} aria-hidden>
      {(kind === "rain" || kind === "storm") &&
        DROPS.map(([left, delay, scale], i) => (
          <span
            key={i}
            className="wfx-drop"
            style={{ left: `${left}%`, animationDelay: `${delay}s`, animationDuration: `${1.1 * scale}s` }}
          />
        ))}

      {kind === "snow" &&
        FLAKES.map(([left, delay, scale], i) => (
          <span
            key={i}
            className="wfx-flake"
            style={{ left: `${left}%`, animationDelay: `${delay}s`, animationDuration: `${6 * scale}s` }}
          />
        ))}

      {kind === "wind" &&
        GUSTS.map(([top, delay, scale], i) => (
          <span
            key={i}
            className="wfx-gust"
            style={{ top: `${top}%`, animationDelay: `${delay}s`, animationDuration: `${3.4 * scale}s` }}
          />
        ))}

      {/* One pane, brightening and going out. A lightning BOLT at this size is a
          scribble; a flash is what you actually notice out of a window. */}
      {kind === "storm" && <span className="wfx-flash" />}
    </span>
  );
}
