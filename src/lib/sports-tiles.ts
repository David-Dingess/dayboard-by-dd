import { DateTime } from "luxon";
import type { DayboardEvent, Layer } from "./schema";
import { competitionsForLayer } from "./scores";
import { teamStream } from "./watch";
import { elapsed, opponent, whenLabel } from "./fixture-text";
import { zone, toInstant } from "./time";

/**
 * One tile per team: who they play next, when, and where it streams.
 *
 * SHARED BY THE SPORTS TAB AND THE STREAM DECK. The tab's tiles and the deck's
 * Sports folder are the same list pressed two ways, and deriving it twice would
 * let a key open Peacock while the tile beside it says USA Network.
 *
 * WHICH TEAMS IS NOT A LIST IN HERE. It is every fixture layer whose upstream
 * names competitions — the same rule the scores grid uses — so a fifth club in
 * upstreams.json gets a tile and a key without a line of this changing.
 */

export interface TeamTile {
  id: string;
  name: string;
  logo?: string;
  emoji?: string;
  color: string;
  /** "vs Orlando City SC", or "Nothing scheduled". */
  line: string;
  /** "Today · 7:30pm", or "34m in" once it has started. */
  when: string;
  live: boolean;
  url: string | null;
  service: string | null;
  /** What the player bar calls it once it is on. */
  title: string;
}

export function teamTiles(input: {
  events: DayboardEvent[];
  layers: Map<string, Layer>;
  /** The fixtures on right now, as page.tsx already computed them. */
  live: DayboardEvent[];
  now?: DateTime;
}): TeamTile[] {
  const nowDt = input.now ?? DateTime.now().setZone(zone());
  const now = nowDt.toMillis();
  const today = nowDt.toISODate()!;

  const teams = [...input.layers.values()]
    .filter((layer) => layer.fixture && competitionsForLayer(layer.id).length > 0)
    .sort((a, b) => a.order - b.order);

  const soonest = (a: DayboardEvent, b: DayboardEvent) => toInstant(a.start) - toInstant(b.start);

  return teams.map((layer) => {
    const onNow = input.live.filter((e) => e.layer === layer.id).sort(soonest)[0];
    const next =
      onNow ??
      input.events
        .filter((e) => e.layer === layer.id && e.status !== "cancelled" && toInstant(e.start) > now)
        .sort(soonest)[0] ??
      null;
    const stream = teamStream(competitionsForLayer(layer.id), next);

    return {
      id: layer.id,
      name: layer.name,
      logo: layer.logo,
      emoji: layer.emoji,
      color: layer.color,
      line: next ? opponent(next.title, layer.name) : "Nothing scheduled",
      when: onNow ? elapsed(onNow, now) : next ? whenLabel(next, today) : "",
      live: Boolean(onNow),
      url: stream?.url ?? null,
      service: stream?.service ?? null,
      title: next ? next.title : layer.name,
    };
  });
}
