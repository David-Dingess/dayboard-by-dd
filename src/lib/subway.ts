import GtfsRt from "gtfs-realtime-bindings";
import { memo, stale } from "./memo";
import { loadSettings } from "./settings";
import { countdown, lineColor, lineInk, type Alert, type Arrival } from "./subway-client";

export { countdown, lineColor, lineInk, type Alert, type Arrival };

/**
 * Subway: next trains at your station, and the disruptions on your lines.
 *
 * NEW YORK ONLY, and off by default. The MTA publishes two keyless feeds —
 * service alerts as plain JSON, trip updates as GTFS-realtime protobuf (hence
 * gtfs-realtime-bindings) — and no other city's transit agency answers in the
 * same shape, so this module is the one piece of the board that is a place
 * rather than a person. Which lines and which station come from
 * data/settings.json; the picker's station list is data/config/mta-stops.json.
 */

const ALERTS_FEED =
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json";

const TRIP_FEEDS = {
  irt: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  ace: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
  nqrw: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  bdfm: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
  l: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
  g: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
  jz: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
  si: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si",
} as const;

/** Which of the MTA's per-line-group feeds carries a route. */
export function feedFor(route: string): keyof typeof TRIP_FEEDS {
  const r = route.toUpperCase();
  if (/^[1-7]$|^S$|^GS$|^FS$/.test(r)) return "irt";
  if (/^[ACEH]$/.test(r)) return "ace";
  if (/^[NQRW]$/.test(r)) return "nqrw";
  if (/^[BDFM]$/.test(r)) return "bdfm";
  if (r === "L") return "l";
  if (r === "G") return "g";
  if (/^[JZ]$/.test(r)) return "jz";
  if (r === "SI") return "si";
  return "irt";
}

/**
 * How often those two feeds are actually worth asking for.
 *
 * The MTA regenerates the trip-update feeds every 30 seconds, and the GTFS-rt
 * best-practice guidance is to refresh "at least once every 30 seconds" — so a
 * faster poll spends bandwidth to be handed the identical bytes. The board's own
 * ticker runs at 30s too; this TTL is what guarantees a stray extra render
 * doesn't turn into a stray extra request.
 *
 * Counting down is NOT gated by this, and not gated by the board's ticker
 * either. Every arrival carries the absolute timestamp the feed gave it, and the
 * tile subtracts a live clock from it, so a train reads 4 min, then 3, then 2, on
 * its own minute boundaries — between fetches, and between refreshes.
 *
 * Alerts move on the order of minutes rather than seconds, so they get a minute.
 */
const TRIPS_TTL_MS = 30_000;
const ALERTS_TTL_MS = 60_000;

export interface LineConfig {
  /** the route as the MTA names it: "4", "Q", "L" */
  route: string;
  feed: keyof typeof TRIP_FEEDS;
  /** platform for arrivals; S = downtown. Omitted for alerts-only lines. */
  arrivalStop?: string;
  arrivalPlace?: string;
  /** the stretch worth hearing about, as GTFS parent-station ids */
  segment: string[];
  segmentLabel: string;
  /**
   * Stations PAST the end of the ride, and the only ones an alert may be
   * dismissed for. Everything else on the line reaches you, so it counts. Empty
   * — which is what the settings menu produces — means every alert on the line
   * is shown.
   */
  beyond: string[];
}

/**
 * The lines to watch, from settings: one entry per route, in the order given,
 * every one pointed at the same home station and platform direction.
 *
 * The private board carried hand-derived segments and "beyond" lists per line;
 * the generic one watches the home station and shows every alert on the line,
 * which is what a rider without a GTFS dump at hand would want anyway.
 */
export function linesFromSettings(): LineConfig[] {
  const t = loadSettings().transit;
  if (!t.enabled || !t.lines.length) return [];
  const place = t.stopName || t.stopId;
  const arrow = t.direction === "N" ? "↑" : "↓";
  const label = t.directionLabel ? `${place} ${arrow} ${t.directionLabel}` : `${place} ${arrow}`;
  return t.lines.map((route) => ({
    route: route.toUpperCase(),
    feed: feedFor(route),
    arrivalStop: t.stopId ? `${t.stopId}${t.direction}` : undefined,
    arrivalPlace: place,
    segment: t.stopId ? [t.stopId] : [],
    segmentLabel: label,
    beyond: [],
  }));
}

