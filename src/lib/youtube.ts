import { loadSettings } from "./settings";
import { z } from "zod";
import { memo, remember, stale } from "./memo";

/**
 * Latest videos from the channels you subscribe to.
 *
 * YouTube publishes a per-channel Atom feed at
 * /feeds/videos.xml?channel_id=… — public, no API key, no quota, 15 most recent
 * videos. So once we know WHICH channels, everything after is free and keyless.
 *
 * Shorts are excluded by asking for a different feed rather than by filtering
 * one. Every channel has hidden auto-playlists alongside its uploads: swapping
 * the "UC" prefix for "UULF" gives long-form only ("UUSH" is the shorts half),
 * and the same RSS endpoint accepts a playlist_id. Measured on three
 * channels, the plain channel feed was 9/15 and 4/15 shorts — so this also
 * returns 15 real videos per channel instead of 15 mixed ones. No extra request.
 *
 * Knowing which channels is the part that needs you: subscriptions are private,
 * and nothing in the public channel HTML exposes them. Google Takeout exports
 * them as a CSV, which scripts/import-youtube.ts turns into the config below.
 */

const ChannelSchema = z.object({
  id: z.string().regex(/^UC[\w-]{20,24}$/, "a YouTube channel id starts with UC"),
  name: z.string().min(1),
  /**
   * How this channel writes its titles.
   *
   * "statement-game" is for channels that title every upload as a joke, then
   * the game in brackets at the end. Splitting it puts the game first, which is
   * the half that decides whether you click. Any channel that does not do this
   * leaves it alone and keeps its title whole.
   */
  titleFormat: z.enum(["plain", "statement-game"]).default("plain"),
});

export const YouTubeConfigSchema = z.object({
  channels: z.array(ChannelSchema).default([]),
  /** how many videos the widget shows */
  limit: z.number().int().min(1).max(60).default(20),
  /** ignore anything older than this, so the panel stays "what's new" */
  maxAgeDays: z.number().int().min(1).default(21),
  /** Shorts are excluded by default; flip this to include them */
  includeShorts: z.boolean().default(false),
});

/**
 * The hidden "long-form uploads" playlist that sits beside every channel's
 * uploads. UC… -> UULF…; the shorts equivalent is UUSH… .
 */
export function longFormPlaylistId(channelId: string): string {
  return `UULF${channelId.slice(2)}`;
}

export type YouTubeConfig = z.infer<typeof YouTubeConfigSchema>;
export type YouTubeChannel = z.infer<typeof ChannelSchema>;

/** The channel list and limits, from data/settings.json. */
export function getYouTubeConfig(): YouTubeConfig {
  return YouTubeConfigSchema.parse(loadSettings().youtube);
}

/**
 * A Google Takeout `subscriptions.csv` — "Channel Id, Channel Url, Channel
 * Title". Subscriptions are private, so this one export is the only way in;
 * after it, every video comes from public per-channel RSS with no key.
 */
export function parseTakeoutCsv(text: string): YouTubeChannel[] {
  const [headerLine, ...lines] = text.split(/\r?\n/).filter((l) => l.trim());
  if (!headerLine) return [];
  const header = headerLine.split(",").map((h) => h.trim().toLowerCase());
  const idIndex = header.findIndex((h) => h.includes("channel id"));
  const titleIndex = header.findIndex((h) => h.includes("channel title"));
  if (idIndex < 0 || titleIndex < 0) return [];
  const found: YouTubeChannel[] = [];
  for (const line of lines) {
    // Channel titles can contain commas; ids never do, and the title is last.
    const parts = line.split(",");
    const id = (parts[idIndex] ?? "").trim();
    const name = parts.slice(titleIndex).join(",").trim();
    if (!/^UC[\w-]{20,24}$/.test(id) || !name) continue;
    found.push({ id, name, titleFormat: "plain" });
  }
  return found;
}

export interface Video {
  id: string;
  title: string;
  channel: string;
  channelId: string;
  published: string;
  url: string;
  thumbnail: string;
}

export interface TitleParts {
  /** The game, out of the brackets at the end. Null if the title is not shaped that way. */
  game: string | null;
  /** Everything before the brackets — the whole title when there is no game. */
  statement: string;
  /** "#ad" was in there. Stripped from the game name, but not thrown away. */
  ad: boolean;
}

/**
 * "a soul for a soul...for a soul (Slay the Spire 2)" -> the game, then the joke.
 *
 * Some channels title every video the same way, and the half that decides
 * whether you click is the half in brackets — so the tile leads with the game
 * and drops the statement to a quieter second line.
 *
 * THE BRACKETS TAKEN ARE THE LAST ONES, which is not fussiness: "it takes (a)
 * two door (Wheelmates)" has two pairs and only the second is the game. The
 * greedy prefix is what walks past the first. Refusing brackets that contain
 * brackets is the other half of it — a title ending in a nested pair is not this
 * shape, and guessing at one would be worse than leaving it alone.
 *
 * Anything that does not match comes back whole, with no game. That is the case
 * for every other channel, and for the occasional NL video that breaks form.
 */
