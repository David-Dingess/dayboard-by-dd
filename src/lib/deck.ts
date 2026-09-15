import { z } from "zod";
import { ago, isFresh, splitTitle, type Video, type YouTubeChannel } from "./youtube";
import { uptime, viewers, type LiveStream } from "./twitch";
import type { WaterSnapshot } from "./water";
import type { AudioState } from "./vitals";

/**
 * What a Stream Deck key may ask the board to do, and what it renders itself
 * from.
 *
 * WHY THIS EXISTS AT ALL. Almost everything worth putting on a button lives in
 * the browser and nowhere else: the active tab is `dayboard.panel.<side>`, the
 * current video is `dayboard.watching`, the full-panel toggle is
 * `dayboard.watch.expanded`. A CLI can write data/water.json and the board picks
 * it up on the next AutoRefresh tick, but nothing outside the page could reach
 * the page. So the deck needed a door, and this file is the vocabulary spoken
 * through it — one place to look for what a button is allowed to say, rather
 * than a shape implied by whatever the route handler happens to destructure.
 *
 * NOTHING IN HERE MAY IMPORT FROM `next/*`, the same rule lib/watched.ts and
 * lib/todos.ts keep: the whole point of the split is that a test can call these
 * with literals and never start a server.
 *
 * The route handlers do the IO; the parsing and the shaping are both here.
 */

/* ------------------------------------------------------------- the tabs ---- */

/**
 * The tab ids, per panel, in the order page.tsx declares them.
 *
 * A SECOND COPY OF THE LIST IN page.tsx, and deliberately so. Those arrays are
 * positional — the Nth tab belongs to the Nth child — and their ids are what
 * `dayboard.panel.<side>` stores, so they cannot be generated from anything.
 * Keeping the deck's copy here rather than importing the page means a route
 * handler does not pull a tree of server components in behind it.
 *
 * IF YOU ADD A TAB TO page.tsx, ADD IT HERE. The cost of forgetting is small
 * and loud: the deck refuses the id with a 400 rather than silently writing a
 * value Panel will fall back out of.
 */
export const DECK_TABS = {
  center: ["calendar", "music", "watch", "sports", "health"],
  right: ["planner", "notes", "pc", "mail", "amazon"],
} as const;

export type DeckSide = keyof typeof DECK_TABS;

export function isTab(side: DeckSide, id: string): boolean {
  return (DECK_TABS[side] as readonly string[]).includes(id);
}

/* --------------------------------------------------------- the commands ---- */

/**
 * The same bound water-actions.ts puts on `drinkWater`. Repeated rather than
 * imported because that file is `"use server"` and this one must stay loadable
 * from a plain script.
 */
const MAX_OUNCES = 200;

export const DeckCommandSchema = z
  .discriminatedUnion("cmd", [
    z.object({
      cmd: z.literal("tab"),
      side: z.enum(["center", "right"]),
      id: z.string(),
    }),
    /**
     * Everything the player needs, sent by the key rather than looked up here.
     * The deck already has the whole row from /api/deck/state, so making it name
     * the video outright keeps this route from having to re-fetch a feed just to
     * turn an index into a title — and it means a key can play something that
     * was never in the list.
     */
    z.object({
      cmd: z.literal("play"),
      /** "stream" is a team's streaming site, for the Sports tab's window. */
      kind: z.enum(["youtube", "twitch", "stream"]),
      key: z.string().min(1),
      title: z.string().default(""),
      channel: z.string().default(""),
      href: z.string().default(""),
    }),
    z.object({ cmd: z.literal("expand"), on: z.boolean() }),
    z.object({
      cmd: z.literal("water"),
      ounces: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= MAX_OUNCES, {
        message: `ounces must be a non-zero integer within ±${MAX_OUNCES}`,
      }),
    }),
    /**
     * Exactly the shape the agent's /audio takes, because this is proxied
     * through unchanged. `output` and `mute` are alternatives, not a pair — see
     * WriteAudioAsync.
     */
    z.object({
      cmd: z.literal("audio"),
      output: z.enum(["headphones", "speakers", "toggle"]).optional(),
      mute: z.enum(["on", "off", "toggle"]).optional(),
    }),
    z.object({ cmd: z.literal("pin"), pin: z.enum(["on", "off", "toggle"]) }),
    /**
     * Do what the "Turn on alerts" banner's button does.
     *
     * It comes back on every reload and the reason is the audio half, not the
     * notification half: the grant is per-profile and survives, but an
     * AudioContext starts suspended in every new page life, so `audioArmed()` is
     * false again the moment the board refreshes and the banner has something
     * true to complain about. A key that resumes it is the whole fix.
     */
    z.object({ cmd: z.literal("alerts") }),
    /**
     * The board's reset button — the one beside the Agent light: restart the
     * server through the dayboard-restart task, and reload the page once it is
     * back. The route does the restart; the page does the waiting.
     */
    z.object({ cmd: z.literal("reset") }),
  ])
  .refine((c) => c.cmd !== "tab" || isTab(c.side, c.id), {
    message: "no such tab on that panel",
  })
  .refine((c) => c.cmd !== "audio" || (c.output == null) !== (c.mute == null), {
    message: "audio takes exactly one of output or mute",
  })
  .refine((c) => c.cmd !== "play" || c.kind !== "stream" || /^https:\/\//.test(c.href), {
    message: "a stream plays an https site",
  });

export type DeckCommand = z.infer<typeof DeckCommandSchema>;

/* ------------------------------------------------------------ the events --- */

