/**
 * Who is in voice, without Discord running.
 *
 * Discord has no REST endpoint that lists a guild's voice states — only
 * `/guilds/{id}/voice-states/{user_id}`, one user at a time. Everything that
 * shows a whole channel's roster does it by holding a gateway websocket, which
 * a remote function cannot do.
 *
 * The guild widget is the way out. `widget.json` is public, unauthenticated and
 * server-side cacheable: it returns the voice channels @everyone can see, plus
 * the online members, each carrying `channel_id` when they are sitting in one.
 * That is exactly the question being asked, for the price of one toggle in
 * Server Settings.
 *
 * The costs, all of them real:
 *  - 100 online members, hard cap, then the list is truncated.
 *  - Only voice channels @everyone can see. A locked channel is invisible here.
 *  - `id` and `discriminator` are anonymised to "0", "1", "2" — usernames and
 *    avatars are genuine, the snowflakes are not. So we key on the username and
 *    never pretend these ids mean anything.
 *  - Enabling the widget makes the online list world-readable to anyone holding
 *    the guild id. That is the actual price; the setup guide says so out loud.
 */

import { loadSettings } from "./settings";
import { memo, stale } from "./memo";

const API = "https://discord.com/api";

/**
 * Who is in voice changes on a human timescale — someone joins a call and stays
 * for an hour — so half a minute of lag is invisible, and it turns the board's
 * 30-second ticker into two requests a minute against a global ceiling of fifty
 * a second. Discord documents no per-route limit for widget.json; this is not
 * close enough to one to need to know.
 */
const VOICE_TTL_MS = 30_000;

export interface VoiceMember {
  /** Anonymised by Discord — unique within one response, meaningless across two. */
  key: string;
  name: string;
  avatarUrl: string | null;
  status: string;
  muted: boolean;
  deafened: boolean;
  /**
   * The real snowflake, and only the bot path can supply it. The widget
   * anonymises ids to "0", "1", "2", so a widget-sourced member has null here and
   * has to be matched on name.
   */
  userId: string | null;
}

export interface VoiceChannel {
  id: string;
  name: string;
  position: number;
  members: VoiceMember[];
  /**
   * Whether you are one of them. Drives the whole point of the panel: people in
   * voice without you are a thing to notice, people in voice WITH you are not.
   */
  hasMe: boolean;
}

export interface GuildVoice {
  id: string;
  name: string;
  ok: boolean;
  /** Set when the guild answered with a problem we can explain. */
  problem: string | null;
  channels: VoiceChannel[];
  inVoice: number;
  online: number;
  /** Discord truncates at 100, so the online count is a floor, not a total. */
  truncated: boolean;
  inviteUrl: string | null;
}

interface RawWidget {
  id?: string;
  name?: string;
  instant_invite?: string | null;
  channels?: { id?: string; name?: string; position?: number }[];
  members?: {
    id?: string;
    username?: string;
    status?: string;
    avatar_url?: string;
    channel_id?: string;
    mute?: boolean;
    deaf?: boolean;
    self_mute?: boolean;
    self_deaf?: boolean;
  }[];
  message?: string;
  code?: number;
  /**
   * Ours, not Discord's. A refused request ("widget is off") is a stable answer
   * worth caching alongside a good one, so the explanation rides in the cached
   * body rather than being re-derived from a response we no longer hold.
   */
  _problem?: string;
}

/**
 * Which username is the user's own. The widget anonymises ids to "0", "1",
 * "2", so a name is the only stable handle it gives us — which is why this is
 * a name and not a snowflake. Empty when nobody has said, and then nothing
 * reads as "you".
 */
function selfName(): string {
  return loadSettings().discord.selfName.trim().toLowerCase();
}

/** The server ids from settings — the widget names each guild, so no labels needed. */
export function configuredGuilds(): string[] {
  return loadSettings().discord.guildIds;
}

function explain(code: number | undefined, status: number): string {
  // 50004 is the one you will actually hit, and it has a two-click fix.
  if (code === 50004) return "Widget is off — enable it in Server Settings → Widget.";
  if (code === 10004) return "Unknown guild — check the id.";
  return `Discord said ${status}.`;
}

