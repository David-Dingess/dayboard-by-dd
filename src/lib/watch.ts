import type { DayboardEvent } from "./schema";

/**
 * Where to actually watch a match.
 *
 * Three tiers, most specific first:
 *   deep-link   a per-match URL the feed itself carried (an Apple TV link in the notes)
 *   network     ESPN named the broadcaster for this exact fixture
 *   competition the right service for the competition — the right site, not the
 *               exact stream, which is the honest answer when nobody has said yet
 *
 * The tables below are DATED FACTS about US rights, correct as of 2026-09 for
 * the 2026-27 season, and US-only: outside the US the competition fallback still
 * names the right competition, but the service will be the wrong one. When a
 * deal moves, this file is the only place to edit.
 */

export interface WatchTarget {
  url: string;
  service: string;
  /** shown when we are offering a service rather than a specific stream */
  note?: string;
}

export interface Competition extends WatchTarget {
  key: string;
  /** ESPN scoreboard path, e.g. "soccer/eng.1" */
  espnPath: string;
  label: string;
  /** Offered in the settings menu's league picker (has a team list on ESPN). */
  pick?: boolean;
  /** Other competitions a team in this league may also play in. */
  related?: string[];
}

export const COMPETITIONS: Record<string, Competition> = {
  mls: {
    key: "mls",
    label: "MLS",
    espnPath: "soccer/usa.1",
    pick: true,
    related: ["us-open-cup", "leagues-cup", "concacaf-cl"],
    service: "Apple TV",
    // MLS Season Pass was retired for 2026; every match is included with an
    // ordinary Apple TV subscription now.
    url: "https://tv.apple.com/us/channel/mls-season-pass/tvs.sbd.7000",
    note: "Every MLS match is included with an Apple TV subscription.",
  },
  epl: {
    key: "epl",
    label: "Premier League",
    espnPath: "soccer/eng.1",
    pick: true,
    related: ["efl-cup", "fa-cup", "ucl", "uel", "uecl"],
    service: "Peacock",
    url: "https://www.peacocktv.com/sports/premier-league",
    // Worth saying out loud: this is the one competition where the fallback can
    // send you to the wrong place, and ESPN never names the broadcaster for it.
    note: "NBC has all 380 matches across NBC, Peacock and USA Network. USA Network games need a TV login and do not stream on Peacock.",
  },
  "efl-cup": {
    key: "efl-cup",
    label: "Carabao Cup",
    espnPath: "soccer/eng.league_cup",
    service: "Paramount+",
    url: "https://www.paramountplus.com/sports/",
    note: "CBS Sports holds the Carabao Cup in the US through 2027-28.",
  },
  "fa-cup": {
    key: "fa-cup",
    label: "FA Cup",
    espnPath: "soccer/eng.fa",
    service: "ESPN+",
    url: "https://plus.espn.com/",
    note: "ESPN+ has the FA Cup exclusively in the US through 2027-28.",
  },
  ucl: {
    key: "ucl",
    label: "Champions League",
    espnPath: "soccer/uefa.champions",
    service: "Paramount+",
    url: "https://www.paramountplus.com/sports/",
  },
  uel: {
    key: "uel",
    label: "Europa League",
    espnPath: "soccer/uefa.europa",
    service: "Paramount+",
    url: "https://www.paramountplus.com/sports/",
  },
  nfl: {
    key: "nfl",
    label: "NFL",
    espnPath: "football/nfl",
    pick: true,
    service: "NFL",
    url: "https://www.nfl.com/ways-to-watch/",
    note: "The network is usually known well ahead; this is the catch-all.",
  },
  nba: {
    key: "nba",
    label: "NBA",
    espnPath: "basketball/nba",
    pick: true,
    service: "NBA League Pass",
    url: "https://www.nba.com/leaguepass",
    note: "Out-of-market games are League Pass. National games move to ESPN, NBC or Prime.",
  },
  mlb: {
    key: "mlb",
    label: "MLB",
    espnPath: "baseball/mlb",
    pick: true,
    service: "MLB.TV",
    url: "https://www.mlb.com/tv",
    note: "Out-of-market games are MLB.TV; in-market games are on the regional network.",
  },
  nhl: {
    key: "nhl",
    label: "NHL",
    espnPath: "hockey/nhl",
    pick: true,
    service: "ESPN+",
    url: "https://plus.espn.com/",
    note: "Out-of-market games stream on ESPN+; national games move to TNT or ABC.",
  },
  wnba: {
    key: "wnba",
    label: "WNBA",
    espnPath: "basketball/wnba",
    pick: true,
    service: "WNBA League Pass",
    url: "https://www.wnba.com/leaguepass",
  },
  nwsl: {
    key: "nwsl",
    label: "NWSL",
    espnPath: "soccer/usa.nwsl",
    pick: true,
    service: "Paramount+",
    url: "https://www.paramountplus.com/sports/",
  },
  laliga: {
    key: "laliga",
    label: "La Liga",
    espnPath: "soccer/esp.1",
    pick: true,
    related: ["ucl", "uel", "uecl"],
    service: "ESPN+",
    url: "https://plus.espn.com/",
  },
  bundesliga: {
    key: "bundesliga",
    label: "Bundesliga",
    espnPath: "soccer/ger.1",
    pick: true,
    related: ["ucl", "uel", "uecl"],
    service: "ESPN+",
    url: "https://plus.espn.com/",
  },
  seriea: {
    key: "seriea",
    label: "Serie A",
    espnPath: "soccer/ita.1",
    pick: true,
    related: ["ucl", "uel", "uecl"],
    service: "Paramount+",
    url: "https://www.paramountplus.com/sports/",
  },
  ligue1: {
    key: "ligue1",
    label: "Ligue 1",
    espnPath: "soccer/fra.1",
    pick: true,
    related: ["ucl", "uel", "uecl"],
    service: "Prime Video",
    url: "https://www.amazon.com/gp/video/storefront",
  },
  uecl: {
    key: "uecl",
    label: "Conference League",
    espnPath: "soccer/uefa.europa.conf",
    service: "Paramount+",
    url: "https://www.paramountplus.com/sports/",
  },
  "us-open-cup": {
    key: "us-open-cup",
    label: "US Open Cup",
    espnPath: "soccer/usa.open",
    service: "Paramount+",
    url: "https://www.paramountplus.com/sports/",
  },
  "leagues-cup": {
    key: "leagues-cup",
    label: "Leagues Cup",
    espnPath: "soccer/concacaf.leagues.cup",
    service: "Apple TV",
    url: "https://tv.apple.com/us/channel/mls-season-pass/tvs.sbd.7000",
  },
  "concacaf-cl": {
    key: "concacaf-cl",
    label: "Concacaf Champions Cup",
    espnPath: "soccer/concacaf.champions",
    service: "FS1",
    url: "https://www.foxsports.com/live",
  },
  ncaaf: {
    key: "ncaaf",
    label: "College football",
    espnPath: "football/college-football",
    pick: true,
    service: "ESPN",
    url: "https://www.espn.com/watch/",
  },
  ncaab: {
    key: "ncaab",
    label: "College basketball",
    espnPath: "basketball/mens-college-basketball",
    pick: true,
    service: "ESPN",
    url: "https://www.espn.com/watch/",
  },
};

