import { healthId } from "../src/lib/uid";
import { todayLocal } from "../src/lib/time";
import {
  applyAttachVideo,
  applyClearDay,
  applyDeleteWalk,
  applyDetachVideo,
  applyFeedback,
  applyLogChair,
  applyLogWalk,
  applyRecordDay,
  applyRestart,
  applySettings,
  buildSnapshot,
  chairOn,
  contextOf,
  loadHealth,
  loadHealthVideos,
  saveHealth,
  saveHealthVideos,
  validVideoKey,
  videoKeyLabel,
  videoKeysFor,
} from "../src/lib/health-store";
import { healthEvents } from "../src/lib/health-events";
import { parseWatchUrl } from "../src/lib/embed";
import {
  chairRoutine,
  formatTime,
  getMinimumDose,
  getSessionForDate,
  type DayRecord,
  type ExerciseResult,
  type Feedback,
} from "../src/lib/health";
import { HealthSettingsSchema, HealthVideoSchema, DATE_ONLY } from "../src/lib/schema";

/**
 * The exercise program from a terminal or a chat session.
 *
 *   npm run health -- status
 *   npm run health -- log-walk 30 [--indoors]
 *   npm run health -- chair | chair log [--minutes 5]
 *   npm run health -- record [--minimum] [--minutes 18]
 *   npm run health -- feedback too_easy [2026-09-07]
 *   npm run health -- clear 2026-09-07
 *   npm run health -- settings walk=11:45 strength=16:30 quiet=23:00-07:00 paused=false
 *   npm run health -- settings eye=20/20 eye-quiet=23:00-07:00   (eye-quiet=off is the default)
 *   npm run health -- nudge list | nudge add vitamins 09:00 "Vitamins" | nudge remove vitamins
 *   npm run health -- restart [2026-09-07]
 *   npm run health -- video add strength <url> | video remove strength <id> | video list
 *
 * This and the buttons in the Health tab are the same code: both call the pure
 * `apply*` functions in src/lib/health-store.ts and the same atomic save. NEVER
 * hand-edit data/health.json — a shape the schema rejects shows up as a board
 * that has quietly forgotten the program, because loadHealth logs and falls back
 * to an empty file rather than taking everything down. The undo for anything
 * here is `git checkout data/health.json`.
 */

const argv = process.argv.slice(2);
const command = argv[0];
const rest = argv.slice(1);

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const flag = (name: string) => rest.includes(`--${name}`);
function option(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
const positional = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));

const file = loadHealth();
const today = todayLocal();
const now = new Date();

