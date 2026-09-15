import { buildCalendar, expandForFeed } from "@/lib/ics";
import { loadSettings } from "@/lib/settings";
import { todayLocal } from "@/lib/time";
import { loadCuratedEvents, loadHealthEvents, getLayer, layersInFeed } from "@/lib/layers";
import { feedTokenIsValid } from "@/lib/auth";

/**
 * The subscribable feed. iOS Calendar cannot log in, so authorisation here is a
 * long random token in the path rather than the session cookie the rest of the
 * site uses — and a bad token 404s rather than 401ing, so the path gives away
 * nothing about what lives here.
 *
 * /feeds/<token>/dayboard.ics    every curated layer
 * /feeds/<token>/<layer>.ics     one layer, so it can get its own colour on the phone
 */

export const dynamic = "force-dynamic";

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; name: string }> },
) {
  const { token, name } = await params;

  if (!feedTokenIsValid(token)) return notFound();
  if (!name.endsWith(".ics")) return notFound();

  const slug = name.slice(0, -".ics".length);
  // The Health sessions are generated rather than stored, so they are not in
  // loadCuratedEvents() and have to be added here as well as on the board.
  const events = [...loadCuratedEvents(), ...loadHealthEvents()];
  const feedLayers = layersInFeed();

  let selected;
  let calendarName;

  if (slug === "dayboard") {
    const ids = new Set(feedLayers.map((l) => l.id));
    selected = events.filter((event) => ids.has(event.layer));
    calendarName = "Dayboard";
  } else {
    const layer = getLayer(slug);
    if (!layer || !layer.inFeed) return notFound();
    selected = events.filter((event) => event.layer === layer.id);
    calendarName = `Dayboard — ${layer.name}`;
  }

  const body = buildCalendar({
    name: calendarName,
    // Rules this feed cannot express safely become dated instances first; a
    // plain yearly birthday keeps its single RRULE VEVENT. See expandForFeed.
    events: expandForFeed(selected, todayLocal()),
    siteUrl: `http://localhost:${loadSettings().board.port}`,
  });

  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${slug}.ics"`,
      // Private: the token is a credential, so no shared cache should hold this.
      "cache-control": "private, max-age=0, must-revalidate",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
