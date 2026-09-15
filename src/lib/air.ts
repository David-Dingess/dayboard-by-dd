import { memo } from "./memo";
import { zone } from "./time";
import { loadSettings } from "./settings";

/**
 * Air quality, pollen and UV — the three things about being outside that a
 * temperature does not tell you.
 *
 * TWO PROVIDERS, not one. Air quality is a second Open-Meteo endpoint, on the
 * same bargain as the forecast: no key, no account, no quota. Pollen is not —
 * see the note above POLLEN_ENDPOINT for why. UV comes from the ordinary
 * forecast API rather than either of them, so it is passed in.
 *
 * WHY EACH NUMBER CARRIES A SENTENCE. "AQI 62" and "grass 41 grains/m³" are not
 * facts anybody can act on without looking up a table — and a second-monitor dashboard
 * exists precisely so nobody has to look anything up. So every reading here
 * comes with the thing it means for the afternoon, and the number is the
 * supporting evidence rather than the point.
 *
 * The thresholds are the published ones: US EPA bands for AQI, pollen.com's own
 * five bands for its index, and WHO's UV index scale.
 */

function endpoint(lat: number, lon: number): string {
  return (
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    "&current=us_aqi" +
    `&timezone=${encodeURIComponent(zone())}&forecast_days=1`
  );
}

/**
 * Pollen comes from somewhere else entirely, because Open-Meteo has none here.
 *
 * ITS POLLEN MODEL IS CAMS EUROPE. Asked for this latitude it answers `null` for
 * every species — verified against the live endpoint, not assumed. So the
 * numbers come from pollen.com (IQVIA), which covers the US by ZIP, needs no
 * key, and hands back the thing this panel actually wants: one 0-12 index and
 * the names of what is in the air.
 *
 * IT IS AN UNOFFICIAL ENDPOINT and it is treated as one. It refuses a request
 * without a Referer from its own site, so that header is sent deliberately
 * rather than by accident, and every failure path here ends in the item simply
 * not drawing. If IQVIA change it, the weather panel loses a tile and nothing
 * else — which is the same bargain the rest of this file makes.
 */
const pollenEndpoint = (zip: string) => `https://www.pollen.com/api/forecast/current/pollen/${zip}`;

/** Fifteen minutes, like the forecast: none of this moves faster than that. */
const AIR_TTL_MS = 900_000;

export interface Reading {
  /** What to show as the value. */
  value: string;
  /** One short clause about what it means for going outside. */
  advice: string;
  /** ok | watch | bad — drives the colour, three steps like the PC panel. */
  level: "ok" | "watch" | "bad";
}

export interface Air {
  aqi: Reading | null;
  pollen: Reading | null;
  fetchedAt: string;
}

/** US EPA bands. Everything above 100 starts mattering to people without asthma. */
export function readAqi(aqi: number | null | undefined): Reading | null {
  if (aqi == null) return null;
  const value = String(Math.round(aqi));
  if (aqi <= 50) return { value, advice: "Air is clean.", level: "ok" };
  if (aqi <= 100) return { value, advice: "Fine unless you're sensitive.", level: "ok" };
  if (aqi <= 150) return { value, advice: "Cut the long run short.", level: "watch" };
  if (aqi <= 200) return { value, advice: "Keep it indoors today.", level: "bad" };
  return { value, advice: "Stay in, windows shut.", level: "bad" };
}

/**
 * Pollen.com's 0-12 index, and what is causing it.
 *
 * Their own five bands, and the advice names the culprits: "ragweed, grasses"
 * is more use than a number, because it is the difference between shutting a
 * window and staying off the grass in the park.
 *
 * Two triggers at most. Three is a list rather than a sentence, and the third is
 * never the one doing the damage.
 */
export function readPollen(index: number | null | undefined, triggers: string[] = []): Reading | null {
  if (index == null || !Number.isFinite(index)) return null;

  const names = triggers.slice(0, 2).join(", ").toLowerCase();
  const because = names ? ` ${names.charAt(0).toUpperCase()}${names.slice(1)}.` : "";

  if (index < 2.5) return { value: "low", advice: "Nothing to plan around.", level: "ok" };
  if (index < 4.9) {
    return { value: "low-med", advice: `Fine for most people.${because}`, level: "ok" };
  }
  if (index < 7.3) {
    return { value: "medium", advice: `Take the antihistamine.${because}`, level: "watch" };
  }
  if (index < 9.7) {
    return { value: "med-high", advice: `Antihistamine, windows shut.${because}`, level: "bad" };
  }
  return { value: "high", advice: `A bad day for windows open.${because}`, level: "bad" };
}

/** WHO's scale. Below 3 nobody needs to do anything. */
export function readUv(uv: number | null | undefined): Reading | null {
  if (uv == null) return null;
  const value = String(Math.round(uv));
  if (uv < 3) return { value, advice: "No need for anything.", level: "ok" };
  if (uv < 6) return { value, advice: "Hat if you're out a while.", level: "ok" };
  if (uv < 8) return { value, advice: "Sunscreen before you go.", level: "watch" };
  if (uv < 11) return { value, advice: "Sunscreen, and find the shade.", level: "bad" };
  return { value, advice: "Burns in minutes. Cover up.", level: "bad" };
}

interface AirResponse {
  current?: { us_aqi?: number };
}

interface PollenResponse {
  Location?: {
    periods?: { Type?: string; Index?: number; Triggers?: { Name?: string }[] }[];
  };
}

async function fetchPollen(zip: string): Promise<Reading | null> {
  // US only, and only when a ZIP has been given: pollen.com is keyed by it.
  if (!/^\d{5}$/.test(zip)) return null;
  try {
    const res = await fetch(pollenEndpoint(zip), {
      // It answers 403 without this. See the note on pollenEndpoint.
      headers: {
        Referer: `https://www.pollen.com/forecast/current/pollen/${zip}`,
        "User-Agent": "Mozilla/5.0",
      },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as PollenResponse;
    const today = json.Location?.periods?.find((p) => p.Type === "Today");
    if (!today) return null;
    return readPollen(
      today.Index,
      (today.Triggers ?? []).map((t) => t.Name ?? "").filter(Boolean),
    );
  } catch {
    return null;
  }
}

export async function getAir(): Promise<Air> {
  const { lat, lon, zip } = loadSettings().location;
  if (lat === null || lon === null) {
    return { aqi: null, pollen: null, fetchedAt: new Date().toISOString() };
  }
  const [parsed, at] = await memo(`air:${lat},${lon},${zip}`, AIR_TTL_MS, async () => {
    // Started before the air request rather than after it: two providers with
    // nothing to say to each other.
    const pollen = fetchPollen(zip);
    try {
      const res = await fetch(endpoint(lat, lon), {
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { aqi: null, pollen: await pollen };
      const json = (await res.json()) as AirResponse;
      return { aqi: readAqi(json.current?.us_aqi), pollen: await pollen };
    } catch {
      // The row simply does not draw. Air quality is worth knowing and not worth
      // taking the weather panel down for.
      return { aqi: null, pollen: await pollen };
    }
  });
  return { ...parsed, fetchedAt: new Date(at).toISOString() };
}
