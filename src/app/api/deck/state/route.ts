import { buildDeckState, type DeckTeam } from "@/lib/deck";
import { readAudio, readBoard } from "@/lib/deck-agent";
import { liveNow } from "@/lib/events";
import { loadAllEvents } from "@/lib/layers";
import { teamTiles } from "@/lib/sports-tiles";
import { getLiveFollowed } from "@/lib/twitch";
import { getSubscriptionVideos, getYouTubeConfig } from "@/lib/youtube";
import { buildWaterSnapshot, loadWater } from "@/lib/water";
import { loadWatched, watchedIds } from "@/lib/watched";
import { todayLocal } from "@/lib/time";

/**
 * Everything a Stream Deck key needs to draw itself.
 *
 * The deck polls this — a key that can see itself asks every few seconds — so
 * the interesting question is what that costs. Almost nothing: every source
 * behind it is already memoised for the board's own thirty-second tick.
 * getSubscriptionVideos holds its answer for 60s on top of a 900s `revalidate`,
 * getLiveFollowed holds a minute against Twitch's 800-point budget, and the
 * water file is a small uncached read the board already does twice a minute. A
 * three-second poll therefore does NOT become a three-second poll against
 * YouTube or Twitch; it becomes a few object allocations.
 *
 * THE SHAPING IS DELIBERATELY THE SAME SHAPING WatchWidget DOES — cleared videos
 * filtered out, statement-game titles split into game and statement, viewers and
 * uptime already formatted. A key and the panel behind it disagreeing about
 * what is in the list would be worse than either of them being wrong. The
 * teams are the Sports tab's own tiles, from lib/sports-tiles.ts, for the same
 * reason.
 *
 * No gate. This is a read, it is bound to 127.0.0.1 by serve.ps1, and it says
 * nothing the board itself is not already showing on a second monitor.
 */
export const dynamic = "force-dynamic";

/**
 * Held for the board's own thirty-second tick. The other sources are memoised
 * underneath; this one expands every recurring event on the calendar to find four
 * teams' next games, which is not worth doing on every three-second deck poll.
 */
const TEAMS_TTL_MS = 30_000;
let teamsCache: { at: number; teams: DeckTeam[] } | null = null;

async function readTeams(): Promise<DeckTeam[]> {
  if (teamsCache && Date.now() - teamsCache.at < TEAMS_TTL_MS) return teamsCache.teams;
  try {
    const { events, layers } = await loadAllEvents();
    const live = liveNow(events.filter((event) => layers.get(event.layer)?.fixture));
    const teams = teamTiles({ events, layers, live }).map((tile) => ({
      id: tile.id,
      name: tile.name,
      logo: tile.logo ?? null,
      color: tile.color,
      line: tile.line,
      when: tile.when,
      live: tile.live,
      url: tile.url,
      service: tile.service,
      title: tile.title,
    }));
    teamsCache = { at: Date.now(), teams };
    return teams;
  } catch {
    // The Sports folder going blank is better than every key on the deck
    // saying the board is down.
    return [];
  }
}

export async function GET() {
  const [{ videos }, live, audio, board, teams] = await Promise.all([
    getSubscriptionVideos(),
    getLiveFollowed(),
    readAudio(),
    readBoard(),
    readTeams(),
  ]);

  return Response.json(
    buildDeckState({
      videos,
      cleared: watchedIds(loadWatched()),
      channels: getYouTubeConfig().channels,
      streams: live.live,
      teams,
      water: buildWaterSnapshot(loadWater(), todayLocal()),
      audio,
      board,
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
