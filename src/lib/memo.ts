/**
 * One in-process TTL cache, shared by every source the board polls.
 *
 * The board refreshes itself every 30 seconds (see components/AutoRefresh), and
 * a tick re-runs every server component on the page. Without this, that would
 * mean hitting the MTA, Discord and Google on every tick regardless of whether
 * any of them had produced a new byte. The TTL is where the real politeness
 * lives: the ticker asks often, and each source decides how often that question
 * is actually worth forwarding.
 *
 * A Map in module scope, so its lifetime is the lambda instance's. On a board
 * with one viewer that is exactly the right granularity — a cold start pays for
 * one fetch, and a warm instance serves the whole session. Nothing here is
 * shared between regions, and nothing needs to be.
 *
 * Callers, and the TTL each one chose:
 *   subway.ts     30s trip feeds, 60s alerts   the MTA regenerates every 30s
 *   discord.ts    30s per guild                who is in voice moves slowly
 *   weather.ts    15min forecast               Open-Meteo's models run hourly
 *   air.ts        15min AQI and pollen         two providers behind one entry
 *   youtube.ts    60s video list               dedupes the widget and its tab
 *   twitch.ts     60s live followed            same trick, and viewer counts drift
 *   subscribed.ts 15min ICS calendars          refreshed in the background; Outlook is slow
 *
 * twitch.ts also holds an access token, and deliberately does NOT keep it here:
 * its lifetime is a number Twitch sends back, not one we get to choose.
 *
 * Worth knowing while developing: a cached value survives an edit to the module
 * that produced it, because the Map lives here rather than there. Change how a
 * forecast is parsed and the board keeps serving the old parse until the TTL is
 * up — touch this file to clear it.
 *
 * `stale` exists for the failure case: when a provider rate-limits us or times
 * out, the last good value is a far better answer than an empty panel, and it
 * is already sitting right here.
 */

interface Cached<T> {
  at: number;
  value: T;
}

const cache = new Map<string, Cached<unknown>>();

/**
 * Returns the value AND when it was actually loaded. Callers report the older of
 * those rather than the time of the request, so a cache hit reads as the
 * stale-but-fine thing it is instead of claiming to be a second old.
 */
export async function memo<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
): Promise<[T, number]> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && Date.now() - hit.at < ttl) return [hit.value, hit.at];
  const value = await load();
  const at = Date.now();
  cache.set(key, { at, value });
  return [value, at];
}

/** The last value stored under a key, however old — for serving through a failure. */
export function stale<T>(key: string): T | null {
  return (cache.get(key) as Cached<T> | undefined)?.value ?? null;
}

/** Store a value without going through `load` — for a partial or recovered result. */
export function remember<T>(key: string, value: T): void {
  cache.set(key, { at: Date.now(), value });
}
