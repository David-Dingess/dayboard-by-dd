import streamDeck from "@elgato/streamdeck";

/**
 * The board, as the deck sees it: one origin, two verbs, one poll.
 *
 * THE PLUGIN KNOWS ONE ADDRESS. Audio lives in the C# agent on 7343 and the
 * window pin lives there too, but neither is reachable from here — /api/deck
 * proxies both. That is deliberate: two hosts to configure, two to be down, and
 * two sets of failure text on a key is a worse deck than one.
 *
 * ONE POLLER FOR EVERY KEY. A page of fourteen video keys must not be fourteen
 * requests every few seconds; they all read the same snapshot. It is the same
 * argument components/audio-state.ts makes on the board itself — two copies of
 * one machine's state disagree the moment either is touched.
 *
 * IT STOPS WHEN NOTHING IS LOOKING. Keys report themselves visible on
 * willAppear and gone on willDisappear, and with none visible the interval is
 * cleared. A Stream Deck sitting on somebody else's profile should not be
 * quietly asking the board for a video list all day.
 */

export const BASE = process.env.DAYBOARD_URL ?? "http://127.0.0.1:6767";

/** Fast enough to feel live on a key, slow enough to be free — see the route's docblock. */
const POLL_MS = 3000;

/** Loopback. If it has not answered by now it is not running. */
const TIMEOUT_MS = 2000;

export interface DeckVideo {
  key: string;
  title: string;
  statement: string;
  game: string | null;
  channel: string;
  href: string;
  thumbnail: string;
  ago: string;
  fresh: boolean;
}

export interface DeckStream {
  key: string;
  title: string;
  channel: string;
  game: string;
  viewers: string;
  uptime: string;
  href: string;
  avatar: string | null;
}

export interface DeckTeam {
  id: string;
  name: string;
  /** A path on the board or an https URL — usually ESPN's own crest. */
  logo: string | null;
  color: string;
  line: string;
  when: string;
  live: boolean;
  url: string | null;
  service: string | null;
  title: string;
}

export interface AudioOutput {
  device: string;
  muted: boolean;
}

export interface DeckState {
  videos: DeckVideo[];
  streams: DeckStream[];
  /** Absent from a board older than the Sports folder. */
  teams?: DeckTeam[];
  water: { ounces: number; goalOz: number; behind: number };
  tabs: { center: readonly string[]; right: readonly string[] };
  audio: {
    ok: boolean;
    running: boolean;
    headphones: AudioOutput | null;
    speakers: AudioOutput | null;
    live: "headphones" | "speakers" | "both" | "none";
  } | null;
  board: { pinned: boolean; found: boolean } | null;
}

/** Null means the board is not answering, which every key draws rather than hides. */
let state: DeckState | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let watchers = 0;

type Listener = (state: DeckState | null) => void;
const listeners = new Set<Listener>();

async function refresh(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/deck/state`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    state = res.ok ? ((await res.json()) as DeckState) : null;
  } catch {
    // The board is down, or mid-deploy. Say so on the keys; do not keep drawing
    // a video list that may no longer be true.
    state = null;
  }
  for (const listener of listeners) listener(state);
}

/**
 * A key has come into view. Returns the teardown, so an action's willDisappear
 * is one call and cannot forget half of it.
 */
export function watch(listener: Listener): () => void {
  listeners.add(listener);
  watchers += 1;
  listener(state);

  if (timer === null) {
    void refresh();
    timer = setInterval(() => void refresh(), POLL_MS);
  }

  return () => {
    listeners.delete(listener);
    watchers -= 1;
    if (watchers <= 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      watchers = 0;
    }
  };
}

export function current(): DeckState | null {
  return state;
}

/**
 * Press a key.
 *
 * Refreshes straight after rather than waiting out the poll: pressing mute and
 * watching the icon change a second and a half later is the difference between
 * a control and a suggestion. The board's own reply carries the new audio state
 * for the same reason, but the water bar and the pin need the full snapshot.
 */
export async function send(command: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/deck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      streamDeck.logger.warn(`${JSON.stringify(command)} -> ${res.status} ${body.error ?? ""}`);
      return false;
    }
    void refresh();
    return true;
  } catch (err) {
    streamDeck.logger.warn(`${JSON.stringify(command)} -> ${(err as Error).message}`);
    return false;
  }
}

/* --------------------------------------------------------------- images --- */

/**
 * Thumbnails and avatars, fetched once and kept.
 *
 * SVG CANNOT REACH THE NETWORK inside the Stream Deck's renderer, so a picture
 * has to be inlined as a data URI before it goes on a key. Fetched once per URL
 * and held: the feed only turns over a couple of times a day, and re-downloading
 * fourteen thumbnails every three seconds to draw the same fourteen keys would
 * be the one wasteful thing in here.
 *
 * A failure is cached as "no picture" rather than retried, so a dead URL costs
 * one request rather than one every poll. The key still draws — the text was
 * always the part that mattered.
 */
const pictures = new Map<string, string | null>();

/** Bigger than any thumbnail; a redirect to something huge is not going on a key. */
const MAX_BYTES = 512 * 1024;

export function picture(url: string | null | undefined): string | null {
  if (!url) return null;
  const known = pictures.get(url);
  if (known !== undefined) return known;

  // Claimed immediately so fourteen keys drawing at once make one request.
  pictures.set(url, null);
  void (async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return;
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_BYTES) return;
      const type = res.headers.get("content-type") ?? "image/jpeg";
      pictures.set(url, `data:${type};base64,${Buffer.from(buffer).toString("base64")}`);
      // Everyone redraws with the picture they did not have a moment ago.
      for (const listener of listeners) listener(state);
    } catch {
      // Left as null. See above.
    }
  })();

  return null;
}
