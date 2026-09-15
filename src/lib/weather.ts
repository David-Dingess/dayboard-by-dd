import { DateTime } from "luxon";
import { zone } from "./time";
import { memo } from "./memo";
import { loadSettings } from "./settings";

/**
 * Weather for wherever the settings say, from Open-Meteo.
 *
 * Chosen because it needs no API key, no account and no attribution beacon, has
 * no call quota for personal use, and returns plain JSON — so nothing here can
 * leak who is asking, and there is no credential to rotate.
 *
 * One request covers all three shapes the dashboard wants: conditions now, the
 * next 48 hours, and 16 days ahead. `forecast_hours` bounds the hourly rows
 * independently of `forecast_days`, which keeps the payload at a few KB.
 *
 * Fetched at request time rather than snapshotted, because a stale forecast is
 * worse than none. Next's data cache keeps the last good response if a
 * revalidation fails, so a blip shows slightly old weather rather than an error.
 */

export type Units = "imperial" | "metric";

/** The request for the configured place, or null when no place is set yet. */
function endpoint(): { url: string; key: string; units: Units } | null {
  const { lat, lon, units } = loadSettings().location;
  if (lat === null || lon === null) return null;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m" +
    "&hourly=temperature_2m,precipitation_probability,weather_code" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset" +
    `&temperature_unit=${units === "metric" ? "celsius" : "fahrenheit"}` +
    `&wind_speed_unit=${units === "metric" ? "kmh" : "mph"}` +
    `&timezone=${encodeURIComponent(zone())}` +
    "&forecast_days=16&forecast_hours=48";
  return { url, key: `forecast:${lat},${lon},${units}`, units };
}

export interface Conditions {
  glyph: string;
  label: string;
}

export interface DayWeather extends Conditions {
  /** Peak wind for the day, mph. Only used to decide whether it looks windy. */
  wind?: number | null;
  /** Peak UV index for the day. */
  uv?: number | null;
  date: string;
  high: number;
  low: number;
  precipChance: number | null;
  code: number;
  sunrise?: string;
  sunset?: string;
}

export interface HourWeather extends Conditions {
  /** ISO local, e.g. 2026-09-05T21:00 */
  time: string;
  date: string;
  hour: number;
  temp: number;
  precipChance: number | null;
  code: number;
}

export interface NowWeather extends Conditions {
  temp: number;
  feelsLike: number;
  humidity: number | null;
  wind: number | null;
  code: number;
}

export interface Forecast {
  now: NowWeather | null;
  hours: HourWeather[];
  days: Map<string, DayWeather>;
  /**
   * When this was really fetched, not when it was asked for. The panel prints it,
   * so a cache hit has to read as the fifteen-minute-old thing it is.
   */
  fetchedAt: string;
  /** What the numbers are in. */
  units: Units;
  /** False until a location has been set; the widget says so instead of "no forecast". */
  configured: boolean;
}

/** Open-Meteo's models run hourly; a quarter of an hour is already generous. */
const FORECAST_TTL_MS = 900_000;

/**
 * WMO weather codes, collapsed to the handful of buckets worth showing.
 * Full table: open-meteo.com/en/docs
 */
/**
 * Real emoji, with the variation selector that forces colour presentation.
 *
 * These were typographic symbols — ☀ ☁ ☂ ≡ ◦ — which the browser renders in the
 * body text colour, so a whole week of weather came out as identical grey
 * marks. Fog was a mathematical identity sign and drizzle was a ring operator.
 * Emoji carry their own colour, which is the entire job of a weather glyph:
 * telling you it is raining without being read.
 */
export function describe(code: number): Conditions {
  if (code === 0) return { glyph: "☀️", label: "Clear" };
  if (code <= 2) return { glyph: "⛅", label: "Partly cloudy" };
  if (code === 3) return { glyph: "☁️", label: "Overcast" };
  if (code <= 48) return { glyph: "🌫️", label: "Fog" };
  if (code <= 57) return { glyph: "🌦️", label: "Drizzle" };
  if (code <= 67) return { glyph: "🌧️", label: "Rain" };
  if (code <= 77) return { glyph: "❄️", label: "Snow" };
  if (code <= 82) return { glyph: "🌦️", label: "Showers" };
  if (code <= 86) return { glyph: "🌨️", label: "Snow showers" };
  return { glyph: "⛈️", label: "Thunderstorm" };
}

interface OpenMeteo {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation_probability?: (number | null)[];
    weather_code?: number[];
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
    uv_index_max?: (number | null)[];
    sunrise?: string[];
    sunset?: string[];
  };
}

const EMPTY: Omit<Forecast, "fetchedAt"> = {
  now: null,
  hours: [],
  days: new Map(),
  units: "imperial",
  configured: false,
};

