import { z } from "zod";

/**
 * `data/settings.json` — everything the setup guide writes.
 *
 * THIS IS THE FILE THAT MAKES THE BOARD SOMEBODY ELSE'S. Every fact that used
 * to be a literal in a lib file (a latitude, a timezone, four clubs, a Discord
 * name) or a line in `.env.local` (a bot token, a Twitch secret) lives here,
 * written by the settings menu through a Server Action and read fresh on every
 * render. It is gitignored: it holds credentials.
 *
 * EVERY FIELD HAS A DEFAULT, so an empty object parses into a working board —
 * the one with no location, no teams and no integrations, which is what a fresh
 * clone is. Nested objects use `.prefault({})` rather than `.default({})`
 * because zod 4 does not run a default through the schema; prefault does.
 *
 * Its own file rather than a block in schema.ts because lib/time.ts imports
 * schema.ts for DATE_ONLY, and the settings module imports time.ts — keeping
 * this apart is what keeps that graph a line rather than a loop.
 *
 * Like every schema parsing browser input, every string is bounded.
 */

export const SCREEN_PRESETS = [
  "auto",
  "3440x1440",
  "2560x1440",
  "2560x1080",
  "1920x1080",
  "1920x1200",
  "3840x2160",
] as const;
export type ScreenPreset = (typeof SCREEN_PRESETS)[number];

const HEX = /^#[0-9a-fA-F]{6}$/;
const Text = (max = 200) => z.string().max(max).default("");
const IdList = (max: number) => z.array(z.string().regex(/^\d{5,25}$/)).max(max).default([]);

/** One team the board follows. `id` becomes the layer id `team-<id>`. */
export const TeamSettingSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(60),
  /** Shown on the tile when the schedule names the club instead of the ground. */
  homeVenue: Text(120),
  color: z.string().regex(HEX),
  /** A crest: an https URL (ESPN's own, usually) or a path under public/. */
  logo: Text(500),
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("espn"),
      /** A key from src/lib/watch.ts COMPETITIONS, e.g. "nfl", "epl". */
      league: z.string().min(1).max(40),
      teamId: z.string().min(1).max(20),
    }),
    z.object({ kind: z.literal("ics"), url: z.string().min(1).max(2000) }),
  ]),
  /** Competition keys from src/lib/watch.ts, most likely first. */
  competitions: z.array(z.string().max(40)).max(10).default([]),
});

export type TeamSetting = z.infer<typeof TeamSettingSchema>;

export const CalendarSettingSchema = z.object({
  label: z.string().min(1).max(60),
  /** https:// or webcal:// — the URL is a credential; this file is gitignored. */
  url: z.string().min(1).max(2000),
  color: z.string().regex(HEX).optional(),
  /** Case-insensitive regexes; a matching title is left off the board. */
  hide: z.array(z.string().max(200)).max(50).default([]),
});

export type CalendarSetting = z.infer<typeof CalendarSettingSchema>;

export const YouTubeChannelSettingSchema = z.object({
  id: z.string().regex(/^UC[\w-]{20,24}$/, "a YouTube channel id starts with UC"),
  name: z.string().min(1).max(100),
  /** "statement-game" splits "a joke (The Game)" so the game leads on a key. */
  titleFormat: z.enum(["plain", "statement-game"]).default("plain"),
});

