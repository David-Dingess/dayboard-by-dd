import { DateTime } from "luxon";
import type { DayboardEvent, Layer } from "@/lib/schema";
import { competitionsForLayer, getScore, type LiveScore } from "@/lib/scores";
import { formatTimeOnly, localDate, zone, toInstant } from "@/lib/time";
import { relativeDay } from "@/lib/events";
import { Freshness } from "@/components/Freshness";
import { LayerMark } from "@/components/LayerMark";
import { nearestFirst } from "@/lib/fixture-text";

/**
 * Every team, at once — five tiles across the column.
 *
 * It used to render exactly ONE fixture: whichever was live, or the single next
 * one on the board. That answered "is anything on right now" and nothing else,
 * so one club's kickoff three hours away was invisible behind another's game,
 * and "when do they next play" was still a question for the calendar.
 * A cell each answers both, and answers them without being asked.
 *
 * WHICH CELLS THERE ARE IS NOT A LIST IN HERE. The tiles are every layer marked
 * `fixture` — the four teams whose competitionsForLayer() is non-empty, and
 * everything else — a fixture layer with no competitions — ordered by whose
 * game is nearest (see nearestFirst). Add a team to upstreams.json and it takes
 * a tile; nothing here changes.
 *
 * IT WAS A 2x2 WITH A WIDE ROW UNDERNEATH, which spent height the left
 * column no longer has: the stack gained Up next and the Quick row, and this sat
 * beside Now Playing at 40% of a shared row. Five across is the same five facts
 * in one band, and it matches the two rows of five directly above it — the week
 * ahead and Up next — so the column reads as three bands rather than three
 * different ideas.
 *
 * A cell still carries an opponent and a kickoff but NOT a countdown as well,
 * and a second live game lights a tile that was already there rather than
 * adding anything.
 *
 * WHEN NOTHING IS LIVE IT MAKES NO NETWORK CALL AT ALL. Fixtures and kickoffs
 * come from the JSON already in memory, which is most days of the week;
 * lib/scores.ts is reached once per live game and no other time.
 */

const clockFor = (score: LiveScore) => (score.state === "post" ? score.clock || "FT" : score.clock);

/**
 * "vs Orlando City SC", "at Manchester United" — the half of the title your team
 * is not.
 *
 * Feeds spell a fixture three ways ("A vs B", "A - B", "A @ B"), and which side
 * is yours differs by sport, so the layer NAME is what picks it out: "Arsenal"
 * sits inside "Arsenal FC", "Bears" inside "Chicago Bears". Exactly
 * one side has to match, or this hands back the whole title untouched — which is
 * also what a tournament gets, since "Big Tournament 2026" has no other side.
 */
const SIDES = /\s+(?:vs\.?|v\.?|@|at|[-–—])\s+/i;

function opponent(title: string, layerName: string | undefined): string {
  if (!layerName) return title;
  const parts = title.split(SIDES);
  if (parts.length !== 2) return title;
  const needle = layerName.toLowerCase();
  const mine = parts.map((p) => p.toLowerCase().includes(needle));
  if (mine[0] === mine[1]) return title;
  return mine[0] ? `vs ${parts[1]}` : `at ${parts[0]}`;
}

const shortDay = (date: string, today: string) =>
  relativeDay(date, today) ?? DateTime.fromISO(date, { zone: zone() }).toFormat("ccc d LLL");

/**
 * "Today · 7:30pm", "Wed 9 Sep · 7:30pm", and for a tournament the days it runs.
 *
 * A MULTI-DAY EVENT IS SHOWN BY ITS LAST DAY, not its first. That is the
 * rule about tournaments and it is a real one: a major starts on Friday with pools
 * nobody watches and ends on Sunday with top eight, which is the part worth
 * being in front of. So the span reads "Fri 11 – Sun 13 Sep" and the day that
 * matters is the one it ends on.
 *
 * There is no start TIME on those, deliberately. A tournament's schedule lives
 * in a JPEG of six parallel streams, and inventing a kickoff from an all-day
 * event would be the board stating something nobody actually knows.
 *
 * An all-day DTEND is exclusive, so the last day is the day before it.
 */
function whenLabel(event: DayboardEvent, today: string): string {
  const first = localDate(event.start);

  if (event.allDay) {
    const last = event.end
      ? DateTime.fromISO(localDate(event.end), { zone: zone() }).minus({ days: 1 }).toISODate()!
      : first;
    if (last > first) return `${shortDay(first, today)} – ${shortDay(last, today)}`;
    return shortDay(first, today);
  }

  const day =
    relativeDay(first, today) ??
    DateTime.fromISO(event.start, { setZone: true }).setZone(zone()).toFormat("ccc d LLL");
  return `${day} · ${formatTimeOnly(event.start)}`;
}

/** How long a game has been running, when ESPN cannot tell us. */
function elapsed(event: DayboardEvent, now: number): string {
  const minutes = Math.max(0, Math.round((now - toInstant(event.start)) / 60_000));
  return minutes < 60 ? `${minutes}m in` : `${Math.floor(minutes / 60)}h ${minutes % 60}m in`;
}

interface Cell {
  layer: Layer;
  event: DayboardEvent | null;
  isLive: boolean;
  score: LiveScore | null;
  /** ESPN was asked and could not answer. The cell degrades; it never throws. */
  problem: boolean;
  /** The real load time behind the score, or null when nothing was fetched. */
  fetchedAt: string | null;
}

