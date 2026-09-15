import { ESPN_BASE, ESPN_UA } from "./espn";
import { COMPETITIONS, type Competition } from "./watch";
import type { DayboardEvent } from "./schema";
import type { TeamSetting } from "./settings-schema";
import { addDays, nowIso, todayLocal } from "./time";
import { zone } from "./runtime";
import { DateTime } from "luxon";

/**
 * Teams from ESPN: the picker and the schedule.
 *
 * WHY ESPN AND NOT AN ICS URL. The private board followed four clubs through
 * four different .ics feeds — a club's own Google calendar, fixtur.es, two
 * fixturedownload.com season files with the year baked into the URL — and
 * finding the right one for a fifth club was an afternoon. ESPN already answers
 * the live scores and the broadcaster lookups, it has a team list per league and
 * a season schedule per team, and neither needs a key. So a team is picked from
 * two dropdowns, and the schedule comes from the same place the score does.
 *
 * NOBODY PROMISED US THIS ENDPOINT — the same caveat lib/espn.ts carries. Every
 * field is optional and every reader optional-chains. An ICS URL is still
 * accepted as a team's source (`kind: "ics"`) for anything ESPN does not list.
 */

export interface League {
  key: string;
  label: string;
  espnPath: string;
  /** Other competition keys a team in this league may also play in. */
  related: string[];
}

/** The leagues the picker offers, in the order it offers them. */
export function listLeagues(): League[] {
  return Object.values(COMPETITIONS)
    .filter((c): c is Competition & { pick: true } => c.pick === true)
    .map((c) => ({ key: c.key, label: c.label, espnPath: c.espnPath, related: c.related ?? [] }));
}

export interface EspnTeamSummary {
  id: string;
  name: string;
  abbreviation: string;
  /** "#rrggbb", from ESPN's own brand colour when it has one. */
  color: string;
  logo: string;
}

interface TeamsResponse {
  sports?: { leagues?: { teams?: { team?: RawTeam }[] }[] }[];
}

interface RawTeam {
  id?: string | number;
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
  color?: string;
  logos?: { href?: string }[];
}

function hex(color: string | undefined): string {
  return color && /^[0-9a-f]{6}$/i.test(color) ? `#${color.toLowerCase()}` : "#98a2ad";
}

function summarise(raw: RawTeam | undefined): EspnTeamSummary | null {
  if (!raw?.id || !raw.displayName) return null;
  return {
    id: String(raw.id),
    name: raw.displayName,
    abbreviation: raw.abbreviation ?? "",
    color: hex(raw.color),
    logo: raw.logos?.[0]?.href ?? "",
  };
}

