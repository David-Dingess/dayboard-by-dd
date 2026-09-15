import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { EventFileSchema, ManifestSchema, type Manifest } from "../src/lib/schema";
import { nowIso } from "../src/lib/time";

/**
 * A refresh: pull every team's schedule, resolve the watch links, recount the
 * layers, validate. The dayboard-refresh scheduled task runs this daily.
 */

const MANIFEST = "data/cache/manifest.json";
const dryRun = process.argv.includes("--dry-run");

function step(name: string, script: string, args: string[] = []): boolean {
  console.log(`\n== ${name}`);
  const result = spawnSync(
    "npm",
    ["run", "--silent", script, ...(args.length ? ["--", ...args] : [])],
    { stdio: "inherit", shell: true },
  );
  if (result.status !== 0) {
    console.error(`   ${name} exited ${result.status}`);
    return false;
  }
  return true;
}

const upstreamsOk = step("upstream feeds", "refresh:upstreams", dryRun ? ["--dry-run"] : []);

// Additive and failure-tolerant: it exits 0 even when ESPN is unreachable, so it
// can never turn a good refresh into a failed one.
step("watch links", "refresh:watch", dryRun ? ["--dry-run"] : []);

// Recount every layer so the manifest carries an honest picture of what shipped.
const counts: Record<string, number> = {};
const files = [
  ...readdirSync("data/layers").map((f) => `data/layers/${f}`),
  ...readdirSync("data/cache")
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => `data/cache/${f}`),
].filter((f) => f.endsWith(".json"));

for (const file of files) {
  try {
    for (const ev of EventFileSchema.parse(JSON.parse(readFileSync(file, "utf8")))) {
      counts[ev.layer] = (counts[ev.layer] ?? 0) + 1;
    }
  } catch {
    // validate reports the real error; don't double-report here
  }
}

if (!dryRun && existsSync(MANIFEST)) {
  const manifest: Manifest = ManifestSchema.parse(JSON.parse(readFileSync(MANIFEST, "utf8")));
  manifest.counts = counts;
  manifest.updatedAt = nowIso();
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
}

const validateOk = step("validate", "validate");

console.log("\n== summary");
for (const [layer, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${layer.padEnd(16)} ${n}`);
}
console.log(`   ${"TOTAL".padEnd(16)} ${Object.values(counts).reduce((a, b) => a + b, 0)}`);

if (existsSync(MANIFEST)) {
  const manifest: Manifest = ManifestSchema.parse(JSON.parse(readFileSync(MANIFEST, "utf8")));
  const failing = Object.entries(manifest.upstreams).filter(([, u]) => !u.ok);
  if (failing.length) {
    console.log("\n   upstreams needing attention:");
    for (const [id, u] of failing) {
      console.log(`     ${id}: ${u.error} (${u.consecutiveFailures} consecutive; serving ${u.count} cached)`);
    }
  }
  // A big drop usually means the season rolled over and the URL needs bumping —
  // worth saying out loud, never worth "fixing" automatically.
  for (const [id, u] of Object.entries(manifest.upstreams)) {
    if (u.ok && u.previousCount && u.count < u.previousCount * 0.5) {
      console.log(`\n   NOTE: ${id} dropped from ${u.previousCount} to ${u.count} events — check the source URL.`);
    }
  }
}

process.exit(upstreamsOk && validateOk ? 0 : 1);