export const SettingsFileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  setup: z
    .object({
      /** The guide opens on every board launch until this is turned off. */
      openOnLaunch: z.boolean().default(true),
      /** Section ids the user has ticked through. Cosmetic; nothing gates on it. */
      completed: z.array(z.string().max(40)).max(40).default([]),
    })
    .prefault({}),
  board: z
    .object({
      port: z.number().int().min(1024).max(65535).default(6767),
      screen: z.enum(SCREEN_PRESETS).default("auto"),
    })
    .prefault({}),
  appearance: z
    .object({
      wallpaper: z.boolean().default(true),
      /** The ground colour. Kept dark by the picker; the palette assumes it. */
      background: z.string().regex(HEX).default("#111111"),
    })
    .prefault({}),
  location: z
    .object({
      label: Text(120),
      lat: z.number().min(-90).max(90).nullable().default(null),
      lon: z.number().min(-180).max(180).nullable().default(null),
      /** An IANA zone. Empty means the machine's own. */
      timezone: Text(64),
      units: z.enum(["imperial", "metric"]).default("imperial"),
      /** US only: pollen.com is keyed by ZIP. Empty skips the pollen tile. */
      zip: Text(10),
    })
    .prefault({}),
  calendars: z.array(CalendarSettingSchema).max(30).default([]),
  birthdays: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
      }),
    )
    .max(500)
    .default([]),
  sports: z.object({ teams: z.array(TeamSettingSchema).max(12).default([]) }).prefault({}),
  discord: z
    .object({
      guildIds: IdList(10),
      selfName: Text(60),
      selfId: Text(25),
      botToken: Text(200),
      watchIds: IdList(30),
    })
    .prefault({}),
  youtube: z
    .object({
      channels: z.array(YouTubeChannelSettingSchema).max(300).default([]),
      limit: z.number().int().min(1).max(60).default(20),
      maxAgeDays: z.number().int().min(1).max(365).default(21),
      includeShorts: z.boolean().default(false),
    })
    .prefault({}),
  twitch: z
    .object({
      clientId: Text(100),
      clientSecret: Text(100),
      refreshToken: Text(200),
      userId: Text(25),
    })
    .prefault({}),
  mail: z
    .object({
      enabled: z.boolean().default(false),
      host: z.string().max(200).default("imap.gmail.com"),
      port: z.number().int().min(1).max(65535).default(993),
      user: Text(200),
      /** An app password, never the account password. */
      appPassword: Text(200),
      mailbox: z.string().max(100).default("INBOX"),
      trash: z.string().max(100).default("[Gmail]/Trash"),
      limit: z.number().int().min(1).max(50).default(15),
    })
    .prefault({}),
  amazon: z
    .object({
      enabled: z.boolean().default(false),
      username: Text(200),
      password: Text(200),
      maxOrders: z.number().int().min(1).max(50).default(12),
      withinDays: z.number().int().min(1).max(365).default(45),
      deliveredDays: z.number().int().min(0).max(30).default(3),
      returnWarnDays: z.number().int().min(0).max(60).default(7),
    })
    .prefault({}),
  pc: z
    .object({
      enabled: z.boolean().default(true),
      /** Keep the literal 127.0.0.1 — see lib/nowplaying.ts. */
      agentUrl: z.string().max(200).default("http://127.0.0.1:7343"),
      /** Which app Now Playing follows: "any", or a substring like "Spotify". */
      nowPlayingApp: z.string().max(60).default("any"),
      /** Voicemeeter device-name fragments, for the output toggle. */
      headphoneNames: z.array(z.string().max(60)).max(10).default([]),
      speakerNames: z.array(z.string().max(60)).max(10).default([]),
    })
    .prefault({}),
  claude: z.object({ enabled: z.boolean().default(true) }).prefault({}),
  music: z
    .object({
      enabled: z.boolean().default(true),
      home: z.string().max(500).default("https://music.apple.com/"),
    })
    .prefault({}),
  transit: z
    .object({
      enabled: z.boolean().default(false),
      /** MTA route ids: "Q", "4", "L"… */
      lines: z.array(z.string().max(4)).max(8).default([]),
      /** GTFS parent station id, e.g. "626" (86 St on the Lexington line). */
      stopId: Text(10),
      stopName: Text(60),
      direction: z.enum(["N", "S"]).default("S"),
      /** "Downtown", "to Manhattan" — what the tile calls the direction. */
      directionLabel: Text(40),
    })
    .prefault({}),
  feed: z
    .object({
      /** The path tokens the .ics feeds accept; the first is the current one. */
      tokens: z.array(z.string().min(16).max(120)).max(5).default([]),
    })
    .prefault({}),
});

export type SettingsFile = z.infer<typeof SettingsFileSchema>;

/** The credential fields, by section — what `publicSettings` blanks out. */
export const SECRET_FIELDS = {
  discord: ["botToken"],
  twitch: ["clientSecret", "refreshToken"],
  mail: ["appPassword"],
  amazon: ["password"],
  feed: ["tokens"],
} as const;