if (command === "status") {
  const snapshot = buildSnapshot(file, today, loadHealthVideos());
  const s = snapshot.session;
  console.log(`${snapshot.dayLabel} — week ${snapshot.weekNumber} of 52, phase ${snapshot.phase.index} ${snapshot.phase.name}${s.isDeload ? " (deload)" : ""}`);
  console.log(`  today      ${s.title} · ${s.subtitle}${s.kind === "rest" ? "" : ` · about ${s.estMinutes} min`}`);
  console.log(`  done       ${snapshot.done ? "yes" : "not yet"}`);
  console.log(`  streak     ${snapshot.streak.current}${snapshot.streak.forgivenGap ? " (one day forgiven)" : ""}`);
  console.log(`  last 7d    ${snapshot.trailingMinutes} min`);
  console.log(
    `  chair five ${snapshot.chair.doneToday} today · ${
      snapshot.chair.slots.map((slot) => `${formatTime(slot.time)}${slot.done ? " ✓" : ""}`).join(", ") || "no nudges"
    } · next adds ${snapshot.chair.nextExtra}`,
  );
  console.log(
    `  adherence  ${snapshot.adherence.scheduled === 0 ? "—" : `${snapshot.adherence.pct}% (${snapshot.adherence.done} of ${snapshot.adherence.scheduled})`}`,
  );
  const nudges = file.settings.slots
    .map((slot) => `${slot.id} ${formatTime(slot.time)}${slot.enabled ? "" : " (off)"}`)
    .join(", ");
  console.log(`  nudges     ${nudges}`);
  console.log(
    `  eye breaks ${
      file.settings.eyeBreaks.enabled
        ? `every ${file.settings.eyeBreaks.everyMinutes} min for ${file.settings.eyeBreaks.forSeconds}s${
            file.settings.eyeBreaks.quietHours
              ? `, quiet ${file.settings.eyeBreaks.quietHours.start}-${file.settings.eyeBreaks.quietHours.end}`
              : ""
          }`
        : "off"
    }`,
  );
  if (file.settings.paused) console.log("  PAUSED — no nudges, and nothing on the calendar.");
  const upcoming = healthEvents(file, today).filter((e) => e.start.slice(0, 10) >= today).slice(0, 5);
  if (upcoming.length) {
    console.log("\n  on the calendar:");
    for (const event of upcoming) {
      console.log(`    ${event.start.slice(0, 16).replace("T", " ")}  ${event.title}`);
    }
  }
  console.log(`\n${Object.keys(file.days).length} session(s), ${file.walks.length} walk(s) logged`);
} else if (command === "log-walk") {
  const minutes = Number(positional[0] ?? die("Usage: npm run health -- log-walk 30 [--indoors]"));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) die("Minutes must be 1–600.");
  const walk = {
    id: healthId("walk", now),
    date: today,
    loggedAt: now.toISOString(),
    durationMin: minutes,
    source: "manual" as const,
    outdoors: !flag("indoors"),
  };
  saveHealth(applyLogWalk(file, walk));
  console.log(`logged ${minutes} min walk${walk.outdoors ? " outdoors" : ""} (${walk.id})`);
} else if (command === "chair") {
  const entries = chairOn(file, today);
  if (positional[0] === "log") {
    const minutes = Number(option("minutes") ?? 5);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30) die("Minutes must be 1–30.");
    const routine = chairRoutine(entries.length);
    saveHealth(
      applyLogChair(file, {
        id: healthId("chair", now),
        date: today,
        completedAt: now.toISOString(),
        routineId: routine.id,
        durationSec: Math.round(minutes * 60),
        skipped: [],
      }),
    );
    console.log(`logged chair five (${routine.extraName}), ${entries.length + 1} today`);
  } else if (positional[0] === undefined) {
    const snapshot = buildSnapshot(file, today);
    console.log(`chair five — ${entries.length} today, the next one adds ${snapshot.chair.nextExtra}`);
    for (const slot of snapshot.chair.slots) {
      console.log(`  ${formatTime(slot.time).padEnd(9)} ${slot.done ? "done" : slot.enabled ? "—" : "off"}`);
    }
    for (const entry of entries) {
      console.log(`  logged ${entry.completedAt}  ${entry.routineId}  ${Math.round(entry.durationSec / 60)} min`);
    }
  } else {
    die("Usage: npm run health -- chair [log [--minutes 5]]");
  }
} else if (command === "delete-walk") {
  const id = positional[0] ?? die("Usage: npm run health -- delete-walk <id>");
  if (!file.walks.some((w) => w.id === id)) die(`No walk with id "${id}".`);
  saveHealth(applyDeleteWalk(file, id));
  console.log(`removed ${id}`);
} else if (command === "record") {
  // Everything done, nothing skipped — the shape a finished session takes when
  // it was not driven from the board's own player.
  const ctx = contextOf(file);
  const session = flag("minimum") ? getMinimumDose(today, ctx) : getSessionForDate(ctx, today);
  if (session.kind === "rest") die("Today is a rest day. Add --minimum to log the five-minute floor.");
  if (session.kind === "walk") die("Today is a walk — use log-walk instead.");

  const exercises: ExerciseResult[] = [];
  for (const block of session.blocks) {
    if (block.kind === "warmup" || block.kind === "cooldown") continue;
    for (const station of block.stations) {
      exercises.push({
        exerciseId: station.exerciseId,
        patternId: station.patternId,
        rungIndex: station.rungIndex,
        roundsCompleted: block.rounds,
        skipped: false,
      });
    }
  }

  const minutes = Number(option("minutes") ?? session.estMinutes);
  const record: DayRecord = {
    date: today,
    sessionId: session.id,
    kind: flag("minimum") ? "minimum" : (session.kind as DayRecord["kind"]),
    status: "completed",
    completedAt: now.toISOString(),
    durationSec: Math.max(60, Math.round(minutes * 60)),
    exercises,
  };
  const next = applyRecordDay(file, record);
  saveHealth(next);
  const moved = next.adjustments.slice(file.adjustments.length);
  console.log(`logged ${session.title} (${minutes} min)`);
  for (const a of moved) console.log(`  ${a.patternId}: rung ${a.fromRung} → ${a.toRung} (${a.reason})`);
} else if (command === "feedback") {
  const signal = positional[0] as Feedback;
  if (!["too_easy", "just_right", "too_hard"].includes(signal)) {
    die("Usage: npm run health -- feedback <too_easy|just_right|too_hard> [date]");
  }
  const date = positional[1] ?? today;
  if (!DATE_ONLY.test(date)) die(`"${date}" is not a YYYY-MM-DD date.`);
  if (!file.days[date]) die(`Nothing logged on ${date} to give feedback about.`);
  const next = applyFeedback(file, date, signal);
  saveHealth(next);
  const moved = next.adjustments.slice(file.adjustments.length);
  console.log(`${signal} on ${date}`);
  for (const a of moved) console.log(`  ${a.patternId}: rung ${a.fromRung} → ${a.toRung}`);
} else if (command === "clear") {
  const date = positional[0] ?? die("Usage: npm run health -- clear <date>");
  if (!file.days[date]) die(`Nothing logged on ${date}.`);
  saveHealth(applyClearDay(file, date));
  console.log(`cleared ${date}`);
} else if (command === "settings") {
  if (!positional.length) die('Usage: npm run health -- settings walk=11:45 quiet=23:00-07:00 paused=false');
  let settings = { ...file.settings };

  for (const pair of positional) {
    const [key, value] = pair.split("=");
    if (!value) die(`"${pair}" should look like key=value.`);

    if (settings.slots.some((slot) => slot.id === key)) {
      settings = {
        ...settings,
        slots: settings.slots.map((slot) =>
          slot.id === key
            ? value === "off" || value === "on"
              ? { ...slot, enabled: value === "on" }
              : { ...slot, time: value }
            : slot,
        ),
      };
    } else if (key === "quiet") {
      const [start, end] = value.split("-");
      settings = { ...settings, quietHours: { start, end } };
    } else if (key === "paused" || key === "sound") {
      const on = value === "true" || value === "on";
      settings = key === "paused" ? { ...settings, paused: on } : { ...settings, soundEnabled: on };
    } else if (key === "eye") {
      // "20/20" — every 20 minutes, for 20 seconds. "off" switches them off.
      if (value === "off") settings = { ...settings, eyeBreaks: { ...settings.eyeBreaks, enabled: false } };
      else {
        const [every, forSec] = value.split("/").map(Number);
        settings = {
          ...settings,
          eyeBreaks: {
            ...settings.eyeBreaks,
            enabled: true,
            everyMinutes: every,
            forSeconds: forSec ?? settings.eyeBreaks.forSeconds,
          },
        };
      }
    } else if (key === "eye-quiet") {
      // Its OWN hours, not the nudge ones. "off" is the default and the usual
      // answer — see the schema.
      const quietHours =
        value === "off" || value === "none"
          ? null
          : (() => {
              const [start, end] = value.split("-");
              return { start, end };
            })();
      settings = { ...settings, eyeBreaks: { ...settings.eyeBreaks, quietHours } };
    } else if (key === "grace") {
      settings = { ...settings, graceMinutes: Number(value) };
    } else {
      die(`Don't know a setting called "${key}".`);
    }
  }

  const parsed = HealthSettingsSchema.safeParse(settings);
  if (!parsed.success) die(`That isn't a valid setting: ${parsed.error.issues[0].message}`);
  saveHealth(applySettings(file, parsed.data));
  const nudges = parsed.data.slots.map((s) => `${s.id} ${s.time}${s.enabled ? "" : " (off)"}`).join(", ");
  console.log(`nudges: ${nudges}`);
  console.log(`quiet ${parsed.data.quietHours.start}–${parsed.data.quietHours.end} · paused ${parsed.data.paused} · sound ${parsed.data.soundEnabled}`);
  console.log(
    `eye breaks ${parsed.data.eyeBreaks.enabled ? `every ${parsed.data.eyeBreaks.everyMinutes}m for ${parsed.data.eyeBreaks.forSeconds}s` : "off"}`,
  );
} else if (command === "nudge") {
  // add | remove | list — the slots themselves, as against `settings`, which
  // only moves the times of the ones that already exist.
  const sub = positional[0] ?? "list";
  const slots = file.settings.slots;

  if (sub === "list") {
    // By time, not by the order they happen to sit in the file: the list is
    // meant to read as a day.
    for (const slot of [...slots].sort((a, b) => a.time.localeCompare(b.time))) {
      console.log(
        `  ${slot.id.padEnd(12)} ${formatTime(slot.time).padEnd(9)} ${slot.kind.padEnd(10)} ${
          slot.enabled ? "on " : "off"
        }  ${slot.label}`,
      );
    }
    console.log(`
  kinds: walk / strength / last_call fire only on a day the`);
    console.log(`  programme calls for them and are answered by logging the work.`);
    console.log(`  reminder fires every day and is answered only by dismissing it.`);
    console.log(`  chair fires every day and is answered by a chair routine in the hour before.`);
  } else if (sub === "add") {
    const id = positional[1] ?? die("Usage: npm run health -- nudge add <id> <HH:mm> \"Label\" [kind]");
    const time = positional[2] ?? die("A time, as HH:mm.");
    const label = positional[3] ?? id;
    const kind = (positional[4] ?? "reminder") as (typeof slots)[number]["kind"];
    if (slots.some((s) => s.id === id)) die(`There is already a nudge called "${id}".`);
    if (slots.length >= 24) die("Twenty-four nudges is the limit; remove one first.");
    saveHealth(applySettings(file, { slots: [...slots, { id, time, label, kind, enabled: true }] }));
    console.log(`added ${id} at ${formatTime(time)} (${kind})`);
  } else if (sub === "remove") {
    const id = positional[1] ?? die("Usage: npm run health -- nudge remove <id>");
    if (!slots.some((s) => s.id === id)) die(`No nudge called "${id}".`);
    saveHealth(applySettings(file, { slots: slots.filter((s) => s.id !== id) }));
    console.log(`removed ${id}`);
  } else {
    die("Usage: npm run health -- nudge [list | add <id> <HH:mm> \"Label\" [kind] | remove <id>]");
  }
} else if (command === "restart") {
  const date = positional[0] ?? today;
  if (!DATE_ONLY.test(date)) die(`"${date}" is not a YYYY-MM-DD date.`);
  saveHealth(applyRestart(file, date));
  console.log(`restarted at week 1 on ${date}. Sessions and walks already logged were kept.`);
} else if (command === "video") {
  const action = positional[0];
  const videos = loadHealthVideos();

  if (action === "list") {
    const keys = Object.keys(videos.videos).sort();
    if (!keys.length) console.log("No follow-along videos attached yet.");
    for (const key of keys) {
      console.log(`${videoKeyLabel(key)} (${key})`);
      for (const v of videos.videos[key]) console.log(`  ${v.id}  ${v.title}`);
    }
    const ctx = contextOf(file);
    console.log(`\ntoday can show: ${videoKeysFor(getSessionForDate(ctx, today)).join(", ")}`);
  } else if (action === "add") {
    const key = positional[1] ?? die("Usage: npm run health -- video add <key> <url>");
    const url = positional[2] ?? die("Usage: npm run health -- video add <key> <url>");
    if (!validVideoKey(key)) die(`"${key}" is not a session kind, warmup/cooldown, or an exercise id.`);
    const parsed = parseWatchUrl(url);
    if (!parsed || parsed.kind !== "youtube") die("Only a YouTube link can play on the board.");
    const video = HealthVideoSchema.parse({ id: parsed.key, title: option("title") ?? `Video ${parsed.key}`, addedAt: today });
    saveHealthVideos(applyAttachVideo(videos, key, video));
    console.log(`attached ${video.id} to ${videoKeyLabel(key)}`);
    if (!option("title")) console.log("  (no --title given; the board's paste box fills it in from YouTube)");
  } else if (action === "remove") {
    const key = positional[1] ?? die("Usage: npm run health -- video remove <key> <id>");
    const id = positional[2] ?? die("Usage: npm run health -- video remove <key> <id>");
    if (!videos.videos[key]?.some((v) => v.id === id)) die(`No video ${id} under "${key}".`);
    saveHealthVideos(applyDetachVideo(videos, key, id));
    console.log(`removed ${id} from ${videoKeyLabel(key)}`);
  } else {
    die("Usage: npm run health -- video <list|add|remove> …");
  }
} else {
  die(
    "Usage: npm run health -- <status|log-walk|chair|delete-walk|record|feedback|clear|settings|nudge|restart|video> …",
  );
}
