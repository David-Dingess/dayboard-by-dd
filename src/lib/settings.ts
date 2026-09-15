import { readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic";
import { configureRuntime } from "./runtime";
import {
  SECRET_FIELDS,
  SettingsFileSchema,
  type CalendarSetting,
  type SettingsFile,
} from "./settings-schema";

/**
 * The settings store: `data/settings.json`, the file the setup guide writes.
 *
 * Same shape as todos, water, notes and health — a pure half with no `next/*`
 * imports, an uncached read, an atomic write, and `scripts/settings.ts` on this
 * exact code path so the CLI and the menu cannot write a file the other rejects.
 *
 * NOTHING IN HERE MAY IMPORT FROM `next/*`, and this file must never carry a
 * `"use server"` directive: the Python agents' `_settings.py` reads the same
 * file, and the scripts read it under plain tsx.
 *
 * READS ARE NEVER CACHED. The menu writes it, the CLI writes it, and every
 * consumer wants the current answer on the next render — the same argument
 * todos.ts makes at length.
 */

const FILE = path.join(process.cwd(), "data", "settings.json");

export function defaultSettings(): SettingsFile {
  return SettingsFileSchema.parse({});
}

/**
 * The legacy environment, as a fallback for the credential-shaped fields.
 *
 * Someone who already has a `.env.local` from the private Dayboard keeps
 * working without retyping anything into the menu; a settings value, once
 * typed, always wins. Nothing here is required — a clone with no env at all
 * simply gets the defaults.
 */
function withEnv(s: SettingsFile): SettingsFile {
  const env = process.env;
  const list = (v: string | undefined) =>
    (v ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => /^\d{5,25}$/.test(x));

  const discord = { ...s.discord };
  if (!discord.guildIds.length) discord.guildIds = list(env.DISCORD_GUILD_IDS);
  if (!discord.selfName) discord.selfName = (env.DISCORD_SELF_NAME ?? "").trim();
  if (!discord.selfId) discord.selfId = (env.DISCORD_SELF_ID ?? "").trim();
  if (!discord.botToken) discord.botToken = (env.DISCORD_BOT_TOKEN ?? "").trim();
  if (!discord.watchIds.length) discord.watchIds = list(env.DISCORD_WATCH_IDS);

  const twitch = { ...s.twitch };
  if (!twitch.clientId) twitch.clientId = (env.TWITCH_CLIENT_ID ?? "").trim();
  if (!twitch.clientSecret) twitch.clientSecret = (env.TWITCH_CLIENT_SECRET ?? "").trim();
  if (!twitch.refreshToken) twitch.refreshToken = (env.TWITCH_REFRESH_TOKEN ?? "").trim();
  if (!twitch.userId) twitch.userId = (env.TWITCH_USER_ID ?? "").trim();

  const feed = { ...s.feed };
  if (!feed.tokens.length) {
    feed.tokens = (env.FEED_TOKENS ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length >= 16);
  }

  const pc = { ...s.pc };
  if (env.NEXT_PUBLIC_NOWPLAYING_URL && pc.agentUrl === "http://127.0.0.1:7343") {
    pc.agentUrl = env.NEXT_PUBLIC_NOWPLAYING_URL;
  }

  const calendars = s.calendars.length
    ? s.calendars
    : parseCalendarEnv(env.SUBSCRIBED_CALENDARS);

  return { ...s, discord, twitch, feed, pc, calendars };
}

/**
 * `SUBSCRIBED_CALENDARS="Label|url;Label|colour|url"` — the private board's
 * format, kept so an existing .env.local still works. Colours may be written
 * without the "#", because a bare "#" in an unquoted .env value is a comment.
 */
export function parseCalendarEnv(raw: string | undefined): CalendarSetting[] {
  if (!raw?.trim()) return [];
  const out: CalendarSetting[] = [];
  for (const entry of raw.split(";")) {
    const parts = entry.split("|").map((p) => p.trim());
    if (parts.length < 2) continue;
    const label = parts[0];
    const colorPart = parts.length >= 3 ? parts[1] : "";
    const color = /^#?[0-9a-f]{6}$/i.test(colorPart)
      ? colorPart.startsWith("#")
        ? colorPart
        : `#${colorPart}`
      : undefined;
    const url = parts[parts.length - 1];
    if (!label || !/^(https?|webcal):\/\//i.test(url)) continue;
    out.push({ label, url, color, hide: [] });
  }
  return out;
}

/**
 * Read the file, fresh. A missing file is the defaults; an unreadable one is
 * logged and ALSO the defaults, because a board that over-shows is legible and
 * one that throws on every render is not.
 */
export function loadSettings(): SettingsFile {
  let parsed: SettingsFile;
  try {
    parsed = SettingsFileSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`dayboard: settings.json is unreadable — ${(err as Error).message.split("\n")[0]}`);
    }
    parsed = defaultSettings();
  }
  const settings = withEnv(parsed);
  configureRuntime({ zone: settings.location.timezone || undefined, agentUrl: settings.pc.agentUrl });
  return settings;
}