async function fetchViaWidget(id: string, loadedAt: { at: number }): Promise<GuildVoice> {
  const blank: GuildVoice = {
    id,
    name: "Discord",
    ok: false,
    problem: null,
    channels: [],
    inVoice: 0,
    online: 0,
    truncated: false,
    inviteUrl: null,
  };

  const key = `widget:${id}`;
  let json: RawWidget;
  try {
    let at: number;
    [json, at] = await memo(key, VOICE_TTL_MS, async () => {
      // The query param is a cache buster, and it is doing real work.
      //
      // Discord serves this through Cloudflare with `max-age=300, s-maxage=300`,
      // so the edge holds a copy for five minutes. `cache: "no-store"` only
      // bypasses Next's cache — the CDN sits upstream of that and happily returns
      // a HIT with an Age of a couple of minutes. Measured: joining a voice
      // channel did not show up at all until the URL varied, and then appeared
      // instantly.
      //
      // Five minutes is not "who is in voice right now", it is "who was". A
      // unique URL per request is the whole fix, and `memo` above is what keeps
      // "per request" from meaning "per render".
      const res = await fetch(`${API}/guilds/${id}/widget.json?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "user-agent": "Dayboard/1.0 (personal dashboard)" },
        signal: AbortSignal.timeout(8000),
      });

      // Discord asks that you honour retry_after rather than guess. We have
      // nowhere to sleep on a page render, so the answer is to serve the last
      // good roster and try again on the next tick — which is what the throw
      // does, since a throw is never what gets cached.
      if (res.status === 429) throw new Error("rate limited");

      const body = (await res.json()) as RawWidget;
      if (!res.ok || !body.name) {
        // A configuration problem is a real, stable answer — cache it, or every
        // tick re-asks a question Discord has already refused.
        return { ...body, code: body.code ?? 0, _problem: explain(body.code, res.status) };
      }
      return body;
    });
    loadedAt.at = Math.min(loadedAt.at, at);
  } catch {
    const last = stale<RawWidget>(key);
    if (!last) return { ...blank, problem: "Couldn't reach Discord." };
    json = last;
  }

  if (json._problem) return { ...blank, problem: json._problem };

  const me = selfName();
  const members = json.members ?? [];
  const byChannel = new Map<string, VoiceMember[]>();

  for (const m of members) {
    if (!m.channel_id || !m.username) continue;
    const list = byChannel.get(m.channel_id) ?? [];
    list.push({
      key: `${m.channel_id}-${m.id ?? list.length}`,
      name: m.username,
      avatarUrl: m.avatar_url ?? null,
      status: m.status ?? "online",
      muted: Boolean(m.mute || m.self_mute),
      deafened: Boolean(m.deaf || m.self_deaf),
      userId: null,
    });
    byChannel.set(m.channel_id, list);
  }

  const channels: VoiceChannel[] = (json.channels ?? [])
    .filter((c): c is { id: string; name: string; position?: number } =>
      Boolean(c.id && c.name),
    )
    .map((c) => {
      // Named `people`, not `members`, so it cannot be mistaken for the guild's
      // member list a few lines down — that one is every online user, this one is
      // only the ones sitting in this channel.
      const people = (byChannel.get(c.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      return {
        id: c.id,
        name: c.name,
        position: c.position ?? 0,
        members: people,
        hasMe: people.some((m) => m.name.toLowerCase() === me),
      };
    })
    // Occupied channels first — the whole point is seeing where people are —
    // then the server's own ordering for the empty ones.
    .sort((a, b) => b.members.length - a.members.length || a.position - b.position);

  return {
    id,
    name: json.name ?? "Discord",
    ok: true,
    problem: null,
    channels,
    inVoice: [...byChannel.values()].reduce((n, list) => n + list.length, 0),
    online: members.length,
    truncated: members.length >= 100,
    inviteUrl: json.instant_invite ?? null,
  };
}

// --------------------------------------------------------------- the bot path
/*
 * Why there is a second source at all.
 *
 * The widget is presence-gated. Its member list is documented as "user objects
 * that include users presence", and someone set to Invisible appears offline to
 * everyone — so Discord omits them entirely, even while they are sitting in a
 * voice channel. Matt was in a call and simply was not in the response, not as a
 * member of the channel and not as an online user. No amount of parsing fixes
 * that; the payload genuinely does not carry them.
 *
 * Voice state is a different kind of fact. Being connected to a voice channel is
 * a property of the connection, not a status anyone broadcasts, and
 * `GET /guilds/{id}/voice-states/{user_id}` reports it regardless of presence and
 * regardless of whether the channel is one @everyone can see. It costs a bot
 * token and one request per watched person, and it stays stateless — no gateway,
 * no long-lived process — so it runs in a remote function like everything else.
 *
 * The two are MERGED rather than swapped. The bot only knows the people it was
 * told to watch; the widget catches anyone else who is online and in a call.
 * Neither is a superset of the other, and either can be missing entirely.
 */

const BOT_TTL_MS = 20_000;
/** Channel names change about once a year. There is no reason to ask often. */
const CHANNELS_TTL_MS = 600_000;
const API_V10 = "https://discord.com/api/v10";

function botToken(): string | null {
  return loadSettings().discord.botToken.trim() || null;
}

/** The people worth one request each. */
function watchedIds(): string[] {
  return loadSettings().discord.watchIds;
}

/** Optional, and strictly better than the name match when it is set. */
function selfId(): string | null {
  const id = loadSettings().discord.selfId.trim();
  return /^\d{5,}$/.test(id) ? id : null;
}

interface RawVoiceState {
  channel_id?: string | null;
  user_id?: string;
  deaf?: boolean;
  mute?: boolean;
  self_deaf?: boolean;
  self_mute?: boolean;
  member?: {
    nick?: string | null;
    user?: { id?: string; username?: string; global_name?: string | null; avatar?: string | null };
  };
}

interface RawChannel {
  id?: string;
  name?: string;
  type?: number;
  position?: number;
}

async function callBot<T>(
  path: string,
  token: string,
): Promise<{ status: number; body: T | null }> {
  const res = await fetch(`${API_V10}${path}`, {
    cache: "no-store",
    headers: {
      authorization: `Bot ${token}`,
      "user-agent": "Dayboard/1.0 (personal dashboard)",
    },
    signal: AbortSignal.timeout(8000),
  });
  // Same reasoning as the widget: nowhere to sleep during a render, so throwing
  // lets `stale` serve the last good roster and the next tick try again.
  if (res.status === 429) throw new Error("rate limited");
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: (await res.json()) as T };
}

/** Discord's channel types: 2 is voice, 13 is stage. */
function isVoice(type: number | undefined): boolean {
  return type === 2 || type === 13;
}

function avatarUrl(userId: string, hash: string | null | undefined): string | null {
  if (!userId) return null;
  if (hash) return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=64`;
  // The default-avatar index moved with the pomelo username migration: it used to
  // be discriminator % 5, and is now derived from the snowflake itself. BigInt
  // because a snowflake is past Number.MAX_SAFE_INTEGER, and the constructor form
  // rather than a `22n` literal because tsconfig targets below ES2020.
  const index = Number((BigInt(userId) >> BigInt(22)) % BigInt(6));
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * Null when no bot is configured, so the caller just uses the widget. A guild
 * with `problem` set when a bot IS configured but cannot answer — a token that
 * has stopped working should say so rather than look like a quiet room.
 */
async function fetchViaBot(id: string, loadedAt: { at: number }): Promise<GuildVoice | null> {
  const token = botToken();
  const ids = watchedIds();
  if (!token || ids.length === 0) return null;

  const channelKey = `bot-channels:${id}`;
  const stateKey = `bot-states:${id}`;

  let channels: RawChannel[];
  let states: (RawVoiceState | null)[];
  try {
    // The channel list's load time is deliberately not bound: see below.
    const [[chans], [voice, voiceAt]] = await Promise.all([
      memo(channelKey, CHANNELS_TTL_MS, async () => {
        const res = await callBot<RawChannel[]>(`/guilds/${id}/channels`, token);
        if (res.status === 401) throw new Error("unauthorized");
        return res.body ?? [];
      }),
      memo(stateKey, BOT_TTL_MS, async () =>
        Promise.all(
          ids.map(async (uid) => {
            const res = await callBot<RawVoiceState>(`/guilds/${id}/voice-states/${uid}`, token);
            // 404 is the ordinary answer for "not in a voice channel" — it is
            // what this endpoint says most of the time, not a failure.
            return res.status === 200 ? res.body : null;
          }),
        ),
      ),
    ]);
    channels = chans;
    states = voice;
    // ONLY the voice states count toward "updated N ago".
    //
    // The channel-name list sits on a ten-minute TTL, and folding its load time
    // into this min made the label report the age of static metadata rather than
    // the age of the roster — the panel would say "updated 7m ago" while
    // correctly showing someone who had left a call thirty seconds earlier.
    //
    // The rule this encodes: a freshness label may only be aged by the data it is
    // vouching for. Channel names are not what it is promising is current.
    loadedAt.at = Math.min(loadedAt.at, voiceAt);
  } catch (err) {
    const lastStates = stale<(RawVoiceState | null)[]>(stateKey);
    const lastChannels = stale<RawChannel[]>(channelKey);
    if (!lastStates || !lastChannels) {
      return {
        id,
        name: "Discord",
        ok: false,
        problem:
          (err as Error).message === "unauthorized"
            ? "Bot token rejected — check DISCORD_BOT_TOKEN."
            : "Couldn't reach Discord.",
        channels: [],
        inVoice: 0,
        online: 0,
        truncated: false,
        inviteUrl: null,
      };
    }
    states = lastStates;
    channels = lastChannels;
  }

  const named = new Map(
    channels.filter((c) => c.id && c.name && isVoice(c.type)).map((c) => [c.id!, c]),
  );

  const inChannel = new Map<string, VoiceMember[]>();
  for (const state of states) {
    if (!state?.channel_id) continue;
    const user = state.member?.user;
    const uid = user?.id ?? state.user_id ?? "";
    const list = inChannel.get(state.channel_id) ?? [];
    list.push({
      key: `bot-${uid}`,
      // Server nickname first: it is what everyone else in the call sees.
      name: state.member?.nick || user?.global_name || user?.username || "someone",
      avatarUrl: avatarUrl(uid, user?.avatar),
      status: "online",
      muted: Boolean(state.mute || state.self_mute),
      deafened: Boolean(state.deaf || state.self_deaf),
      userId: uid || null,
    });
    inChannel.set(state.channel_id, list);
  }

  const me = selfName();
  const mine = selfId();

  return {
    id,
    name: "Discord",
    ok: true,
    problem: null,
    channels: [...inChannel.entries()].map(([channelId, people]) => ({
      id: channelId,
      name: named.get(channelId)?.name ?? "Voice",
      position: named.get(channelId)?.position ?? 0,
      members: people.sort((a, b) => a.name.localeCompare(b.name)),
      hasMe: people.some((m) => (mine ? m.userId === mine : m.name.toLowerCase() === me)),
    })),
    inVoice: [...inChannel.values()].reduce((n, list) => n + list.length, 0),
    online: 0,
    truncated: false,
    inviteUrl: null,
  };
}

/**
 * One roster from two partial views. The bot knows only the watched people but
 * sees them whatever their status; the widget sees everyone online but only if
 * they are online. Duplicates collapse on the real snowflake where the bot
 * supplied one, and otherwise on the name — the only handle the widget gives.
 */
function mergeVoice(widget: GuildVoice, robot: GuildVoice): GuildVoice {
  // A broken bot must not blank a working widget, and vice versa.
  if (!robot.ok) return widget.ok ? widget : robot;
  if (!widget.ok) return { ...robot, problem: null };

  const byChannel = new Map(widget.channels.map((c) => [c.id, { ...c }]));

  for (const channel of robot.channels) {
    const existing = byChannel.get(channel.id);
    if (!existing) {
      // A channel the widget never mentioned — a private one, most likely.
      byChannel.set(channel.id, { ...channel });
      continue;
    }
    const isSame = (a: VoiceMember, b: VoiceMember) =>
      a.userId && b.userId ? a.userId === b.userId : a.name.toLowerCase() === b.name.toLowerCase();
    // Bot entries win where both have someone: a real id and a real avatar beat
    // an anonymised one.
    const members = [
      ...channel.members,
      ...existing.members.filter((m) => !channel.members.some((b) => isSame(b, m))),
    ].sort((a, b) => a.name.localeCompare(b.name));

    byChannel.set(channel.id, {
      ...existing,
      name: channel.name || existing.name,
      members,
      hasMe: existing.hasMe || channel.hasMe,
    });
  }

  const channels = [...byChannel.values()].sort(
    (a, b) => b.members.length - a.members.length || a.position - b.position,
  );

  return { ...widget, channels, inVoice: channels.reduce((n, c) => n + c.members.length, 0) };
}

async function fetchGuild(id: string, loadedAt: { at: number }): Promise<GuildVoice> {
  const [widget, robot] = await Promise.all([
    fetchViaWidget(id, loadedAt),
    fetchViaBot(id, loadedAt),
  ]);
  return robot ? mergeVoice(widget, robot) : widget;
}

export async function getVoice(): Promise<{ guilds: GuildVoice[]; fetchedAt: string }> {
  const ids = configuredGuilds();
  // The oldest roster on the board, not the time of the request — a cached answer
  // should say so rather than claim to be a second old.
  const loaded = { at: Date.now() };
  const guilds = await Promise.all(ids.map((id) => fetchGuild(id, loaded)));
  return { guilds, fetchedAt: new Date(loaded.at).toISOString() };
}
