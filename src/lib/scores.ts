import { DateTime } from "luxon";
import type { DayboardEvent } from "./schema";
import { loadSettings } from "./settings";
import { COMPETITIONS, fixtureMatches } from "./watch";
import {
  fetchScoreboard,
  gamecastLink,
  type EspnCompetitor,
  type EspnEvent,
} from "./espn";
import { memo, remember, stale } from "./memo";
import { localDate } from "./time";

/**
 * The score of the game that is on right now.
 *
 * This is the FIRST request-time call to ESPN in the repo, and it needed a
 * reason. scripts/enrich-watch.ts keeps ESPN out of the request path on purpose
 * — "a broken or rate-limiting ESPN can never damage the fixture snapshot" — and
 * that argument still holds for everything it does, because a broadcaster is a
 * fact that keeps until the next refresh. A score is not. It is worth nothing
 * ninety minutes later, so it cannot be snapshotted, and this module is
 * therefore built so that a broken ESPN degrades the card and nothing else: it
 * is only ever called when a fixture is actually live, every field is optional,
 * a failure serves the last good slate, and the widget above it falls back to
 * what the local JSON already knew.
 */

const SCORE_TTL_MS = 20_000;

export interface ScoreSide {
  name: string;
  abbr: string;
  /** ESPN sends a string, and an empty one before kickoff. */
  score: number | null;
  logo?: string;
  homeAway: "home" | "away";
}

export interface LiveScore {
  eventId: string;
  layer: string;
  home: ScoreSide;
  away: ScoreSide;
  state: "pre" | "in" | "post";
  /** ESPN's own per-sport formatting: "34'", "7:12 - 3rd", "Halftime", "FT". */
  clock: string;
  period: number | null;
  eventUrl?: string;
}

export interface ScoreResult {
  score: LiveScore | null;
  /** The real load time behind it, for <Freshness>. */
  fetchedAt: string;
  /** Set when ESPN was asked and could not answer. The card degrades; it never throws. */
  problem: string | null;
}

/* ------------------------------------------------- which competitions ----- */

let byLayer: Map<string, string[]> | null = null;
let byLayerAt = 0;
const LAYERS_TTL_MS = 5_000;

/**
 * Layer -> the competition keys its team plays in, from the teams in settings.
 *
 * An ESPN team with no competitions ticked plays in its league; a team with
 * some ticked plays in those, most likely first. Re-read every few seconds
 * rather than cached for the process, because the settings menu edits this
 * while the server runs.
 *
 * A useful consequence: a non-empty answer IS the definition of "one of the
 * teams". It is true for every team layer and false for health, birthdays and
 * personal, which means nothing here needs a hard-coded list of clubs — the
 * same setting that yields the ESPN path decides who counts.
 */
export function competitionsForLayer(layer: string): string[] {
  if (!byLayer || Date.now() - byLayerAt > LAYERS_TTL_MS) {
    byLayer = new Map();
    byLayerAt = Date.now();
    for (const team of loadSettings().sports.teams) {
      const keys = team.competitions.length
        ? team.competitions
        : team.source.kind === "espn"
          ? [team.source.league]
          : [];
      if (keys.length) byLayer.set(`team-${team.id}`, keys);
    }
  }
  return byLayer.get(layer) ?? [];
}

/**
 * The competition paths worth trying for one fixture, most likely first.
 *
 * enrich-watch already resolved a gamecast link for most fixtures, and that URL
 * carries the league slug (".../soccer/match/_/gameId/704321/league/eng.1").
 * Using it first matters for a club in five competitions: without the hint a
 * cup night would cost five requests before finding the right slate.
 * Once a path has worked for a fixture it is remembered, so only the first tick
 * of a match can ever cost more than one request.
 */
function pathsFor(event: DayboardEvent): string[] {
  const keys = competitionsForLayer(event.layer);
  const paths = keys.map((key) => COMPETITIONS[key]?.espnPath).filter((p): p is string => !!p);

  const known = stale<string>(`scores:comp:${event.id}`);
  const hinted = hintFromWatchUrl(event.watch?.eventUrl);
  const first = [known, hinted].filter((p): p is string => !!p && paths.includes(p));

  return [...new Set([...first, ...paths])];
}