/** Validated on the way out, like every store: a bad patch never reaches disk. */
export function saveSettings(next: SettingsFile): void {
  writeJsonAtomic(FILE, JSON.stringify(SettingsFileSchema.parse(next), null, 2) + "\n");
}

/** The file's own path, for the scripts and agents that say where it is. */
export const SETTINGS_FILE = FILE;

/* ------------------------------------------------------------ the shapes --- */

export type SecretSection = keyof typeof SECRET_FIELDS;

/** What a credential looks like once it has crossed to the browser. */
export interface SecretState {
  set: boolean;
  /** "…a1b2" — enough to recognise, never enough to use. */
  hint: string;
}

/**
 * The settings with every credential replaced by `{ set, hint }`.
 *
 * This is the only shape the page may render. A Server Component that took the
 * whole file would put the bot token in the RSC payload of every board load,
 * which is the same as printing it in the page source.
 */
export type PublicSettings = Omit<SettingsFile, SecretSection> & {
  discord: Omit<SettingsFile["discord"], "botToken"> & { botToken: SecretState };
  twitch: Omit<SettingsFile["twitch"], "clientSecret" | "refreshToken"> & {
    clientSecret: SecretState;
    refreshToken: SecretState;
  };
  mail: Omit<SettingsFile["mail"], "appPassword"> & { appPassword: SecretState };
  amazon: Omit<SettingsFile["amazon"], "password"> & { password: SecretState };
  feed: { tokens: SecretState; current: string };
};

function secret(value: string): SecretState {
  return { set: value.length > 0, hint: value ? `…${value.slice(-4)}` : "" };
}

export function publicSettings(s: SettingsFile): PublicSettings {
  return {
    ...s,
    discord: { ...s.discord, botToken: secret(s.discord.botToken) },
    twitch: {
      ...s.twitch,
      clientSecret: secret(s.twitch.clientSecret),
      refreshToken: secret(s.twitch.refreshToken),
    },
    mail: { ...s.mail, appPassword: secret(s.mail.appPassword) },
    amazon: { ...s.amazon, password: secret(s.amazon.password) },
    // The feed token is the one credential the user has to SEE, because the
    // phone subscribes by pasting it — so it travels, in full, on purpose.
    feed: { tokens: secret(s.feed.tokens[0] ?? ""), current: s.feed.tokens[0] ?? "" },
  };
}

/* ---------------------------------------------------------- the patches --- */

/**
 * A patch is a partial of the top-level sections; each section given is
 * replaced whole, then the result re-parsed. Whole sections rather than deep
 * merges because a list (teams, calendars) has no sensible deep merge, and the
 * menu always holds the whole section it is editing.
 *
 * SECRETS SURVIVE A PATCH THAT DOES NOT NAME THEM. The browser holds the public
 * shape, so a section it sends back carries `{ set, hint }` where the file has
 * a string. Any secret field that arrives as anything but a string keeps the
 * value on disk. Sending an empty string clears it — that is what the menu's
 * "remove" does.
 */
export type SettingsPatch = { [K in keyof SettingsFile]?: unknown };

export function applyPatch(current: SettingsFile, patch: SettingsPatch): SettingsFile {
  const next: Record<string, unknown> = { ...current };
  for (const [section, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (section in SECRET_FIELDS && value && typeof value === "object") {
      const fields = SECRET_FIELDS[section as SecretSection] as readonly string[];
      const incoming = { ...(value as Record<string, unknown>) };
      const onDisk = current[section as SecretSection] as unknown as Record<string, unknown>;
      for (const field of fields) {
        const sent = incoming[field];
        const keep = field === "tokens" ? !Array.isArray(sent) : typeof sent !== "string";
        if (keep) incoming[field] = onDisk[field];
      }
      next[section] = incoming;
    } else {
      next[section] = value;
    }
  }
  return SettingsFileSchema.parse(next);
}

/* ------------------------------------------------------------- helpers --- */

/** What the setup guide's status dots and the widgets' empty states agree on. */
export function configured(s: SettingsFile) {
  return {
    location: s.location.lat !== null && s.location.lon !== null,
    calendars: s.calendars.length > 0,
    birthdays: s.birthdays.length > 0,
    sports: s.sports.teams.length > 0,
    discord: s.discord.guildIds.length > 0,
    youtube: s.youtube.channels.length > 0,
    twitch: Boolean(s.twitch.clientId && s.twitch.clientSecret && s.twitch.refreshToken && s.twitch.userId),
    mail: s.mail.enabled && Boolean(s.mail.user && s.mail.appPassword),
    amazon: s.amazon.enabled && Boolean(s.amazon.username && s.amazon.password),
    pc: s.pc.enabled,
    claude: s.claude.enabled,
    music: s.music.enabled,
    transit: s.transit.enabled && s.transit.lines.length > 0 && Boolean(s.transit.stopId),
    feed: s.feed.tokens.length > 0,
  };
}

/** A fresh feed token: 24 random bytes, URL-safe. */
export function mintFeedToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
