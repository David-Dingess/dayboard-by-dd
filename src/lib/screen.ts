import type { ScreenPreset } from "./settings-schema";

/**
 * Screen presets, and what they mean.
 *
 * THE BOARD WAS DRAWN FOR 3440x1440 AND EVERYTHING ELSE IS THAT BOARD SCALED.
 * Some eighty pixel values in globals.css were measured against that one
 * screen — the stack's padding, the stage floors, the month cells — and the
 * honest way to put the same board on a 1920x1080 monitor is not to re-measure
 * all of them but to draw the same picture smaller. So each preset is a CSS
 * `zoom` on <html>: the height ratio, capped so the three columns never get
 * narrower than 2560 CSS pixels between them, which is where the week grid
 * starts to fight for room.
 *
 *   3440x1440 -> 1       the original
 *   2560x1440 -> 1       same height, columns a quarter narrower
 *   2560x1080 -> 0.75    a 3413x1440 board, near enough the original
 *   1920x1080 -> 0.75    a 2560x1440 board
 *   1920x1200 -> 0.75    a 2560x1600 board — the stack gets a little more room
 *   3840x2160 -> 1.5     a 2560x1440 board, at 4K density
 *
 * `auto` is null here and is resolved in the browser by the same formula
 * (layout.tsx), against the window the board actually opened in.
 */
export const PRESET_SIZES: Record<Exclude<ScreenPreset, "auto">, [number, number]> = {
  "3440x1440": [3440, 1440],
  "2560x1440": [2560, 1440],
  "2560x1080": [2560, 1080],
  "1920x1080": [1920, 1080],
  "1920x1200": [1920, 1200],
  "3840x2160": [3840, 2160],
};

export function zoomFor(width: number, height: number): number {
  const z = Math.min(height / 1440, width / 2560);
  return Math.max(0.5, Math.min(2, Number(z.toFixed(3))));
}

export function screenZoom(preset: ScreenPreset): number | null {
  if (preset === "auto") return null;
  const [w, h] = PRESET_SIZES[preset];
  return zoomFor(w, h);
}

/* ------------------------------------------------------------- the ground --- */

export interface WallpaperGreys {
  /** The four terraces, lowest first, as "#rrggbb". */
  g1: string;
  g2: string;
  g3: string;
  g4: string;
  /** The seam between terraces — the darkest thing on the board. */
  seam: string;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function shift(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + by);
  const g = clamp(((n >> 8) & 0xff) + by);
  const b = clamp((n & 0xff) + by);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * The wallpaper's five tones, from one chosen ground.
 *
 * The original was measured off a reference: greys #0d, #10, #18, #1d on a
 * near-black seam #01, around a #111111 board. Those are offsets of -4, -1,
 * +7, +12 and -16 from the ground, and the offsets are what is kept — so a
 * dark blue ground gets four dark blues and a darker blue seam, and the
 * terraces read exactly as they did.
 */
export function wallpaperGreys(background: string): WallpaperGreys {
  const base = /^#[0-9a-f]{6}$/i.test(background) ? background.toLowerCase() : "#111111";
  return {
    g1: shift(base, -4),
    g2: shift(base, -1),
    g3: shift(base, 7),
    g4: shift(base, 12),
    seam: shift(base, -16),
  };
}

/** Lightness 0-100 of a hex colour, for keeping the picker inside the palette. */
export function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2) * 100;
}
