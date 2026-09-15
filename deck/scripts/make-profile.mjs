import { randomUUID } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
// fileURLToPath, not the URL's pathname: this repo lives under "Personal
// Projects", and a raw pathname keeps the %20.
import { fileURLToPath } from "node:url";

/**
 * The Dayboard profile, laid out once so nobody has to place forty-three keys.
 *
 *     npm run profile -- --model mk2            -> deck/Dayboard.streamDeckProfile, to import
 *     npm run profile -- --model mk2 --install  -> written straight into ProfilesV3
 *     npm run profile -- --model mk2 --replace  -> over the installed Dayboard profile, in place
 *                                                  (quit the Stream Deck app first)
 *     npm run profile -- --device "@(1)[...]"   -> pin the device id instead of detecting it
 *
 * --model is one of mk2 (15 keys, also the original and the Mini's big sibling),
 * mini (6), xl (32), plus (8 keys and four dials) or neo (8). The front page is
 * laid out for fifteen keys; smaller decks get the tabs and the folders first and
 * the rest one folder deeper.
 *
 * THE FORMAT IS UNDOCUMENTED and everything below was read off the profiles
 * already on this machine (%APPDATA%\Elgato\StreamDeck\ProfilesV3). It is a
 * directory called <GUID>.sdProfile holding a manifest that names the device and
 * lists its pages, plus one directory per page whose own manifest maps "col,row"
 * to an action. Folders are pages that are NOT listed in Pages — they are
 * reached only by a com.elgato.streamdeck.profile.openchild key naming them, and
 * they carry a backtoparent key of their own.
 *
 * If a future Stream Deck release moves the goalposts, the fallback is placing
 * the keys by hand: the plugin does not depend on any of this.
 */

/* ------------------------------------------------------------- the deck --- */

/**
 * The devices, by the model string Stream Deck writes into a profile's
 * manifest. Read off real profiles; a model not listed here means placing the
 * keys by hand, which the plugin does not mind.
 */
const MODELS = {
  mk2: { model: "20GAA9902", columns: 5, rows: 3, label: "Stream Deck MK.2 (15 keys)" },
  original: { model: "20GAA9901", columns: 5, rows: 3, label: "Stream Deck (15 keys)" },
  mini: { model: "20GAI9901", columns: 3, rows: 2, label: "Stream Deck Mini (6 keys)" },
  xl: { model: "20GAT9901", columns: 8, rows: 4, label: "Stream Deck XL (32 keys)" },
  plus: { model: "20GBD9901", columns: 4, rows: 2, label: "Stream Deck + (8 keys)" },
  neo: { model: "20GBJ9901", columns: 4, rows: 2, label: "Stream Deck Neo (8 keys)" },
};

const argv = process.argv.slice(2);
const modelArg = argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : "mk2";
const deviceArg = argv.includes("--device") ? argv[argv.indexOf("--device") + 1] : "";
if (!MODELS[modelArg]) {
  console.error(`unknown --model "${modelArg}"; one of ${Object.keys(MODELS).join(", ")}`);
  process.exit(1);
}
const DECK = MODELS[modelArg];
const MODEL = DECK.model;
const COLUMNS = DECK.columns;
const ROWS = DECK.rows;

const PROFILES_DIR = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
  "Elgato",
  "StreamDeck",
  "ProfilesV3",
);

/**
 * The device's own identifier, "@(1)[vendor/product/serial]". Read off
 * whichever installed profile already targets this model, because the serial
 * is one deck's and nobody else's — or given with --device. Absent (a fresh
 * machine), the model alone is enough for an import, which asks which device
 * to import to anyway.
 */
function deviceUuid() {
  if (deviceArg) return deviceArg;
  if (!existsSync(PROFILES_DIR)) return "";
  for (const entry of readdirSync(PROFILES_DIR)) {
    const file = path.join(PROFILES_DIR, entry, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      const manifest = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
      if (manifest?.Device?.Model === MODEL && manifest.Device.UUID) return manifest.Device.UUID;
    } catch {
      // Somebody else's profile, half-written or from an older release.
    }
  }
  return "";
}

/* ------------------------------------------------------------ the pieces -- */

const PLUGIN = { Name: "Dayboard", UUID: "com.dayboard.deck", Version: "1.0.0.0" };

