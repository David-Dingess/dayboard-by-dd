/**
 * Who you follow on Twitch, and which of them are live right now.
 *
 * THIS IS THE ONE PLACE IN THE BOARD THAT HOLDS A USER GRANT, and it is worth
 * saying why. Twitch will hand anybody an app token for a client id and secret,
 * but an app token cannot see a follow list — `/streams/followed` is scoped
 * `user:read:follows` and takes a USER token, because a follow list is personal
 * data even when the person is you. So the setup is a one-time authorization in
 * a browser (scripts/twitch-auth.ts), which yields a refresh token that, for a
 * confidential client, does not expire. After that the board is self-sufficient:
 * it trades the refresh token for an access token whenever it needs one, and
 * nobody is ever asked to log in again.
 *
 * The alternative was a hand-kept channel list in data/config/, the way
 * youtube.json works. It would have needed no grant at all — but it would also
 * have gone stale the first time you followed somebody new, and "the people I
 * follow" is the actual question the panel answers.
 *
 * Everything below fails soft, the same way discord.ts does: a dead credential
 * or a timeout produces a sentence in the panel, never a throw that reaches the
 * page. The video list sits underneath this one and must not go down
 * with it.
 */

import { loadSettings, saveSettings } from "./settings";
import { memo, stale } from "./memo";

const OAUTH = "https://id.twitch.tv/oauth2/token";
const HELIX = "https://api.twitch.tv/helix";
const UA = "Dayboard/1.0 (personal dashboard)";

/**
 * Viewer counts drift; nobody reads them to the hundred. Sixty seconds against
 * the board's thirty-second tick halves the requests and costs nothing anyone
 * can see. Twitch's ceiling is 800 points a minute — this spends two.
 */
const LIVE_TTL_MS = 60_000;

export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userId: string;
}

export interface LiveStream {
  id: string;
  login: string;
  name: string;
  title: string;
  game: string;
  viewers: number;
  startedAt: string;
  url: string;
  /** Their profile picture. Null when the extra lookup failed — see loadLive. */
  avatar: string | null;
  /** The live preview frame, already sized. Twitch refreshes it every few minutes. */
  preview: string;
}

interface LiveResult {
  live: LiveStream[];
  /** Something the panel can explain, in place of an empty panel that lies. */
  problem: string | null;
}

/** All four or nothing — three of them is a half-finished setup, not a config. */
export function configuredTwitch(): TwitchConfig | null {
  const { clientId, clientSecret, refreshToken, userId } = loadSettings().twitch;
  if (!clientId || !clientSecret || !refreshToken || !userId) return null;
  return { clientId, clientSecret, refreshToken, userId };
}

/* ---- the token ---------------------------------------------------------- */

/**
 * Not in `memo`, deliberately. Every other cache on the board picks its own TTL
 * because it is guessing how fast the world changes; this one is TOLD, by the
 * `expires_in` in the response. A constant here would either re-ask early
 * forever or, much worse, keep using a token past its end.
 */
let token: { value: string; expiresAt: number } | null = null;

/** The newest refresh token we have seen — env's, until Twitch hands us another. */
let currentRefresh: string | null = null;

/**
 * A refusal that will still be a refusal in thirty seconds: you revoked the app
 * in Twitch's Connections page, or changed your password. Sticky, so a dead
 * credential is not re-asked on every tick of a board nobody is watching.
 */
let deadCredential: string | null = null;

let warnedRotation = false;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  message?: string;
}

async function accessToken(cfg: TwitchConfig, force = false): Promise<string> {
  if (deadCredential) throw new Error(deadCredential);
  if (!force && token && Date.now() < token.expiresAt - 60_000) return token.value;

  const res = await fetch(OAUTH, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
      refresh_token: currentRefresh ?? cfg.refreshToken,
    }),
    signal: AbortSignal.timeout(8000),
  });

  const body = (await res.json().catch(() => ({}))) as TokenResponse;

  if (!res.ok || !body.access_token) {
    // 400 "Invalid refresh token" is the one you will actually hit, and no
    // amount of retrying fixes it — it needs you at a keyboard.
    if (res.status === 400 || res.status === 401) {
      deadCredential =
        "Twitch refused the refresh token — press Authorize again in Settings → Twitch.";
      throw new Error(deadCredential);
    }
    throw new Error(`Twitch auth said ${res.status}.`);
  }

  // Twitch documents that a refresh MAY return a new refresh token, and in
  // practice does not for confidential clients. If that ever changes we keep
  // working for the life of this process and say so once, loudly, because the
  // failure mode otherwise is a board that works until the next cold start.
  if (body.refresh_token && body.refresh_token !== (currentRefresh ?? cfg.refreshToken)) {
    currentRefresh = body.refresh_token;
    // Written straight back to settings, so a restart picks up the rotated
    // token rather than the dead one. A failed write is only a warning: the
    // in-memory copy keeps this process going.
    try {
      const s = loadSettings();
      saveSettings({ ...s, twitch: { ...s.twitch, refreshToken: body.refresh_token } });
    } catch (err) {
      if (!warnedRotation) {
        warnedRotation = true;
        console.warn(`dayboard: Twitch rotated the refresh token and it could not be saved — ${(err as Error).message}`);
      }
    }
  }

  token = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return token.value;
}

