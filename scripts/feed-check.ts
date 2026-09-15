import ICAL from "ical.js";
import { readFileSync, existsSync } from "node:fs";

/**
 * Read a built feed back the way a calendar client would, and say what's in it.
 * Run this after touching uid.ts or ics.ts: if an id moved, every subscriber
 * gets a duplicate rather than an update, and this is the cheapest way to see it.
 *
 *   npm run feed:check -- --url http://localhost:3000/feeds/<token>/dayboard.ics
 *   npm run feed:check -- --file some-feed.ics
 */

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function load(): Promise<string> {
  const url = flag("url");
  const file = flag("file");
  if (file) {
    if (!existsSync(file)) throw new Error(`No such file: ${file}`);
    return readFileSync(file, "utf8");
  }
  if (!url) {
    throw new Error("Pass --url <feed url> or --file <path>");
  }
  const res = await fetch(url, { headers: { accept: "text/calendar" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 120)}`);
  return text;
}

async function main() {
const text = await load();
if (!text.includes("BEGIN:VCALENDAR")) {
  console.error("Not an iCalendar body. First 200 chars:\n" + text.slice(0, 200));
  process.exit(1);
}

const root = new ICAL.Component(ICAL.parse(text));
const vevents = root.getAllSubcomponents("vevent");

const perLayer = new Map<string, number>();
let alarms = 0;
let allDay = 0;
let cancelled = 0;
let recurring = 0;
const ids = new Set<string>();
const duplicates: string[] = [];
let earliest: string | null = null;
let latest: string | null = null;

for (const ve of vevents) {
  const event = new ICAL.Event(ve);
  const category = String(ve.getFirstPropertyValue("categories") ?? "(none)");
  perLayer.set(category, (perLayer.get(category) ?? 0) + 1);

  const uid = event.uid;
  if (ids.has(uid)) duplicates.push(uid);
  ids.add(uid);

  if (ve.getAllSubcomponents("valarm").length) alarms++;
  if (event.startDate?.isDate) allDay++;
  if (String(ve.getFirstPropertyValue("status") ?? "") === "CANCELLED") cancelled++;
  if (ve.getFirstPropertyValue("rrule")) recurring++;

  const iso = event.startDate?.toJSDate().toISOString() ?? null;
  if (iso) {
    if (!earliest || iso < earliest) earliest = iso;
    if (!latest || iso > latest) latest = iso;
  }
}

console.log(`calendar: ${root.getFirstPropertyValue("x-wr-calname")}`);
console.log(`ttl:      ${root.getFirstPropertyValue("x-published-ttl") ?? "(none)"}`);
console.log(`events:   ${vevents.length}`);
console.log(`  all-day   ${allDay}`);
console.log(`  with alarm ${alarms}`);
console.log(`  recurring ${recurring}`);
console.log(`  cancelled ${cancelled}`);
console.log(`range:    ${earliest?.slice(0, 10)} .. ${latest?.slice(0, 10)}`);
console.log("by layer:");
for (const [layer, count] of [...perLayer.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${layer.padEnd(18)} ${count}`);
}

if (duplicates.length) {
  console.error(`\n${duplicates.length} DUPLICATE UID(s) — subscribers will see these twice:`);
  for (const uid of [...new Set(duplicates)].slice(0, 10)) console.error(`  ${uid}`);
  process.exit(1);
}
console.log("\nfeed:check: ok");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