/**
 * ESPN's `geoBroadcasts[].media.shortName` -> where that actually streams.
 * Keys are compared case-insensitively after trimming.
 */
const SERVICES: Record<string, WatchTarget> = {
  fox: { url: "https://www.foxsports.com/live", service: "FOX" },
  fs1: { url: "https://www.foxsports.com/live", service: "FS1" },
  cbs: { url: "https://www.paramountplus.com/live-tv/", service: "CBS" },
  "paramount+": { url: "https://www.paramountplus.com/sports/", service: "Paramount+" },
  nbc: { url: "https://www.peacocktv.com/watch/sports", service: "NBC" },
  peacock: { url: "https://www.peacocktv.com/watch/sports", service: "Peacock" },
  "usa network": {
    url: "https://www.usanetwork.com/live",
    service: "USA Network",
    note: "USA Network needs a TV provider login.",
  },
  usa: { url: "https://www.usanetwork.com/live", service: "USA Network" },
  espn: { url: "https://www.espn.com/watch/", service: "ESPN" },
  espn2: { url: "https://www.espn.com/watch/", service: "ESPN2" },
  espnu: { url: "https://www.espn.com/watch/", service: "ESPNU" },
  "espn+": { url: "https://plus.espn.com/", service: "ESPN+" },
  abc: { url: "https://www.espn.com/watch/", service: "ABC" },
  "prime video": { url: "https://www.amazon.com/gp/video/storefront", service: "Prime Video" },
  amazon: { url: "https://www.amazon.com/gp/video/storefront", service: "Prime Video" },
  netflix: { url: "https://www.netflix.com/browse", service: "Netflix" },
  "apple tv": { url: "https://tv.apple.com/us/channel/mls-season-pass/tvs.sbd.7000", service: "Apple TV" },
  "apple tv+": { url: "https://tv.apple.com/", service: "Apple TV" },
  "nba tv": { url: "https://www.nba.com/watch", service: "NBA TV" },
  tnt: { url: "https://www.tntdrama.com/watchtnt", service: "TNT" },
  max: { url: "https://www.max.com/", service: "Max" },
};

