import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { getSubscribedEvents } from "./subscribed";
import { healthEvents } from "./health-events";
import { expandAll } from "./recur";
import { loadHealth } from "./health-store";
import { loadSettings, SETTINGS_FILE } from "./settings";
import { birthdayEvents } from "./birthdays";
import { todayLocal } from "./time";
import {
  EventFileSchema,
  LayersFileSchema,
  type DayboardEvent,
  type Layer,
} from "./schema";

/**
 * Loading the calendar. Every curated layer and every cached upstream snapshot
 * is a JSON file in the repo, so this is a synchronous read of files that ship
 * with the deployment — no database, no request-time network call.
 */

const DATA = path.join(process.cwd(), "data");

/**
 * A fingerprint of the files behind a cache: how many, the newest mtime, and
 * their total size.
 *
 * WHY A STAMP RATHER THAN A PLAIN `if (cache)`. Both caches below used to hold
 * for the life of the process, which was right when the process was a a remote host
 * lambda — the files ship with the deployment, so a new one is the only way they
 * change. The board now runs from a scheduled task that stays up for weeks
 * (scripts/setup.ps1), and `npm run refresh` rewrites
 * `data/cache/*.json` underneath it. A permanent cache there is not a cache
 * going stale; it is the refresh routine quietly not reaching the screen.
 *
 * A stat is not a read, so this stays cheap enough to run per render, and it
 * moves when a file is added or removed as well as edited — which is what a
 * refresh dropping in a new upstream actually does.
 */
function stampOf(files: string[]): string {
  let newest = 0;
  let bytes = 0;
  for (const file of files) {
    try {
      const stat = statSync(file);
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      bytes += stat.size;
    } catch {
      // Vanished between the listing and the stat. That is itself a change, and
      // the file count in the stamp has already recorded it.
    }
  }
  return `${files.length}:${newest}:${bytes}`;
}

let layerCache: Layer[] | null = null;
let layerStamp = "";

/**
 * The layers: the three built in (health, birthdays, personal) from
 * data/config/layers.json, plus one per team in settings. A team's layer is
 * `team-<id>`, carries its colour and crest, and is a fixture layer — which is
 * what makes the Sports tab, the live scores and the Stream Deck's Sports
 * folder pick it up without a line of any of them changing.
 */
export function getLayers(): Layer[] {
  const file = path.join(DATA, "config/layers.json");
  const stamp = stampOf([file, SETTINGS_FILE]);
  if (layerCache && stamp === layerStamp) return layerCache;
  const teams = loadSettings().sports.teams.map((team, i): Layer => ({
    id: `team-${team.id}`,
    name: team.name,
    color: team.color,
    logo: team.logo || undefined,
    emoji: team.logo ? undefined : "🏟️",
    order: 10 + i,
    inFeed: true,
    showByDefault: true,
    fixture: true,
    defaultAlarmMinutes: 60,
    defaultAlarmMinutesAllDay: -540,
  }));
  layerCache = [
    ...teams,
    ...LayersFileSchema.parse(JSON.parse(readFileSync(file, "utf8"))),
  ].sort((a, b) => a.order - b.order);
  layerStamp = stamp;
  return layerCache;
}

export function getLayer(id: string): Layer | undefined {
  return getLayers().find((l) => l.id === id);
}

function readEvents(file: string): DayboardEvent[] {
  try {
    return EventFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    console.error(`dayboard: skipping ${file} — ${(err as Error).message.split("\n")[0]}`);
    return [];
  }
}

/** The layer's configured alarm, unless the event asked for something specific. */
function withDefaults(event: DayboardEvent, layers: Map<string, Layer>): DayboardEvent {
  if (event.alarm !== undefined && event.alarm !== null) return event;
  const layer = layers.get(event.layer);
  if (!layer) return event;
  const minutes = event.allDay ? layer.defaultAlarmMinutesAllDay : layer.defaultAlarmMinutes;
  if (minutes === null || minutes === undefined) return event;
  return { ...event, alarm: { minutesBefore: minutes } };
}

/**
 * THE CACHE COVERS data/cache/ AND NOTHING ELSE, and that line is load-bearing.
 *
 * It stopped being right for data/layers/ the moment the board could write one.
 * A Server Action adds an event, calls revalidatePath("/"), the page re-renders
 * — and reads the array from before the write, so the new event appears only
 * after a restart. That is not a cache going stale; that is a feature that does
 * not work. loadHealthEvents already had to route around this.
 *
 * Four small files re-read per render is the price, and it is the same price
 * loadTodos and loadHealth already pay for the same reason.
 *
 * THE UPSTREAM SNAPSHOTS ARE CACHED, BUT NO LONGER FOREVER. The old argument
 * was that they ship with the deployment and cannot change without a new one, so
 * a cold lambda pays for the read and every request after it is free. That
 * premise died with the move to a long-lived local server: `npm run refresh`
 * rewrites these files in place while the process keeps running, and a permanent
 * cache would freeze the fixtures at whatever they were when the task last
 * started. `stampOf` keeps the cheap path and drops the lie.
 */