/**
 * Twitch's own advice is to react to a 401 rather than predict one, because a
 * token can die for reasons no clock knows about. So: try, and if the answer is
 * "no", throw this token away and try once more with a fresh one.
 */
async function helix<T>(path: string, cfg: TwitchConfig): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const bearer = await accessToken(cfg, attempt > 0);
    const res = await fetch(`${HELIX}${path}`, {
      cache: "no-store",
      headers: {
        "client-id": cfg.clientId,
        authorization: `Bearer ${bearer}`,
        "user-agent": UA,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 401 && attempt === 0) {
      token = null;
      continue;
    }
    // 429 throws rather than caching an empty list, so `stale` serves the last
    // roster and the next tick asks again — the bargain discord.ts makes too.
    if (!res.ok) throw new Error(`Twitch said ${res.status}.`);
    return (await res.json()) as T;
  }
  throw new Error("Twitch would not accept the token.");
}

/* ---- who is live -------------------------------------------------------- */

interface RawStream {
  id?: string;
  user_id?: string;
  user_login?: string;
  user_name?: string;
  title?: string;
  game_name?: string;
  viewer_count?: number;
  started_at?: string;
  thumbnail_url?: string;
}

/**
 * Twitch hands back the preview as a template with {width}x{height} in the path,
 * so the caller picks the size rather than being served a 1080p frame per tile.
 * 320x180 is two device pixels per CSS pixel at the width these tiles render.
 */
function preview(template: string | undefined): string {
  if (!template) return "";
  return template.replace("{width}", "320").replace("{height}", "180");
}

/**
 * Profile pictures, which the stream payload does not carry.
 *
 * One extra request for the whole list — /helix/users takes up to 100 ids at a
 * time — and it rides inside the same 60-second memo as the streams, so it is
 * one call a minute, not one per face. If it fails, everybody just goes back to
 * an initial: a missing picture must not cost us the roster we already have.
 */
async function fetchAvatars(ids: string[], cfg: TwitchConfig): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (!ids.length) return found;
  try {
    const query = new URLSearchParams();
    for (const id of ids.slice(0, 100)) query.append("id", id);
    const page = await helix<{ data?: { id?: string; profile_image_url?: string }[] }>(
      `/users?${query}`,
      cfg,
    );
    for (const user of page.data ?? []) {
      if (user.id && user.profile_image_url) found.set(user.id, user.profile_image_url);
    }
  } catch {
    // Faces are a nicety; the list is the point.
  }
  return found;
}

async function loadLive(cfg: TwitchConfig): Promise<LiveResult> {
  const raw: RawStream[] = [];
  let cursor: string | undefined;

  // `/streams/followed` returns ONLY the live ones, so there is nothing to
  // filter and no second call to list the follows. The loop is for the day a
  // hundred of the people you follow are streaming at once; the cap is there so
  // a pagination bug cannot spin.
  do {
    const query = new URLSearchParams({ user_id: cfg.userId, first: "100" });
    if (cursor) query.set("after", cursor);
    const page = await helix<{ data?: RawStream[]; pagination?: { cursor?: string } }>(
      `/streams/followed?${query}`,
      cfg,
    );
    const batch = page.data ?? [];
    raw.push(...batch);
    cursor = batch.length === 100 ? page.pagination?.cursor : undefined;
  } while (cursor && raw.length < 300);

  const streaming = raw.filter((s): s is RawStream & { user_login: string } =>
    Boolean(s.user_login),
  );
  const avatars = await fetchAvatars(
    streaming.map((s) => s.user_id).filter((id): id is string => Boolean(id)),
    cfg,
  );

  const live = streaming
    .map((s) => ({
      id: s.id ?? s.user_login,
      login: s.user_login,
      name: s.user_name || s.user_login,
      title: (s.title ?? "").trim(),
      game: s.game_name ?? "",
      viewers: s.viewer_count ?? 0,
      startedAt: s.started_at ?? "",
      url: `https://www.twitch.tv/${s.user_login}`,
      avatar: (s.user_id && avatars.get(s.user_id)) || null,
      preview: preview(s.thumbnail_url),
    }))
    // Biggest first, which is what Twitch's own sidebar does and what "who is
    // actually happening right now" means in practice.
    .sort((a, b) => b.viewers - a.viewers);

  return { live, problem: null };
}

export async function getLiveFollowed(): Promise<LiveResult & { configured: boolean }> {
  const cfg = configuredTwitch();
  if (!cfg) return { live: [], problem: null, configured: false };

  const key = "twitch:live";
  try {
    const [value] = await memo(key, LIVE_TTL_MS, () => loadLive(cfg));
    return { ...value, configured: true };
  } catch (err) {
    // A stale roster beats an empty one: somebody who was live a minute ago is
    // still a better answer than a blank panel, and the next tick corrects it.
    const last = stale<LiveResult>(key);
    if (last) return { ...last, configured: true };
    return { live: [], problem: (err as Error).message, configured: true };
  }
}

/** "42m", "2h14m" — how long they have been at it, not when they started. */
export function uptime(startedAt: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(startedAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** 812 · 4.2k · 31k. One decimal only where it carries information. */
export function viewers(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}