/**
 * Regional sports networks come through with market-specific names — "FanDuel SN
 * SE", "FanDuel SN DET", "MNMT". They are not nationally streamable, so they map
 * to the network's own page and keep their real name on the button.
 */
const REGIONAL_PREFIXES: [RegExp, WatchTarget][] = [
  [/^fanduel sn/i, { url: "https://www.fanduelsportsnetwork.com/", service: "FanDuel Sports Network" }],
  [/^bally/i, { url: "https://www.fanduelsportsnetwork.com/", service: "FanDuel Sports Network" }],
  [/^peachtree/i, { url: "https://www.peachtreesports.com/", service: "Peachtree Sports Network" }],
];

export function serviceForNetwork(name: string | null | undefined): WatchTarget | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  if (SERVICES[key]) return SERVICES[key];
  for (const [pattern, target] of REGIONAL_PREFIXES) {
    if (pattern.test(name.trim())) return { ...target, service: name.trim() };
  }
  return null;
}

export function fallbackForCompetition(key: string): Competition | null {
  return COMPETITIONS[key] ?? null;
}

/**
 * Some clubs' own calendars put a real per-match Apple TV link in the
 * DESCRIPTION of a fixture (MLS clubs do, for away games). Ticket links are
 * deliberately not matched — a ticket page is not a watch link, and treating it
 * as one would be worse than having nothing.
 */
export function appleTvLinkFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = notes.match(/https:\/\/tv\.apple\.com\/\S+/);
  if (!match) return null;
  return match[0].replace(/[.,)\]]+$/, "");
}

const NOISE = /\((\d+\s*-\s*\d+|pen\.?[^)]*)\)|\[[^\]]*\]/gi;

