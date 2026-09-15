import { readFileSync } from "node:fs";
import {
  LayersFileSchema,
  RecurrenceSchema,
  type DayboardEvent,
  type Recurrence,
} from "../src/lib/schema";
import { curatedId } from "../src/lib/uid";
import { loadLayerFile, saveLayerFile } from "../src/lib/events-store";
import { parseFlexible, localDate, nowIso, zone } from "../src/lib/time";
import { notifyBoard } from "./notify-board";

/**
 * One event in, out or changed. This is what the "/dayboard" chat convention
 * drives, so that adding an event is never a hand-edit of JSON that might get
 * the id rule wrong — an id, once minted, must never move or the phone will
 * show a duplicate.
 *
 *   npm run event -- add --title "Dinner with Sam" --start "2026-10-04 19:30"
 *   npm run event -- edit --id personal:dinner-with-sam-2026-10-04 --start "2026-10-04 20:00"
 *   npm run event -- remove --id personal:dinner-with-sam-2026-10-04
 *
 * Repeating:
 *   --repeat weekly --on MO,WE [--every 2] [--until 2027-06-01] [--count 12]
 *
 * WRITES THROUGH src/lib/events-store.ts, which the editor in the Calendar tab
 * also uses. Two writers means the save has to be atomic — a render can now read
 * a layer file at any moment — and it means neither side can invent a shape the
 * other rejects.
 */

const argv = process.argv.slice(2);
const command = argv[0];

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return argv.includes(`--${name}`);
}
function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const layers = LayersFileSchema.parse(
  JSON.parse(readFileSync("data/config/layers.json", "utf8")),
);
const layerId = flag("layer") ?? "personal";
if (!layers.some((l) => l.id === layerId)) {
  die(`Unknown layer "${layerId}". Known: ${layers.map((l) => l.id).join(", ")}`);
}

const file = `data/layers/${layerId}.json`;
const events: DayboardEvent[] = loadLayerFile(layerId);

const save = (next: DayboardEvent[]) => saveLayerFile(layerId, next);

/**
 * `--repeat weekly --on MO,WE --every 2 --until 2027-06-01`, as a rule.
 *
 * Parsed through the schema rather than trusted, so a typo is refused here
 * rather than written into the calendar the phone subscribes to.
 */
function readRecurrence(): Recurrence | undefined {
  const repeat = flag("repeat");
  if (!repeat) return undefined;
  const parsed = RecurrenceSchema.safeParse({
    freq: repeat.toUpperCase(),
    interval: flag("every") ? Number(flag("every")) : 1,
    byDay: flag("on")
      ?.split(",")
      .map((d) => d.trim().toUpperCase()),
    until: flag("until"),
    count: flag("count") ? Number(flag("count")) : undefined,
  });
  if (!parsed.success) {
    die(`Bad --repeat: ${parsed.error.issues[0]?.message ?? "unrecognised"}`);
  }
  return parsed.data;
}

if (command === "add") {
  const title = flag("title") ?? die("--title is required");
  const startRaw = flag("start") ?? die("--start is required");
  const forceAllDay = has("all-day");

  const parsed = parseFlexible(startRaw);
  const allDay = forceAllDay || parsed.allDay;
  const start = allDay ? localDate(parsed.value) : parsed.value;

  const endRaw = flag("end");
  let end: string | undefined;
  if (endRaw) {
    const parsedEnd = parseFlexible(endRaw);
    end = allDay ? localDate(parsedEnd.value) : parsedEnd.value;
  }

  const id = curatedId(layerId, title, localDate(start));
  if (events.some((e) => e.id === id)) {
    die(`"${id}" already exists — use edit, or change the title/date.`);
  }

  const alarmRaw = flag("alarm");
  const event: DayboardEvent = {
    id,
    layer: layerId,
    title,
    start,
    end,
    allDay,
    tz: zone(),
    location: flag("location"),
    url: flag("url"),
    notes: flag("notes"),
    source: { kind: "curated", ref: "chat" },
    alarm: alarmRaw === undefined ? undefined : { minutesBefore: Number(alarmRaw) },
    recurrence: readRecurrence(),
    status: has("tentative") ? "tentative" : "confirmed",
    seq: 0,
    updatedAt: nowIso(),
  };

  save([...events, event]);
  console.log(`added ${id}\n  ${event.title} — ${event.start}${event.end ? ` to ${event.end}` : ""}`);
} else if (command === "edit") {
  const id = flag("id") ?? die("--id is required");
  const index = events.findIndex((e) => e.id === id);
  if (index < 0) die(`No event "${id}" in ${file}`);

  const current = events[index];
  const next: DayboardEvent = { ...current };

  if (flag("title")) next.title = flag("title")!;
  if (flag("start")) {
    const parsed = parseFlexible(flag("start")!);
    next.allDay = parsed.allDay || current.allDay;
    next.start = next.allDay ? localDate(parsed.value) : parsed.value;
  }
  if (flag("end")) {
    const parsed = parseFlexible(flag("end")!);
    next.end = next.allDay ? localDate(parsed.value) : parsed.value;
  }
  if (flag("location")) next.location = flag("location");
  if (flag("url")) next.url = flag("url");
  if (flag("notes")) next.notes = flag("notes");
  if (flag("alarm")) next.alarm = { minutesBefore: Number(flag("alarm")) };
  if (flag("status")) next.status = flag("status") as DayboardEvent["status"];
  if (flag("repeat")) next.recurrence = readRecurrence();
  if (has("no-repeat")) next.recurrence = undefined;

  // The id never changes, even when the title does — that is the whole point of
  // minting it once. SEQUENCE goes up so subscribed calendars apply the change.
  next.seq = current.seq + 1;
  next.updatedAt = nowIso();

  const copy = [...events];
  copy[index] = next;
  save(copy);
  console.log(`edited ${id} (seq ${current.seq} -> ${next.seq})`);
} else if (command === "remove") {
  const id = flag("id") ?? die("--id is required");
  if (!events.some((e) => e.id === id)) die(`No event "${id}" in ${file}`);
  save(events.filter((e) => e.id !== id));
  console.log(`removed ${id}`);
  console.log("note: subscribers keep a deleted event until their next refresh drops it.");
} else {
  die(
    [
      "usage:",
      '  npm run event -- add --title "..." --start "YYYY-MM-DD[ HH:mm]" [--end ...]',
      "        [--layer personal] [--all-day] [--alarm 60] [--location ...] [--url ...]",
      "        [--notes ...] [--tentative]",
      "        [--repeat daily|weekly|monthly|yearly] [--every N] [--on MO,WE]",
      "        [--until YYYY-MM-DD] [--count N]",
      "  npm run event -- edit --id <id> [--layer <layer>] [any field above]",
      "  npm run event -- remove --id <id> [--layer <layer>]",
    ].join("\n"),
  );
}

// Reached only by add/edit/remove — the usage branch above exits first. Tell the
// wall the calendar moved so it shows inside a tick rather than on the 30s poll.
notifyBoard();
