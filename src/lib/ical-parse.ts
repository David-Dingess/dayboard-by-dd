import ICAL from "ical.js";
import { DateTime } from "luxon";
import type { DayboardEvent } from "./schema";
import { titleDateId, upstreamId } from "./uid";
import { zone, isoInZone } from "./time";

export interface ParseOptions {
  layer: string;
  /** how the id is derived — see uid.ts */
  uidStrategy?: "upstream" | "title-date";
  window?: { pastDays: number; futureDays: number };
  tz?: string;
  alarmMinutes?: number | null;
  forceAllDayIfMidnight?: boolean;
  titleRewrite?: { pattern: string; replace: string }[];
  drop?: string[];
  sourceKind?: DayboardEvent["source"]["kind"];
  sourceRef?: string;
  /** the team this feed follows, used to render Home/Away instead of an address */
  team?: string;
  /** used when a feed names the club rather than the ground on home fixtures */
  homeVenue?: string;
  /** hard stop on runaway RRULEs (an UNTIL-less DAILY rule would otherwise never end) */
  maxOccurrencesPerEvent?: number;
}

const DEFAULT_WINDOW = { pastDays: 30, futureDays: 240 };

function registerTimezones(root: ICAL.Component): void {
  for (const vt of root.getAllSubcomponents("vtimezone")) {
    try {
      const tz = new ICAL.Timezone(vt);
      // register() is typed as (component) or (tzid, timezone); the two-argument
      // string form isn't in the .d.ts, so pass the timezone itself.
      if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz);
    } catch {
      // A malformed VTIMEZONE shouldn't cost us the whole feed; the event will
      // fall back to the calendar's own zone below.
    }
  }
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Venue fields in these feeds are full postal addresses — "Mercedes-Benz Stadium
 * 1 Stadium Drive, Some City, ST 00000, United States" — and at least one of them
 * is simply wrong (Providence Park listed at an address in Milton, GA). Only the
 * venue name is worth showing, so cut at the first comma and then at the street
 * number, keeping at least one word.
 */
export function venueName(location: string): string {
  const firstPart = collapse(location).split(",")[0] ?? "";
  const trimmed = firstPart.replace(/\s+\d+\s+\S.*$/, "").trim();
  return trimmed || firstPart;
}

/**
 * Every one of these feeds writes the fixture as "Home <separator> Away" —
 * "Orlando City SC vs Inter Miami CF", "Liverpool - Everton". So the
 * side your team is on tells us whether it's a home game, which is far more
 * useful on a calendar row than a street address.
 */
export function homeAway(title: string, team: string): "Home" | "Away" | null {
  const parts = title.split(/\s+(?:vs\.?|v|-|@|—)\s+/i);
  if (parts.length < 2) return null;
  const matches = (side: string) => side.toLowerCase().includes(team.toLowerCase());
  if (matches(parts[0])) return "Home";
  if (parts.slice(1).some(matches)) return "Away";
  return null;
}

/** "Home · Mercedes-Benz Stadium" */
export function fixtureLocation(
  title: string,
  location: string | undefined,
  team: string | undefined,
  homeVenue?: string,
): string | undefined {
  let venue = location ? venueName(location) : "";
  const side = team ? homeAway(title, team) : null;
  // Some feeds put the club's NAME in LOCATION for home matches ("Some Club
  // Hotspur"), which reads as a venue but isn't one.
  if (side === "Home" && homeVenue && (!venue || venue.toLowerCase() === team?.toLowerCase())) {
    venue = homeVenue;
  }
  if (side && venue) return `${side} · ${venue}`;
  if (side) return side;
  return venue || undefined;
}

function applyRewrites(title: string, rules: { pattern: string; replace: string }[]): string {
  let out = title;
  for (const rule of rules) {
    try {
      out = out.replace(new RegExp(rule.pattern), rule.replace);
    } catch {
      // an unparseable pattern in config shouldn't break ingestion
    }
  }
  return out.trim();
}

/** ICAL.Time -> our stored form. All-day values keep their date; timed ones get an offset. */
function toStored(t: ICAL.Time, tz: string): { value: string; allDay: boolean } {
  if (t.isDate) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return { value: `${t.year}-${pad(t.month)}-${pad(t.day)}`, allDay: true };
  }
  return { value: isoInZone(t.toJSDate(), tz), allDay: false };
}