function hintFromWatchUrl(url: string | undefined): string | null {
  if (!url) return null;
  const slug = url.match(/\/league\/([a-z0-9._-]+)/i)?.[1]?.toLowerCase();
  if (!slug) return null;
  return (
    Object.values(COMPETITIONS).find((c) => c.espnPath.endsWith(`/${slug}`))?.espnPath ?? null
  );
}

/* -------------------------------------------------------------- parsing --- */

function side(competitor: EspnCompetitor | undefined, fallback: "home" | "away"): ScoreSide {
  const raw = competitor?.score;
  const parsed = raw === undefined || raw === "" ? NaN : Number(raw);
  return {
    name: competitor?.team?.shortDisplayName ?? competitor?.team?.displayName ?? "—",
    abbr: competitor?.team?.abbreviation ?? "",
    score: Number.isFinite(parsed) ? parsed : null,
    logo: competitor?.team?.logo,
    homeAway: competitor?.homeAway ?? fallback,
  };
}

/**
 * Pull one fixture's score out of a day's slate. Pure, and exported separately
 * from the fetch so a test can drive it off a captured payload.
 *
 * Returns null rather than a phantom 0-0 when nothing matches — an invented
 * score is far worse than no card, and on a busy Saturday ESPN's slate holds
 * dozens of games we are not looking for.
 */
export function parseScoreboard(slate: EspnEvent[], event: DayboardEvent): LiveScore | null {
  const found = slate.find((espnEvent) => fixtureMatches(espnEvent.name ?? "", event.title));
  if (!found) return null;

  const competition = found.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  // homeAway, never array order: ESPN varies it by sport. The index fallbacks
  // are only reached when the field is missing entirely.
  const home = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === "away") ?? competitors[1];

  const status = competition?.status ?? found.status;
  const type = status?.type;

  return {
    eventId: event.id,
    layer: event.layer,
    home: side(home, "home"),
    away: side(away, "away"),
    state: type?.state ?? (type?.completed ? "post" : "in"),
    // shortDetail is the only clock string that reads correctly across sports.
    // displayClock counts DOWN within a period for the NFL and NBA and is
    // unreliable for soccer, so it is carried on the interface and not rendered.
    clock: type?.shortDetail ?? type?.detail ?? type?.description ?? "",
    period: status?.period ?? null,
    eventUrl: gamecastLink(found),
  };
}

/* --------------------------------------------------------------- fetch ---- */

/**
 * ESPN keys its slate by a date whose timezone depends on the sport: the US date
 * for the NFL, NBA and MLS, effectively the UTC date for European football. A
 * 20:00 ET tip-off is the next day in UTC, so both are tried — usually one
 * request, two only when the dates differ AND the first misses.
 */
function datesFor(event: DayboardEvent): string[] {
  const ny = localDate(event.start);
  const utc = DateTime.fromISO(event.start, { setZone: true }).toUTC().toISODate();
  return utc && utc !== ny ? [ny, utc] : [ny];
}

/**
 * The score for one fixture that is on right now.
 *
 * Only ever called for a live fixture — see LiveScoresWidget, which renders a
 * countdown off local JSON and imports nothing from here when nothing is on.
 *
 * The 20-second TTL is deliberately shorter than the board's 30-second tick. At
 * 30s every other tick would serve an answer up to 59 seconds old, and a score
 * is the one number on this board where a minute is noticed. Keyed on (path,
 * date) rather than on the fixture, so a Sunday with two games in one
 * competition still costs one request.
 */
export async function getScore(event: DayboardEvent): Promise<ScoreResult> {
  let problem: string | null = null;
  let oldest = Date.now();

  for (const espnPath of pathsFor(event)) {
    for (const date of datesFor(event)) {
      const key = `espn:${espnPath}:${date}`;
      let slate: EspnEvent[] | null;
      try {
        // fetchScoreboard throws, so memo never caches a failure and the stale
        // value below stays available. Same contract as subway.ts.
        const [value, at] = await memo(key, SCORE_TTL_MS, () => fetchScoreboard(espnPath, date));
        slate = value;
        oldest = Math.min(oldest, at);
      } catch (err) {
        problem = (err as Error).message;
        slate = stale<EspnEvent[]>(key);
        if (!slate) continue;
      }

      const score = parseScoreboard(slate, event);
      if (score) {
        remember(`scores:comp:${event.id}`, espnPath);
        return { score, fetchedAt: new Date(oldest).toISOString(), problem };
      }
    }
  }

  return { score: null, fetchedAt: new Date(oldest).toISOString(), problem };
}