/** A key belonging to our plugin. The title is drawn by the plugin, not by this. */
const key = (uuid, name, settings = {}) => ({
  ActionID: randomUUID(),
  LinkedTitle: true,
  Name: name,
  Plugin: PLUGIN,
  Resources: null,
  Settings: settings,
  State: 0,
  // No Title: every one of these draws its own words into the image, so a title
  // on top would be a second, staler copy of the same text.
  States: [{ ShowTitle: false }],
  UUID: uuid,
});

/**
 * Into a folder. `child` is the page's GUID, lowercase, as Stream Deck writes it.
 *
 * IT CARRIES ITS OWN PICTURE because no plugin code runs for it. This is
 * Elgato's Create Folder action, so setImage is never called and the app would
 * otherwise draw its stock folder — the only two keys on the deck that would not
 * match the rest. `face` names a PNG that lives beside this page's manifest,
 * baked at key size by scripts/make-icons.py in the same palette src/art.ts uses,
 * with the word already in it. Hence ShowTitle: false.
 */
const intoFolder = (child, face) => ({
  ActionID: randomUUID(),
  LinkedTitle: true,
  Name: "Create Folder",
  Plugin: { Name: "Create Folder", UUID: "com.elgato.streamdeck.profile.openchild", Version: "1.0" },
  Resources: null,
  Settings: { ProfileUUID: child },
  State: 0,
  States: [{ Image: `Images/${face}.png`, ShowTitle: false }],
  UUID: "com.elgato.streamdeck.profile.openchild",
});

const backKey = () => ({
  ActionID: randomUUID(),
  LinkedTitle: true,
  Name: "Parent Folder",
  Plugin: { Name: "Open Parent Folder", UUID: "com.elgato.streamdeck.profile.backtoparent", Version: "1.0" },
  Resources: null,
  Settings: {},
  State: 0,
  States: [{}],
  UUID: "com.elgato.streamdeck.profile.backtoparent",
});

const tab = (side, id, label, icon) =>
  key("com.dayboard.deck.tab", "Panel tab", { side, id, label, icon });

/* -------------------------------------------------------------- the pages - */

/** "col,row" for the nth key, reading left to right and top to bottom. */
function* slots(skip = 0) {
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      if (skip-- > 0) continue;
      yield `${column},${row}`;
    }
  }
}

/**
 * A page of keys.
 *
 * `Type: "Keypad"` is not optional even on a device that has nothing else:
 * without it Stream Deck reads the page but has no controller to attach it to.
 */
const page = (actions) => ({
  Controllers: [{ Actions: actions, Type: "Keypad" }],
  Icon: "",
  Name: "",
});

/**
 * The Default page, which is NOT one of the pages.
 *
 * Stream Deck keeps a blank page per profile as the template for a new one, and
 * it must be a directory of its own that `Pages.Default` names and `Pages.Pages`
 * does not. Pointing Default at a real page instead gets it refused —
 * "Failed to map default page … (duplicate)" — and the profile arrives empty.
 */
const blankPage = () => page(null);

/** A folder of numbered slots: back, then as many list keys as the deck holds. */
function slotPage(uuid, name) {
  const actions = { "0,0": backKey() };
  let slot = 0;
  for (const at of slots(1)) actions[at] = key(uuid, name, { slot: slot++ });
  return page(actions);
}

/**
 * The deck's front page, for a fifteen-key deck.
 *
 * THE RIGHT-HAND TABS HAVE A FOLDER. The centre panel's tabs are the ones
 * changed from across the room, so they stay on the front page, and the right
 * panel's whole row goes one press deeper — all of it, nothing dropped.
 *
 * The rows: the centre panel's tabs, in the board's own order (Music second);
 * the three list folders (Live, Videos, and Sports — the team streams), the
 * video's size and the Right panel folder; then water, the alerts banner, the
 * output, the mute and the board's reset. There is no window-pin key: the
 * agent keeps the board on top by itself.
 *
 * Rearrange the deck in the app if you like — but mirror it here, or the next
 * `--replace` puts this arrangement back.
 */
