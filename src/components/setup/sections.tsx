"use client";

import { useEffect, useState } from "react";
import type { PublicSettings } from "@/lib/settings";
import {
  beginTwitchAuth,
  importBirthdays,
  importYouTube,
  leagues,
  refreshSchedules,
  rotateFeedToken,
  searchPlaces,
  teamsIn,
  twitchAuthState,
  updateSettings,
} from "@/lib/settings-actions";
import type { Place } from "@/lib/settings-checks";
import type { EspnTeamSummary, League } from "@/lib/espn-teams";
import type { SectionProps } from "./SetupGuide";
import { CheckButton, Command, Field, Lead, Lines, Note, SaveBar, Secret, Select, Steps, Text, Toggle } from "./fields";

/**
 * The form-heavy sections: the ones with a list to edit or a credential to
 * hold. Each keeps a draft of its own top-level section and saves it whole —
 * see applyPatch in lib/settings.ts for why whole sections.
 */

type Draft<K extends keyof PublicSettings> = PublicSettings[K];

/* ------------------------------------------------------------ location --- */

export function LocationSection({ settings, writable }: SectionProps) {
  const [loc, setLoc] = useState<Draft<"location">>(settings.location);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const dirty = JSON.stringify(loc) !== JSON.stringify(settings.location);

  const search = async () => {
    setSearching(true);
    try {
      const result = await searchPlaces(query);
      setPlaces(result.places);
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <Lead>
        Weather, air quality, sunrise and sunset, and the timezone every date on the board is
        computed in. From Open-Meteo, which needs no key and no account.
      </Lead>
      <Field label="Find your city" hint="A city or town; add the country for a common name (“Springfield, US”). Press Enter.">
        <span className="setup-row">
          <Text value={query} disabled={!writable} placeholder="e.g. Manchester, UK" onChange={setQuery} />
          <button type="button" className="setup-btn" disabled={!writable || searching || query.trim().length < 2} onClick={() => void search()}>
            {searching ? "Searching…" : "Search"}
          </button>
        </span>
      </Field>
      {places.length > 0 && (
        <ul className="setup-picks">
          {places.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button
                type="button"
                className="setup-pick"
                onClick={() => {
                  setLoc({ ...loc, label: p.label, lat: p.lat, lon: p.lon, timezone: p.timezone || loc.timezone, zip: p.zip || loc.zip });
                  setPlaces([]);
                }}
              >
                {p.label} <span>{p.timezone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="setup-grid">
        <Field label="Shown as">
          <Text value={loc.label} disabled={!writable} onChange={(label) => setLoc({ ...loc, label })} />
        </Field>
        <Field label="Timezone" hint="IANA name, e.g. Europe/London. Empty uses this machine's.">
          <Text mono value={loc.timezone} disabled={!writable} onChange={(timezone) => setLoc({ ...loc, timezone })} />
        </Field>
        <Field label="Latitude">
          <Text mono value={loc.lat === null ? "" : String(loc.lat)} disabled={!writable} onChange={(v) => setLoc({ ...loc, lat: v === "" ? null : Number(v) })} />
        </Field>
        <Field label="Longitude">
          <Text mono value={loc.lon === null ? "" : String(loc.lon)} disabled={!writable} onChange={(v) => setLoc({ ...loc, lon: v === "" ? null : Number(v) })} />
        </Field>
        <Field label="Units">
          <Select value={loc.units} disabled={!writable} options={[{ value: "imperial", label: "°F, mph" }, { value: "metric", label: "°C, km/h" }]} onChange={(units) => setLoc({ ...loc, units })} />
        </Field>
        <Field label="US ZIP (optional)" hint="Pollen comes from pollen.com, which is keyed by ZIP and covers the US only.">
          <Text mono value={loc.zip} disabled={!writable} onChange={(zip) => setLoc({ ...loc, zip })} />
        </Field>
      </div>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ location: loc })}>
        <CheckButton name="location" label="Check the forecast" />
      </SaveBar>
    </>
  );
}

/* ----------------------------------------------------------- calendars --- */

export function CalendarsSection({ settings, writable }: SectionProps) {
  const [cals, setCals] = useState<Draft<"calendars">>(settings.calendars);
  const [token, setToken] = useState(settings.feed.current);
  const dirty = JSON.stringify(cals) !== JSON.stringify(settings.calendars);
  const edit = (i: number, patch: Partial<Draft<"calendars">[number]>) =>
    setCals(cals.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <>
      <Lead>
        Any calendar that publishes an ICS address shows on the board in its own colour: Google,
        iCloud, Outlook, a work Exchange calendar, Partiful. The address is a credential — anyone
        holding it can read that calendar — so it stays in the ignored settings file.
      </Lead>
      {cals.map((cal, i) => (
        <div className="setup-card" key={i}>
          <div className="setup-grid">
            <Field label="Name">
              <Text value={cal.label} disabled={!writable} onChange={(label) => edit(i, { label })} />
            </Field>
            <Field label="Colour">
              <span className="setup-colour">
                <input type="color" value={cal.color ?? "#7fb2e5"} disabled={!writable} onChange={(e) => edit(i, { color: e.target.value })} />
              </span>
            </Field>
            <Field label="ICS address" wide>
              <Text mono type="url" value={cal.url} disabled={!writable} placeholder="https://… or webcal://…" onChange={(url) => edit(i, { url })} />
            </Field>
            <Field label="Hide titles matching (regex, one per line)" wide hint="Case-insensitive, matched against the whole title. Useful for standing holds in a work calendar: ^lunch$, ^breakfast$.">
              <Lines value={cal.hide} rows={2} disabled={!writable} onChange={(hide) => edit(i, { hide })} />
            </Field>
          </div>
          <button type="button" className="setup-btn is-small is-quiet" disabled={!writable} onClick={() => setCals(cals.filter((_, j) => j !== i))}>
            Remove this calendar
          </button>
        </div>
      ))}
      <button type="button" className="setup-btn" disabled={!writable || cals.length >= 30} onClick={() => setCals([...cals, { label: "", url: "", hide: [] }])}>
        + Add a calendar
      </button>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ calendars: cals.filter((c) => c.label && c.url) })}>
        <CheckButton name="calendars" label="Check the feeds" />
      </SaveBar>

      <h4>Where the address is</h4>
      <Steps>
        <li>
          <strong>Google</strong>: calendar.google.com → Settings → pick the calendar → <strong>Integrate
          calendar</strong> → <strong>Secret address in iCal format</strong>. If it ever leaks, press Reset
          there.
        </li>
        <li>
          <strong>iCloud</strong>: Calendar app → share the calendar → <strong>Public Calendar</strong> →
          copy the webcal link.
        </li>
        <li>
          <strong>Outlook.com</strong>: Settings → Calendar → <strong>Shared calendars</strong> →
          Publish a calendar → <strong>Can view all details</strong> → the ICS link.
        </li>
        <li>
          <strong>Work (Exchange / Microsoft 365)</strong>: Outlook on the web → Settings → Calendar →
          Shared calendars → publish, as above. Big feeds take a while; the board keeps the last
          copy while it refreshes.
        </li>
      </Steps>

      <h4>The other direction: this board on your phone</h4>
      <p>
        Everything on the board — the teams&apos; fixtures with alarms an hour before kickoff, the
        birthdays, the health sessions — is also published as an ICS feed your phone can subscribe
        to. The path carries a token, because a phone cannot log in.
      </p>
      <span className="setup-row">
        <Text mono value={token || "(no token yet)"} onChange={() => {}} disabled />
        <button
          type="button"
          className="setup-btn"
          disabled={!writable}
          onClick={async () => {
            const r = await rotateFeedToken();
            if (r.ok && r.token) setToken(r.token);
          }}
        >
          {token ? "Rotate" : "Create a token"}
        </button>
      </span>
      {token && (
        <Note>
          Subscribe on the phone to{" "}
          <code>
            http://&lt;this computer&apos;s address&gt;:{settings.board.port}/feeds/{token}/dayboard.ics
          </code>{" "}
          — iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.
          The board only listens on this machine, so reaching it from a phone needs the server on
          the same network or a tunnel; the feed is more useful on a machine that is always on.
        </Note>
      )}
    </>
  );
}

