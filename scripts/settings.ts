import { loadSettings, saveSettings, publicSettings, configured, SETTINGS_FILE } from "../src/lib/settings";
import { SettingsFileSchema } from "../src/lib/settings-schema";
import { notifyBoard } from "./notify-board";

/**
 * The settings file from a terminal — the same module the menu writes through,
 * so the two can never disagree about what is valid.
 *
 *   npm run settings                          what is configured
 *   npm run settings -- show [section]        the file, with secrets masked
 *   npm run settings -- set <path> <value>    e.g. set location.units metric
 *                                             e.g. set appearance.wallpaper false
 *                                             e.g. set discord.guildIds '["123","456"]'
 *   npm run settings -- reset                 back to the defaults
 *
 * A value is parsed as JSON when it can be, and taken as a string otherwise.
 */

const [command, ...rest] = process.argv.slice(2);

function get(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setAt(obj: Record<string, unknown>, path: string[], value: unknown): void {
  const [head, ...tail] = path;
  if (!tail.length) {
    obj[head] = value;
    return;
  }
  const next = obj[head];
  if (!next || typeof next !== "object") obj[head] = {};
  setAt(obj[head] as Record<string, unknown>, tail, value);
}

switch (command) {
  case undefined:
  case "status": {
    const s = loadSettings();
    const flags = configured(s);
    console.log(`settings: ${SETTINGS_FILE}`);
    for (const [k, v] of Object.entries(flags)) console.log(`  ${k.padEnd(10)} ${v ? "configured" : "—"}`);
    console.log(`  screen     ${s.board.screen} · port ${s.board.port} · wallpaper ${s.appearance.wallpaper ? "on" : "off"} ${s.appearance.background}`);
    break;
  }
  case "show": {
    const pub = publicSettings(loadSettings());
    const section = rest[0];
    console.log(JSON.stringify(section ? get(pub, section.split(".")) : pub, null, 2));
    break;
  }
  case "set": {
    const [path, ...valueParts] = rest;
    if (!path || !valueParts.length) {
      console.error("usage: npm run settings -- set <section.field> <value>");
      process.exit(1);
    }
    const raw = valueParts.join(" ");
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // a plain string
    }
    const next = structuredClone(loadSettings()) as unknown as Record<string, unknown>;
    setAt(next, path.split("."), value);
    const parsed = SettingsFileSchema.safeParse(next);
    if (!parsed.success) {
      console.error(`refused: ${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`);
      process.exit(1);
    }
    saveSettings(parsed.data);
    notifyBoard();
    console.log(`${path} = ${JSON.stringify(value)}`);
    break;
  }
  case "reset": {
    saveSettings(SettingsFileSchema.parse({}));
    notifyBoard();
    console.log("settings reset to the defaults");
    break;
  }
  default:
    console.error(`unknown command "${command}" — status | show [section] | set <path> <value> | reset`);
    process.exit(1);
}