function mainPage(nl, twitch, panels, sports) {
  if (COLUMNS * ROWS < 15) return compactMainPage(nl, twitch, panels, sports);
  return page({
    "0,0": tab("center", "calendar", "Calendar", "calendar"),
    "1,0": tab("center", "music", "Music", "music"),
    // "watch" is the id every stored tab and player entry carries; the label
    // once said Gaming and now says the same thing as the id.
    "2,0": tab("center", "watch", "Watch", "watch"),
    "3,0": tab("center", "sports", "Sports", "sports"),
    "4,0": tab("center", "health", "Health", "health"),

    // The three list folders together — Twitch, videos, the teams' streaming
    // sites — then the video's size and the right panel.
    "0,1": intoFolder(twitch, "live"),
    "1,1": intoFolder(nl, "videos"),
    "2,1": intoFolder(sports, "sports"),
    "3,1": key("com.dayboard.deck.expand", "Full panel video"),
    "4,1": intoFolder(panels, "panels"),

    "0,2": key("com.dayboard.deck.water", "Water", { ounces: 8 }),
    "1,2": key("com.dayboard.deck.alerts", "Turn on alerts"),
    "2,2": key("com.dayboard.deck.audio", "Output"),
    "3,2": key("com.dayboard.deck.mute", "Mute"),
    "4,2": key("com.dayboard.deck.reset", "Reset the board"),
  });
}

/**
 * The front page for a deck with fewer than fifteen keys: the folders first,
 * because they are where the lists are, then as many single keys as fit. On a
 * Mini that is Live, Videos, Sports, the panel folder, water and the alerts;
 * the tabs live inside the panel folder along with everything else.
 */
function compactMainPage(nl, twitch, panels, sports) {
  const keys = [
    intoFolder(twitch, "live"),
    intoFolder(nl, "videos"),
    intoFolder(sports, "sports"),
    intoFolder(panels, "panels"),
    key("com.dayboard.deck.water", "Water", { ounces: 8 }),
    key("com.dayboard.deck.alerts", "Turn on alerts"),
    key("com.dayboard.deck.expand", "Full panel video"),
    key("com.dayboard.deck.audio", "Output"),
  ];
  const actions = {};
  let i = 0;
  for (const at of slots()) {
    if (i >= keys.length) break;
    actions[at] = keys[i++];
  }
  return page(actions);
}

/**
 * Every right-panel tab, in the board's own order and with the board's own
 * words. On a small deck the centre tabs and the remaining controls join them
 * here, so nothing is lost — it is one press deeper. The ids are what travel, and some of them are older than the labels:
 * "notes" is To-Dos, "pc" is Computer, "amazon" is Packages. See DECK_TABS in src/lib/deck.ts.
 */
function panelsPage() {
  const tabs = [
    tab("right", "planner", "Planner", "planner"),
    tab("right", "notes", "To-Dos", "notes"),
    tab("right", "pc", "Computer", "computer"),
    tab("right", "mail", "Mail", "mail"),
    tab("right", "amazon", "Packages", "amazon"),
  ];
  if (COLUMNS * ROWS < 15) {
    tabs.push(
      tab("center", "calendar", "Calendar", "calendar"),
      tab("center", "music", "Music", "music"),
      tab("center", "watch", "Watch", "watch"),
      tab("center", "sports", "Sports", "sports"),
      tab("center", "health", "Health", "health"),
      key("com.dayboard.deck.mute", "Mute"),
      key("com.dayboard.deck.reset", "Reset the board"),
    );
  }
  const actions = { "0,0": backKey() };
  let i = 0;
  for (const at of slots(1)) {
    if (i >= tabs.length) break;
    actions[at] = tabs[i++];
  }
  return page(actions);
}

/* ------------------------------------------------------------ the writing - */

// Declared up here rather than beside the main block below, because buildTree
// reaches for the plugin's imgs/ folder and a const is not hoisted.
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const upper = (id) => id.toUpperCase();

