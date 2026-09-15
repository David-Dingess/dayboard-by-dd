import { getVoice, configuredGuilds } from "../src/lib/discord";
import { getLiveFollowed, configuredTwitch, uptime, viewers } from "../src/lib/twitch";
import { competitionsForLayer, getScore } from "../src/lib/scores";
import { COMPETITIONS } from "../src/lib/watch";
import { loadAllEvents } from "../src/lib/layers";
import { liveNow } from "../src/lib/events";
import { toInstant } from "../src/lib/time";
import { loadSettings } from "../src/lib/settings";
import { agentBase } from "../src/lib/runtime";

/**
 * Reads back the credentialed widgets the way the board does, without loading
 * the board.
 *
 * Worth having because they all fail in ways a rendered panel states politely
 * and briefly — "nobody in voice", "No access", "Nobody live." — and none of
 * those tells you whether the problem is the credential, the grant, or genuinely
 * nothing happening. This prints the whole answer.
 *
 *   npm run check:widgets              all of them
 *   npm run check:widgets -- discord   one
 *   npm run check:widgets -- twitch --watch
 */

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const only = args.find((a) => !a.startsWith("--"));

async function discord() {
  if (!configuredGuilds().length) {
    console.log("discord: no server ids in settings");
    return;
  }
  // Which source is live matters more than usual here: the widget cannot see an
  // invisible member at all, so "nobody in voice" means two different things
  // depending on whether the bot is answering.
  const { botToken, watchIds } = loadSettings().discord;
  const watching = watchIds.length;
  console.log(
    botToken && watching
      ? `source: widget + bot (watching ${watching} ${watching === 1 ? "person" : "people"})`
      : "source: widget only — invisible members will not appear",
  );

  const { guilds } = await getVoice();
  for (const g of guilds) {
    if (g.problem) {
      console.log(`discord: ${g.name} — ${g.problem}`);
      continue;
    }
    const busy = g.channels.filter((c) => c.members.length > 0);
    console.log(
      `discord: ${g.name} — ${g.inVoice} in voice, ${g.online}${g.truncated ? "+" : ""} online`,
    );
    for (const c of busy) {
      const who = c.members
        .map(
          (m) =>
            // A real snowflake means the bot found them; the widget only ever
            // hands back anonymised ids, so this is a reliable tell.
            `${m.name}${m.userId ? " [bot]" : " [widget]"}` +
            (m.deafened ? " (deafened)" : m.muted ? " (muted)" : ""),
        )
        .join(", ");
      console.log(`    ${c.name}${c.hasMe ? " (you're in)" : ""}: ${who}`);
    }
    if (!busy.length) console.log("    every channel empty");
  }
}

/**
 * The one that earns its keep. "Nobody live." is a true sentence on a quiet
 * night AND on a dead refresh token, and the panel is too terse to tell you
 * which — this prints the problem verbatim.
 */
async function twitch() {
  if (!configuredTwitch()) {
    console.log("twitch: client id, secret, refresh token and user id are not all set — see Settings -> Twitch");
    return;
  }
  const { live, problem } = await getLiveFollowed();
  if (problem) {
    console.log(`twitch: ${problem}`);
    return;
  }
  if (!live.length) {
    console.log("twitch: nobody you follow is live");
    return;
  }
  console.log(`twitch: ${live.length} live`);
  for (const s of live) {
    console.log(
      `    ${s.name} — ${viewers(s.viewers)} · ${s.game || "no category"} · up ${uptime(s.startedAt)}`,
    );
    if (s.title) console.log(`      ${s.title}`);
  }
}

/**
 * Live scores, which fail the same way: an empty card is the truth on a Tuesday
 * and also the truth when fixtureMatches cannot reconcile ESPN's spelling of a
 * club with our feed's. This says which — and, when nothing is live, proves the
 * widget spends nothing, because getScore is never reached.
 */
