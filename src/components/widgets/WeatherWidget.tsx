import Link from "next/link";
import { DateTime } from "luxon";
import { getForecast, formatHour, nextHours, weatherFx, type HourWeather } from "@/lib/weather";
import { WeatherFx } from "@/components/WeatherFx";
import { getAir, readUv, type Reading } from "@/lib/air";
import { zone, todayLocal } from "@/lib/time";
import { relativeDay } from "@/lib/events";
import { sunBar } from "@/lib/sun";
import { loadSettings } from "@/lib/settings";
import { Freshness } from "@/components/Freshness";

/**
 * Conditions now beside the next twelve hours, then the next five days as tiles.
 *
 * THIS WIDGET IS THE STACK'S BUDGET. It is the only `is-flex` track in the left
 * column, so every other widget takes the height it needs and whatever is left
 * belongs to the weather. When Up Next and the Quick row moved in, ~240px had to
 * come from here — so the twelve hours went from a wide strip of bordered tiles
 * to a 4x3 grid of plain lines beside the current conditions, the week ahead
 * went from five tall tiles to five two-column ones, and TOMORROW'S HOUR STRIP
 * WENT ENTIRELY — tomorrow is the first tile of the week ahead, and twelve more
 * cells said the same thing at ten times the height. The hours that remain roll
 * with the clock, so the grid is full at six in the evening as well as at eight
 * in the morning.
 */

// Twelve, as four columns of three beside the conditions tile. They are the
// NEXT twelve from right now rather than a window of the day — see nextHours.
const HOURS_AHEAD = 12;
const DAYS_AHEAD = 5;

/**
 * The next twelve hours as four columns of three, filled downward: the first
 * three hours in column one, the next three in column two. The markup is a
 * plain list in time order; the grid does the rest.
 */