function ScoreLine({ score }: { score: LiveScore }) {
  return (
    <p className="sgrid-score">
      <span className="sgrid-abbr">{score.home.abbr}</span>
      <span className="sgrid-num">{score.home.score ?? "–"}</span>
      <span className="sgrid-dash">–</span>
      <span className="sgrid-num">{score.away.score ?? "–"}</span>
      <span className="sgrid-abbr">{score.away.abbr}</span>
    </p>
  );
}

function CellBody({ cell, today, now }: { cell: Cell; today: string; now: number }) {
  if (!cell.event) {
    return <p className="sgrid-line is-empty">Nothing scheduled.</p>;
  }

  if (cell.isLive) {
    return (
      <>
        {cell.score ? (
          <ScoreLine score={cell.score} />
        ) : (
          // ESPN had no line for this fixture, or could not answer at all. Say
          // what we do know — never invent a 0-0.
          <p className="sgrid-line">{opponent(cell.event.title, cell.layer.name)}</p>
        )}
        <p className="sgrid-when is-on">
          {cell.score
            ? clockFor(cell.score)
            : cell.event.allDay
              ? whenLabel(cell.event, today)
              : elapsed(cell.event, now)}
          {cell.problem && " · no ESPN"}
        </p>
      </>
    );
  }

  return (
    <>
      <p className="sgrid-line">{opponent(cell.event.title, cell.layer.name)}</p>
      <p className="sgrid-when">{whenLabel(cell.event, today)}</p>
    </>
  );
}

function CellCard({ cell, today, now }: { cell: Cell; today: string; now: number }) {
  return (
    <li
      className={`sgrid-cell${cell.isLive ? " is-on" : ""}`}
      style={{ ["--sgrid-accent" as string]: cell.layer.color }}
    >
      <p className="sgrid-team">
        <LayerMark layer={cell.layer} size={15} className="sgrid-mark" />
        <span className="sgrid-name">{cell.layer.name}</span>
      </p>
      <CellBody cell={cell} today={today} now={now} />
    </li>
  );
}

export async function LiveScoresWidget({
  events,
  layers,
  live,
}: {
  events: DayboardEvent[];
  layers: Map<string, Layer>;
  /** Already computed in page.tsx for the Watch tab's pulse. */
  live: DayboardEvent[];
}) {
  // One hoisted read. Five cells would otherwise build five DateTimes, the same
  // trap the month grid's `now` exists to avoid.
  const nowDt = DateTime.now().setZone(zone());
  const now = nowDt.toMillis();
  const today = nowDt.toISODate()!;

  const tracked = [...layers.values()].filter((l) => l.fixture).sort((a, b) => a.order - b.order);
  const teams = tracked.filter((l) => competitionsForLayer(l.id).length > 0);
  const rest = tracked.filter((l) => competitionsForLayer(l.id).length === 0);

  const soonest = (a: DayboardEvent, b: DayboardEvent) => toInstant(a.start) - toInstant(b.start);

  const build = async (layer: Layer): Promise<Cell> => {
    const onNow = live.filter((e) => e.layer === layer.id).sort(soonest)[0];
    if (onNow) {
      // The one request-time call to a third party on this board, and only ever
      // for a game that has actually started.
      const { score, problem, fetchedAt } = await getScore(onNow);
      return { layer, event: onNow, isLive: true, score, problem: Boolean(problem), fetchedAt };
    }

    // All-day fixture events (multi-day tournaments) span multiple days and are excluded
    // from liveNow() to keep the Watch tab quiet — but the tile itself should
    // glow when the tournament is happening right now.
    const allDayNow = events
      .filter((e) => e.layer === layer.id && e.allDay && e.status !== "cancelled")
      .find((e) => {
        const start = localDate(e.start);
        const end = e.end ? localDate(e.end) : start;
        return start <= today && today < end;
      });
    if (allDayNow) {
      return { layer, event: allDayNow, isLive: true, score: null, problem: false, fetchedAt: null };
    }

    const next = events
      .filter((e) => e.layer === layer.id && e.status !== "cancelled" && toInstant(e.start) > now)
      .sort(soonest)[0];
    return { layer, event: next ?? null, isLive: false, score: null, problem: false, fetchedAt: null };
  };

  // In parallel: awaiting them one after another would be four round trips on
  // the one afternoon all four of them are somehow playing at once.
  const [teamCells, restCells] = await Promise.all([
    Promise.all(teams.map(build)),
    Promise.all(rest.map(build)),
  ]);

  // The OLDEST load behind any cell, not the newest and certainly not `now`:
  // one label covers several fetches, so it has to report the worst of them or
  // it is telling you the board is fresher than it is.
  // NEAREST FIRST, whoever it is. The tiles used to sit in layer order — the
  // the clubs, then the rest — which put one game six weeks out ahead of
  // another on Tuesday. What is on now leads, then whatever starts soonest,
  // and a side with nothing scheduled goes to the end.
  const cells = nearestFirst([...teamCells, ...restCells], (cell) =>
    cell.event ? { live: cell.isLive, start: toInstant(cell.event.start) } : null,
  );

  const oldestFetch = cells
    .map((c) => c.fetchedAt)
    .filter((at): at is string => at !== null)
    .sort()[0];

  return (
    <div className="widget">
      <h2 className="stack-title">
        Sports
        {/* A stale score rots faster than anything else on this board, so it is
            flagged at 90 seconds rather than the default three minutes. Absent
            entirely when nothing is live, because then nothing was fetched. */}
        {oldestFetch && <Freshness fetchedAt={oldestFetch} staleAfterMs={90_000} />}
      </h2>

      <div className="widget-scroll">
        <ul className="sgrid">
          {cells.map((cell) => (
            <CellCard key={cell.layer.id} cell={cell} today={today} now={now} />
          ))}
        </ul>
      </div>
    </div>
  );
}
