import { readFileSync, readdirSync, existsSync } from "node:fs";
import {
  EventFileSchema,
  LayersFileSchema,
  TodoFileSchema,
  HealthFileSchema,
  HealthVideosFileSchema,
  type DayboardEvent,
} from "../src/lib/schema";
import { validVideoKey } from "../src/lib/health-store";
import { getLayers } from "../src/lib/layers";
import { loadSettings } from "../src/lib/settings";

/**
 * The gate every script and the routine run before committing. It checks shape,
 * referential integrity, and — the one that matters most — that no private feed
 * URL has leaked out of the environment and into a tracked file.
 */

const problems: string[] = [];
const note = (msg: string) => problems.push(msg);

// ---- config -----------------------------------------------------------------
LayersFileSchema.parse(JSON.parse(readFileSync("data/config/layers.json", "utf8")));
// The built-in layers plus one per team in settings — the same list the board
// renders, so a cached snapshot for a removed team is caught here.
const layers = getLayers();
const layerIds = new Set(layers.map((l) => l.id));
if (layerIds.size !== layers.length) note("layers have duplicate ids (a team id collides with a built-in layer?)");

const settings = loadSettings();
for (const team of settings.sports.teams) {
  if (team.source.kind === "espn" && !team.source.teamId) note(`team "${team.id}" has no ESPN team id`);
}

// ---- events -----------------------------------------------------------------
const eventFiles = [
  ...readdirSync("data/layers").map((f) => `data/layers/${f}`),
  ...(existsSync("data/cache") ? readdirSync("data/cache") : [])
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => `data/cache/${f}`),
].filter((f) => f.endsWith(".json"));

const seenIds = new Map<string, string>();
let total = 0;
const perLayer = new Map<string, number>();

for (const file of eventFiles) {
  let events: DayboardEvent[];
  try {
    events = EventFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    note(`${file}: ${(err as Error).message.split("\n")[0]}`);
    continue;
  }

  for (const ev of events) {
    total++;
    perLayer.set(ev.layer, (perLayer.get(ev.layer) ?? 0) + 1);

    const previous = seenIds.get(ev.id);
    if (previous) note(`duplicate id "${ev.id}" in ${file} (already in ${previous})`);
    seenIds.set(ev.id, file);

    if (!layerIds.has(ev.layer)) note(`${file}: event "${ev.id}" has unknown layer "${ev.layer}"`);
    if (ev.source.kind === "passthrough" && ev.alarm) {
      note(`${file}: passthrough event "${ev.id}" must not carry an alarm`);
    }
    // A ticket page is not a watch link. A club's own feed can carry both, and
    // getting that wrong once would write it across a whole season.
    if (ev.watch && /ticket|seatgeek|stubhub/i.test(ev.watch.url)) {
      note(`${file}: event "${ev.id}" has a ticketing URL as its watch link`);
    }
  }
}

// ---- to-dos -----------------------------------------------------------------
// The one data file the BOARD writes, so it is the one most worth checking: a
// crashed save or a hand-edit would otherwise show up as a silently empty
// Planner (loadTodos logs and returns []) rather than as an error here.
if (existsSync("data/todos.json")) {
  try {
    const todos = TodoFileSchema.parse(JSON.parse(readFileSync("data/todos.json", "utf8")));
    const todoIds = new Set(todos.map((t) => t.id));
    if (todoIds.size !== todos.length) note("data/todos.json has duplicate to-do ids");
    console.log(`${todos.length} to-do(s)`);
  } catch (err) {
    note(`data/todos.json: ${(err as Error).message.split("\n")[0]}`);
  }
}

// ---- health -----------------------------------------------------------------
// The other two files the BOARD writes. health.json is a year of history and the
// program's own start date, so a shape the schema rejects is a silently reset
// program rather than an error — loadHealth falls back to an empty file. The
// video keys are checked against the engine because a typo there ("push-ups"
// for "push-full") produces a tile that can never be shown and no complaint.
if (existsSync("data/health.json")) {
  try {
    const health = HealthFileSchema.parse(JSON.parse(readFileSync("data/health.json", "utf8")));
    const walkIds = new Set(health.walks.map((w) => w.id));
    if (walkIds.size !== health.walks.length) note("data/health.json has duplicate walk ids");
    for (const [date, day] of Object.entries(health.days)) {
      if (day.date !== date) note(`data/health.json: day "${date}" carries the date "${day.date}"`);
    }
    console.log(
      `health: started ${health.settings.programStartDate}, ${Object.keys(health.days).length} session(s), ${health.walks.length} walk(s)`,
    );
  } catch (err) {
    note(`data/health.json: ${(err as Error).message.split("\n")[0]}`);
  }
}