/** Every team in a league, alphabetical. Throws on a non-2xx. */
export async function listTeams(leagueKey: string): Promise<EspnTeamSummary[]> {
  const league = COMPETITIONS[leagueKey];
  if (!league) throw new Error(`no such league: ${leagueKey}`);
  const res = await fetch(`${ESPN_BASE}/${league.espnPath}/teams?limit=1000`, {
    headers: { "user-agent": ESPN_UA, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`ESPN said ${res.status}`);
  const json = (await res.json()) as TeamsResponse;
  const teams = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams
    .map((t) => summarise(t.team))
    .filter((t): t is EspnTeamSummary => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------ schedule --- */

interface ScheduleResponse {
  team?: RawTeam;
  events?: RawEvent[];
}

interface RawEvent {
  id?: string | number;
  date?: string;
  name?: string;
  shortName?: string;
  timeValid?: boolean;
  competitions?: {
    date?: string;
    timeValid?: boolean;
    venue?: { fullName?: string; address?: { city?: string; state?: string; country?: string } };
    competitors?: { homeAway?: "home" | "away"; team?: RawTeam }[];
    status?: { type?: { name?: string; state?: string } };
    notes?: { headline?: string }[];
  }[];
  links?: { href?: string; rel?: string[] }[];
}

const WINDOW = { pastDays: 30, futureDays: 300 };

/** The season the schedule endpoint answers without being asked. */
async function fetchSchedule(espnPath: string, teamId: string, season?: number): Promise<ScheduleResponse> {
  const query = season ? `?season=${season}` : "";
  const res = await fetch(`${ESPN_BASE}/${espnPath}/teams/${teamId}/schedule${query}`, {
    headers: { "user-agent": ESPN_UA, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ESPN said ${res.status}`);
  return (await res.json()) as ScheduleResponse;
}

/**
 * A team's fixtures, in the shape every other layer keeps.
 *
 * Titles are "Home vs Away", which is what lib/watch.ts's fixtureMatches and
 * lib/fixture-text.ts's opponent() already read. Ids hang off ESPN's event id,
 * which is stable across refreshes — the property uid.ts exists to protect.
 *
 * TWO SEASONS, NOT ONE. Asked with no season, ESPN answers the season in
 * progress; asked in July for an NFL team that is the one that just ended. So
 * the current answer and the next calendar year's are both fetched and merged,
 * which costs one extra request per team per refresh and makes August show
 * September.
 */
export async function teamSchedule(team: TeamSetting): Promise<DayboardEvent[]> {
  if (team.source.kind !== "espn") throw new Error("not an ESPN team");
  const league = COMPETITIONS[team.source.league];
  if (!league) throw new Error(`no such league: ${team.source.league}`);

  const year = Number(todayLocal().slice(0, 4));
  const [current, next] = await Promise.all([
    fetchSchedule(league.espnPath, team.source.teamId),
    fetchSchedule(league.espnPath, team.source.teamId, year + 1).catch(() => ({ events: [] })),
  ]);

  const layer = `team-${team.id}`;
  const tz = zone();
  const today = todayLocal();
  const from = addDays(today, -WINDOW.pastDays);
  const to = addDays(today, WINDOW.futureDays);
  const now = nowIso();
  const seen = new Set<string>();
  const events: DayboardEvent[] = [];

  for (const raw of [...(current.events ?? []), ...(next.events ?? [])]) {
    const competition = raw.competitions?.[0];
    const when = competition?.date ?? raw.date;
    if (!raw.id || !when || seen.has(String(raw.id))) continue;
    seen.add(String(raw.id));

    const start = DateTime.fromISO(when, { setZone: true }).setZone(tz);
    if (!start.isValid) continue;
    const date = start.toISODate()!;
    if (date < from || date > to) continue;

    const home = competition?.competitors?.find((c) => c.homeAway === "home")?.team;
    const away = competition?.competitors?.find((c) => c.homeAway === "away")?.team;
    const title =
      home?.displayName && away?.displayName
        ? `${home.displayName} vs ${away.displayName}`
        : (raw.name ?? raw.shortName ?? "Match");

    // A TBD kickoff arrives as a date with timeValid false; treat it as all-day
    // rather than as a midnight fixture, the way the ICS parser does.
    const timeValid = competition?.timeValid ?? raw.timeValid ?? true;
    const status = (competition?.status?.type?.name ?? "").toUpperCase();
    const cancelled = /CANCEL|POSTPON/.test(status);

    const venue = competition?.venue;
    const isHome = home?.id != null && String(home.id) === team.source.teamId;
    const place = venue?.fullName
      ? `${venue.fullName}${venue.address?.city ? `, ${venue.address.city}` : ""}`
      : isHome && team.homeVenue
        ? team.homeVenue
        : undefined;

    const page = raw.links?.find((l) => /^https?:\/\//.test(l.href ?? ""))?.href;

    events.push({
      id: `${layer}:e-${raw.id}`,
      layer,
      title,
      start: timeValid ? start.toISO({ suppressMilliseconds: true })! : date,
      end: timeValid
        ? start.plus({ hours: 3 }).toISO({ suppressMilliseconds: true })!
        : addDays(date, 1),
      allDay: !timeValid,
      tz,
      location: place,
      url: page,
      source: { kind: "upstream", ref: `espn:${team.id}`, fetchedAt: now },
      alarm: { minutesBefore: 60 },
      status: cancelled ? "cancelled" : "confirmed",
      seq: 0,
      updatedAt: now,
    });
  }

  return events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}
