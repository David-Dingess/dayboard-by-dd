import {
  ago,
  getSubscriptionVideos,
  getYouTubeConfig,
  isFresh,
  splitTitle,
  type TitleParts,
} from "@/lib/youtube";
import { getLiveFollowed, uptime, viewers } from "@/lib/twitch";
import { VideoList } from "@/components/VideoList";
import { StreamList, type StreamMeta } from "@/components/StreamList";
import { Rail } from "@/components/Rail";
import { WatchStage } from "@/components/WatchStage";
import { GameCard } from "@/components/widgets/GameCard";
import { loadWatched, watchedIds } from "@/lib/watched";
import { todoGate } from "@/lib/todo-actions";
import { DateTime } from "luxon";
import { zone } from "@/lib/time";
import type { DayboardEvent } from "@/lib/schema";

/**
 * Everything worth watching, and the thing that plays it. The whole tab, since
 * Entertainment was folded into it — two tabs showing the same two lists was one
 * tab too many the moment those lists became clickable.
 *
 * THE PLAYER IS AT THE BOTTOM, directly above the tab row. It is the thing you
 * look at rather than the thing you scan, so it sits where the eyes rest and the
 * choosing happens above it — the same argument that puts the tab toggle at the
 * bottom of a panel rather than the top.
 *
 * EACH SOURCE IS ONE ROW, NOT A GRID. A row is read in a single sweep, and it
 * stops the two sources competing for height in a panel whose height is now
 * mostly spoken for. One stream and its tile takes the full width; a dozen and
 * they hold their minimum and the row scrolls sideways.
 *
 * THE STAGE IS AN EMPTY BOX ON PURPOSE. WatchPlayer lives outside this widget —
 * outside every panel — and sits on top of that rectangle in fixed coordinates.
 * It has to be that way round: Panel hides an inactive tab with display:none, so
 * a player parked in here would stop being visible the moment you looked at
 * the calendar, which is the one thing the feature exists to avoid.
 */

const FOLLOWING_URL = "https://www.twitch.tv/directory/following/live";
const SUBSCRIPTIONS_URL = "https://www.youtube.com/feed/subscriptions";

export async function WatchWidget({ fixtures }: { fixtures: DayboardEvent[] }) {
  // Settled on the server, like every other clock-dependent thing on the board.
  const now = DateTime.now().setZone(zone());
  const [{ videos, channelCount }, { live, problem, configured }] = await Promise.all([
    getSubscriptionVideos(),
    getLiveFollowed(),
  ]);
  const { channels } = getYouTubeConfig();
  // One channel: name the row after it, and drop the per-tile channel label as
  // redundant.
  const single = channels.length === 1 ? channels[0].name : null;

  /**
   * The cleared ones come out here rather than in the browser.
   *
   * They used to be filtered client-side against localStorage, which put the
   * whole feed in the HTML and made every consumer of the list carry a "not
   * known yet" state so it would not flash. It also meant the answer lived in
   * one Chrome profile and was lost every time the board moved — see the
   * WatchedFileSchema docblock. `videos` stays whole for the one question the
   * short list cannot answer: whether the FEED is empty, which reads very
   * differently from having watched everything in it.
   *
   * Cosmetic only, like the gate in JobsWidget: markWatched re-checks it, and
   * that check is the one that counts.
   */
  const cleared = watchedIds(loadWatched());
  const left = videos.filter((v) => !cleared.has(v.id));
  const gate = await todoGate();

  // Everything below reads the clock or formats a number for humans, so it is
  // settled here rather than in the client lists, which would hydrate into a
  // mismatch.
  const relative = Object.fromEntries(left.map((v) => [v.id, ago(v.published)]));
  const fresh = left.filter((v) => isFresh(v.published)).map((v) => v.id);
  // Only the channels that actually write titles that way — see settings.
  // Everyone else's title is left whole, which is what VideoList does with a
  // video that has no entry here.
  const splits = new Set(
    channels.filter((c) => c.titleFormat === "statement-game").map((c) => c.id),
  );
  const parts: Record<string, TitleParts> = Object.fromEntries(
    left.filter((v) => splits.has(v.channelId)).map((v) => [v.id, splitTitle(v.title)]),
  );
  const meta: Record<string, StreamMeta> = Object.fromEntries(
    live.map((stream) => [
      stream.id,
      {
        line: [stream.game || "Just Chatting", uptime(stream.startedAt)].filter(Boolean).join(" · "),
        viewers: viewers(stream.viewers),
      },
    ]),
  );

  return (
    <div className="widget watchwidget">
      <div className="widget-head">
        <h2 className="widget-title">Watch</h2>
        <span className="widget-meta">YouTube and Twitch play here.</span>
      </div>

      <div className="watchrails">
        <section className="watchrail">
          <h3 className="stack-title">
            Twitch
            {live.length > 0 && <span className="headcount">{live.length}</span>}
            <a className="headlink" href={FOLLOWING_URL} target="_blank" rel="noreferrer">
              Following →
            </a>
          </h3>
          {!configured ? (
            <p className="empty">Connect Twitch in Settings → Twitch to see who you follow live.</p>
          ) : problem ? (
            <p className="empty">{problem}</p>
          ) : live.length === 0 ? (
            // You asked for this line to stay. A blank space cannot tell you the
            // difference between a quiet Tuesday and a token that died overnight.
            <p className="empty">Nobody live.</p>
          ) : (
            <Rail count={live.length}>
              <StreamList streams={live} meta={meta} />
            </Rail>
          )}
        </section>

        <section className="watchrail">
          <h3 className="stack-title">
            {single ?? "Subscriptions"}
            {/* How many are still unwatched. The same green number the Twitch
                row uses for how many people are live, and for the same reason —
                a row title that can tell you whether to bother. Zero is silence:
                a count exists to say "there is something here", and a green 0
                beside a title is a worse way of saying nothing than nothing is. */}
            {left.length > 0 && (
              <span className="headcount" title={`${left.length} unwatched`}>
                {left.length}
              </span>
            )}
            <a className="headlink" href={SUBSCRIPTIONS_URL} target="_blank" rel="noreferrer">
              View all →
            </a>
          </h3>
          {channelCount === 0 ? (
            <p className="empty">Add channels in Settings → YouTube to see new uploads here.</p>
          ) : videos.length === 0 ? (
            <p className="empty">Nothing new from those channels lately.</p>
          ) : (
            <Rail count={left.length}>
              <VideoList
                videos={left}
                ago={relative}
                fresh={fresh}
                titles={parts}
                showChannel={!single}
                writable={gate.ok}
              />
            </Rail>
          )}
        </section>
      </div>

      {/* WatchPlayer finds this by attribute and covers it. See its docblock. */}
      <div className="watchstage" data-watchstage>
        <WatchStage>
          {fixtures.length > 0 ? (
            <GameCard event={fixtures[0]} now={now} />
          ) : (
            <p className="watchidle-none">Nothing playing.</p>
          )}
        </WatchStage>
      </div>
    </div>
  );
}