/* ----------------------------------------------------------- birthdays --- */

export function BirthdaysSection({ settings, writable }: SectionProps) {
  const [rows, setRows] = useState<Draft<"birthdays">>(settings.birthdays);
  const [csv, setCsv] = useState("");
  const [imported, setImported] = useState<string | null>(null);
  const dirty = JSON.stringify(rows) !== JSON.stringify(settings.birthdays);
  const edit = (i: number, patch: Partial<Draft<"birthdays">[number]>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <>
      <Lead>
        Birthdays become yearly all-day events on their own layer, on the board and in the phone
        feed with a 9am reminder. No year needed.
      </Lead>
      <div className="setup-rows">
        {rows.map((r, i) => (
          <div className="setup-row" key={i}>
            <Text value={r.name} disabled={!writable} placeholder="Name" onChange={(name) => edit(i, { name })} />
            <Text type="number" value={String(r.month)} disabled={!writable} onChange={(v) => edit(i, { month: Number(v) || 1 })} />
            <Text type="number" value={String(r.day)} disabled={!writable} onChange={(v) => edit(i, { day: Number(v) || 1 })} />
            <button type="button" className="setup-btn is-small is-quiet" disabled={!writable} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="setup-btn" disabled={!writable} onClick={() => setRows([...rows, { name: "", month: 1, day: 1 }])}>
        + Add a birthday
      </button>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ birthdays: rows.filter((r) => r.name.trim()) })} />

      <h4>Or paste a list</h4>
      <p>
        One per line as <code>name,month,day</code> — which is also the shape of a Facebook birthdays
        export (<code>Name,Month,Day,Link to Profile</code>; the link is ignored). Existing names are
        kept; new ones are added.
      </p>
      <textarea className="setup-input is-mono" rows={5} value={csv} disabled={!writable} placeholder={"name,month,day\nAda Lovelace,12,10"} onChange={(e) => setCsv(e.target.value)} />
      <span className="setup-row">
        <button
          type="button"
          className="setup-btn"
          disabled={!writable || !csv.trim()}
          onClick={async () => {
            const r = await importBirthdays(/^\s*name\s*,/i.test(csv) ? csv : `name,month,day\n${csv}`);
            setImported(r.ok ? `Added ${r.added ?? 0}.` : (r.error ?? "That did not import."));
          }}
        >
          Import
        </button>
        {imported && <span className="setup-check-result">{imported}</span>}
      </span>
    </>
  );
}

