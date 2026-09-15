"use server";

import { revalidatePath } from "next/cache";
import { todoGate, type TodoResult } from "./todo-actions";
import { parseWatchUrl } from "./embed";
import { healthId } from "./uid";
import { addDays, todayKey, type ChairEntry, type DayRecord, type Feedback, type WalkEntry } from "./health";
import {
  applyAttachVideo,
  applyClearDay,
  applyDeleteWalk,
  applyDetachVideo,
  applyFeedback,
  applyLogChair,
  applyLogWalk,
  applyRecordDay,
  applyRestart,
  applySettings,
  loadHealth,
  loadHealthVideos,
  saveHealth,
  saveHealthVideos,
  validVideoKey,
} from "./health-store";
import {
  HealthChairSchema,
  HealthDaySchema,
  HealthSettingsSchema,
  HealthVideoSchema,
  HealthWalkSchema,
  DATE_ONLY,
  type HealthSettingsFile,
} from "./schema";
import { todayLocal } from "./time";

/**
 * The Health tab's writes.
 *
 * Same shape as todo-actions.ts, and it reuses that file's gate rather than
 * defining a second one: "did this request come from this machine" is one fact
 * about the deployment, and a second copy would be a second thing to keep in
 * step. Every action returns a result instead of throwing, so a failed button
 * says so inside the widget rather than replacing the board with an error page.
 *
 * Everything crossing this boundary is browser input, so every argument is
 * re-parsed with the same zod schemas that guard the file — the render-time
 * `writable` flag decides what is drawn, and these checks are the ones that
 * count.
 */

async function apply(mutate: () => void): Promise<TodoResult> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };
  try {
    mutate();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath("/");
  return { ok: true };
}

/**
 * Today, or yesterday. A session started at 11:50pm is logged after midnight and
 * belongs to the day it started; anything further out is a client with a wrong
 * clock or a hand-made request, and neither should be able to write history.
 */
function dateIsRecent(date: string): boolean {
  const today = todayLocal();
  return date === today || date === addDays(today, -1);
}

export async function recordSession(input: unknown): Promise<TodoResult> {
  const parsed = HealthDaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That session didn't look like one." };
  const record = parsed.data as DayRecord;
  if (!dateIsRecent(record.date)) {
    return { ok: false, error: "Sessions can only be logged for today." };
  }
  return apply(() => saveHealth(applyRecordDay(loadHealth(), record)));
}

export async function sendFeedback(date: string, signal: Feedback): Promise<TodoResult> {
  if (!DATE_ONLY.test(date)) return { ok: false, error: "Bad date." };
  if (!["too_easy", "just_right", "too_hard"].includes(signal)) {
    return { ok: false, error: "Bad feedback." };
  }
  return apply(() => saveHealth(applyFeedback(loadHealth(), date, signal)));
}

export async function clearDay(date: string): Promise<TodoResult> {
  if (!DATE_ONLY.test(date)) return { ok: false, error: "Bad date." };
  return apply(() => saveHealth(applyClearDay(loadHealth(), date)));
}

export async function logWalk(input: {
  durationMin: number;
  outdoors: boolean;
  source: "timer" | "manual";
}): Promise<TodoResult> {
  const now = new Date();
  const parsed = HealthWalkSchema.safeParse({
    id: healthId("walk", now),
    date: todayLocal(),
    loggedAt: now.toISOString(),
    durationMin: Math.round(input?.durationMin),
    source: input?.source,
    outdoors: input?.outdoors !== false,
  });
  if (!parsed.success) return { ok: false, error: "That walk didn't look like one." };
  return apply(() => saveHealth(applyLogWalk(loadHealth(), parsed.data as WalkEntry)));
}

/**
 * A finished chair routine. The id, the date and the timestamp are minted here
 * rather than trusted from the browser: the timestamp is what answers a chair
 * nudge, so a client clock that is off must not be able to backdate one.
 */
export async function recordChair(input: {
  routineId: string;
  durationSec: number;
  skipped?: string[];
}): Promise<TodoResult> {
  const now = new Date();
  const parsed = HealthChairSchema.safeParse({
    id: healthId("chair", now),
    date: todayLocal(),
    completedAt: now.toISOString(),
    routineId: input?.routineId,
    durationSec: Math.round(input?.durationSec),
    skipped: input?.skipped ?? [],
  });
  if (!parsed.success) return { ok: false, error: "That routine didn't look like one." };
  return apply(() => saveHealth(applyLogChair(loadHealth(), parsed.data as ChairEntry)));
}

export async function deleteWalk(id: string): Promise<TodoResult> {
  if (!id) return { ok: false, error: "Bad walk." };
  return apply(() => saveHealth(applyDeleteWalk(loadHealth(), id)));
}

/**
 * A patch of whole sub-objects — slots, quiet hours, eye breaks — validated
 * against the settings schema by merging it into the file first. Partial
 * validation would let a bad slot array through on the grounds that it is
 * optional.
 */
export async function updateHealthSettings(patch: Partial<HealthSettingsFile>): Promise<TodoResult> {
  return apply(() => {
    const file = loadHealth();
    const merged = HealthSettingsSchema.parse({ ...file.settings, ...patch });
    saveHealth(applySettings(file, merged));
  });
}

/** Takes the date to start from, not a "restart" verb — see flagTodo's docblock. */
export async function restartProgram(startDate: string): Promise<TodoResult> {
  if (!DATE_ONLY.test(startDate)) return { ok: false, error: "Bad start date." };
  return apply(() => saveHealth(applyRestart(loadHealth(), startDate)));
}

/**
 * Attach a follow-along video to a session kind or an exercise.
 *
 * Only YouTube: the board has exactly one player and it can frame exactly two
 * things (see lib/embed.ts), and a Twitch channel is not a thing you follow
 * along with on a mat. The title comes from YouTube's oembed endpoint, which
 * needs no key — and if that call fails the video is still saved, because a
 * tile reading "Video dQw4w9WgXcQ" is worth more than a refused paste.
 */
export async function attachVideo(key: string, url: string): Promise<TodoResult> {
  if (!validVideoKey(key)) return { ok: false, error: "That isn't a thing to attach a video to." };
  const parsed = parseWatchUrl(url ?? "");
  if (!parsed) return { ok: false, error: "That didn't look like a video link." };
  if (parsed.kind !== "youtube") return { ok: false, error: "Only YouTube can play on the board." };

  let title = `Video ${parsed.key}`;
  let channel: string | undefined;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${parsed.key}&format=json`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const meta = (await res.json()) as { title?: string; author_name?: string };
      if (meta.title) title = meta.title.slice(0, 200);
      if (meta.author_name) channel = meta.author_name.slice(0, 100);
    }
  } catch {
    // Offline, rate-limited, or a private video. The id is what matters.
  }

  const video = HealthVideoSchema.safeParse({ id: parsed.key, title, channel, addedAt: todayLocal() });
  if (!video.success) return { ok: false, error: "Couldn't make sense of that video." };
  return apply(() => saveHealthVideos(applyAttachVideo(loadHealthVideos(), key, video.data)));
}

export async function detachVideo(key: string, id: string): Promise<TodoResult> {
  if (!key || !id) return { ok: false, error: "Bad video." };
  return apply(() => saveHealthVideos(applyDetachVideo(loadHealthVideos(), key, id)));
}

/** The day key as the SERVER sees it, for a client that wants to compare. */
export async function serverToday(): Promise<string> {
  return todayKey();
}
