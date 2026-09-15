import { DateTime } from "luxon";
import { getTimes } from "suncalc";
import { zone } from "./time";
import { loadSettings } from "./settings";

/**
 * The shape of the day, as one bar.
 *
 * Sunrise and sunset are two numbers in the Quick row and they answer a smaller
 * question than the one actually being asked, which is "how much of the light is
 * left, and is it about to go gold". A bar answers that from across the room
 * without reading anything: the marker's distance from the right-hand edge of
 * the pale band IS the answer.
 *
 * NO NETWORK AT ALL. suncalc has been sitting in package.json unused since the
 * flight scanner landed; this is pure astronomy from a latitude and a longitude,
 * so it costs nothing, cannot rate-limit, and works when every provider on this
 * board is down.
 *
 * MIDNIGHT TO MIDNIGHT, rather than a window around daylight. A day-shaped bar
 * has to have night at both ends, or the marker's position stops meaning
 * anything at 6am and the two golden bands lose the thing they are golden
 * against. It also means the geometry never changes between December and June —
 * only the stops inside it move, which is the part worth looking at.
 *
 * Pure and server-rendered. The marker moves 0.03% of the bar between refresh
 * ticks, which is a fifth of a pixel, so there is nothing here worth a client
 * component or a second clock.
 */

/** The same point the forecast and air readings use, from settings. */
function here(): { lat: number; lon: number } | null {
  const { lat, lon } = loadSettings().location;
  return lat === null || lon === null ? null : { lat, lon };
}

const DAY_MINUTES = 1440;

export interface SunBand {
  /** night | dawn | golden | day — the four things the bar is made of. */
  kind: "night" | "dawn" | "golden" | "day";
  /** Where it starts and ends, 0-100 across the local day. */
  from: number;
  to: number;
}

export interface SunBar {
  bands: SunBand[];
  /** Where now is, 0-100. */
  at: number;
  /** For the two ends of the row, already formatted. */
  sunrise: string | null;
  sunset: string | null;
  /** Daylight, as "13h 12m" — the number the bar is a picture of. */
  length: string | null;
}

/** Minutes past local midnight, as a percentage of the day. */
function pct(date: Date | null | undefined, tz: string = zone()): number | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const local = DateTime.fromJSDate(date, { zone: tz });
  return ((local.hour * 60 + local.minute + local.second / 60) / DAY_MINUTES) * 100;
}

function clock(date: Date | null | undefined, tz: string = zone()): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("h:mma").toLowerCase();
}

/**
 * Everything the row needs, from a single instant.
 *
 * The bands are built in order and each one starts where the last ended, so
 * there is no arithmetic that can leave a gap or an overlap — a missing sun time
 * (which suncalc returns as null, and does above the Arctic circle rather than
 * here) simply means the band before it runs on.
 */
export function sunBar(
  now: number = Date.now(),
  tz: string = zone(),
  at: { lat: number; lon: number } | null = here(),
): SunBar | null {
  if (!at) return null;
  const when = DateTime.fromMillis(now, { zone: tz });
  const times = getTimes(when.toJSDate(), at.lat, at.lon);

  const stops: [SunBand["kind"], number | null][] = [
    // Each entry is where a band ENDS. Night runs to civil dawn, dawn to
    // sunrise, gold to the end of the golden hour, and so on back down.
    ["night", pct(times.dawn, tz)],
    ["dawn", pct(times.sunrise, tz)],
    ["golden", pct(times.goldenHourEnd, tz)],
    ["day", pct(times.goldenHour, tz)],
    ["golden", pct(times.sunset, tz)],
    ["dawn", pct(times.dusk, tz)],
    ["night", 100],
  ];

  const bands: SunBand[] = [];
  let cursor = 0;
  for (const [kind, end] of stops) {
    if (end == null) continue;
    const to = Math.min(100, Math.max(cursor, end));
    if (to > cursor) bands.push({ kind, from: cursor, to });
    cursor = to;
  }
  if (cursor < 100) bands.push({ kind: "night", from: cursor, to: 100 });

  const rise = pct(times.sunrise, tz);
  const set = pct(times.sunset, tz);
  const minutes = rise != null && set != null ? ((set - rise) / 100) * DAY_MINUTES : null;

  return {
    bands,
    at: ((when.hour * 60 + when.minute) / DAY_MINUTES) * 100,
    sunrise: clock(times.sunrise, tz),
    sunset: clock(times.sunset, tz),
    length:
      minutes == null
        ? null
        : `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}m`,
  };
}
