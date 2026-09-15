import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The MTA's station list, for the setup guide's home-station picker.
 *
 * A route rather than a prop: the list is 500 stations, and the guide is
 * mounted on every render of a page that re-renders every thirty seconds.
 * Fetched once when the Transit section is opened with the widget on.
 *
 * data/config/mta-stops.json is derived from the MTA's public Stations.csv
 * (data.ny.gov, dataset 39hk-dx4f): GTFS stop id, name, borough, daytime
 * routes and the two direction labels.
 */
export function GET() {
  try {
    const body = readFileSync(path.join(process.cwd(), "data", "config", "mta-stops.json"), "utf8");
    return new Response(body, {
      headers: { "content-type": "application/json", "cache-control": "private, max-age=86400" },
    });
  } catch {
    return Response.json([], { status: 200 });
  }
}