export function splitTitle(title: string): TitleParts {
  const match = /^(.*)\s*\(([^()]*)\)\s*$/.exec(title.trim());
  if (!match) return { game: null, statement: title.trim(), ad: false };

  const inner = match[2].trim();
  const game = inner.replace(/#ad\b/gi, "").replace(/\s{2,}/g, " ").trim();
  // Brackets with nothing but "#ad" in them are not a game name.
  if (!game) return { game: null, statement: title.trim(), ad: /#ad\b/i.test(inner) };

  return { game, statement: match[1].trim(), ad: /#ad\b/i.test(inner) };
}

function decode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return match ? decode(match[1].trim()) : null;
}

/**
 * The Atom feed is small and its shape is stable, so a targeted parse beats
 * pulling in an XML dependency. Anything malformed yields fewer videos, never
 * an exception.
 */
export function parseChannelFeed(xml: string): Video[] {
  const out: Video[] = [];
  // A playlist feed's <title> is "Videos", not the channel, so fall back to the
  // feed-level author instead. Entries carry their own author either way.
  const head = xml.split("<entry>")[0] ?? "";
  const headAuthor = head.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/);
  const channelName = headAuthor ? decode(headAuthor[1].trim()) : (tag(head, "title") ?? "");

  for (const chunk of xml.split("<entry>").slice(1)) {
    const block = chunk.split("</entry>")[0];
    const videoId = tag(block, "yt:videoId");
    const title = tag(block, "title");
    const published = tag(block, "published");
    const channelId = tag(block, "yt:channelId");
    if (!videoId || !title || !published) continue;

    const author = block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/);
    out.push({
      id: videoId,
      title,
      channel: author ? decode(author[1].trim()) : channelName,
      channelId: channelId ?? "",
      published,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      // i.ytimg.com serves these without any key; mqdefault is the 320x180 one.
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    });
  }
  return out;
}

async function fetchFeed(query: string): Promise<Video[] | null> {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?${query}`, {
      next: { revalidate: 900 },
      headers: { "user-agent": "Dayboard/1.0 (personal dashboard)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return parseChannelFeed(await res.text());
  } catch {
    return null;
  }
}

/**
 * Null means "could not fetch this channel at all", which is NOT the same as a
 * channel that genuinely has nothing — and collapsing the two is the bug behind
 * tiles that appear and vanish on a roughly one-minute beat. A feed that
 * rate-limits, times out at 8s, or answers 5xx used to come back as `[]`, the
 * load cached that empty list for 60s (memo has no stale-on-failure of its own),
 * and the channel's tiles were simply gone until the next good tick. The caller
 * keeps the last good list through a null; see loadSubscriptionVideos.
 */
async function fetchChannel(channel: YouTubeChannel, includeShorts: boolean): Promise<Video[] | null> {
  if (!includeShorts) {
    const longForm = await fetchFeed(`playlist_id=${longFormPlaylistId(channel.id)}`);
    // A channel with no long-form playlist (or a feed that failed) falls back to
    // the plain channel feed — some shorts is better than an empty column.
    if (longForm && longForm.length) return longForm;
  }
  // null (the feed failed) travels straight up; only a real empty answer is [].
  return await fetchFeed(`channel_id=${channel.id}`);
}

/** Posted this recently and not yet opened, and the board says so out loud. */
export const FRESH_MS = 30 * 60_000;

export function isFresh(published: string, now = Date.now()): boolean {
  const age = now - Date.parse(published);
  return Number.isFinite(age) && age >= 0 && age < FRESH_MS;
}

/** Just the yes/no, for the panel tab — which has no room for a video list. */
export async function hasFreshVideo(): Promise<boolean> {
  const { videos } = await getSubscriptionVideos();
  return videos.some((video) => isFresh(video.published));
}

/**
 * Memoised because two things ask per render now — the widget and the tab that
 * pulses above it — and the answer must be the same for both. The fetches were
 * already cached by `revalidate`; this dedupes the XML parsing on top, and a
 * minute is far finer than the 30-minute window it feeds.
 */
export async function getSubscriptionVideos(): Promise<{
  videos: Video[];
  channelCount: number;
}> {
  const [value] = await memo("youtube:videos", 60_000, loadSubscriptionVideos);
  return value;
}

async function loadSubscriptionVideos(): Promise<{
  videos: Video[];
  channelCount: number;
}> {
  const config = getYouTubeConfig();
  if (!config.channels.length) return { videos: [], channelCount: 0 };

  const results = await Promise.all(
    config.channels.map(async (channel) => {
      // Per-channel last-good, so one feed failing drops nobody's tiles. The age
      // filter below still applies, so a channel that stays dead for weeks empties
      // on its own as its videos age past maxAgeDays rather than lingering forever.
      const key = `youtube:channel:${channel.id}`;
      const fetched = await fetchChannel(channel, config.includeShorts);
      if (fetched === null) return stale<Video[]>(key) ?? [];
      remember(key, fetched);
      return fetched;
    }),
  );
  const cutoff = Date.now() - config.maxAgeDays * 86_400_000;

  const videos = results
    .flat()
    .filter((video) => Date.parse(video.published) >= cutoff)
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, config.limit);

  return { videos, channelCount: config.channels.length };
}

/** "3h ago", "2d ago" — a dashboard wants recency, not a date. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