export function parseIcs(text: string, options: ParseOptions): DayboardEvent[] {
  const {
    layer,
    uidStrategy = "upstream",
    window = DEFAULT_WINDOW,
    tz = zone(),
    alarmMinutes = null,
    forceAllDayIfMidnight = false,
    titleRewrite = [],
    drop = [],
    sourceKind = "upstream",
    sourceRef,
    team,
    homeVenue,
    maxOccurrencesPerEvent = 400,
  } = options;

  const root = new ICAL.Component(ICAL.parse(text));
  registerTimezones(root);

  const vevents = root.getAllSubcomponents("vevent");
  const masters: ICAL.Component[] = [];
  const exceptions: ICAL.Component[] = [];
  for (const ve of vevents) {
    if (ve.getFirstPropertyValue("recurrence-id")) exceptions.push(ve);
    else masters.push(ve);
  }

  const dropRes = drop.map((p) => {
    try {
      return new RegExp(p);
    } catch {
      return null;
    }
  });

  const now = DateTime.now().setZone(tz);
  const from = now.minus({ days: window.pastDays }).toMillis();
  const until = now.plus({ days: window.futureDays }).toMillis();
  const fetchedAt = new Date().toISOString();

  const out: DayboardEvent[] = [];

  for (const master of masters) {
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(master);
    } catch {
      continue;
    }

    // Attach this master's overridden instances so getOccurrenceDetails returns
    // the moved/renamed version rather than the original slot.
    const uid = event.uid;
    for (const ex of exceptions) {
      if (ex.getFirstPropertyValue("uid") === uid) {
        try {
          event.relateException(new ICAL.Event(ex));
        } catch {
          // ignore an exception we can't relate
        }
      }
    }

    const rawTitle = collapse(event.summary ?? "");
    if (!rawTitle) continue;
    if (dropRes.some((re) => re?.test(rawTitle))) continue;
    const title = applyRewrites(rawTitle, titleRewrite);
    if (!title) continue;

    // Venue fields arrive as multi-line postal addresses; a calendar row wants
    // "Home · Mercedes-Benz Stadium".
    const rawLocation = collapse(event.location ?? "") || undefined;
    const location = team ? fixtureLocation(title, rawLocation, team, homeVenue) : rawLocation;
    const description = (event.description ?? "").trim();
    const urlValue = master.getFirstPropertyValue("url");
    const url = typeof urlValue === "string" && /^https?:\/\//.test(urlValue) ? urlValue : undefined;

    const emit = (startT: ICAL.Time, endT: ICAL.Time | null, occurrenceKey: string) => {
      const start = toStored(startT, tz);
      const end = endT ? toStored(endT, tz) : null;

      let { value: startValue, allDay } = start;
      let endValue = end?.value;

      // A TBD kickoff usually arrives as local midnight. Showing "12:00am" is a
      // lie; an all-day row is the honest rendering.
      if (
        forceAllDayIfMidnight &&
        !allDay &&
        DateTime.fromISO(startValue, { setZone: true }).setZone(tz).hour === 0 &&
        DateTime.fromISO(startValue, { setZone: true }).setZone(tz).minute === 0
      ) {
        const day = DateTime.fromISO(startValue, { setZone: true }).setZone(tz);
        startValue = day.toISODate()!;
        endValue = day.plus({ days: 1 }).toISODate()!;
        allDay = true;
      }

      const localDate = allDay
        ? startValue
        : DateTime.fromISO(startValue, { setZone: true }).setZone(tz).toISODate()!;

      const id =
        uidStrategy === "title-date"
          ? titleDateId(layer, title, localDate)
          : upstreamId(layer, occurrenceKey);

      out.push({
        id,
        layer,
        title,
        start: startValue,
        end: endValue,
        allDay,
        tz,
        location,
        url,
        notes: description || undefined,
        source: { kind: sourceKind, ref: sourceRef, fetchedAt },
        // Upstream VALARMs are deliberately never carried through — the layer
        // config decides what is worth a notification.
        alarm: alarmMinutes === null ? null : { minutesBefore: alarmMinutes },
        status: "confirmed",
        seq: 0,
        updatedAt: fetchedAt,
      });
    };

    if (event.isRecurring()) {
      const iterator = event.iterator();
      let next: ICAL.Time | null;
      let count = 0;
      while ((next = iterator.next()) && count < maxOccurrencesPerEvent) {
        count++;
        const ms = next.toJSDate().getTime();
        if (ms > until) break;
        if (ms < from) continue;
        let details;
        try {
          details = event.getOccurrenceDetails(next);
        } catch {
          continue;
        }
        emit(details.startDate, details.endDate ?? null, `${uid}:${next.toString()}`);
      }
      continue;
    }

    const startDate = event.startDate;
    if (!startDate) continue;
    const ms = startDate.toJSDate().getTime();
    if (ms < from || ms > until) continue;
    emit(startDate, event.endDate ?? null, uid || `${title}:${startDate.toString()}`);
  }

  // A feed can legitimately repeat a UID; keep the first and stay deterministic.
  const seen = new Set<string>();
  return out
    .filter((ev) => (seen.has(ev.id) ? false : (seen.add(ev.id), true)))
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}