// ---------------------------------------------------------------- arrivals


/**
 * Next arrivals per route. The 4, 5 and 6 all live in the same IRT feed, so
 * each feed is fetched once and split by route rather than once per line.
 */
export async function getArrivalsByRoute(
  lines: LineConfig[] = linesFromSettings(),
  /** Filled in with the oldest feed load behind these arrivals, if a caller cares. */
  loadedAt?: { at: number },
): Promise<Map<string, Arrival[] | null>> {
  const wanted = lines.filter((l) => l.arrivalStop);
  const feeds = [...new Set(wanted.map((l) => l.feed))];
  const now = Math.floor(Date.now() / 1000);

  const decoded = await Promise.all(
    feeds.map(async (feed) => {
      const key = `trips:${feed}`;
      try {
        const [message, at] = await memo(key, TRIPS_TTL_MS, async () => {
          const res = await fetch(TRIP_FEEDS[feed], {
            // Next's data cache is bypassed on purpose — it is not built to hold
            // a multi-megabyte protobuf, and `memo` above is the cache that
            // actually paces this feed.
            cache: "no-store",
            headers: { "user-agent": "Dayboard/1.0 (personal dashboard)" },
            signal: AbortSignal.timeout(10_000),
          });
          // Thrown, not returned: a failure must not be what gets cached for the
          // next thirty seconds.
          if (!res.ok) throw new Error(String(res.status));
          return GtfsRt.transit_realtime.FeedMessage.decode(new Uint8Array(await res.arrayBuffer()));
        });
        if (loadedAt) loadedAt.at = Math.min(loadedAt.at, at);
        return [feed, message] as const;
      } catch {
        // A blip shows the last feed we did get, counted down against the
        // current clock, rather than an empty tile. Old train times are wrong
        // fast, so they age out with the tile's own "nothing soon".
        return [feed, stale<GtfsRt.transit_realtime.FeedMessage>(key)] as const;
      }
    }),
  );
  const byFeed = new Map(decoded);

  const out = new Map<string, Arrival[] | null>();
  for (const line of wanted) {
    const feed = byFeed.get(line.feed);
    if (!feed) {
      out.set(line.route, null);
      continue;
    }

    const arrivals: Arrival[] = [];
    for (const entity of feed.entity) {
      const update = entity.tripUpdate;
      if (!update || (update.trip?.routeId ?? "") !== line.route) continue;

      for (const stop of update.stopTimeUpdate ?? []) {
        if (stop.stopId !== line.arrivalStop) continue;
        const at = Number(stop.arrival?.time ?? stop.departure?.time ?? 0);
        if (!at) continue;
        const seconds = at - now;
        // A train 30s in the past is at the platform; an hour out is noise.
        if (seconds < -30 || seconds > 3600) continue;
        arrivals.push({
          route: line.route,
          at: at * 1000,
          minutes: Math.max(0, Math.round(seconds / 60)),
        });
      }
    }
    // Sorted on the timestamp, not the rounded minute. Rounding makes ties —
    // 3:40 and 4:20 are both "4" — and sorting on the tie would let the later
    // train take the "next" slot, which is the one slot that has to be right.
    out.set(line.route, arrivals.sort((a, b) => a.at - b.at).slice(0, 3));
  }
  return out;
}

// ------------------------------------------------------------------ alerts


interface RawAlert {
  active_period?: { start?: number; end?: number }[];
  informed_entity?: { route_id?: string; stop_id?: string }[];
  header_text?: { translation?: { text?: string; language?: string }[] };
  "transit_realtime.mercury_alert"?: { alert_type?: string };
}