/**
 * What travels down the SSE stream to the board.
 *
 * A subset of the commands: only the three that cannot be done any other way.
 * Water goes to disk and arrives through the normal render path, audio and pin
 * are the agent's business — none of them need a push, so none of them are
 * here. `refresh-audio` is the one exception and it is a nudge, not a change:
 * audio-state.ts otherwise re-reads the mixer on a 30-second poll, which is a
 * long time to look at the wrong icon after pressing a button.
 *
 * `refresh` is the same idea for the whole board. A CLI write lands on disk
 * instantly but the board only re-reads on its own 30-second tick, so a "npm run
 * event" felt like it took up to half a minute to show. This frame is a writer
 * saying "the files moved, re-render now"; it carries nothing, because the data
 * is already on disk and every store is read uncached. See /api/refresh and
 * scripts/notify-board.ts for the writers, and DeckBridge for the board's end.
 */
export type DeckEvent =
  | { type: "tab"; side: DeckSide; id: string }
  | { type: "play"; kind: "youtube" | "twitch" | "stream"; key: string; title: string; channel: string; href: string }
  | { type: "expand"; on: boolean }
  | { type: "alerts" }
  /** The server is about to restart (`restarted`), or there is nothing to restart and the page should just reload. */
  | { type: "reset"; restarted: boolean }
  | { type: "refresh-audio" }
  | { type: "refresh" };

/** The events a command produces, if any. Pure, so the route stays a dispatcher. */
export function eventsFor(command: DeckCommand): DeckEvent[] {
  switch (command.cmd) {
    case "tab":
      return [{ type: "tab", side: command.side, id: command.id }];
    case "play":
      return [
        {
          type: "play",
          kind: command.kind,
          key: command.key,
          title: command.title,
          channel: command.channel,
          href: command.href,
        },
      ];
    case "expand":
      return [{ type: "expand", on: command.on }];
    case "alerts":
      return [{ type: "alerts" }];
    case "audio":
      return [{ type: "refresh-audio" }];
    default:
      return [];
  }
}

/* ------------------------------------------------------------- the state --- */

export interface DeckVideo {
  /** The YouTube video id — what `play` wants as its key. */
  key: string;
  title: string;
  /** The title with the game taken out of the brackets, for a 72px key. */
  statement: string;
  game: string | null;
  channel: string;
  href: string;
  thumbnail: string;
  /** "3h ago". Settled here; the deck does no clock arithmetic. */
  ago: string;
  fresh: boolean;
}

export interface DeckStream {
  /** The channel login — what `play` wants as its key. */
  key: string;
  title: string;
  channel: string;
  game: string;
  viewers: string;
  uptime: string;
  href: string;
  avatar: string | null;
}

/** One team in the deck's Sports folder — lib/sports-tiles.ts's tile, as sent. */
export interface DeckTeam {
  id: string;
  name: string;
  /** A logo URL: a path on the board or an absolute https URL; the deck fetches it. */
  logo: string | null;
  color: string;
  line: string;
  when: string;
  live: boolean;
  /** The site the key opens. Null when no stream is known, and the key is dead. */
  url: string | null;
  service: string | null;
  title: string;
}

export interface DeckBoard {
  pinned: boolean;
  /** Whether the agent can currently see a window called Dayboard. */
  found: boolean;
}

export interface DeckState {
  videos: DeckVideo[];
  streams: DeckStream[];
  teams: DeckTeam[];
  water: { ounces: number; goalOz: number; behind: number };
  tabs: typeof DECK_TABS;
  /** Null when the agent is not answering — the deck greys those keys out. */
  audio: AudioState | null;
  board: DeckBoard | null;
}

/**
 * Everything a key needs to draw itself, in one object.
 *
 * ONE ENDPOINT RATHER THAN SIX, because the deck polls: a key that is visible
 * asks every few seconds, and six requests per tick per key would be absurd for
 * data this small. The shaping is the same shaping WatchWidget does — cleared
 * videos out, NL titles split, viewers and uptime already formatted — for the
 * plain reason that the deck and the panel should never disagree about what is
 * in the list.
 */
export function buildDeckState(input: {
  videos: Video[];
  cleared: Set<string>;
  channels: YouTubeChannel[];
  streams: LiveStream[];
  teams?: DeckTeam[];
  water: WaterSnapshot;
  audio: AudioState | null;
  board: DeckBoard | null;
  now?: number;
}): DeckState {
  const now = input.now ?? Date.now();
  // Only the channels that write titles that way. Everyone else keeps a whole
  // title and a null game, exactly as VideoList treats a video with no entry.
  const splits = new Set(
    input.channels.filter((c) => c.titleFormat === "statement-game").map((c) => c.id),
  );

  const videos = input.videos
    .filter((v) => !input.cleared.has(v.id))
    .map((v) => {
      const parts = splits.has(v.channelId)
        ? splitTitle(v.title)
        : { game: null, statement: v.title, ad: false };
      return {
        key: v.id,
        title: v.title,
        statement: parts.statement,
        game: parts.game,
        channel: v.channel,
        href: v.url,
        thumbnail: v.thumbnail,
        ago: ago(v.published, now),
        fresh: isFresh(v.published, now),
      };
    });

  const streams = input.streams.map((s) => ({
    key: s.login,
    title: s.title || s.name,
    channel: s.name,
    game: s.game || "Just Chatting",
    viewers: viewers(s.viewers),
    uptime: uptime(s.startedAt, now),
    href: s.url,
    avatar: s.avatar,
  }));

  return {
    videos,
    streams,
    teams: input.teams ?? [],
    water: {
      ounces: input.water.ounces,
      goalOz: input.water.goalOz,
      behind: input.water.behind,
    },
    tabs: DECK_TABS,
    audio: input.audio,
    board: input.board,
  };
}
