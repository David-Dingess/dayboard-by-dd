import { readFileSync, existsSync } from "node:fs";
import { parseTakeoutCsv } from "../src/lib/youtube";
import { loadSettings, saveSettings } from "../src/lib/settings";
import { notifyBoard } from "./notify-board";

/**
 * Turn a Google Takeout YouTube subscriptions export into the channel list in
 * data/settings.json. The setup guide's YouTube section does the same from a
 * pasted file; this is the terminal route.
 *
 * Takeout -> YouTube and YouTube Music -> subscriptions -> subscriptions.csv,
 * whose columns are "Channel Id, Channel Url, Channel Title". Subscriptions are
 * private, so this one manual export is the only way in; after it, every video
 * comes from public per-channel RSS with no key and no quota.
 *
 *   npm run import:youtube -- "C:\\path\\to\\subscriptions.csv"
 *
 * Re-running merges: channels added by hand survive, and unsubscribed ones are
 * dropped only when --prune is passed.
 */

const args = process.argv.slice(2);
const prune = args.includes("--prune");
const source = args.find((a) => !a.startsWith("--"));

if (!source) {
  console.error(
    [
      "usage: npm run import:youtube -- <path to subscriptions.csv> [--prune]",
      "",
      "Get the file from takeout.google.com:",
      "  1. Deselect all, then select YouTube and YouTube Music",
      "  2. All YouTube data included -> deselect all -> subscriptions only",
      "  3. Export, download, unzip; the file is subscriptions.csv",
    ].join("\n"),
  );
  process.exit(1);
}

if (!existsSync(source)) {
  console.error(`No such file: ${source}`);
  process.exit(1);
}

const found = parseTakeoutCsv(readFileSync(source, "utf8"));
if (!found.length) {
  console.error('That does not look like a Takeout subscriptions.csv — expected "Channel Id" and "Channel Title" columns.');
  process.exit(1);
}

const settings = loadSettings();
const byId = new Map(settings.youtube.channels.map((c) => [c.id, c]));
let added = 0;
for (const channel of found) {
  if (!byId.has(channel.id)) {
    added++;
    byId.set(channel.id, channel);
  }
}
if (prune) {
  const keep = new Set(found.map((c) => c.id));
  for (const id of [...byId.keys()]) if (!keep.has(id)) byId.delete(id);
}

const channels = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
saveSettings({ ...settings, youtube: { ...settings.youtube, channels } });
notifyBoard();

console.log(
  `youtube: ${found.length} in the export -> ${channels.length} channels (${added} new)` +
    (prune ? ", pruned to the export" : ""),
);
