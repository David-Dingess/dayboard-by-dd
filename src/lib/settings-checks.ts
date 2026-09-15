import { connect } from "node:tls";
import type { SettingsFile } from "./settings-schema";
import { getVoice } from "./discord";
import { getLiveFollowed } from "./twitch";
import { listTeams } from "./espn-teams";
import { parseChannelFeed, longFormPlaylistId } from "./youtube";

/**
 * "Check" buttons: try an integration with what is on disk and say what
 * happened, in one sentence a person can act on.
 *
 * This is scripts/check-widgets.ts brought inside the board. The widgets are
 * deliberately terse — "Nobody live." is a true sentence on a quiet night and
 * on a dead refresh token — so the guide needs a way to tell the two apart
 * without a terminal.
 *
 * Every check returns; none throws. A check that cannot run says why.
 */

export type CheckName =
  | "location"
  | "calendars"
  | "sports"
  | "discord"
  | "youtube"
  | "twitch"
  | "mail"
  | "pc"
  | "claude"
  | "transit";

export interface CheckResult {
  ok: boolean;
  /** One line. What worked, or what to fix. */
  detail: string;
}

const fail = (detail: string): CheckResult => ({ ok: false, detail });
const pass = (detail: string): CheckResult => ({ ok: true, detail });

async function location(s: SettingsFile): Promise<CheckResult> {
  const { lat, lon } = s.location;
  if (lat === null || lon === null) return fail("No location set yet. Search for your city above.");
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&timezone=auto`,
      { signal: AbortSignal.timeout(8000), cache: "no-store" },
    );
    if (!res.ok) return fail(`Open-Meteo said ${res.status}.`);
    const json = (await res.json()) as { current?: { temperature_2m?: number }; timezone?: string };
    const temp = json.current?.temperature_2m;
    return pass(
      `Weather answers for ${s.location.label || `${lat}, ${lon}`}: ${temp ?? "?"}°C now` +
        (json.timezone && json.timezone !== s.location.timezone ? ` (Open-Meteo puts it in ${json.timezone})` : "") +
        ".",
    );
  } catch (err) {
    return fail(`Could not reach Open-Meteo: ${(err as Error).message}`);
  }
}

async function calendars(s: SettingsFile): Promise<CheckResult> {
  if (!s.calendars.length) return fail("No calendars added yet.");
  const lines: string[] = [];
  let bad = 0;
  for (const cal of s.calendars) {
    try {
      const res = await fetch(cal.url.replace(/^webcal:\/\//i, "https://"), {
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
        headers: { "user-agent": "Dayboard/1.0 (personal dashboard)" },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error("not an ICS feed");
      const count = (text.match(/BEGIN:VEVENT/g) ?? []).length;
      lines.push(`${cal.label}: ${count} events`);
    } catch (err) {
      bad++;
      lines.push(`${cal.label}: ${(err as Error).message}`);
    }
  }
  return bad ? fail(lines.join(" · ")) : pass(lines.join(" · "));
}

async function sports(s: SettingsFile): Promise<CheckResult> {
  const team = s.sports.teams[0];
  if (!team) return fail("No teams added yet.");
  if (team.source.kind !== "espn") return pass(`${team.name} is an ICS feed; run a refresh to fetch it.`);
  try {
    const teams = await listTeams(team.source.league);
    const wanted = team.source.teamId;
    const match = teams.find((t) => t.id === wanted);
    return match
      ? pass(`ESPN lists ${match.name} in ${team.source.league.toUpperCase()}. Refresh schedules to pull the fixtures.`)
      : fail(`ESPN's ${team.source.league} list does not include team id ${team.source.teamId}.`);
  } catch (err) {
    return fail(`Could not reach ESPN: ${(err as Error).message}`);
  }
}

async function discord(s: SettingsFile): Promise<CheckResult> {
  if (!s.discord.guildIds.length) return fail("No server ids yet.");
  const { guilds } = await getVoice();
  const lines = guilds.map((g) =>
    g.problem ? `${g.name}: ${g.problem}` : `${g.name}: ${g.inVoice} in voice, ${g.online} online`,
  );
  const bad = guilds.some((g) => g.problem);
  const source = s.discord.botToken && s.discord.watchIds.length ? " (widget + bot)" : " (widget only)";
  return bad ? fail(lines.join(" · ")) : pass(lines.join(" · ") + source);
}

async function youtube(s: SettingsFile): Promise<CheckResult> {
  const channel = s.youtube.channels[0];
  if (!channel) return fail("No channels yet.");
  try {
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${longFormPlaylistId(channel.id)}`,
      { signal: AbortSignal.timeout(8000), cache: "no-store" },
    );
    if (!res.ok) return fail(`YouTube said ${res.status} for ${channel.name}.`);
    const videos = parseChannelFeed(await res.text());
    return pass(`${channel.name}: ${videos.length} recent uploads readable${s.youtube.channels.length > 1 ? ` (${s.youtube.channels.length} channels configured)` : ""}.`);
  } catch (err) {
    return fail(`Could not read ${channel.name}'s feed: ${(err as Error).message}`);
  }
}

async function twitch(s: SettingsFile): Promise<CheckResult> {
  const t = s.twitch;
  if (!t.clientId || !t.clientSecret) return fail("Client ID and secret first.");
  if (!t.refreshToken || !t.userId) return fail("Press Authorize to finish the one-time grant.");
  const { live, problem } = await getLiveFollowed();
  if (problem) return fail(problem);
  return pass(live.length ? `${live.length} of the channels you follow are live now.` : "Authorized. Nobody you follow is live right now.");
}

