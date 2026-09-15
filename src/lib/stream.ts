import { z } from "zod";

/**
 * The stream window's vocabulary: what the page may ask for, and the pure
 * arithmetic behind it. No IO — lib/stream-host.ts is the half that spawns
 * things, and this half is what the tests can reach.
 *
 * THE STREAM WINDOW, IN ONE PARAGRAPH. A second Chrome, in its own profile so
 * Your streaming logins live there and nowhere else, launched --kiosk so it
 * has no frame, and parented into the board window by agent/stream so it sits
 * exactly on the player's rectangle with no taskbar button. The Next server
 * drives it over the DevTools protocol on a loopback port.
 */

/** Chrome's DevTools port for the stream browser. Not 9222, which every tutorial uses. */
export const STREAM_PORT = Number(process.env.DAYBOARD_STREAM_PORT) || 9224;

export function streamProfile(localAppData: string | undefined): string {
  if (process.env.DAYBOARD_STREAM_PROFILE) return process.env.DAYBOARD_STREAM_PROFILE;
  return `${localAppData ?? "."}\\dayboard\\stream-profile`;
}

/**
 * The stream browser's command line.
 *
 * KEEP IN STEP WITH $DayboardStreamArgs in scripts/_common.ps1, which exists
 * only so you can open the same profile by hand.
 *
 *   --kiosk                      no frame, no tab strip, no address bar: the
 *                                window is nothing but the page, which is what
 *                                makes it look like part of the board.
 *   --remote-debugging-port      how the server navigates, mutes and reads it.
 *                                Chrome 136+ ignores it on the DEFAULT profile,
 *                                which this is not.
 *   --window-position            the board's monitor, so the moment before the
 *                                window is adopted happens where the board is
 *                                rather than on whichever screen is primary.
 *   the rest                     the board's own flags, for the board's reasons:
 *                                a hidden stream must not be throttled.
 */
export function chromeArgs(opts: {
  profile: string;
  port: number;
  url: string;
  monitor?: { x: number; y: number } | null;
}): string[] {
  return [
    "--kiosk",
    `--user-data-dir=${opts.profile}`,
    `--remote-debugging-port=${opts.port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    ...(opts.monitor ? [`--window-position=${opts.monitor.x + 40},${opts.monitor.y + 40}`] : []),
    opts.url,
  ];
}

const Https = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "expected an https URL");

const Px = z.number().int().min(-20000).max(20000);

export const StreamCommandSchema = z.discriminatedUnion("action", [
  /** Bring the window up on this page. `fresh` is a click; a restore is not. */
  z.object({ action: z.literal("open"), url: Https, fresh: z.boolean().default(false) }),
  z.object({
    action: z.literal("place"),
    x: Px,
    y: Px,
    w: z.number().int().min(1).max(20000),
    h: z.number().int().min(1).max(20000),
    /** Corner radius to clip the window to, in pixels. 0 when docked. */
    r: z.number().int().min(0).max(64).default(0),
  }),
  z.object({ action: z.literal("show"), on: z.boolean() }),
  z.object({ action: z.literal("play") }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("mute"), on: z.boolean() }),
  z.object({ action: z.literal("reload") }),
  z.object({ action: z.literal("back") }),
  z.object({ action: z.literal("home"), url: Https }),
  z.object({ action: z.literal("close") }),
]);

export type StreamCommand = z.infer<typeof StreamCommandSchema>;

export interface StreamState {
  ok: boolean;
  /** Why not, in a sentence the player can show. */
  reason?: string;
  /** The stream browser answers on its DevTools port. */
  running: boolean;
  /** Its window is inside the board. */
  adopted: boolean;
  visible: boolean;
  url: string | null;
  title: string | null;
  /** The main video on the page, if there is one. */
  video: { playing: boolean; muted: boolean } | null;
  /**
   * Whether the stream browser's sound is off at the Windows level — the mute
   * the board controls. Not the page's own mute, which belongs to the site.
   */
  muted: boolean | null;
}

/**
 * A rectangle in the board's CSS pixels -> the board window's client pixels.
 *
 * The board is a fullscreen --app window, so its client area IS its viewport
 * and the only conversion is the device pixel ratio — which includes page zoom,
 * so Ctrl+minus on the board still lands the stream in the right place. Rounded
 * outward on the far edges, so a fractional box never leaves a one-pixel seam of
 * board showing between the stream and the player bar.
 */
export function toClientRect(
  rect: { left: number; top: number; width: number; height: number },
  dpr: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const x = Math.round(rect.left * scale);
  const y = Math.round(rect.top * scale);
  const right = Math.ceil((rect.left + rect.width) * scale);
  const bottom = Math.ceil((rect.top + rect.height) * scale);
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

/** The tabs a person could be looking at — not DevTools, not an extension's page. */
export function pageTargets(targets: CdpTarget[]): CdpTarget[] {
  return targets.filter(
    (t) =>
      t.type === "page" &&
      Boolean(t.webSocketDebuggerUrl) &&
      !/^(devtools|chrome-extension|chrome-untrusted):/.test(t.url),
  );
}

/**
 * The same service, near enough that a restored player should leave the page
 * alone: "www.peacocktv.com" and "peacocktv.com" are, and so are
 * "tv.apple.com" and "apple.com" — you may have wandered anywhere inside a
 * site, and a board reload must not yank you back to its front page.
 */
export function sameSite(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  try {
    const tail = (value: string) => new URL(value).hostname.split(".").slice(-2).join(".");
    return tail(a) === tail(b);
  } catch {
    return false;
  }
}
