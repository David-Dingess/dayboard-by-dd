"use client";

import { useCallback, type MouseEvent } from "react";
import { selectTab } from "@/components/Panel";
import { useWatching, writeWatching } from "@/components/watching";

/**
 * One tile per team, and a click opens that team's streaming site in the stage.
 *
 * Everything a tile says is settled on the server (see SportsWidget) — the
 * opponent, the kickoff, where it streams — so this is only the click and the
 * one fact the server cannot know: which tile is the one already playing.
 *
 * A PLAIN LINK UNDERNEATH, like every tile on this board: a modified or middle
 * click still opens the site in a new tab of the board's own browser, which is
 * the escape hatch if the stream window is ever the thing that is broken.
 */

import type { TeamTile } from "@/lib/sports-tiles";
export type { TeamTile };

export function TeamTiles({ tiles }: { tiles: TeamTile[] }) {
  const { entry } = useWatching("stream");

  const open = useCallback((event: MouseEvent, tile: TeamTile) => {
    if (!tile.url || !tile.service) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    writeWatching({
      kind: "stream",
      key: tile.url,
      title: tile.title,
      channel: tile.service,
      href: tile.url,
      at: Date.now(),
      origin: "sports",
    });
    selectTab("center", "sports");
  }, []);

  return (
    <ul className="teamtiles">
      {tiles.map((tile) => {
        const playing = entry?.kind === "stream" && entry.key === tile.url;
        const body = (
          <>
            <span className="teamtile-head">
              {tile.logo ? (
                <span className="mark mark-logo teamtile-mark">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local crest */}
                  <img src={tile.logo} alt="" />
                </span>
              ) : (
                <span className="mark mark-emoji teamtile-mark" aria-hidden>
                  {tile.emoji ?? "•"}
                </span>
              )}
              <span className="teamtile-name">{tile.name}</span>
              {tile.live && <span className="teamtile-live">Live</span>}
            </span>
            <span className="teamtile-line">{tile.line}</span>
            <span className={`teamtile-when${tile.live ? " is-on" : ""}`}>{tile.when}</span>
            <span className="teamtile-go">
              {tile.service ? (playing ? `On ${tile.service}` : `Watch on ${tile.service}`) : "No stream known"}
            </span>
          </>
        );

        return (
          <li key={tile.id} className="teamtile-item">
            {tile.url ? (
              <a
                className={`teamtile${tile.live ? " is-live" : ""}${playing ? " is-playing" : ""}`}
                style={{ ["--team-accent" as string]: tile.color }}
                href={tile.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => open(e, tile)}
              >
                {body}
              </a>
            ) : (
              <div className="teamtile is-dead" style={{ ["--team-accent" as string]: tile.color }}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
