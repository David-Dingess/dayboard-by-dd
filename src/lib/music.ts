import { z } from "zod";

/**
 * The Music tab's vocabulary: what the page may ask of the music window, and
 * the pure pieces behind it. lib/stream-host.ts is the half with IO.
 *
 * THE MUSIC WINDOW, IN ONE PARAGRAPH. A music site (Apple Music by default; any
 * of MUSIC_HOSTS) in a THIRD Chrome — its own profile, so the login lives there
 * and nowhere else, launched --kiosk
 * and parented into the board over the Music tab by agent/stream, exactly as the
 * Sports tab's stream window is. It is its own browser rather than a tab in the
 * stream's for one reason: agent/stream mutes the stream browser's whole process
 * tree at the Windows audio level, and muting a match must not mute the music.
 *
 * WHY NOT MUSICKIT JS ON THE BOARD ITSELF. That needs a developer token, which
 * needs the $99/yr Apple Developer Program; the token music.apple.com uses is
 * pinned to apple.com pages by its root_https_origin claim. Inside Apple's own
 * page, though, its MusicKit instance is right there — which is how the server
 * reads what is playing and presses play without a token of its own.
 */

/** Chrome's DevTools port for the music browser. The stream's is 9224. */
export const MUSIC_PORT = Number(process.env.DAYBOARD_MUSIC_PORT) || 9225;

/** The default; the real home page is `music.home` in data/settings.json. */
export const MUSIC_HOME = "https://music.apple.com/";

/**
 * The music services the window will open. Not a list of what can be embedded
 * — nothing here can be — but what the window is FOR: a music site rather than
 * a second stream browser. Matched on the end of the hostname.
 */
export const MUSIC_HOSTS = [
  "music.apple.com",
  "music.youtube.com",
  "open.spotify.com",
  "tidal.com",
  "soundcloud.com",
  "deezer.com",
  "music.amazon.com",
  "bandcamp.com",
] as const;

export function musicProfile(localAppData: string | undefined): string {
  if (process.env.DAYBOARD_MUSIC_PROFILE) return process.env.DAYBOARD_MUSIC_PROFILE;
  return `${localAppData ?? "."}\\dayboard\\music-profile`;
}

/** A music service over https, and nothing else — see MUSIC_HOSTS. */
export function isMusicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return MUSIC_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const Px = z.number().int().min(-20000).max(20000);

export const MusicCommandSchema = z.discriminatedUnion("action", [
  /** Bring the window up. A restore leaves a page already on music.apple.com alone. */
  z.object({
    action: z.literal("open"),
    url: z.string().max(2000).refine(isMusicUrl, "expected a music service URL").default(MUSIC_HOME),
    fresh: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("place"),
    x: Px,
    y: Px,
    w: z.number().int().min(1).max(20000),
    h: z.number().int().min(1).max(20000),
    /**
     * The board's corner players, cut out of the window: [x, y, w, h, radius] in
     * the same client pixels. A child window covers its parent's page whatever
     * the z-order, so this is the only way the corner video stays on top.
     */
    holes: z
      .array(
        z.tuple([Px, Px, z.number().int().min(1).max(20000), z.number().int().min(1).max(20000), z.number().int().min(0).max(64)]),
      )
      .max(8)
      .default([]),
  }),
  z.object({ action: z.literal("show"), on: z.boolean() }),
  z.object({ action: z.literal("back") }),
  z.object({ action: z.literal("home") }),
  z.object({ action: z.literal("reload") }),
  z.object({ action: z.literal("play") }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("next") }),
  z.object({ action: z.literal("previous") }),
]);

export type MusicCommand = z.infer<typeof MusicCommandSchema>;

export interface MusicTrack {
  title: string;
  artist: string | null;
  album: string | null;
  artUrl: string | null;
  playing: boolean;
  /** Seconds, when the page knows them. */
  position: number | null;
  duration: number | null;
}

export interface MusicState {
  ok: boolean;
  reason?: string;
  /** The music browser answers on its DevTools port. */
  running: boolean;
  /** Its window is inside the board. */
  adopted: boolean;
  visible: boolean;
  url: string | null;
  /** Signed in to Apple Music, when the page can say; null when it cannot. */
  signedIn: boolean | null;
  track: MusicTrack | null;
}

