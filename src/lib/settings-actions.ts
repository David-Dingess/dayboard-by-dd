"use server";

import { revalidatePath } from "next/cache";
import { spawn } from "node:child_process";
import { todoGate, type TodoResult } from "./todo-actions";
import {
  applyPatch,
  loadSettings,
  mintFeedToken,
  saveSettings,
  type SettingsPatch,
} from "./settings";
import { checkIntegration, geocode, type CheckName, type CheckResult, type Place } from "./settings-checks";
import { listLeagues, listTeams, type EspnTeamSummary, type League } from "./espn-teams";
import { startTwitchAuth, twitchAuthPending } from "./twitch-auth";
import { parseCsv as parseBirthdayCsv } from "./birthdays";
import { parseTakeoutCsv } from "./youtube";

/**
 * The writes behind the setup guide. Same gate as every other write on this
 * board — `todoGate` imported rather than copied, so "is this request from this
 * machine" stays one fact — and the same contract: a result, never a throw, so
 * a failed save says so inside the menu rather than replacing the board.
 */

async function apply(mutate: () => void): Promise<TodoResult> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };
  try {
    mutate();
  } catch (err) {
    return { ok: false, error: (err as Error).message.split("\n")[0] };
  }
  revalidatePath("/");
  return { ok: true };
}

/** Replace whole sections. See applyPatch for how secrets survive a round trip. */
export async function updateSettings(patch: SettingsPatch): Promise<TodoResult> {
  return apply(() => saveSettings(applyPatch(loadSettings(), patch)));
}

/** A new feed token at the front; the old ones stay valid until dropped. */
export async function rotateFeedToken(): Promise<TodoResult & { token?: string }> {
  const token = mintFeedToken();
  const result = await apply(() => {
    const s = loadSettings();
    saveSettings({ ...s, feed: { tokens: [token, ...s.feed.tokens].slice(0, 5) } });
  });
  return result.ok ? { ...result, token } : result;
}

/** `name,month,day` rows — a Facebook export, or a hand-typed list. Merges by name. */
export async function importBirthdays(csv: string): Promise<TodoResult & { added?: number }> {
  if (csv.length > 200_000) return { ok: false, error: "That file is too large." };
  const rows = parseBirthdayCsv(csv);
  if (!rows.length) return { ok: false, error: "No rows with a name, month and day were found." };
  let added = 0;
  const result = await apply(() => {
    const s = loadSettings();
    const have = new Set(s.birthdays.map((b) => b.name.toLowerCase()));
    const merged = [...s.birthdays];
    for (const row of rows) {
      if (have.has(row.name.toLowerCase())) continue;
      merged.push({ name: row.name, month: row.month, day: row.day });
      have.add(row.name.toLowerCase());
      added++;
    }
    saveSettings({ ...s, birthdays: merged });
  });
  return result.ok ? { ...result, added } : result;
}

/** A Google Takeout subscriptions.csv. Merges by channel id. */
export async function importYouTube(csv: string): Promise<TodoResult & { added?: number }> {
  if (csv.length > 500_000) return { ok: false, error: "That file is too large." };
  const channels = parseTakeoutCsv(csv);
  if (!channels.length) return { ok: false, error: "No channel rows were found in that file." };
  let added = 0;
  const result = await apply(() => {
    const s = loadSettings();
    const have = new Set(s.youtube.channels.map((c) => c.id));
    const merged = [...s.youtube.channels];
    for (const channel of channels) {
      if (have.has(channel.id)) continue;
      merged.push(channel);
      have.add(channel.id);
      added++;
    }
    saveSettings({ ...s, youtube: { ...s.youtube, channels: merged } });
  });
  return result.ok ? { ...result, added } : result;
}

/** Try an integration with what is on disk right now, and say what happened. */
export async function runCheck(name: CheckName): Promise<CheckResult> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, detail: gate.reason };
  return checkIntegration(name, loadSettings());
}

/**
 * `npm run refresh`, from the Sports section's button. Detached and unwaited:
 * a refresh takes a minute, and the board re-reads the cache on its next tick.
 */
export async function refreshSchedules(): Promise<TodoResult> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };
  try {
    const child = spawn("npm", ["run", "--silent", "refresh"], {
      cwd: process.cwd(),
      shell: true,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Places matching a typed name, from Open-Meteo's geocoder. */
export async function searchPlaces(query: string): Promise<{ ok: boolean; places: Place[]; error?: string }> {
  try {
    return { ok: true, places: await geocode(query.slice(0, 120)) };
  } catch (err) {
    return { ok: false, places: [], error: (err as Error).message };
  }
}

/** The league picker's options. Static, but a Server Action keeps the table server-side. */
export async function leagues(): Promise<League[]> {
  return listLeagues();
}

/** The team picker's options for one league. */
export async function teamsIn(league: string): Promise<{ ok: boolean; teams: EspnTeamSummary[]; error?: string }> {
  try {
    return { ok: true, teams: await listTeams(league) };
  } catch (err) {
    return { ok: false, teams: [], error: (err as Error).message };
  }
}

/**
 * Begin the Twitch grant with the client id and secret on disk, and hand back
 * the URL to open. The listener writes the token itself when the browser comes
 * back; the menu polls `twitchAuthState` to know when.
 */
export async function beginTwitchAuth(): Promise<TodoResult & { url?: string }> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };
  const { clientId, clientSecret } = loadSettings().twitch;
  try {
    const { url } = await startTwitchAuth(clientId, clientSecret);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function twitchAuthState(): Promise<{ pending: boolean; authorized: boolean }> {
  const t = loadSettings().twitch;
  return { pending: twitchAuthPending(), authorized: Boolean(t.refreshToken && t.userId) };
}
