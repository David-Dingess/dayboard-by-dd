import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { EventFileSchema, ManifestSchema, type DayboardEvent, type Manifest } from "../src/lib/schema";
import type { TeamSetting } from "../src/lib/settings-schema";
import { loadSettings } from "../src/lib/settings";
import { teamSchedule } from "../src/lib/espn-teams";
import { parseIcs } from "../src/lib/ical-parse";
import { contentHash } from "../src/lib/uid";
import { addDays, nowIso, todayLocal } from "../src/lib/time";

/**
 * Snapshot every team's schedule into data/cache/, which is what the site
 * actually reads. Nothing is fetched at request time, so a flaky upstream can
 * never blank a layer — the worst case is last week's fixtures.
 *
 * Which teams comes from data/settings.json. An ESPN team is fetched through
 * lib/espn-teams.ts; an ICS team is fetched and parsed the way the private
 * board always did it. Both land in the same shape and the same file name.
 */

const MANIFEST = "data/cache/manifest.json";
const cachePath = (id: string) => `data/cache/upstream-${id}.json`;

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const dryRun = args.includes("--dry-run");

async function fetchText(url: string, attempts = 3): Promise<{ text: string; status: number }> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url.replace(/^webcal:\/\//i, "https://"), {
        headers: { "user-agent": "Dayboard/1.0 (personal calendar)" },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error("response is not an iCalendar body");
      return { text, status: res.status };
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function loadPrevious(id: string): DayboardEvent[] {
  const path = cachePath(id);
  if (!existsSync(path)) return [];
  try {
    return EventFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return [];
  }
}

function loadManifest(): Manifest {
  if (!existsSync(MANIFEST)) {
    return { updatedAt: nowIso(), upstreams: {}, counts: {}, lastUesSweep: null };
  }
  try {
    return ManifestSchema.parse(JSON.parse(readFileSync(MANIFEST, "utf8")));
  } catch {
    return { updatedAt: nowIso(), upstreams: {}, counts: {}, lastUesSweep: null };
  }
}

/**
 * Carry SEQUENCE forward. A calendar client only re-notifies when SEQUENCE
 * increases, so it has to survive across refreshes and only move when something
 * a human would care about actually changed.
 */
function reconcile(previous: DayboardEvent[], fresh: DayboardEvent[]): DayboardEvent[] {
  const before = new Map(previous.map((e) => [e.id, e]));
  const out: DayboardEvent[] = [];
  let changed = 0;

  for (const ev of fresh) {
    const prior = before.get(ev.id);
    if (!prior) {
      out.push(ev);
      continue;
    }
    if (contentHash(prior) === contentHash(ev)) {
      // Nothing meaningful moved: keep the old timestamps so the diff stays quiet,
      // and carry the watch link forward. A freshly parsed event never has one —
      // enrichment is a separate pass — so without this every refresh would
      // silently wipe every link enrich-watch had resolved.
      out.push({ ...ev, watch: prior.watch, seq: prior.seq, updatedAt: prior.updatedAt });
    } else {
      // The fixture moved, so the old broadcast assignment is suspect. Dropping
      // `watch` here is deliberate: enrich-watch resolves it again on this run.
      changed++;
      out.push({ ...ev, seq: prior.seq + 1 });
    }
  }

  // A fixture that vanishes from the feed is tombstoned for a week rather than
  // deleted, so subscribers see it cancelled instead of it silently disappearing.
  const freshIds = new Set(fresh.map((e) => e.id));
  const cutoff = addDays(todayLocal(), -7);
  for (const prior of previous) {
    if (freshIds.has(prior.id)) continue;
    if (prior.status === "cancelled" && prior.updatedAt.slice(0, 10) < cutoff) continue;
    out.push(
      prior.status === "cancelled"
        ? prior
        : { ...prior, status: "cancelled", seq: prior.seq + 1, updatedAt: nowIso() },
    );
  }

  if (changed) console.log(`  ${changed} event(s) moved`);
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

async function fetchTeam(team: TeamSetting): Promise<{ events: DayboardEvent[]; status: number | string; url: string }> {
  if (team.source.kind === "espn") {
    return {
      events: await teamSchedule(team),
      status: 200,
      url: `espn:${team.source.league}/${team.source.teamId}`,
    };
  }
  const { text, status } = await fetchText(team.source.url);
  const events = parseIcs(text, {
    layer: `team-${team.id}`,
    uidStrategy: "upstream",
    window: { pastDays: 30, futureDays: 300 },
    alarmMinutes: 60,
    forceAllDayIfMidnight: true,
    sourceRef: team.id,
    team: team.name,
    homeVenue: team.homeVenue || undefined,
  });
  return { events, status, url: team.source.url };
}

async function run(): Promise<void> {
  const teams = loadSettings().sports.teams;
  const manifest = loadManifest();
  const targets = teams.filter((t) => !only || t.id === only);
  if (!targets.length) {
    console.log(only ? `No team called "${only}"` : "No teams in settings — nothing to fetch.");
    // Not a failure: a board with no teams is a valid board.
    return;
  }
  if (!dryRun) mkdirSync("data/cache", { recursive: true });

  // A team removed from settings leaves its snapshot behind; clear it so the
  // layer really goes.
  if (!only && !dryRun && existsSync("data/cache")) {
    const keep = new Set(teams.map((t) => cachePath(t.id)));
    for (const name of readdirSync("data/cache")) {
      const path = `data/cache/${name}`;
      if (name.startsWith("upstream-") && !keep.has(path)) {
        unlinkSync(path);
        delete manifest.upstreams[name.replace(/^upstream-|\.json$/g, "")];
        console.log(`removed ${path} (no longer in settings)`);
      }
    }
  }

  let failures = 0;

  for (const team of targets) {
    console.log(`${team.id} (${team.name})`);
    const previousEntry = manifest.upstreams[team.id];
    try {
      const { events: fresh, status, url } = await fetchTeam(team);
      const reconciled = reconcile(loadPrevious(team.id), fresh);
      EventFileSchema.parse(reconciled);
      if (!dryRun) {
        writeFileSync(cachePath(team.id), JSON.stringify(reconciled, null, 2) + "\n");
      }
      manifest.upstreams[team.id] = {
        fetchedAt: nowIso(),
        ok: true,
        status,
        count: reconciled.length,
        previousCount: previousEntry?.count ?? null,
        consecutiveFailures: 0,
        error: null,
        urlUsed: url,
      };
      console.log(`  ok — ${reconciled.length} events in window` + (previousEntry ? ` (was ${previousEntry.count})` : ""));
    } catch (err) {
      failures++;
      const kept = loadPrevious(team.id);
      manifest.upstreams[team.id] = {
        fetchedAt: previousEntry?.fetchedAt ?? null,
        ok: false,
        status: null,
        count: kept.length,
        previousCount: previousEntry?.count ?? null,
        consecutiveFailures: (previousEntry?.consecutiveFailures ?? 0) + 1,
        error: (err as Error).message,
        urlUsed: null,
      };
      console.warn(`  failed: ${(err as Error).message} — KEPT previous snapshot (${kept.length} events)`);
    }
  }

  manifest.updatedAt = nowIso();
  if (!dryRun) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  if (failures === targets.length) {
    console.error(`\nEvery team failed (${failures}/${targets.length}).`);
    process.exit(1);
  }
  if (failures) console.warn(`\n${failures} of ${targets.length} teams failed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