/**
 * Apple's artwork URLs are templates — ".../{w}x{h}bb.jpg" — and a template in
 * an <img> is a broken image. Filled square, at the size asked for.
 */
export function artworkUrl(template: string | null | undefined, size: number): string | null {
  if (!template) return null;
  return template.replace("{w}", String(size)).replace("{h}", String(size)).replace("{f}", "jpg");
}

/**
 * Read inside music.apple.com over DevTools. MusicKit first — it knows the
 * position and whether you are signed in — then the Media Session metadata the
 * page publishes for Windows, which survives Apple renaming its internals.
 * Returns a plain object; `artwork` is still a template when it came from
 * MusicKit, and artworkUrl() fills it on the server.
 */
export const READ_TRACK = `(() => {
  let mk = null;
  try { mk = window.MusicKit && window.MusicKit.getInstance(); } catch {}
  const item = mk && mk.nowPlayingItem;
  const md = navigator.mediaSession && navigator.mediaSession.metadata;
  const attrs = (item && item.attributes) || {};
  const title = attrs.name || (item && item.title) || (md && md.title) || null;
  const playing = mk
    ? Boolean(mk.isPlaying)
    : navigator.mediaSession && navigator.mediaSession.playbackState === 'playing';
  const art = (attrs.artwork && attrs.artwork.url)
    || (md && md.artwork && md.artwork.length ? md.artwork[md.artwork.length - 1].src : null);
  const num = (value) => (typeof value === 'number' && isFinite(value) && value > 0 ? value : null);
  return {
    url: location.href,
    signedIn: mk ? Boolean(mk.isAuthorized) : null,
    track: title ? {
      title,
      artist: attrs.artistName || (md && md.artist) || null,
      album: attrs.albumName || (md && md.album) || null,
      artwork: art,
      playing: Boolean(playing),
      position: mk ? num(mk.currentPlaybackTime) : null,
      duration: mk ? num(mk.currentPlaybackDuration) : null,
    } : null,
  };
})()`;

/**
 * The transport, for whichever service is open.
 *
 * MusicKit first (Apple Music exposes its player to the page), then the
 * service's own buttons by the selectors each web player uses, then any button
 * whose accessible name says play/pause/next/previous, then a bare <audio> or
 * <video> for play and pause. Resolves true when something was pressed, false
 * when the page had nothing to press (not loaded, not signed in, a service
 * that renamed its controls).
 */
export function transportScript(action: "play" | "pause" | "next" | "previous"): string {
  const mk = {
    play: "mk.play()",
    pause: "mk.pause()",
    next: "mk.skipToNextItem()",
    previous: "mk.skipToPreviousItem()",
  }[action];
  return `(async () => {
    const action = ${JSON.stringify(action)};
    let mk = null;
    try { mk = window.MusicKit && window.MusicKit.getInstance(); } catch {}
    if (mk) {
      try { await ${mk}; return true; } catch {}
    }
    const known = {
      play: ['[data-testid="control-button-playpause"]', '#play-pause-button', 'button[data-test="play"]', '.playControls__play', 'button[aria-label="Play"]'],
      pause: ['[data-testid="control-button-playpause"]', '#play-pause-button', 'button[data-test="pause"]', '.playControls__play', 'button[aria-label="Pause"]'],
      next: ['[data-testid="control-button-skip-forward"]', '.next-button', 'button[data-test="next"]', '.playControls__next', 'button[aria-label="Next"]'],
      previous: ['[data-testid="control-button-skip-back"]', '.previous-button', 'button[data-test="previous"]', '.playControls__prev', 'button[aria-label="Previous"]'],
    }[action];
    for (const sel of known) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return true; }
    }
    const want = { play: /^(play|resume)\b/i, pause: /^pause\b/i, next: /^(next|skip forward|skip next)/i, previous: /^(previous|skip back|skip previous)/i }[action];
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
      if (want.test(name)) { el.click(); return true; }
    }
    const media = document.querySelector('audio, video');
    if (media && (action === 'play' || action === 'pause')) {
      try { if (action === 'play') await media.play(); else media.pause(); return true; } catch {}
    }
    return false;
  })()`;
}
