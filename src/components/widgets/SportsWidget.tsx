import { DateTime } from "luxon";
import type { DayboardEvent, Layer } from "@/lib/schema";
import { competitionsForLayer } from "@/lib/scores";
import { teamTiles } from "@/lib/sports-tiles";
import { zone } from "@/lib/time";
import { TeamTiles } from "@/components/TeamTiles";
import { WatchStage } from "@/components/WatchStage";
import { GameCard } from "@/components/widgets/GameCard";

/**
 * The four teams, and their games playing in the panel.
 *
 * THE SAME SHAPE AS THE GAMING TAB ON PURPOSE: a row to choose from, and a stage
 * below it that the one player covers. The difference is what plays. A tile
 * here opens the team's streaming site — Apple TV for an MLS club, Peacock for
 * a Premier League one, whatever the fixture resolved to otherwise — in
 * the stream window, a real logged-in Chrome that agent/stream tucks into the
 * board over this stage. See lib/stream-host.ts for how, and agent/stream for
 * why it has to be a window.
 *
 * The tiles themselves come from lib/sports-tiles.ts, which the Stream Deck's
 * Sports folder reads too.
 */

export function SportsWidget({
  events,
  layers,
  live,
}: {
  events: DayboardEvent[];
  layers: Map<string, Layer>;
  /** Already computed in page.tsx, for the tab's pulse. */
  live: DayboardEvent[];
}) {
  const nowDt = DateTime.now().setZone(zone());
  const tiles = teamTiles({ events, layers, live, now: nowDt });
  const liveTeams = live.filter((e) => competitionsForLayer(e.layer).length > 0);

  return (
    <div className="widget watchwidget sportswidget">
      <div className="widget-head">
        <h2 className="widget-title">Sports</h2>
        <span className="widget-meta">Your streaming logins play here.</span>
      </div>

      <div className="watchrails">
        <section className="watchrail">
          <div className="rail">
            <TeamTiles tiles={tiles} />
          </div>
        </section>
      </div>

      {/* WatchPlayer finds this by attribute and covers it, exactly as it does
          the Watch tab's. Only the active slot's stage is ever measured. */}
      <div className="watchstage" data-watchstage>
        <WatchStage home="sports">
          {liveTeams.length > 0 ? (
            <GameCard event={liveTeams[0]} now={nowDt} />
          ) : (
            <p className="watchidle-none">Pick a team to open their stream.</p>
          )}
        </WatchStage>
      </div>
    </div>
  );
}