/** "Liverpool - Everton (1-1) [LC]" -> ["liverpool", "everton"] */
export function teamsFromTitle(title: string): string[] {
  return title
    .replace(NOISE, " ")
    .split(/\s+(?:vs\.?|v|at|-|—|@)\s+/i)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(fc|cf|sc|afc|united|city|club)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does an ESPN fixture describe the same match as ours?
 *
 * ESPN writes "Away at Home"; our feeds write "Home vs Away" or "Home - Away".
 * Rather than reconcile the orders, require that both sides of our title appear
 * somewhere in ESPN's — after stripping the filler words that differ between
 * sources ("Some Town FC" vs "Some Town").
 */
export function fixtureMatches(espnName: string, ourTitle: string): boolean {
  const ours = teamsFromTitle(ourTitle).map(normalise).filter((t) => t.length > 2);
  if (ours.length < 2) return false;
  const theirs = normalise(espnName);
  return ours.every((team) => {
    if (theirs.includes(team)) return true;
    // Fall back to the longest word ("Liverpool", "Wolverhampton"), which is
    // distinctive enough on a single day's slate.
    const longest = team.split(" ").sort((a, b) => b.length - a.length)[0];
    return longest.length > 3 && theirs.includes(longest);
  });
}

/** The competition-level answer, used when nobody has named a broadcaster yet. */
export function competitionTarget(
  competitionKey: string,
  eventUrl?: string,
): DayboardEvent["watch"] | null {
  const competition = fallbackForCompetition(competitionKey);
  if (!competition) return null;
  return {
    url: competition.url,
    service: competition.service,
    precision: "competition",
    note: competition.note,
    eventUrl,
  };
}

/** Only fixtures worth spending a request on: today forward, inside the horizon. */
export function withinHorizon(date: string, today: string, horizonDays: number): boolean {
  if (date < today) return false;
  const ms = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return ms / 86_400_000 <= horizonDays;
}

/**
 * A resolved link only needs re-checking when it was a guess. An exact deep link
 * or a named network never changes, but "League Pass" may become "Prime Video"
 * once the NBA assigns the game.
 */
export function needsLookup(event: DayboardEvent): boolean {
  return !event.watch || event.watch.precision === "competition";
}

/* ------------------------------------------------- streaming sites ------ */

/**
 * The sites the stream window will open, by host.
 *
 * NOT A LIST OF WHAT CAN BE EMBEDDED — nothing here can be. It is what the paste
 * box recognises as "a streaming service" rather than "a link", so pasting a
 * Peacock URL opens it in the stream window instead of being refused. Once a
 * site is open you can go anywhere from it; this only decides what gets in
 * through the front door.
 *
 * Matched on the END of the hostname, most specific first, so plus.espn.com is
 * ESPN+ rather than ESPN and tv.youtube.com is YouTube TV.
 */
const STREAM_HOSTS: [string, string][] = [
  ["plus.espn.com", "ESPN+"],
  ["espn.com", "ESPN"],
  ["tv.apple.com", "Apple TV"],
  ["peacocktv.com", "Peacock"],
  ["paramountplus.com", "Paramount+"],
  ["primevideo.com", "Prime Video"],
  ["netflix.com", "Netflix"],
  ["max.com", "Max"],
  ["hbomax.com", "Max"],
  ["nba.com", "NBA"],
  ["nfl.com", "NFL"],
  ["foxsports.com", "FOX Sports"],
  ["fox.com", "FOX"],
  ["nbcsports.com", "NBC Sports"],
  ["nbc.com", "NBC"],
  ["usanetwork.com", "USA Network"],
  ["tntdrama.com", "TNT"],
  ["tv.youtube.com", "YouTube TV"],
  ["fubo.tv", "Fubo"],
  ["sling.com", "Sling"],
  ["mlssoccer.com", "MLS"],
  ["fanduelsportsnetwork.com", "FanDuel Sports Network"],
  ["peachtreesports.com", "Peachtree Sports Network"],
];

/** "www.peacocktv.com" -> "Peacock". Amazon only counts on its video pages. */
export function serviceForUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if ((host === "amazon.com" || host.endsWith(".amazon.com")) && url.pathname.startsWith("/gp/video")) {
    return "Prime Video";
  }
  for (const [suffix, service] of STREAM_HOSTS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return service;
  }
  return null;
}

/**
 * Where a team's tile sends the stream window.
 *
 * The fixture's own answer first — enrich-watch has usually resolved the exact
 * broadcaster for the next game, which is the difference between Peacock and
 * USA Network for a Premier League match — and the team's main competition otherwise. A
 * cancelled fixture's link is not an answer about anything.
 */
export function teamStream(
  competitions: string[],
  event: DayboardEvent | null,
): { url: string; service: string } | null {
  if (event && event.status !== "cancelled" && event.watch) {
    return { url: event.watch.url, service: event.watch.service };
  }
  for (const key of competitions) {
    const competition = COMPETITIONS[key];
    if (competition) return { url: competition.url, service: competition.service };
  }
  return null;
}