function englishText(alert: RawAlert): string {
  const translations = alert.header_text?.translation ?? [];
  const en =
    translations.find((t) => t.language === "en" && t.text) ??
    translations.find((t) => t.text);
  return (en?.text ?? "")
    // The feed writes routes as [4][6]. Keep the character rather than deleting
    // it: dropping it turns "No [5] between Bowling Green and E 180 St" into
    // "No between Bowling Green and E 180 St". Mildly redundant with the
    // bullets, never ungrammatical.
    .replace(/\[(\w{1,2})\]/g, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

function isLive(alert: RawAlert, now: number): boolean {
  const periods = alert.active_period ?? [];
  if (!periods.length) return true;
  return periods.some(
    (p) => (p.start ?? 0) <= now && (p.end === undefined || p.end === null || p.end >= now),
  );
}

/** Strip the N/S platform suffix so ids match the static GTFS parent stations. */
function parentStation(stopId: string): string {
  return /[NS]$/.test(stopId) ? stopId.slice(0, -1) : stopId;
}

export function selectAlerts(
  entities: { id?: string; alert?: RawAlert }[],
  lines: LineConfig[],
  now = Math.floor(Date.now() / 1000),
): Map<string, Alert[]> {
  const byRoute = new Map<string, Alert[]>(lines.map((l) => [l.route, []]));
  const seen = new Set<string>();

  for (const entity of entities) {
    const alert = entity.alert;
    if (!alert || !isLive(alert, now)) continue;

    const text = englishText(alert);
    if (!text) continue;

    const informed = alert.informed_entity ?? [];
    const type = alert["transit_realtime.mercury_alert"]?.alert_type ?? "Service change";
    const planned = /^planned|^extra service/i.test(type);

    for (const line of lines) {
      const onRoute = informed.filter(
        (i) => (i.route_id ?? "").toUpperCase() === line.route,
      );
      if (!onRoute.length) continue;

      // What reaches you, which is more than the stretch you stand on. A signal
      // problem ten stops up the line delays the very trains that will pull
      // into your station, so a "does it touch my segment" test would throw
      // away the disruptions most worth knowing about.
      //
      // So the test is inverted: an alert is dropped ONLY if every station it
      // names is past the end of the ride. That fails open, which is the right
      // bias here and the same one the no-station case already took — an alert
      // we cannot place is likelier to matter than not.
      const stops = onRoute.map((i) => i.stop_id).filter(Boolean) as string[];
      const beyond = new Set(line.beyond);
      const reachesYou =
        stops.length === 0 || stops.some((s) => !beyond.has(parentStation(s)));
      if (!reachesYou) continue;

      // The same disruption is filed once per affected station.
      const key = `${line.route}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);

      byRoute.get(line.route)!.push({
        id: `${entity.id ?? ""}-${line.route}`,
        routes: [line.route],
        type,
        text,
        planned,
      });
    }
  }

  for (const list of byRoute.values()) {
    // Unplanned first — that's the part that changes what you do next.
    list.sort((a, b) => Number(a.planned) - Number(b.planned));
  }
  return byRoute;
}

export async function getSubway(lines: LineConfig[] = linesFromSettings()): Promise<{
  ok: boolean;
  alerts: Map<string, Alert[]>;
  arrivals: Map<string, Arrival[] | null>;
  fetchedAt: string;
}> {
  if (!lines.length) {
    return { ok: true, alerts: new Map(), arrivals: new Map(), fetchedAt: new Date().toISOString() };
  }
  // The label reports the OLDEST thing on screen, across two feeds with two
   // different TTLs. Reporting the newest would let a stalled alerts feed hide
   // behind a fresh trip feed, which is exactly the failure the label exists for.
  const loaded = { at: Date.now() };
  const arrivals = await getArrivalsByRoute(lines, loaded);

  // The raw entities are what's cached, not the selection: selectAlerts is pure
  // and cheap, and running it fresh means an alert expires on its own schedule
  // rather than on the cache's.
  type AlertEntity = { id?: string; alert?: RawAlert };
  const key = "alerts";
  let ok = true;
  let alerts = new Map<string, Alert[]>(lines.map((l) => [l.route, []]));
  try {
    const [entities, alertsAt] = await memo(key, ALERTS_TTL_MS, async () => {
      const res = await fetch(ALERTS_FEED, {
        cache: "no-store",
        headers: { "user-agent": "Dayboard/1.0 (personal dashboard)" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { entity?: AlertEntity[] };
      return json.entity ?? [];
    });
    loaded.at = Math.min(loaded.at, alertsAt);
    alerts = selectAlerts(entities, lines);
  } catch {
    const last = stale<AlertEntity[]>(key);
    if (last) alerts = selectAlerts(last, lines);
    else ok = false;
  }

  return { ok, alerts, arrivals, fetchedAt: new Date(loaded.at).toISOString() };
}
