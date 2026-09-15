import { getSubway, lineColor, lineInk, linesFromSettings, type Arrival } from "@/lib/subway";
import { LineStatus, type LineState } from "@/components/LineStatus";
import { Freshness } from "@/components/Freshness";
import { TrainTimes } from "@/components/TrainTimes";

function Bullet({ route, size = 26 }: { route: string; size?: number }) {
  return (
    <span
      className="bullet"
      style={{
        background: lineColor(route),
        color: lineInk(route),
        width: size,
        height: size,
        fontSize: Math.round(size * 0.54),
      }}
      aria-label={`${route} train`}
    >
      <span className="bullet-label">{route}</span>
    </span>
  );
}

function TrainTile({
  route,
  place,
  arrivals,
}: {
  route: string;
  place: string;
  arrivals: Arrival[] | null;
}) {
  return (
    <div className="traintile">
      <span className="traintile-head">
        <Bullet route={route} size={28} />
        <span className="traintile-place">{place}</span>
      </span>

      {arrivals === null ? (
        <span className="traintile-none">no data</span>
      ) : (
        // "nothing soon" lives in there too: the countdown can retire the last
        // train on the list before the next refresh does.
        <TrainTimes arrivals={arrivals} />
      )}
    </div>
  );
}

export async function SubwayWidget() {
  const lines = linesFromSettings();
  if (!lines.length) return null;
  const { ok, alerts, arrivals, fetchedAt } = await getSubway(lines);

  const states: LineState[] = lines.map((line) => ({
    route: line.route,
    segmentLabel: line.segmentLabel,
    alerts: alerts.get(line.route) ?? [],
  }));

  const tiles = lines.filter((l) => l.arrivalStop);

  return (
    <div className="widget">
      <h2 className="stack-title">
        Subway
        <Freshness fetchedAt={fetchedAt} />
      </h2>

      <div className="widget-scroll">
        {/* The status grid and the trains share one row — see .subwaybody. The
            bullets are three rows tall, which is what the tiles beside them
            already were. */}
        <div className="subwaybody">
          {ok ? (
            <LineStatus lines={states} />
          ) : (
            <p className="empty">Couldn&apos;t reach the MTA alerts feed.</p>
          )}

          <section className="traintiles">
          {tiles.map((line) => (
            <TrainTile
              key={line.route}
              route={line.route}
              place={line.arrivalPlace ?? ""}
              arrivals={arrivals.get(line.route) ?? null}
            />
          ))}
          </section>
        </div>
      </div>
    </div>
  );
}
