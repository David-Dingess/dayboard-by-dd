import { Panel, type WidgetTab } from "@/components/Panel";
import { AutoRefresh } from "@/components/AutoRefresh";
import { WatchPlayer } from "@/components/WatchPlayer";
import { DeckBridge } from "@/components/DeckBridge";
import { WatchAlert } from "@/components/WatchAlert";
import { HealthAlert } from "@/components/HealthAlert";
import { NudgeTakeover } from "@/components/NudgeTakeover";
import { AlertsPrompt } from "@/components/AlertsPrompt";
import { SetupGuide } from "@/components/setup/SetupGuide";
import { isSection, type SectionId } from "@/components/setup/sections-list";
import { WatchWidget } from "@/components/widgets/WatchWidget";
import { SportsWidget } from "@/components/widgets/SportsWidget";
import { competitionsForLayer } from "@/lib/scores";
import { PlannerWidget } from "@/components/widgets/PlannerWidget";
import { loadAllEvents } from "@/lib/layers";
import { liveNow } from "@/lib/events";
import { CalendarWidget, readCalendarParams } from "@/components/widgets/CalendarWidget";
import { hasFreshVideo } from "@/lib/youtube";
import { WeatherWidget } from "@/components/widgets/WeatherWidget";
import { SubwayWidget } from "@/components/widgets/SubwayWidget";
import { QuickWidget } from "@/components/widgets/QuickWidget";
import { NowPlayingWidget } from "@/components/widgets/NowPlayingWidget";
import { LiveScoresWidget } from "@/components/widgets/LiveScoresWidget";
import { VitalsWidget } from "@/components/widgets/VitalsWidget";
import { HealthWidget } from "@/components/widgets/HealthWidget";
import { MusicWidget } from "@/components/widgets/MusicWidget";
import { MailWidget } from "@/components/widgets/MailWidget";
import { PackagesWidget } from "@/components/widgets/PackagesWidget";
import { loadMail } from "@/lib/mail";
import { loadPackages } from "@/lib/packages";
import { NotesWidget } from "@/components/widgets/NotesWidget";
import { DiscordWidget } from "@/components/widgets/DiscordWidget";
import { WaterWidget } from "@/components/widgets/WaterWidget";
import { ClaudeUsageWidget } from "@/components/widgets/ClaudeUsageWidget";
import { chairMinutes, chairOn, loadHealth } from "@/lib/health-store";
import { configured, loadSettings, publicSettings } from "@/lib/settings";
import { todoGate } from "@/lib/todo-actions";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

/** `/?setup` opens the guide on Welcome; `/?setup=sports` on that section. */
function readSetupParam(value: string | string[] | undefined): SectionId | null {
  if (value === undefined) return null;
  const one = Array.isArray(value) ? value[0] : value;
  return isSection(one) ? one : "welcome";
}

/**
 * The triboard: three columns, two of which swap between widgets and one of
 * which does not.
 *
 * THE LEFT COLUMN IS A FIXED STACK. Trains, weather, what is playing and who is
 * in voice are not alternatives you choose between — they are the things you
 * want answered by looking up, and a glance cannot press a button first. So
 * they are all on screen, all the time, with no title bars, because you can
 * tell a weather panel from a subway map without being told.
 *
 * THE CENTRE IS THE CALENDAR AND THE PLAYER. Week and month are the calendar's
 * own view modes rather than two panels arguing over one column. Watch
 * (YouTube and Twitch), Sports (the teams' streaming sites in a framed
 * browser), Music (your music service, likewise) and Health each earn a tab
 * because they are the widest things on the board, and the player itself is
 * NOT in any of them — see WatchPlayer below. Keeping it out is what lets a
 * video carry on while you look at the calendar.
 *
 * THE RIGHT COLUMN is what is coming and what needs doing: the Planner (the
 * agenda), To-Dos (the checklist and the page), the Computer, the Mail and the
 * Packages.
 *
 * WHICH WIDGETS EXIST IS A SETTING. The subway is New York only and off by
 * default; the Music tab, the Claude bars and the PC panels can each be turned
 * off; the Mail and Packages tabs appear once their pollers are configured.
 * Tabs and their children are built together below, because Panel matches them
 * by POSITION — the Nth tab is the Nth child — and building one list without
 * the other silently lands every stored tab on the wrong widget.
 *
 * Nothing on the board has a refresh button; AutoRefresh re-runs every server
 * component on a 30-second tick, and lib/memo.ts decides which of those ticks a
 * given provider actually hears about.
 */
