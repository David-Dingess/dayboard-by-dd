import { z } from "zod";
import { parseIcs } from "./ical-parse";
import { loadSettings } from "./settings";
import { isHolidayCalendar, styleForHoliday } from "./holidays";
import { remember, stale } from "./memo";
import type { DayboardEvent, Layer } from "./schema";

/**
 * Calendars subscribed to by URL: iCloud, Google, Outlook, a work Exchange
 * feed, Partiful — anything that publishes an ICS feed.
 *
 * These are fetched at REQUEST time, not snapshotted like the sports feeds,
 * because they are the user's own diary and a week-old copy would be worse than
 * useless. Next's data cache keeps the last good response when a revalidation
 * fails, so a blip shows slightly stale events rather than an empty column.
 *
 * The URLs are credentials — anyone holding one can read that calendar — so
 * they live in data/settings.json, which is gitignored. validate.ts fails the
 * run if one leaks into a tracked file. Which titles to leave off the board
 * travels with each calendar as `hide`: a list of case-insensitive regexes.
 */

/** Distinct from the layer palette in layers.json, and readable on #101216. */
const PALETTE = ["#7fb2e5", "#d9a25f", "#8fc99a", "#c58fd4", "#e08a8a", "#5fc4c0"];

export interface SubscribedCalendar {
  /** layer id, e.g. "sub-personal" */
  id: string;
  label: string;
  color: string;
  url: string;
  /** Titles to leave off the board, as regex sources. */
  hide: string[];
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function getSubscribedCalendars(): SubscribedCalendar[] {
  const out: SubscribedCalendar[] = [];
  const seen = new Set<string>();
  for (const entry of loadSettings().calendars) {
    const url = entry.url.trim();
    if (!entry.label || !/^(https?|webcal):\/\//i.test(url)) continue;
    let id = `sub-${slug(entry.label)}`;
    // Two calendars sharing a label would otherwise collide into one colour and
    // one filter row.
    let n = 2;
    while (seen.has(id)) id = `sub-${slug(entry.label)}-${n++}`;
    seen.add(id);
    out.push({
      id,
      label: entry.label,
      color: entry.color ?? PALETTE[out.length % PALETTE.length],
      // webcal:// is just https:// with a scheme that makes calendar apps
      // subscribe rather than download. fetch() needs the real one.
      url: url.replace(/^webcal:\/\//i, "https://"),
      hide: entry.hide,
    });
  }
  return out;
}

/** A synthesized layer so these render like any other, without editing layers.json. */
export function subscribedLayer(calendar: SubscribedCalendar): Layer {
  return {
    id: calendar.id,
    name: calendar.label,
    color: calendar.color,
    emoji: "📅",
    order: 500,
    // A subscribed calendar is a diary, not a fixture list — nothing
    // in it should pull the Watch panel forward.
    fixture: false,
    inFeed: false,
    showByDefault: true,
    defaultAlarmMinutes: null,
    defaultAlarmMinutesAllDay: null,
  };
}

/**
 * Kept in memo.ts rather than Next's data cache, which refuses entries over 2MB:
 * the work Exchange feed is ~2.1MB, and would have been re-downloaded on every
 * 30s tick with no stale copy to fall back on.
 *
 * And served stale-while-revalidate, because Outlook takes ~20 seconds to send
 * that feed (measured 2026-09-13; the iCloud and Google ones take under 400ms).
 * Awaiting it would stall the whole board for twenty seconds every TTL. A render
 * waits WAIT_MS for a refresh and otherwise shows the last good copy while the
 * fetch finishes on its own.
 */
const TTL_MS = 15 * 60_000;
const RETRY_MS = 2 * 60_000;
const WAIT_MS = 2_000;
const TIMEOUT_MS = 60_000;

/** When each feed last loaded — or, after a failure, when it is next allowed to try. */
const loadedAt = new Map<string, number>();
const inflight = new Map<string, Promise<DayboardEvent[]>>();

function refresh(calendar: SubscribedCalendar, key: string): Promise<DayboardEvent[]> {
  let pending = inflight.get(key);
  if (pending) return pending;
  pending = loadOne(calendar)
    .then((events) => {
      remember(key, events);
      loadedAt.set(key, Date.now());
      return events;
    })
    .catch((err: unknown) => {
      // Back off rather than retrying on every tick; keep whatever copy we had.
      loadedAt.set(key, Date.now() - TTL_MS + RETRY_MS);
      throw err;
    })
    .finally(() => inflight.delete(key));
  // A refresh nobody waited for still settles somewhere.
  pending.catch(() => {});
  inflight.set(key, pending);
  return pending;
}

async function fetchOne(calendar: SubscribedCalendar): Promise<DayboardEvent[]> {
  const key = `subscribed:${calendar.id}`;
  const cached = stale<DayboardEvent[]>(key);
  if (Date.now() - (loadedAt.get(key) ?? 0) < TTL_MS) return cached ?? [];

  // One slow or unreachable calendar must never empty or stall the board.
  const fallback = new Promise<DayboardEvent[]>((resolve) =>
    setTimeout(() => resolve(cached ?? []), WAIT_MS),
  );
  return Promise.race([refresh(calendar, key), fallback]).catch(() => cached ?? []);
}

async function loadOne(calendar: SubscribedCalendar): Promise<DayboardEvent[]> {
  const res = await fetch(calendar.url, {
    cache: "no-store",
    headers: { "user-agent": "Dayboard/1.0 (personal dashboard)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${calendar.label}: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error(`${calendar.label}: not an ICS feed`);

  const events = parseIcs(text, {
    layer: calendar.id,
    window: { pastDays: 30, futureDays: 400 },
    sourceKind: "passthrough",
    sourceRef: calendar.label,
    // Alarms belong to the calendar that owns the event; Dayboard is a
    // viewer here and must not double-notify.
    alarmMinutes: null,
    forceAllDayIfMidnight: false,
  });

  // A holiday feed is one calendar carrying thirty different occasions, so
  // each event gets its own face and colour rather than a shared grey.
  if (!isHolidayCalendar(calendar.label)) return events;
  return events.map((event) => ({ ...event, ...styleForHoliday(event.title) }));
}

/**
 * Per calendar, keyed by its label, titles to leave off the board. Each is a
 * case-insensitive regex tested against the whole trimmed title.
 *
 * A work calendar tends to carry standing holds (breakfast, lunch, "email
 * catch-up") that block the day in Outlook but are not what anyone does with
 * it; anchored rules keep those off while "Lunch w/ a candidate" stays.
 */
export const SubscribedConfigSchema = z.object({
  calendars: z
    .record(z.string(), z.object({ hide: z.array(z.string()).default([]) }))
    .default({}),
});

/** Hide rules for each calendar, by lower-cased label. A bad pattern is skipped, not fatal. */
export function hideRules(raw: unknown): Map<string, RegExp[]> {
  const rules = new Map<string, RegExp[]>();
  const parsed = SubscribedConfigSchema.parse(raw);
  for (const [label, { hide }] of Object.entries(parsed.calendars)) {
    const compiled: RegExp[] = [];
    for (const pattern of hide) {
      try {
        compiled.push(new RegExp(pattern, "i"));
      } catch {
        console.error(`dayboard: calendar hide rule "${pattern}" under ${label} is not a valid regex`);
      }
    }
    rules.set(label.toLowerCase(), compiled);
  }
  return rules;
}

export function isHidden(title: string, rules: RegExp[] | undefined): boolean {
  const t = title.trim();
  return !!rules?.some((rule) => rule.test(t));
}

function loadHideRules(calendars: SubscribedCalendar[]): Map<string, RegExp[]> {
  return hideRules({
    calendars: Object.fromEntries(calendars.map((c) => [c.label, { hide: c.hide }])),
  });
}

export async function getSubscribedEvents(): Promise<{
  events: DayboardEvent[];
  layers: Layer[];
}> {
  const calendars = getSubscribedCalendars();
  if (!calendars.length) return { events: [], layers: [] };

  const results = await Promise.all(calendars.map(fetchOne));
  // Filtered here rather than before caching, so an edit to the hide list
  // reaches the board on the next tick instead of the next feed refresh.
  const rules = loadHideRules(calendars);
  return {
    events: results.flatMap((events, i) => {
      const own = rules.get(calendars[i].label.toLowerCase());
      return own?.length ? events.filter((e) => !isHidden(e.title, own)) : events;
    }),
    layers: calendars.map(subscribedLayer),
  };
}
