/**
 * ESPN's unauthenticated scoreboard, and the shapes it answers with.
 *
 * There are two callers and they want different things from the same endpoint:
 * `scripts/enrich-watch.ts` asks who is BROADCASTING a fixture, at refresh time,
 * once; `src/lib/scores.ts` asks what the SCORE is, at request time, every
 * twenty seconds while a game is on. Neither is allowed to own the response
 * shape, because a field one of them stops reading is a field the other one
 * silently loses.
 *
 * NOBODY PROMISED US THIS ENDPOINT. It is undocumented, unversioned and free.
 * Every field below is optional and every reader optional-chains, because the
 * only guarantee is that it answered at all.
 *
 * `fetchScoreboard` THROWS on a non-2xx rather than returning null. That is the
 * `lib/memo.ts` contract — a throw inside a `load` is never cached, which is
 * what lets `stale()` serve the last good slate through an outage. A caller
 * that would rather have null (the script) catches it.
 */

export const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
export const ESPN_UA = "Dayboard/1.0 (personal calendar)";

export interface EspnTeam {
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
  logo?: string;
  color?: string;
}

export interface EspnCompetitor {
  /** Read this. NEVER trust the array order — ESPN varies it by sport. */
  homeAway?: "home" | "away";
  /** A STRING, and "" before kickoff. */
  score?: string;
  team?: EspnTeam;
}

export interface EspnStatus {
  clock?: number;
  /** Counts DOWN within a period for the NFL and NBA. Not what you want. */
  displayClock?: string;
  period?: number;
  type?: {
    state?: "pre" | "in" | "post";
    completed?: boolean;
    detail?: string;
    /** The only clock string that reads correctly across sports. See scores.ts. */
    shortDetail?: string;
    description?: string;
  };
}

export interface EspnCompetition {
  competitors?: EspnCompetitor[];
  status?: EspnStatus;
  geoBroadcasts?: { media?: { shortName?: string }; market?: { type?: string } }[];
}

export interface EspnEvent {
  name?: string;
  shortName?: string;
  date?: string;
  competitions?: EspnCompetition[];
  status?: EspnStatus;
  links?: { text?: string; href?: string }[];
}

/**
 * One day's slate for one competition path (e.g. "soccer/eng.1", "football/nfl").
 *
 * `date` is YYYY-MM-DD or YYYYMMDD — the dashes are stripped here so callers can
 * pass whichever they already hold. Throws on a non-2xx or a timeout.
 */
export async function fetchScoreboard(
  path: string,
  date: string,
  timeoutMs = 12_000,
): Promise<EspnEvent[]> {
  const url = `${ESPN_BASE}/${path}/scoreboard?dates=${date.replace(/-/g, "")}`;
  const res = await fetch(url, {
    headers: { "user-agent": ESPN_UA, accept: "application/json" },
    // Next's data cache would hold this behind our own TTLs; memo.ts is the one
    // place caching is decided, the same way subway.ts and discord.ts do it.
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { events?: EspnEvent[] };
  return json.events ?? [];
}

/** ESPN's own page for a fixture, when it offers one. */
export function gamecastLink(event: EspnEvent): string | undefined {
  const link = event.links?.find((l) => /gamecast|summary/i.test(l.text ?? ""));
  return link?.href && /^https?:\/\//.test(link.href) ? link.href : undefined;
}