let upstreamCache: DayboardEvent[] | null = null;
let upstreamStamp = "";

function eventFilesIn(dir: string, skip: (name: string) => boolean = () => false): string[] {
  const full = path.join(DATA, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => name.endsWith(".json") && !skip(name))
    .map((name) => path.join(full, name));
}

/**
 * Everything that lives in the repo: hand-curated layers plus the cached
 * upstream snapshots. This is what dayboard.ics is built from.
 *
 * Repeating events are NOT expanded here — this is the stored truth, one row per
 * series, which is what the ICS writer wants and what the editor edits. The
 * board's own copy comes from loadAllEvents, which expands.
 */
export function loadCuratedEvents(): DayboardEvent[] {
  const layers = new Map(getLayers().map((l) => [l.id, l]));

  const snapshots = eventFilesIn("cache", (n) => n === "manifest.json");
  const stamp = stampOf(snapshots);
  if (!upstreamCache || stamp !== upstreamStamp) {
    const cached: DayboardEvent[] = [];
    for (const file of snapshots) {
      cached.push(...readEvents(file));
    }
    upstreamCache = cached;
    upstreamStamp = stamp;
  }

  const seen = new Set<string>();
  const events: DayboardEvent[] = [];
  // Generated from settings on every read, like the health sessions below.
  const birthdays = birthdayEvents(loadSettings().birthdays, Number(todayLocal().slice(0, 4)));
  // Layer files first, so a hand-curated event still wins an id collision with
  // a snapshot — the order the single loop used to give for free.
  for (const event of [...eventFilesIn("layers").flatMap(readEvents), ...birthdays, ...upstreamCache]) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(withDefaults(event, layers));
  }
  return events;
}

export function layersInFeed(): Layer[] {
  return getLayers().filter((l) => l.inFeed);
}

/**
 * The Health program's sessions, as events. Read fresh rather than through
 * `curatedCache`, because unlike every file that cache holds, `data/health.json`
 * is rewritten by the board itself — the day a nudge time moves or the program
 * restarts, a cached copy of these would be wrong until the process did. It is arithmetic over about 130 days, so the honest read is cheap.
 */
export function loadHealthEvents(): DayboardEvent[] {
  const layers = new Map(getLayers().map((l) => [l.id, l]));
  return healthEvents(loadHealth(), todayLocal()).map((event) => withDefaults(event, layers));
}

/**
 * Everything on the board: the repo's own events plus any calendars subscribed
 * to by URL. Async because the subscribed ones are fetched live — your own
 * calendar is the one thing a stale snapshot would be wrong about.
 *
 * The returned layers include the synthesized ones, so a caller can colour and
 * label a subscribed event without knowing where it came from.
 */
export async function loadAllEvents(): Promise<{
  events: DayboardEvent[];
  layers: Map<string, Layer>;
}> {
  const curated = [...loadCuratedEvents(), ...loadHealthEvents()];
  const { events: subscribed, layers: subscribedLayers } = await getSubscribedEvents();

  const layers = new Map(getLayers().map((l) => [l.id, l]));
  for (const layer of subscribedLayers) layers.set(layer.id, layer);

  // The catalogue always wins. Subscribe to a club's own calendar and every
  // match arrives twice — once from the team's schedule with its crest and
  // watch link, once as a plain entry on the personal calendar. Ids never
  // collide (one hangs off ESPN's event id, the other iCloud's UID), so the
  // match has to be on content: same moment, same title.
  const seenIds = new Set(curated.map((e) => e.id));
  const seenContent = new Set(curated.map(contentKey));
  const stored = [
    ...curated,
    ...subscribed.filter((e) => !seenIds.has(e.id) && !seenContent.has(contentKey(e))),
  ];

  // EXPANDED HERE AND NOWHERE ELSE. A repeating event is stored once — one row,
  // one rule — which is what the ICS writer wants and what the editor edits. The
  // board wants the occurrences, so this is where the arithmetic happens, after
  // the dedupe: two sources of one series should collide on the master, not on
  // four hundred instances of it.
  //
  // It is also what puts the birthdays on next year's wall: they carry a
  // yearly rule, and this is where it is read. Subscribed events arrive
  // expanded already — ical-parse does it — and carry no `recurrence`, so they
  // pass straight through.
  const events = expandAll(stored, todayLocal());

  return { events, layers };
}

/** Same instant and the same words: the duplicate test for two sources of one event. */
export function contentKey(event: DayboardEvent): string {
  const title = event.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
  // Minute precision: the two sources agree on the kickoff, not on the seconds.
  const when = event.allDay ? event.start : event.start.slice(0, 16);
  return `${when}|${title}`;
}