function buildTree(root) {
  const main = randomUUID();
  const blank = randomUUID();
  const nl = randomUUID();
  const twitch = randomUUID();
  const panels = randomUUID();
  const sports = randomUUID();

  const write = (rel, value) => {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };

  write("manifest.json", {
    Device: { Model: MODEL, UUID: deviceUuid() },
    Name: "Dayboard",
    // Only `main` is a page. The others are folders, reached by the keys
    // that name them — listing them here would put them in the page carousel.
    Pages: { Current: main, Default: blank, Pages: [main] },
    Version: "3.0",
  });

  write(`Profiles/${upper(main)}/manifest.json`, mainPage(nl, twitch, panels, sports));
  write(`Profiles/${upper(panels)}/manifest.json`, panelsPage());
  write(`Profiles/${upper(blank)}/manifest.json`, blankPage());
  write(`Profiles/${upper(nl)}/manifest.json`, slotPage("com.dayboard.deck.video", "Video slot"));
  write(`Profiles/${upper(twitch)}/manifest.json`, slotPage("com.dayboard.deck.stream", "Stream slot"));
  write(`Profiles/${upper(sports)}/manifest.json`, slotPage("com.dayboard.deck.team", "Team slot"));

  // Stream Deck writes one of these per profile and expects it to exist even
  // when nothing has a custom image.
  mkdirSync(path.join(root, "Images"), { recursive: true });
  for (const id of [main, blank, nl, twitch, panels, sports]) {
    mkdirSync(path.join(root, "Profiles", upper(id), "Images"), { recursive: true });
  }

  // The two folder faces, into the page that shows them. Referenced as
  // Images/<name>.png by intoFolder above.
  for (const face of ["videos", "live", "panels", "sports"]) {
    cpSync(
      path.join(here, "com.dayboard.deck.sdPlugin", "imgs", "folders", `${face}.png`),
      path.join(root, "Profiles", upper(main), "Images", `${face}.png`),
    );
  }
}

/* ------------------------------------------------------------------ zip --- */

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buffer) => {
    let c = -1;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

/**
 * A ZIP, by hand.
 *
 * Node ships deflate but no archiver, and pulling one in for four JSON files
 * would be a dependency to keep alive forever. Deflate-raw entries with real
 * CRCs, which is what every unzipper — including the Stream Deck app's — expects.
 * Entry names use forward slashes because the spec says so, whatever Windows
 * would rather.
 */
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, contents] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const body = deflateRawSync(contents);
    const crc = CRC(contents);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time and date, zeroed for a reproducible file
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    // 8 is FLAGS and 10 is the method — they are the other way round from the
    // local header, which is exactly the kind of thing that produces an archive
    // every reader accepts the shape of and none can decompress.
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(0, 12); // time and date
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(contents.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

function filesUnder(root, prefix) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(full, rel));
    else out.push([rel, readFileSync(full)]);
  }
  return out;
}

/* ----------------------------------------------------------------- main --- */

const install = argv.includes("--install");
const replace = argv.includes("--replace");

/**
 * The profile already installed under this name, for --replace.
 *
 * Replaced IN PLACE, keeping its folder name, because that folder's GUID is how
 * the Stream Deck app remembers which profile the MK.2 is showing. A fresh
 * install is a second profile the device has to be switched to by hand.
 */
function installedProfile(name) {
  if (!existsSync(PROFILES_DIR)) return null;
  for (const entry of readdirSync(PROFILES_DIR)) {
    const file = path.join(PROFILES_DIR, entry, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      const manifest = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      if (manifest?.Name === name && manifest?.Device?.Model === MODEL) return entry;
    } catch {
      // Not ours.
    }
  }
  return null;
}
const folder = `${randomUUID().toUpperCase()}.sdProfile`;
const staging = path.join(here, ".profile-build", folder);

rmSync(path.join(here, ".profile-build"), { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
buildTree(staging);

if (replace) {
  // The Stream Deck app writes its profiles back out when it quits, so it must
  // be closed first or it will put the old pages straight back.
  const existing = installedProfile("Dayboard");
  if (!existing) throw new Error("No installed Dayboard profile for this deck. Use --install instead.");
  const target = path.join(PROFILES_DIR, existing);
  rmSync(path.join(target, "Profiles"), { recursive: true, force: true });
  cpSync(staging, target, { recursive: true });
  console.log(`replaced ${target}`);
  console.log("Start the Stream Deck app to see it.");
} else if (install) {
  const target = path.join(PROFILES_DIR, folder);
  cpSync(staging, target, { recursive: true });
  console.log(`installed ${target}`);
  console.log("Restart the Stream Deck app to see it.");
} else {
  const out = path.join(here, "Dayboard.streamDeckProfile");
  writeFileSync(out, zip(filesUnder(staging, folder)));
  console.log(`wrote ${out} for the ${DECK.label}`);
  console.log("Double-click it, and pick your deck when asked.");
}

rmSync(path.join(here, ".profile-build"), { recursive: true, force: true });