if (existsSync("data/config/health-videos.json")) {
  try {
    const parsed = HealthVideosFileSchema.parse(
      JSON.parse(readFileSync("data/config/health-videos.json", "utf8")),
    );
    let count = 0;
    for (const [key, list] of Object.entries(parsed.videos)) {
      if (!validVideoKey(key)) {
        note(`data/config/health-videos.json: "${key}" is not a session kind or an exercise id`);
      }
      count += list.length;
    }
    console.log(`health videos: ${count} across ${Object.keys(parsed.videos).length} key(s)`);
  } catch (err) {
    note(`data/config/health-videos.json: ${(err as Error).message.split("\n")[0]}`);
  }
}

for (const calendar of settings.calendars) {
  for (const pattern of calendar.hide) {
    try {
      new RegExp(pattern, "i");
    } catch {
      note(`settings: calendar "${calendar.label}" hide rule "${pattern}" is not a valid regex`);
    }
  }
}

// ---- secret leak check ------------------------------------------------------
// Calendar URLs, bot tokens, app passwords and private keys are credentials.
// They belong in data/settings.json (gitignored) and must never reach a tracked
// file. This is also what keeps the public repo public: a maintainer can list
// their own details in .private-terms (gitignored, one regex per line, # for
// comments) and a stray copy of any of them fails the build. The list lives
// outside the repo because a list of what must not be published, published,
// is the leak.
const privateTerms: [RegExp, string][] = existsSync(".private-terms")
  ? readFileSync(".private-terms", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((term, i): [RegExp, string] => [new RegExp(term, "i"), `private term #${i + 1} from .private-terms`])
  : [];

const SECRET_PATTERNS: [RegExp, string][] = [
  [/calendar\.google\.com\/calendar\/ical\/[^/\s"]+\/private-[^/\s"]+/i, "Google secret iCal URL"],
  [/outlook\.(live|office)\.com\/owa\/calendar\/[^\s"]*\/calendar\.ics/i, "Outlook published calendar URL"],
  [/outlook\.(live|office)\.com\/owa\/calendar\/[0-9a-f]{16,}/i, "Outlook published calendar URL"],
  [/caldav\.icloud\.com\/published\//i, "published iCloud calendar URL"],
  [/webcal:\/\/[^\s"']+\.[a-z]{2,}\/[^\s"']+/i, "webcal subscription URL"],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, "private key"],
  [/\b[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}\b/, "Discord bot token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/facebook\.com\/[A-Za-z0-9.]+/i, "a Facebook profile URL"],
  ...privateTerms,
];

/** Where credentials are allowed to be: the settings file and the agents' own envs. */
const SECRET_HOMES = new Set(["data/settings.json", "scripts/validate.ts"]);

function scan(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (["node_modules", ".next", ".git", ".next-check", "bin", "obj", "dist", ".venv", "__pycache__"].includes(entry.name)) continue;
      scan(path);
      continue;
    }
    if (entry.name.startsWith(".env") || SECRET_HOMES.has(path)) continue;
    if (!/\.(json|ts|tsx|md|css|mjs|js|py|cs|ps1|cmd|toml|txt)$/.test(entry.name)) continue;
    const text = readFileSync(path, "utf8");
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(text)) note(`${path} contains what looks like ${label} — it does not belong in the repo`);
    }
  }
}
for (const dir of ["data", "src", "scripts", "docs", "agent", "deck", "public", "tests", "introduction"]) {
  if (existsSync(dir)) scan(dir);
}
for (const file of ["README.md", "CLAUDE.md", "AGENTS.md", ".env.example", "package.json"]) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(text)) note(`${file} contains what looks like ${label} — it does not belong in the repo`);
  }
}

// ---- report -----------------------------------------------------------------
const layerReport = [...perLayer.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([id, n]) => `  ${id.padEnd(16)} ${n}`)
  .join("\n");

console.log(`${total} events across ${perLayer.size} layers`);
console.log(layerReport);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nvalidate: ok");