/* -------------------------------------------------------------- sports --- */

export function SportsSection({ settings, writable }: SectionProps) {
  const [teams, setTeams] = useState<Draft<"sports">["teams"]>(settings.sports.teams);
  const [leagueList, setLeagueList] = useState<League[]>([]);
  const [league, setLeague] = useState("");
  // Loaded for one league at a time; "loading" is the league not matching.
  const [loaded, setLoaded] = useState<{ league: string; teams: EspnTeamSummary[]; problem: string | null }>({
    league: "",
    teams: [],
    problem: null,
  });
  const loading = Boolean(league) && loaded.league !== league;
  const teamList = loaded.league === league ? loaded.teams : [];
  const problem = loaded.league === league ? loaded.problem : null;
  const [icsName, setIcsName] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [refreshed, setRefreshed] = useState<string | null>(null);
  const dirty = JSON.stringify(teams) !== JSON.stringify(settings.sports.teams);

  useEffect(() => {
    void leagues().then((list) => {
      setLeagueList(list);
      if (!league && list[0]) setLeague(list[0].key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!league) return;
    let stale = false;
    void teamsIn(league).then((r) => {
      if (stale) return;
      setLoaded({ league, teams: r.teams, problem: r.ok ? null : (r.error ?? "ESPN did not answer.") });
    });
    return () => {
      stale = true;
    };
  }, [league]);

  const slug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

  const addEspn = (t: EspnTeamSummary) => {
    const id = slug(t.name) || t.id;
    if (teams.some((x) => x.id === id)) return;
    setTeams([
      ...teams,
      { id, name: t.name, homeVenue: "", color: t.color, logo: t.logo, source: { kind: "espn", league, teamId: t.id }, competitions: [] },
    ]);
  };

  const addIcs = () => {
    const id = slug(icsName);
    if (!id || !/^(https?|webcal):\/\//i.test(icsUrl) || teams.some((x) => x.id === id)) return;
    setTeams([...teams, { id, name: icsName, homeVenue: "", color: "#7ea0f0", logo: "", source: { kind: "ics", url: icsUrl }, competitions: [] }]);
    setIcsName("");
    setIcsUrl("");
  };

  const related = (t: Draft<"sports">["teams"][number]) => {
    const source = t.source;
    return source.kind === "espn" ? (leagueList.find((l) => l.key === source.league)?.related ?? []) : [];
  };

  return (
    <>
      <Lead>
        Each team gets a layer in its colour with its crest: every fixture on the calendar and the
        phone feed, a live score while it is on, a tile on the Sports tab that opens the right
        streaming site, and a pulse on the tab at kickoff. Schedules come from ESPN; pick a league,
        then the team.
      </Lead>
      <div className="setup-grid">
        <Field label="League">
          <Select value={league} disabled={!writable || !leagueList.length} options={leagueList.map((l) => ({ value: l.key, label: l.label }))} onChange={setLeague} />
        </Field>
        <Field label="Team" hint={problem ?? (loading ? "Loading from ESPN…" : "Pick one to add it.")}>
          <Select
            value=""
            disabled={!writable || loading || !teamList.length}
            options={[{ value: "", label: teamList.length ? "Choose a team…" : "—" }, ...teamList.map((t) => ({ value: t.id, label: t.name }))]}
            onChange={(id) => {
              const t = teamList.find((x) => x.id === id);
              if (t) addEspn(t);
            }}
          />
        </Field>
      </div>

      {teams.length > 0 && (
        <ul className="setup-teams">
          {teams.map((t, i) => (
            <li key={t.id} className="setup-card">
              <div className="setup-teamhead">
                {t.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- an ESPN crest, not ours to optimise
                  <img src={t.logo} alt="" width={28} height={28} />
                ) : <span className="setup-swatch" style={{ background: t.color }} />}
                <strong>{t.name}</strong>
                <span className="setup-muted">{t.source.kind === "espn" ? `ESPN · ${t.source.league}` : "ICS feed"}</span>
                <button type="button" className="setup-btn is-small is-quiet" disabled={!writable} onClick={() => setTeams(teams.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
              <div className="setup-grid">
                <Field label="Colour">
                  <span className="setup-colour">
                    <input type="color" value={t.color} disabled={!writable} onChange={(e) => setTeams(teams.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
                  </span>
                </Field>
                <Field label="Home ground (optional)">
                  <Text value={t.homeVenue} disabled={!writable} onChange={(homeVenue) => setTeams(teams.map((x, j) => (j === i ? { ...x, homeVenue } : x)))} />
                </Field>
                {related(t).length > 0 && (
                  <Field label="Also plays in" wide hint="Cup and continental competitions, for the live score and the watch link.">
                    <span className="setup-chips">
                      {related(t).map((key) => {
                        const on = t.competitions.includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`setup-chip${on ? " is-on" : ""}`}
                            disabled={!writable}
                            onClick={() => {
                              const base = t.competitions.length ? t.competitions : t.source.kind === "espn" ? [t.source.league] : [];
                              const next = on ? base.filter((k) => k !== key) : [...base, key];
                              setTeams(teams.map((x, j) => (j === i ? { ...x, competitions: next } : x)));
                            }}
                          >
                            {leagueList.find((l) => l.key === key)?.label ?? key}
                          </button>
                        );
                      })}
                    </span>
                  </Field>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ sports: { teams } })}>
        <CheckButton name="sports" label="Check ESPN" />
        <button
          type="button"
          className="setup-btn"
          disabled={!writable || dirty || !settings.sports.teams.length}
          title={dirty ? "Save first" : undefined}
          onClick={async () => {
            const r = await refreshSchedules();
            setRefreshed(r.ok ? "Refreshing in the background — the fixtures appear within a minute." : (r.error ?? "Could not start a refresh."));
          }}
        >
          Refresh schedules now
        </button>
        {refreshed && <span className="setup-check-result">{refreshed}</span>}
      </SaveBar>

      <h4>A team ESPN does not list</h4>
      <p>
        Paste a fixtures ICS address instead — <code>ics.fixtur.es</code> and{" "}
        <code>fixturedownload.com</code> publish them for most leagues, and many clubs offer one on
        their own site. No live score for these, but every fixture lands on the calendar.
      </p>
      <span className="setup-row">
        <Text value={icsName} disabled={!writable} placeholder="Team name" onChange={setIcsName} />
        <Text mono type="url" value={icsUrl} disabled={!writable} placeholder="https://…/fixtures.ics" onChange={setIcsUrl} />
        <button type="button" className="setup-btn" disabled={!writable} onClick={addIcs}>
          Add
        </button>
      </span>
      <Note>
        Schedules refresh daily once the Finish step&apos;s task is registered. The watch links
        name US streaming services; outside the US the competition is right and the service will
        not be.
      </Note>
    </>
  );
}

/* ------------------------------------------------------------- discord --- */

export function DiscordSection({ settings, writable }: SectionProps) {
  const [d, setD] = useState<Draft<"discord">>(settings.discord);
  const dirty = JSON.stringify(d) !== JSON.stringify(settings.discord);
  return (
    <>
      <Lead>
        Who is in voice on your servers, as faces with names — and a chime when someone joins a
        call you are not in. Green means people are in there and you are not; purple means you are
        already in it.
      </Lead>
      <Field label="Server ids" hint="One per line. Right-click the server → Copy Server ID (needs Settings → Advanced → Developer Mode).">
        <Lines value={d.guildIds} rows={3} placeholder="123456789012345678" disabled={!writable} onChange={(guildIds) => setD({ ...d, guildIds: guildIds.filter((x) => /^\d{5,25}$/.test(x)) })} />
      </Field>
      <Steps>
        <li>
          For <strong>each</strong> server: <strong>Server Settings → Widget → Enable Server Widget</strong>.
          That endpoint is public, which is why no bot is needed — and why the server&apos;s online
          member list becomes readable by anyone holding the id. Fine on a server of friends; think
          twice on anything else.
        </li>
        <li>
          Only voice channels <em>@everyone</em> can see appear; a locked channel never will.
        </li>
      </Steps>
      <div className="setup-grid">
        <Field label="Your username" hint="What decides green (others are in a call) from purple (you are). The widget hides ids, so it goes by name.">
          <Text value={d.selfName} disabled={!writable} onChange={(selfName) => setD({ ...d, selfName })} />
        </Field>
        <Field label="Your user id (better)" hint="Survives a nickname change. Right-click yourself → Copy User ID.">
          <Text mono value={d.selfId} disabled={!writable} onChange={(selfId) => setD({ ...d, selfId })} />
        </Field>
      </div>
      <h4>Optional: seeing invisible people</h4>
      <p>
        The widget is presence-gated: someone set to Invisible is left out entirely, even while
        sitting in a call. A bot reads voice state regardless, one request per watched person, no
        always-on process.
      </p>
      <Steps>
        <li>
          discord.com/developers/applications → <strong>New Application</strong> → <strong>Bot</strong> →
          <strong> Reset Token</strong>. No privileged intents.
        </li>
        <li>
          <strong>OAuth2 → URL Generator</strong>: scope <code>bot</code>, permissions{" "}
          <strong>View Channels</strong> and <strong>Connect</strong>. Open the URL and add the bot to
          the server.
        </li>
      </Steps>
      <div className="setup-grid">
        <Field label="Bot token">
          <Secret value={d.botToken} disabled={!writable} onChange={(botToken) => setD({ ...d, botToken: botToken as never })} />
        </Field>
        <Field label="Watch these user ids" hint="One per line. Include yourself.">
          <Lines value={d.watchIds} rows={3} disabled={!writable} onChange={(watchIds) => setD({ ...d, watchIds: watchIds.filter((x) => /^\d{5,25}$/.test(x)) })} />
        </Field>
      </div>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ discord: d })}>
        <CheckButton name="discord" label="Check Discord" />
      </SaveBar>
    </>
  );
}

/* ------------------------------------------------------------- youtube --- */

export function YouTubeSection({ settings, writable }: SectionProps) {
  const [y, setY] = useState<Draft<"youtube">>(settings.youtube);
  const [csv, setCsv] = useState("");
  const [imported, setImported] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const dirty = JSON.stringify(y) !== JSON.stringify(settings.youtube);
  return (
    <>
      <Lead>
        New uploads from the channels you choose, as tiles on the Watch tab that play in the board.
        A video posted in the last half hour pulses the tab. No API key: every channel has a public
        feed.
      </Lead>
      <h4>Add a channel</h4>
      <p>
        The id starts with <code>UC</code>. On the channel&apos;s page: <strong>…more → Share
        channel → Copy channel ID</strong>.
      </p>
      <span className="setup-row">
        <Text mono value={newId} disabled={!writable} placeholder="UC…" onChange={setNewId} />
        <Text value={newName} disabled={!writable} placeholder="Channel name" onChange={setNewName} />
        <button
          type="button"
          className="setup-btn"
          disabled={!writable || !/^UC[\w-]{20,24}$/.test(newId) || !newName.trim()}
          onClick={() => {
            if (y.channels.some((c) => c.id === newId)) return;
            setY({ ...y, channels: [...y.channels, { id: newId, name: newName.trim(), titleFormat: "plain" }] });
            setNewId("");
            setNewName("");
          }}
        >
          Add
        </button>
      </span>
      {y.channels.length > 0 && (
        <ul className="setup-list">
          {y.channels.map((c) => (
            <li key={c.id}>
              <span>{c.name}</span>
              <span className="setup-muted is-mono">{c.id}</span>
              <label className="setup-toggle is-small" title='For channels that title every upload "a joke (The Game)": the game leads on a Stream Deck key.'>
                <input
                  type="checkbox"
                  checked={c.titleFormat === "statement-game"}
                  disabled={!writable}
                  onChange={(e) => setY({ ...y, channels: y.channels.map((x) => (x.id === c.id ? { ...x, titleFormat: e.target.checked ? "statement-game" : "plain" } : x)) })}
                />
                <span>game in brackets</span>
              </label>
              <button type="button" className="setup-btn is-small is-quiet" disabled={!writable} onClick={() => setY({ ...y, channels: y.channels.filter((x) => x.id !== c.id) })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="setup-grid">
        <Field label="Show at most">
          <Text type="number" value={String(y.limit)} disabled={!writable} onChange={(v) => setY({ ...y, limit: Math.max(1, Math.min(60, Number(v) || 20)) })} />
        </Field>
        <Field label="Ignore videos older than (days)">
          <Text type="number" value={String(y.maxAgeDays)} disabled={!writable} onChange={(v) => setY({ ...y, maxAgeDays: Math.max(1, Math.min(365, Number(v) || 21)) })} />
        </Field>
      </div>
      <Toggle checked={y.includeShorts} disabled={!writable} label="Include Shorts" onChange={(includeShorts) => setY({ ...y, includeShorts })} />
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ youtube: y })}>
        <CheckButton name="youtube" label="Check a feed" />
      </SaveBar>

      <h4>Or import every subscription at once</h4>
      <Steps>
        <li>takeout.google.com → deselect all → select <strong>YouTube and YouTube Music</strong>.</li>
        <li>
          <strong>All YouTube data included</strong> → deselect all → <strong>subscriptions</strong> only →
          export, download, unzip.
        </li>
        <li>Open <code>subscriptions.csv</code> in a text editor, copy everything, paste here.</li>
      </Steps>
      <textarea className="setup-input is-mono" rows={4} value={csv} disabled={!writable} placeholder="Channel Id,Channel Url,Channel Title…" onChange={(e) => setCsv(e.target.value)} />
      <span className="setup-row">
        <button
          type="button"
          className="setup-btn"
          disabled={!writable || !csv.trim()}
          onClick={async () => {
            const r = await importYouTube(csv);
            setImported(r.ok ? `Added ${r.added ?? 0} channels.` : (r.error ?? "That did not import."));
          }}
        >
          Import
        </button>
        {imported && <span className="setup-check-result">{imported}</span>}
      </span>
    </>
  );
}

/* -------------------------------------------------------------- twitch --- */

export function TwitchSection({ settings, writable }: SectionProps) {
  const [t, setT] = useState<Draft<"twitch">>(settings.twitch);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authState, setAuthState] = useState<{ pending: boolean; authorized: boolean } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const dirty = JSON.stringify(t) !== JSON.stringify(settings.twitch);

  useEffect(() => {
    if (!authUrl) return;
    const timer = setInterval(async () => {
      const s = await twitchAuthState();
      setAuthState(s);
      if (s.authorized && !s.pending) {
        clearInterval(timer);
        setAuthUrl(null);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [authUrl]);

  return (
    <>
      <Lead>
        Which of the channels you follow are live right now, as a row above the videos — with
        viewers, uptime and a preview, playable in the board. This is the one integration that
        needs you to click Authorize once: a follow list is personal data even when the person is
        you.
      </Lead>
      <Steps>
        <li>
          dev.twitch.tv/console/apps → <strong>Register Your Application</strong>. Name: anything.
          Category: <strong>Application Integration</strong>. Client Type: <strong>Confidential</strong>{" "}
          (this is what makes the grant permanent).
        </li>
        <li>
          OAuth Redirect URL, exactly: <code>http://localhost:7345/callback</code>
        </li>
        <li>
          Copy the <strong>Client ID</strong>; press <strong>New Secret</strong> and copy that too. Save
          them below.
        </li>
        <li>Press <strong>Authorize</strong>, click Authorize on Twitch, come back.</li>
      </Steps>
      <div className="setup-grid">
        <Field label="Client ID">
          <Text mono value={t.clientId} disabled={!writable} onChange={(clientId) => setT({ ...t, clientId })} />
        </Field>
        <Field label="Client secret">
          <Secret value={t.clientSecret} disabled={!writable} onChange={(clientSecret) => setT({ ...t, clientSecret: clientSecret as never })} />
        </Field>
      </div>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ twitch: t })}>
        <button
          type="button"
          className="setup-btn"
          disabled={!writable || dirty || !settings.twitch.clientId || !settings.twitch.clientSecret.set}
          title={dirty ? "Save first" : undefined}
          onClick={async () => {
            setAuthError(null);
            const r = await beginTwitchAuth();
            if (r.ok && r.url) {
              setAuthUrl(r.url);
              window.open(r.url, "_blank", "noopener");
            } else setAuthError(r.error ?? "Could not start.");
          }}
        >
          Authorize with Twitch
        </button>
        <CheckButton name="twitch" label="Check Twitch" />
      </SaveBar>
      {authUrl && (
        <Note>
          Waiting for Twitch… If a tab did not open,{" "}
          <a href={authUrl} target="_blank" rel="noopener noreferrer">
            open the authorization page
          </a>
          .
        </Note>
      )}
      {authState?.authorized && !authUrl && <Note tone="good">Authorized. The board mints its own access tokens from here on; nobody logs in again.</Note>}
      {authError && <Note tone="warn">{authError}</Note>}
      <Note>
        The refresh token dies if you change your Twitch password or revoke the app under Twitch →
        Settings → Connections. The panel says so rather than going blank; press Authorize again.
      </Note>
    </>
  );
}

/* ---------------------------------------------------------------- mail --- */

const MAIL_PRESETS: { label: string; host: string; port: number; trash: string }[] = [
  { label: "Gmail", host: "imap.gmail.com", port: 993, trash: "[Gmail]/Trash" },
  { label: "Outlook.com / Hotmail", host: "outlook.office365.com", port: 993, trash: "Deleted" },
  { label: "iCloud", host: "imap.mail.me.com", port: 993, trash: "Deleted Messages" },
  { label: "Fastmail", host: "imap.fastmail.com", port: 993, trash: "Trash" },
  { label: "Yahoo", host: "imap.mail.yahoo.com", port: 993, trash: "Trash" },
];

export function MailSection({ settings, writable }: SectionProps) {
  const [m, setM] = useState<Draft<"mail">>(settings.mail);
  const dirty = JSON.stringify(m) !== JSON.stringify(settings.mail);
  const preset = MAIL_PRESETS.find((p) => p.host === m.host)?.host ?? "custom";
  return (
    <>
      <Lead>
        The newest messages in one mailbox, on the Mail tab, with the tab pulsing green while
        something is unread. Open a message to read it; the × deletes it (into the trash). A
        small Python poller reads IMAP every five minutes and writes a file the board reads.
      </Lead>
      <Toggle checked={m.enabled} disabled={!writable} label="Show the Mail tab" onChange={(enabled) => setM({ ...m, enabled })} />
      <div className="setup-grid">
        <Field label="Provider">
          <Select
            value={preset}
            disabled={!writable}
            options={[...MAIL_PRESETS.map((p) => ({ value: p.host, label: p.label })), { value: "custom", label: "Other IMAP server" }]}
            onChange={(host) => {
              const p = MAIL_PRESETS.find((x) => x.host === host);
              if (p) setM({ ...m, host: p.host, port: p.port, trash: p.trash });
            }}
          />
        </Field>
        <Field label="Address">
          <Text type="email" value={m.user} disabled={!writable} onChange={(user) => setM({ ...m, user })} />
        </Field>
        <Field label="App password" hint="Never the account password. Gmail: myaccount.google.com/apppasswords (needs 2-Step Verification on). Outlook and iCloud have the same under Security.">
          <Secret value={m.appPassword} disabled={!writable} onChange={(appPassword) => setM({ ...m, appPassword: appPassword as never })} />
        </Field>
        <Field label="Mailbox" hint="INBOX, or a label/folder name.">
          <Text mono value={m.mailbox} disabled={!writable} onChange={(mailbox) => setM({ ...m, mailbox })} />
        </Field>
        <Field label="IMAP host">
          <Text mono value={m.host} disabled={!writable} onChange={(host) => setM({ ...m, host })} />
        </Field>
        <Field label="Port">
          <Text type="number" value={String(m.port)} disabled={!writable} onChange={(v) => setM({ ...m, port: Number(v) || 993 })} />
        </Field>
        <Field label="Trash folder" hint="Where the × moves a message.">
          <Text mono value={m.trash} disabled={!writable} onChange={(trash) => setM({ ...m, trash })} />
        </Field>
        <Field label="Show at most">
          <Text type="number" value={String(m.limit)} disabled={!writable} onChange={(v) => setM({ ...m, limit: Math.max(1, Math.min(50, Number(v) || 15)) })} />
        </Field>
      </div>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ mail: m })}>
        <CheckButton name="mail" label="Try signing in" />
      </SaveBar>
      <h4>The poller</h4>
      <Steps>
        <li>Install Python 3 (python.org; tick &ldquo;Add to PATH&rdquo;).</li>
        <li>
          Once: <Command>{"cd agent\\mail; py -3 -m pip install -r requirements.txt"}</Command>
        </li>
        <li>
          Run the Finish step&apos;s command again; with Mail turned on it registers a task that polls
          every five minutes.
        </li>
      </Steps>
    </>
  );
}

/* -------------------------------------------------------------- amazon --- */

export function AmazonSection({ settings, writable }: SectionProps) {
  const [a, setA] = useState<Draft<"amazon">>(settings.amazon);
  const dirty = JSON.stringify(a) !== JSON.stringify(settings.amazon);
  return (
    <>
      <Lead>
        What is on the way: recent Amazon orders as cards with the item, the carrier&apos;s latest
        scan and the delivery day, pulsing when one is out for delivery, and a warning when a
        return window is closing. A Python poller signs in as you and reads your order history —
        there is no Amazon API for this, so it needs your credentials.
      </Lead>
      <Note tone="warn">
        Your Amazon password is stored in <code>data/settings.json</code> on this machine, in plain
        text, and nowhere else. If that is not a trade you want to make, leave this off.
      </Note>
      <Toggle checked={a.enabled} disabled={!writable} label="Show the Packages tab" onChange={(enabled) => setA({ ...a, enabled })} />
      <div className="setup-grid">
        <Field label="Amazon email">
          <Text type="email" value={a.username} disabled={!writable} onChange={(username) => setA({ ...a, username })} />
        </Field>
        <Field label="Password">
          <Secret value={a.password} disabled={!writable} onChange={(password) => setA({ ...a, password: password as never })} />
        </Field>
        <Field label="Orders to show">
          <Text type="number" value={String(a.maxOrders)} disabled={!writable} onChange={(v) => setA({ ...a, maxOrders: Math.max(1, Math.min(50, Number(v) || 12)) })} />
        </Field>
        <Field label="From the last (days)">
          <Text type="number" value={String(a.withinDays)} disabled={!writable} onChange={(v) => setA({ ...a, withinDays: Math.max(1, Math.min(365, Number(v) || 45)) })} />
        </Field>
        <Field label="Keep delivered for (days)">
          <Text type="number" value={String(a.deliveredDays)} disabled={!writable} onChange={(v) => setA({ ...a, deliveredDays: Math.max(0, Math.min(30, Number(v) || 0)) })} />
        </Field>
        <Field label="Return warning (days before)">
          <Text type="number" value={String(a.returnWarnDays)} disabled={!writable} onChange={(v) => setA({ ...a, returnWarnDays: Math.max(0, Math.min(60, Number(v) || 0)) })} />
        </Field>
      </div>
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ amazon: a })} />
      <h4>The one-time sign-in</h4>
      <Steps>
        <li>Install Python 3, then once: <Command>{"cd agent\\amazon; py -3 -m pip install -r requirements.txt; py -3 -m playwright install chromium"}</Command></li>
        <li>
          Sign in by hand once, so the OTP or captcha is yours to answer: <Command>{"agent\\amazon\\run_login.cmd"}</Command>
          The session is kept on disk and reused by the poller.
        </li>
        <li>Run the Finish step&apos;s command; with Packages on it registers a task that polls every thirty minutes.</li>
        <li>
          If the tab ever says the session expired (the poller exits with code 3), run{" "}
          <code>run_login.cmd</code> again.
        </li>
      </Steps>
      <Note>amazon.com only — the poller reads the US storefront&apos;s order pages.</Note>
    </>
  );
}

/* ------------------------------------------------------------- transit --- */

interface Stop {
  id: string;
  name: string;
  borough: string;
  routes: string[];
  north: string;
  south: string;
}

export function TransitSection({ settings, writable }: SectionProps) {
  const [t, setT] = useState<Draft<"transit">>(settings.transit);
  const [stops, setStops] = useState<Stop[]>([]);
  const [query, setQuery] = useState("");
  const dirty = JSON.stringify(t) !== JSON.stringify(settings.transit);

  useEffect(() => {
    if (!t.enabled || stops.length) return;
    void fetch("/api/mta-stops")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Stop[]) => setStops(list))
      .catch(() => setStops([]));
  }, [t.enabled, stops.length]);

  const matches = query.trim().length >= 2 ? stops.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())).slice(0, 12) : [];
  const chosen = stops.find((s) => s.id === t.stopId);
  const routes = chosen?.routes ?? t.lines;

  return (
    <>
      <Lead>
        New York only: the next trains at your station, counting down, and every disruption on
        your lines — from the MTA&apos;s keyless feeds. Off unless you turn it on.
      </Lead>
      <Toggle checked={t.enabled} disabled={!writable} label="Show the subway widget" onChange={(enabled) => setT({ ...t, enabled })} />
      {t.enabled && (
        <>
          <Field label="Home station" hint={chosen ? `${chosen.name} (${chosen.borough}) · ${chosen.routes.join(" ")}` : "Type part of the name."}>
            <Text value={query} disabled={!writable} placeholder="e.g. 86 St" onChange={setQuery} />
          </Field>
          {matches.length > 0 && (
            <ul className="setup-picks">
              {matches.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="setup-pick"
                    onClick={() => {
                      setT({ ...t, stopId: s.id, stopName: s.name, lines: s.routes, directionLabel: t.direction === "N" ? s.north : s.south });
                      setQuery("");
                    }}
                  >
                    {s.name} <span>{s.borough} · {s.routes.join(" ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {chosen && (
            <>
              <Field label="Lines to watch" hint="In this order on the board.">
                <span className="setup-chips">
                  {routes.map((r) => {
                    const on = t.lines.includes(r);
                    return (
                      <button key={r} type="button" className={`setup-chip${on ? " is-on" : ""}`} disabled={!writable} onClick={() => setT({ ...t, lines: on ? t.lines.filter((x) => x !== r) : [...t.lines, r] })}>
                        {r}
                      </button>
                    );
                  })}
                </span>
              </Field>
              <Field label="Direction">
                <Select
                  value={t.direction}
                  disabled={!writable}
                  options={[
                    { value: "S", label: `Southbound · ${chosen.south}` },
                    { value: "N", label: `Northbound · ${chosen.north}` },
                  ]}
                  onChange={(direction) => setT({ ...t, direction, directionLabel: direction === "N" ? chosen.north : chosen.south })}
                />
              </Field>
            </>
          )}
        </>
      )}
      <SaveBar dirty={dirty} disabled={!writable} onSave={() => updateSettings({ transit: t })}>
        <CheckButton name="transit" label="Check the MTA" />
      </SaveBar>
    </>
  );
}
