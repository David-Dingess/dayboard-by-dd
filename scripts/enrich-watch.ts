import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { EventFileSchema, type DayboardEvent, type Watch } from "../src/lib/schema";
import { loadSettings } from "../src/lib/settings";
import {
  COMPETITIONS,
  appleTvLinkFromNotes,
  competitionTarget,
  fixtureMatches,
  needsLookup,
  serviceForNetwork,
  withinHorizon,
} from "../src/lib/watch";
import { fetchScoreboard, gamecastLink, type EspnEvent } from "../src/lib/espn";
import { localDate, nowIso, todayLocal } from "../src/lib/time";

/**
 * Attach a "where to watch" link to every upcoming fixture.
 *
 * Deliberately a SEPARATE pass from fetch-upstreams:
 *  - the NBA assigns broadcasters weeks late, so already-cached events need
 *    re-checking on later runs without re-fetching any ICS;
 *  - ESPN's API is undocumented, and keeping it out of the fetch path means a
 *    broken or rate-limiting ESPN can never damage the fixture snapshot.
 *
 * It is additive and failure-tolerant by construction: anything it cannot resolve
 * keeps whatever it had, and the script never fails the refresh.
 */

const cachePath = (id: string) => `data/cache/upstream-${id}.json`;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const horizonDays = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : 60;

let requests = 0;

/**
 * One request per (path, date), memoised — many fixtures share a date.
 *
 * The fetch itself lives in src/lib/espn.ts now, shared with the live-score
 * widget. This wrapper keeps the parts that are the SCRIPT's alone: a run-length
 * cache (there is no request cycle here to scope memo.ts to), the politeness
 * sleep, and turning a failure into a null this pass can walk past.
 */
const scoreboardCache = new Map<string, EspnEvent[] | null>();

async function scoreboard(path: string, date: string): Promise<EspnEvent[] | null> {
  const key = `${path}:${date}`;
  const cached = scoreboardCache.get(key);
  if (cached !== undefined) return cached;

  try {
    requests++;
    const events = await fetchScoreboard(path, date);
    scoreboardCache.set(key, events);
    // Be a polite guest at an endpoint nobody promised us.
    await new Promise((r) => setTimeout(r, 120));
    return events;
  } catch (err) {
    console.warn(`    ${path} ${date}: ${(err as Error).message}`);
    scoreboardCache.set(key, null);
    return null;
  }
}

/** The national feed if there is one, else whatever regional carrier is listed. */
function pickNetwork(event: EspnEvent): string | null {
  const broadcasts = event.competitions?.[0]?.geoBroadcasts ?? [];
  if (!broadcasts.length) return null;
  const national = broadcasts.find((b) => (b.market?.type ?? "").toLowerCase() === "national");
  return (national ?? broadcasts[0])?.media?.shortName ?? null;
}

async function resolve(
  event: DayboardEvent,
  competitions: string[],
): Promise<Watch | null> {
  // 1. A per-match link the feed already gave us always wins.
  const deepLink = appleTvLinkFromNotes(event.notes);
  if (deepLink) {
    return {
      url: deepLink,
      service: "Apple TV",
      precision: "deep-link",
      checkedAt: nowIso(),
    };
  }

  const date = localDate(event.start);
  const today = todayLocal();
  const firstCompetition = competitions[0];

  // Beyond the horizon nobody has assigned a broadcaster yet, so spend nothing.
  if (!withinHorizon(date, today, horizonDays)) {
    return firstCompetition ? competitionTarget(firstCompetition) ?? null : null;
  }

  for (const key of competitions) {
    const competition = COMPETITIONS[key];
    if (!competition) continue;

    const slate = await scoreboard(competition.espnPath, date);
    if (!slate) continue;

    const found = slate.find((espnEvent) => fixtureMatches(espnEvent.name ?? "", event.title));
    if (!found) continue;

    const eventUrl = gamecastLink(found);
    const target = serviceForNetwork(pickNetwork(found));
    if (target) {
      return {
        url: target.url,
        service: target.service,
        precision: "network",
        note: target.note,
        eventUrl,
        checkedAt: nowIso(),
      };
    }
    // We know the competition now even though the broadcaster is unnamed — which
    // is the whole reason for trying the cup paths for a club in several.
    return { ...competitionTarget(key, eventUrl)!, checkedAt: nowIso() };
  }

  return firstCompetition
    ? { ...competitionTarget(firstCompetition)!, checkedAt: nowIso() }
    : null;
}

async function run(): Promise<void> {
  // One entry per team: its cache id and the competitions worth asking ESPN
  // about, most likely first. An ESPN team with nothing ticked plays in its
  // league; an ICS team with nothing ticked has no ESPN path, and keeps only
  // whatever deep links its feed carried.
  const upstreams = loadSettings().sports.teams.map((team) => ({
    id: team.id,
    competitions: team.competitions.length
      ? team.competitions
      : team.source.kind === "espn"
        ? [team.source.league]
        : [],
  }));
  const today = todayLocal();

  for (const upstream of upstreams) {
    if (only && upstream.id !== only) continue;
    if (!upstream.competitions.length) continue;

    const path = cachePath(upstream.id);
    if (!existsSync(path)) continue;

    let events: DayboardEvent[];
    try {
      events = EventFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (err) {
      console.warn(`${upstream.id}: unreadable cache — ${(err as Error).message}`);
      continue;
    }

    const counts = { "deep-link": 0, network: 0, competition: 0, none: 0 };
    let looked = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      // Past fixtures are left exactly as they are: a watch link for a played
      // game is noise, and re-resolving them would burn requests forever.
      if (localDate(event.start) < today) continue;
      if (!needsLookup(event)) {
        counts[event.watch!.precision]++;
        continue;
      }

      looked++;
      try {
        const watch = await resolve(event, upstream.competitions);
        if (watch) {
          events[i] = { ...event, watch };
          counts[watch.precision]++;
        } else {
          counts.none++;
        }
      } catch (err) {
        console.warn(`  ${event.title}: ${(err as Error).message}`);
        counts.none++;
      }
    }

    try {
      EventFileSchema.parse(events);
      if (!dryRun) writeFileSync(path, JSON.stringify(events, null, 2) + "\n");
    } catch (err) {
      console.error(`${upstream.id}: refusing to write — ${(err as Error).message}`);
      continue;
    }

    console.log(
      `${upstream.id.padEnd(8)} ${String(looked).padStart(3)} looked up · ` +
        `${counts["deep-link"]} deep-link, ${counts.network} network, ` +
        `${counts.competition} competition, ${counts.none} none`,
    );
  }

  console.log(`\n${requests} ESPN request(s), horizon ${horizonDays} days`);
}

run().catch((err) => {
  // Never fail the refresh over an optional enrichment.
  console.error(`enrich-watch: ${(err as Error).message}`);
  process.exit(0);
});