export async function getForecast(): Promise<Forecast> {
  const target = endpoint();
  if (!target) return { ...EMPTY, fetchedAt: new Date().toISOString() };
  // memo, not just `revalidate`: Next's cache will happily serve the same body
  // without telling us how old it is, and the panel now has to say. Keyed on
  // the place, so changing the location in settings is a new forecast at once.
  const [parsed, at] = await memo(target.key, FORECAST_TTL_MS, () => parseForecast(target.url));
  return { ...parsed, units: target.units, configured: true, fetchedAt: new Date(at).toISOString() };
}

async function parseForecast(url: string): Promise<Omit<Forecast, "fetchedAt">> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return EMPTY;
    const json = (await res.json()) as OpenMeteo;

    const days = new Map<string, DayWeather>();
    const d = json.daily;
    for (let i = 0; i < (d?.time?.length ?? 0); i++) {
      const code = d!.weather_code?.[i];
      const high = d!.temperature_2m_max?.[i];
      const low = d!.temperature_2m_min?.[i];
      if (code === undefined || high === undefined || low === undefined) continue;
      days.set(d!.time![i], {
        date: d!.time![i],
        high: Math.round(high),
        low: Math.round(low),
        precipChance: d!.precipitation_probability_max?.[i] ?? null,
        wind: d!.wind_speed_10m_max?.[i] ?? null,
        uv: d!.uv_index_max?.[i] ?? null,
        code,
        sunrise: d!.sunrise?.[i],
        sunset: d!.sunset?.[i],
        ...describe(code),
      });
    }

    const hours: HourWeather[] = [];
    const h = json.hourly;
    for (let i = 0; i < (h?.time?.length ?? 0); i++) {
      const code = h!.weather_code?.[i];
      const temp = h!.temperature_2m?.[i];
      const time = h!.time![i];
      if (code === undefined || temp === undefined) continue;
      hours.push({
        time,
        date: time.slice(0, 10),
        hour: Number(time.slice(11, 13)),
        temp: Math.round(temp),
        precipChance: h!.precipitation_probability?.[i] ?? null,
        code,
        ...describe(code),
      });
    }

    const c = json.current;
    const now: NowWeather | null =
      c?.temperature_2m === undefined || c?.weather_code === undefined
        ? null
        : {
            temp: Math.round(c.temperature_2m),
            feelsLike: Math.round(c.apparent_temperature ?? c.temperature_2m),
            humidity: c.relative_humidity_2m ?? null,
            wind: c.wind_speed_10m === undefined ? null : Math.round(c.wind_speed_10m),
            code: c.weather_code,
            ...describe(c.weather_code),
          };

    return { now, hours, days, units: "imperial", configured: true };
  } catch {
    // No weather is a missing panel, never an error page.
    return EMPTY;
  }
}

/**
 * The next `count` hours from right now, rolling.
 *
 * NOT a fixed window of the day. The first version showed 8am to 7pm, which is
 * right at breakfast and mostly empty by dinner — at half past five it had three
 * cells and nine blanks. What a forecast is being asked at any hour is "what is
 * about to happen", so the window follows the clock and spills into tomorrow
 * when it has to.
 *
 * The current hour is included rather than skipped: it is still happening, and
 * the conditions tile above says what it is doing NOW, not what the hour holds.
 *
 * `now` is a parameter with a default so a server component never has to reach
 * for the clock during render — see untilLabel in lib/time.ts.
 */
export function nextHours(
  hours: HourWeather[],
  count = 12,
  now: DateTime = DateTime.now().setZone(zone()),
): HourWeather[] {
  const from = now.startOf("hour").toFormat("yyyy-MM-dd'T'HH:mm");
  return hours.filter((hour) => hour.time >= from).slice(0, count);
}

/**
 * Which weather is worth drawing, and which is just a colour.
 *
 * RAIN, SNOW, A STORM AND A REAL WIND ONLY. Sun, cloud and a light breeze get
 * nothing — a tile with something moving on it should mean something is
 * happening, and if four days out of five had particles they would stop being a
 * signal and start being wallpaper.
 *
 * WMO codes, collapsed the same way describe() collapses them: thunderstorms
 * from 95, snow in the 71-77 and 85-86 bands, everything wet from drizzle at 51
 * through showers at 82. Wind only counts when nothing wetter is already
 * happening — rain in a gale is drawn as rain, because that is what you would
 * put a coat on for.
 */
export type WeatherFx = "rain" | "snow" | "storm" | "wind";

/** Sustained mph at which the trees outside are obviously moving. */
const WINDY_MPH = 22;

export function weatherFx(code: number, windMph?: number | null): WeatherFx | null {
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (windMph != null && windMph >= WINDY_MPH) return "wind";
  return null;
}

export function formatHour(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

export function formatClock(iso: string | undefined): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: zone() });
  return dt.isValid ? dt.toFormat("h:mma").toLowerCase() : null;
}