async function scores() {
  const { events, layers } = await loadAllEvents();
  const fixtures = events.filter((e) => layers.get(e.layer)?.fixture);
  const live = liveNow(fixtures).filter((e) => competitionsForLayer(e.layer).length > 0);

  if (!live.length) {
    const next = fixtures
      .filter((e) => competitionsForLayer(e.layer).length > 0 && toInstant(e.start) > Date.now())
      .sort((a, b) => toInstant(a.start) - toInstant(b.start))[0];
    console.log(
      `scores: nothing live — 0 ESPN requests. Next: ${next ? `${next.title} (${next.start})` : "none on the board"}`,
    );
    return;
  }

  for (const event of live) {
    const paths = competitionsForLayer(event.layer)
      .map((key) => COMPETITIONS[key]?.espnPath)
      .filter(Boolean)
      .join(", ");
    const { score, fetchedAt, problem } = await getScore(event);
    console.log(`scores: ${event.title}`);
    console.log(`    layer ${event.layer} → ${paths}`);
    if (problem) console.log(`    ESPN: ${problem}`);
    console.log(
      score
        ? `    ${score.home.name} ${score.home.score ?? "–"} – ${score.away.score ?? "–"} ${score.away.name} · ${score.clock} · ${score.state} · loaded ${fetchedAt}`
        : "    no line on the slate matched this fixture (check fixtureMatches)",
    );
  }
}

/**
 * The PC agent's hardware endpoint, read the way the widget reads it.
 *
 * The interesting answer is which fields came back null: an unelevated agent
 * still reports GPU, memory and load, so "no temperature" is the normal state of
 * a manual launch and a bug only if the task is supposed to be elevated.
 */
async function vitals() {
  const url = `${agentBase()}/vitals`;
  let body: Record<string, unknown>;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.status === 404) {
      console.log("vitals: 404 — that agent predates /vitals. Rebuild: dotnet publish -c Release -o dist");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.log(`vitals: ${(err as Error).message} — is dayboard-nowplaying running?`);
    return;
  }

  console.log(`vitals: ok, elevated=${body.elevated}`);
  const missing: string[] = [];
  for (const [group, fields] of Object.entries(body)) {
    if (fields === null) {
      missing.push(group);
      continue;
    }
    if (typeof fields !== "object" || Array.isArray(fields)) continue;
    const entries = Object.entries(fields as Record<string, unknown>);
    console.log(
      `    ${group.padEnd(4)} ${entries.map(([k, v]) => `${k}=${v ?? "null"}`).join(" ")}`,
    );
    missing.push(...entries.filter(([, v]) => v === null).map(([k]) => `${group}.${k}`));
  }
  console.log(`    fans ${(body.fans as unknown[]).length} · drives ${(body.drives as unknown[]).length} · disks ${(body.disks as unknown[]).length}`);
  // Its own line for the same reason the arrays above have one: the loop skips
  // arrays, and printing five grouped processes as key=value would be a second monitor.
  // Absent for the first few seconds of an agent's life — a CPU percentage is a
  // rate, and the first sample has nothing to difference against.
  const procs = body.processes as { name: string; cpu: number; count: number }[] | undefined | null;
  console.log(
    `    procs ${
      procs?.length
        ? procs.map((p) => `${p.name}${p.count > 1 ? `x${p.count}` : ""} ${p.cpu.toFixed(1)}%`).join(" · ")
        : "— (no second sample yet, or an agent built before the process list)"
    }`,
  );
  if (missing.length) {
    console.log(
      `    null: ${missing.join(", ")}`
        + (body.elevated ? "" : "  (expected — not elevated, see docs/agents.md)"),
    );
  }
}

async function once() {
  const solo = only === "scores" || only === "vitals";
  if (!solo && only !== "twitch") await discord();
  if (!solo && only !== "discord") await twitch();
  if (only === "scores" || !only) await scores();
  if (only === "vitals" || !only) await vitals();
}

async function main() {
  await once();
  // The point of watching is voice presence, which changes while you look at it.
  while (watch) {
    await new Promise((r) => setTimeout(r, 5000));
    console.log("—");
    await once();
  }
}

main();