function HourGrid({ hours }: { hours: HourWeather[] }) {
  if (!hours.length) return null;
  return (
    <ul className="hours is-compact">
      {hours.map((hour) => (
        <li key={hour.time} className="hour">
          <span className="hour-time">{formatHour(hour.hour)}</span>
          <span className="hour-glyph" aria-hidden title={hour.label}>
            {hour.glyph}
          </span>
          <span className="hour-temp">{hour.temp}°</span>
          {hour.precipChance !== null && hour.precipChance >= 20 ? (
            <span className="hour-precip">{hour.precipChance}%</span>
          ) : (
            <span className="hour-precip" />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * One reading — a number, and what it means for going outside.
 *
 * The sentence is the point and the number is the evidence: "AQI 62" is not
 * something anyone can act on without a lookup table, and a board exists so
 * nobody has to look anything up.
 */
/**
 * The whole day as one 6px strip, with now on it.
 *
 * Sunrise and sunset are already two numbers in the Quick row, and they answer a
 * smaller question than the one being asked — "how much light is left, and is it
 * about to go gold". The distance from the marker to the right edge of the pale
 * band is that answer, read without reading anything.
 *
 * Bands as flex children rather than a gradient string, so the four colours live
 * in CSS where the rest of the palette is. Server-rendered and never ticked: the
 * marker moves a fifth of a pixel between refreshes, which is not worth a client
 * component. lib/sun.ts does the astronomy, offline, from a latitude.
 */
function DaylightBar() {
  const sun = sunBar();
  if (!sun || sun.bands.length === 0) return null;

  return (
    <div className="sunrow">
      <span className="sunrow-end">{sun.sunrise}</span>
      <span className="sunbar" title={sun.length ? `${sun.length} of daylight` : undefined}>
        {sun.bands.map((band) => (
          <span
            key={`${band.kind}-${band.from}`}
            className={`sunband is-${band.kind}`}
            style={{ width: `${band.to - band.from}%` }}
          />
        ))}
        <span className="sunbar-now" style={{ left: `${sun.at}%` }} />
      </span>
      <span className="sunrow-end">{sun.sunset}</span>
    </div>
  );
}

function AirReading({ label, reading }: { label: string; reading: Reading | null }) {
  if (!reading) return null;
  return (
    <li className={`airitem is-${reading.level}`}>
      <span className="airitem-head">
        <span className="airitem-label">{label}</span>
        <span className="airitem-value">{reading.value}</span>
      </span>
      <span className="airitem-advice">{reading.advice}</span>
    </li>
  );
}

export async function WeatherWidget() {
  // Two providers, both keyless, fetched together rather than in series — the
  // air model is a separate Open-Meteo endpoint and there is no reason for the
  // panel to wait on one before starting the other.
  const [{ now, hours, days, fetchedAt, units, configured }, air] = await Promise.all([
    getForecast(),
    getAir(),
  ]);
  const windUnit = units === "metric" ? "km/h" : "mph";
  const place = loadSettings().location.label;
  const today = todayLocal();

  const ahead = [...days.values()].filter((d) => d.date > today).slice(0, DAYS_AHEAD);
  const todayDay = days.get(today);

  // is-flex: the one widget in the left stack allowed to absorb a short column.
  // See `.panel.is-stack > .widget.is-flex` in globals.css — that used to be
  // :nth-child(2), which meant the give moved if anything was inserted above.
  return (
    <div className="widget is-flex wxwidget">
      {/* ONE LAYER, BEHIND THE WHOLE SECTION, and only for what it is doing
          outside RIGHT NOW. Per-tile particles meant Thursday's forecast rained
          on Thursday's tile while the window showed a clear evening — which is
          a forecast, not weather. This is the room's own weather, drawn behind
          everything. */}
      <WeatherFx kind={weatherFx(now?.code ?? -1, now?.wind == null ? null : units === "metric" ? now.wind * 0.6214 : now.wind)} />
      <h2 className="stack-title">
        Weather
        <span className="stack-meta">{place || "No location set"}</span>
        {/* A forecast is fetched every 15 minutes on purpose, so it is only
            worth flagging once it has been silent for the best part of an hour. */}
        <Freshness fetchedAt={fetchedAt} staleAfterMs={2_700_000} />
      </h2>

      <div className="widget-scroll">
        {!configured ? (
          <p className="empty">
            Set your location in <Link href="/?setup=location">Settings</Link> to see the weather here.
          </p>
        ) : !now && !days.size ? (
          <p className="empty">No forecast right now.</p>
        ) : (
          <>
            <section className="wxtop">
              {now && (
                <section className="wxnow">
                  <span className="wxnow-glyph" aria-hidden>
                    {now.glyph}
                  </span>
                  <span className="wxnow-temp">{now.temp}°</span>
                  <span className="wxnow-body">
                    <span className="wxnow-label">{now.label}</span>
                    <span className="wxnow-detail">
                      Feels {now.feelsLike}°
                      {now.humidity !== null && ` · ${now.humidity}% humidity`}
                      {now.wind !== null && ` · ${now.wind} ${windUnit}`}
                    </span>
                    {todayDay && (
                      <span className="wxnow-detail">
                        High {todayDay.high}° · Low {todayDay.low}°
                      </span>
                    )}
                  </span>
                </section>
              )}
              {/* Sunset moved to the Quick row at the bottom of the stack, where
                  it sits with the clock — the two questions are the same one. */}
              <HourGrid hours={nextHours(hours, HOURS_AHEAD)} />
            </section>

            <DaylightBar />

            {/* Between today's hours and the week ahead, which is where it
                belongs: all three are facts about going outside TODAY, and the
                week is a different question. */}
            {(air.aqi || air.pollen || todayDay?.uv != null) && (
              <ul className="airrow">
                <AirReading label="Air" reading={air.aqi} />
                <AirReading label="UV" reading={readUv(todayDay?.uv)} />
                <AirReading label="Pollen" reading={air.pollen} />
              </ul>
            )}

            {ahead.length > 0 && (
              <section className="hourblock">
                <h3 className="hourblock-title">The week ahead</h3>
                <ul className="ahead">
                  {ahead.map((day) => {
                    const dt = DateTime.fromISO(day.date, { zone: zone() });
                    return (
                      // Five tiles, one row, sharing the column equally — and
                      // TWO COLUMNS INSIDE each one. The glyph spans both lines
                      // beside the words rather than sitting above them, which
                      // is what turns a five-line tile into a two-line one
                      // without dropping anything from it.
                      <li key={day.date} className="ahead-tile">
                        <span className="ahead-glyph" aria-hidden title={day.label}>
                          {day.glyph}
                        </span>
                        <span className="ahead-when">
                          <span className="ahead-day">
                            {relativeDay(day.date, today) ?? dt.toFormat("ccc")}
                          </span>
                          <span className="ahead-date">{dt.toFormat("d LLL")}</span>
                        </span>
                        <span className="ahead-read">
                          <span className="ahead-temps">
                            <span className="weather-high">{day.high}°</span>
                            <span className="weather-low">{day.low}°</span>
                          </span>
                          {day.precipChance !== null && day.precipChance >= 20 ? (
                            <span className="ahead-precip">{day.precipChance}%</span>
                          ) : (
                            <span className="ahead-precip" />
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