export default async function Triboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const calendar = readCalendarParams(params);
  // Read once, up here, like everything else the page shares between a tab's
  // pulse and the widget inside it. Uncached on purpose: the settings menu
  // writes this file while the server runs.
  const settings = loadSettings();
  const gate = await todoGate();

  // Read here rather than inside the widget: the tab that pulses lives outside
  // it, and getSubscriptionVideos is memoised so both share one answer. Only the
  // video list feeds this — a stream going live is not an alert.
  const freshVideo = await hasFreshVideo();

  // Read once and shared: the nudge tick and the widget must be looking at the
  // same program, and this file is read uncached on purpose.
  const health = loadHealth();
  const healthToday = todayLocal();

  const { events, layers } = await loadAllEvents();
  const live = liveNow(events.filter((event) => layers.get(event.layer)?.fixture));
  // The teams' games belong to the Sports tab; anything else that kicks off
  // stays with Watch, where Twitch is.
  const liveTeams = live.filter((event) => competitionsForLayer(event.layer).length > 0);
  const liveOther = live.filter((event) => competitionsForLayer(event.layer).length === 0);

  // Both are uncached small files written by their agents on their own poll.
  const mail = settings.mail.enabled ? loadMail() : null;
  const packages = settings.amazon.enabled ? loadPackages() : null;

  // The centre tabs and their widgets, built as pairs so they cannot drift.
  const centre: [WidgetTab, React.ReactNode][] = [
    [{ id: "calendar", label: "Calendar" }, <CalendarWidget key="calendar" {...calendar} />],
    // Still id "watch": the id is what dayboard.panel.center and every player
    // entry's `origin` store, and renaming it would strand both. It pulses for a
    // video posted in the last half hour, or a non-team fixture kicking off.
    [
      { id: "watch", label: "Watch", alert: liveOther.length > 0 || freshVideo },
      <WatchWidget key="watch" fixtures={liveOther} />,
    ],
    // A team's match has kicked off. WatchAlert is what switches to it.
    [
      { id: "sports", label: "Sports", alert: liveTeams.length > 0 },
      <SportsWidget key="sports" events={events} layers={layers} live={liveTeams} />,
    ],
    // Its own pulse comes from the browser instead of this array — see
    // components/tab-status.ts.
    [{ id: "health", label: "Health" }, <HealthWidget key="health" file={health} />],
  ];
  if (settings.music.enabled) {
    centre.splice(1, 0, [{ id: "music", label: "Music" }, <MusicWidget key="music" />]);
  }

  const right: [WidgetTab, React.ReactNode][] = [
    [{ id: "planner", label: "Planner" }, <PlannerWidget key="planner" events={events} layers={layers} />],
    // The only place the board captures anything — a to-do and a stray thought
    // both land here — so it earns the position next to the agenda.
    [{ id: "notes", label: "To-Dos" }, <NotesWidget key="notes" />],
  ];
  // Labels are free to change; the ID IS NOT. "pc" is what dayboard.panel.right
  // stores and what setTabStatus("pc", …) keys on.
  if (settings.pc.enabled) right.push([{ id: "pc", label: "Computer" }, <VitalsWidget key="pc" />]);
  if (mail) {
    // Pulses green when there is unread — the same "new, and you have not dealt
    // with it" the green everywhere else means. Never switches the panel itself.
    right.push([{ id: "mail", label: "Mail", alert: (mail.unreadCount ?? 0) > 0 }, <MailWidget key="mail" file={mail} />]);
  }
  if (packages) {
    // No tab pulse: a parcel three days out is not something to jump the board
    // for, and "out for delivery" pulses inside the panel where it belongs.
    right.push([{ id: "amazon", label: "Packages" }, <PackagesWidget key="amazon" file={packages} />]);
  }

  return (
    <div className="triboard">
      <AutoRefresh />
      {/* Deliberately here, and deliberately propless. It is the only player on
          the board, and it survives the refresh tick precisely because it sits
          at a fixed position in this tree with nothing server-derived to key on.
          Moving it inside a panel would reload the video every thirty seconds.
          See WatchPlayer's docblock before touching this line. */}
      <WatchPlayer />
      {/* The second lane: the Sports stream window, so a match and a Twitch
          stream can both be on. The literal prop is as stable as no prop — it
          never changes, so the refresh tick still cannot remount it. */}
      <WatchPlayer lane="stream" />
      {/* The Stream Deck's end of the wire, and propless for the same reason as
          the player above it: a remount would drop its EventSource and open a
          second one on every refresh tick. */}
      <DeckBridge />
      <WatchAlert fixtureId={live[0]?.id ?? null} tab={liveTeams.length > 0 ? "sports" : "watch"} />
      {/* Propless in the same spirit as WatchPlayer: mounted here so it keeps
          its interval across the refresh tick and can fire whichever tab is up. */}
      <HealthAlert
        settings={health.settings}
        today={healthToday}
        logged={health.days[healthToday] != null && health.days[healthToday].status !== "skipped"}
        walked={health.walks.some((walk) => walk.date === healthToday)}
        chairAt={chairMinutes(chairOn(health, healthToday))}
      />

      {/* The most intrusive thing on this board, and mounted at the top of the
          tree like the player and the alerts so it survives the refresh tick and
          can cover whichever tab is up. */}
      <NudgeTakeover />

      {/* Mounted up here with the alerts it is about, and propless like them, so
          it survives the refresh tick. It shows only while the chime or the
          notifications are actually off, and never again once dismissed. */}
      <AlertsPrompt />

      {/* The settings menu and setup guide. It takes the PUBLIC settings —
          every credential reduced to "set or not" — because whatever a Server
          Component hands a client one is in the page. Opens once per window. */}
      <SetupGuide
        settings={publicSettings(settings)}
        status={configured(settings)}
        writable={gate.ok}
        initial={readSetupParam(params.setup)}
      />

      <section className="panel is-stack">
        {/* New York only, and only when turned on. Renders nothing otherwise. */}
        {settings.transit.enabled && <SubwayWidget />}
        <WeatherWidget />
        {/* Full width of the column: this is the one widget with album art and
            a live EQ in it. Do NOT put a key on it or anything wrapping it — a
            remount reconnects its EventSource. */}
        {settings.pc.enabled && <NowPlayingWidget />}
        <LiveScoresWidget events={events} layers={layers} live={live} />
        {/* A habit and a fuel gauge, sharing one row when both are on: a bottle
            and three thin bars are each half a widget's worth of height. The
            wrapper is itself a .widget so the stack's own rule keeps drawing the
            lines above and below, and so the flexible track stays on weather. */}
        {settings.claude.enabled && settings.pc.enabled ? (
          <div className="widget stackrow is-water">
            <WaterWidget />
            <ClaudeUsageWidget />
          </div>
        ) : (
          <WaterWidget />
        )}
        {/* Who is in voice is the one thing in this column that is about other
            people, and it reads better next to the controls you would reach for
            on seeing it than wedged between the scores and the water. */}
        <DiscordWidget />
        {/* Last, and the only row on the board that is all controls. */}
        <QuickWidget settings={health.settings} />
      </section>

      <Panel side="center" tabs={centre.map(([tab]) => tab)}>
        {centre.map(([, widget]) => widget)}
      </Panel>

      <Panel side="right" tabs={right.map(([tab]) => tab)}>
        {right.map(([, widget]) => widget)}
      </Panel>
    </div>
  );
}