/**
 * A real IMAP login, which is the only honest test of an app password. Plain
 * node:tls, one LOGIN, one LOGOUT — no library, because the agent that does
 * the reading is Python and this only has to answer yes or no.
 */
function mail(s: SettingsFile): Promise<CheckResult> {
  const m = s.mail;
  if (!m.user || !m.appPassword) return Promise.resolve(fail("Address and app password first."));
  return new Promise((resolve) => {
    let buffer = "";
    let stage: "greeting" | "login" | "done" = "greeting";
    const socket = connect({ host: m.host, port: m.port, servername: m.host }, () => {});
    const finish = (result: CheckResult) => {
      if (stage === "done") return;
      stage = "done";
      try {
        socket.write("a2 LOGOUT\r\n");
      } catch {
        // already gone
      }
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(10_000, () => finish(fail(`${m.host} did not answer in time.`)));
    socket.on("error", (err) => finish(fail(`${m.host}: ${err.message}`)));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (stage === "greeting" && buffer.includes("\n")) {
        stage = "login";
        buffer = "";
        const quote = (v: string) => `"${v.replace(/(["\\])/g, "\\$1")}"`;
        socket.write(`a1 LOGIN ${quote(m.user)} ${quote(m.appPassword)}\r\n`);
      } else if (stage === "login" && /^a1 (OK|NO|BAD)/m.test(buffer)) {
        const line = buffer.match(/^a1 (OK|NO|BAD)(.*)$/m);
        if (line?.[1] === "OK") finish(pass(`Signed in to ${m.host} as ${m.user}. Mailbox: ${m.mailbox}.`));
        else finish(fail(`${m.host} refused the login:${line?.[2]?.trim() ? ` ${line[2].trim()}` : ""} — for Gmail this needs an app password, not the account password.`));
      }
    });
  });
}

async function agent(path: string, timeoutMs = 3000): Promise<{ status: number; body: string } | null> {
  const { agentBase } = await import("./runtime");
  try {
    const res = await fetch(`${agentBase()}${path}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}

async function pc(): Promise<CheckResult> {
  const health = await agent("/health");
  if (!health) return fail("The PC agent is not running. Build it and register its task (see the Computer section).");
  const vitals = await agent("/vitals");
  if (!vitals || vitals.status === 404) return pass("Agent is running, but it predates /vitals — rebuild it.");
  try {
    const body = JSON.parse(vitals.body) as { elevated?: boolean };
    return pass(body.elevated ? "Agent is running, elevated: temperatures and fans included." : "Agent is running without elevation: load and memory only, no temperatures.");
  } catch {
    return pass("Agent is running.");
  }
}

async function claude(): Promise<CheckResult> {
  const res = await agent("/claude", 5000);
  if (!res) return fail("The PC agent is not running; the usage bars come through it.");
  if (res.status === 404) return fail("This agent build has no /claude route. Rebuild it.");
  try {
    const body = JSON.parse(res.body) as { ok?: boolean; problem?: string; reason?: string };
    if (body.ok === false) return fail(body.problem ?? body.reason ?? "The agent could not read a Claude login. Run `claude` in a terminal and sign in.");
    return pass("Claude usage is readable.");
  } catch {
    return fail("The agent answered /claude with something that is not JSON.");
  }
}

async function transit(s: SettingsFile): Promise<CheckResult> {
  if (!s.transit.enabled) return fail("Transit is off.");
  if (!s.transit.lines.length || !s.transit.stopId) return fail("Pick at least one line and a home station.");
  try {
    const res = await fetch("https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json", {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return fail(`MTA said ${res.status}.`);
    return pass(`MTA answers. Watching ${s.transit.lines.join(", ")} at ${s.transit.stopName || s.transit.stopId}.`);
  } catch (err) {
    return fail(`Could not reach the MTA: ${(err as Error).message}`);
  }
}

export async function checkIntegration(name: CheckName, s: SettingsFile): Promise<CheckResult> {
  try {
    switch (name) {
      case "location":
        return await location(s);
      case "calendars":
        return await calendars(s);
      case "sports":
        return await sports(s);
      case "discord":
        return await discord(s);
      case "youtube":
        return await youtube(s);
      case "twitch":
        return await twitch(s);
      case "mail":
        return await mail(s);
      case "pc":
        return await pc();
      case "claude":
        return await claude();
      case "transit":
        return await transit(s);
    }
  } catch (err) {
    return fail((err as Error).message);
  }
}

/* ------------------------------------------------------------- geocode --- */

export interface Place {
  label: string;
  lat: number;
  lon: number;
  timezone: string;
  /** A US ZIP when Open-Meteo knew one; pollen.com wants it. */
  zip: string;
}

/**
 * Open-Meteo's geocoder: free, no key, and it returns the timezone with the
 * coordinates, which is the one thing a lat/lon pair cannot tell you on its own.
 */
export async function geocode(query: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`,
    { signal: AbortSignal.timeout(8000), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Open-Meteo said ${res.status}`);
  const json = (await res.json()) as {
    results?: {
      name?: string;
      admin1?: string;
      country?: string;
      country_code?: string;
      latitude?: number;
      longitude?: number;
      timezone?: string;
      postcodes?: string[];
    }[];
  };
  return (json.results ?? [])
    .filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number" && r.name)
    .map((r) => ({
      label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
      lat: Number(r.latitude!.toFixed(4)),
      lon: Number(r.longitude!.toFixed(4)),
      timezone: r.timezone ?? "",
      zip: r.country_code === "US" ? (r.postcodes?.[0] ?? "") : "",
    }));
}
