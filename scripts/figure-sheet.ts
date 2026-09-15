import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FIGURES, drawFigure, labelAt, type Shape } from "../src/lib/health";

/**
 * A contact sheet of the drawn exercise animations, for looking at them without
 * the board.
 *
 *   npm run figures                  every animation
 *   npm run figures -- squat push    only ids containing "squat" or "push"
 *   npm run figures -- squat --png   also screenshot the sheet with headless Chrome
 *   npm run figures -- --png --split 4   one screenshot per four animations
 *
 * One row per animation: every key pose, plus the frame halfway to the next
 * one, each captioned with its time and label. Writes to %TEMP%\dayboard-figures
 * and prints the path. Nothing here touches data/ or the running board.
 *
 * The colours are the stylesheet's (.exfig in globals.css), copied, because the
 * point is to judge the drawing as the board will show it.
 */

const COLORS: Record<string, string> = {
  near: "#ececec",
  mid: "#b5b5b5",
  far: "#767676",
  hot: "#e2a55a",
  prop: "#4a4a4a",
  propSoft: "#343434",
  face: "#1c1c1c",
  gap: "#1c1c1c",
  gear: "#8fa3b3",
};

const CELL = 200;
const PER_ROW = 10;

const args = process.argv.slice(2);
const png = args.includes("--png");
const splitAt = args.indexOf("--split");
const split = splitAt >= 0 ? Math.max(1, Number(args[splitAt + 1]) || 4) : 0;
const filters = args.filter((a, i) => !a.startsWith("--") && (splitAt < 0 || i !== splitAt + 1));

function svg(shapes: Shape[], viewBox: number[]): string {
  const body = shapes
    .map((s) =>
      s.kind === "line"
        ? `<line x1="${s.x1.toFixed(1)}" y1="${s.y1.toFixed(1)}" x2="${s.x2.toFixed(1)}" y2="${s.y2.toFixed(1)}" stroke="${COLORS[s.tone]}" stroke-width="${s.w}" stroke-linecap="round"/>`
        : `<circle cx="${s.cx.toFixed(1)}" cy="${s.cy.toFixed(1)}" r="${s.r}" fill="${COLORS[s.tone]}"/>`,
    )
    .join("");
  return `<svg viewBox="${viewBox.join(" ")}" width="${CELL}" height="${CELL}" style="background:#1c1c1c;border-radius:8px;display:block">${body}</svg>`;
}

const ids = Object.keys(FIGURES).filter((id) => !filters.length || filters.some((f) => id.includes(f)));
if (!ids.length) {
  console.error(`No animation id contains ${filters.join(" or ")}.`);
  process.exit(1);
}

const rows: string[] = [];
for (const id of ids) {
  const anim = FIGURES[id];
  const times: number[] = [];
  anim.keys.forEach((key, i) => {
    times.push(key.at);
    const next = i + 1 < anim.keys.length ? anim.keys[i + 1].at : anim.loop;
    if (next - key.at > 0.3) times.push((key.at + next) / 2);
  });
  let row = `<div style="margin:0 0 6px;font-weight:600">${id} · ${Number(anim.loop.toFixed(2))}s${anim.switchHalfway ? " · switches halfway" : ""}</div>`;
  row += `<div style="display:flex;gap:6px;margin-bottom:12px">`;
  for (const t of times.slice(0, PER_ROW)) {
    row += `<figure style="margin:0;width:${CELL}px">${svg(drawFigure(anim, t + 0.001), anim.viewBox)}<figcaption style="height:28px;overflow:hidden">${t.toFixed(2)}s · ${labelAt(anim, t + 0.001)}</figcaption></figure>`;
  }
  rows.push(row + `</div>`);
}

const dir = path.join(tmpdir(), "dayboard-figures");
mkdirSync(dir, { recursive: true });
const name = filters.length ? filters.join("-").slice(0, 60) : "all";
const pages: { file: string; count: number }[] = [];
const size = split || rows.length;
for (let i = 0; i < rows.length; i += size) {
  const chunk = rows.slice(i, i + size);
  const suffix = split ? `-${String(i / size + 1).padStart(2, "0")}` : "";
  const file = path.join(dir, `${name}${suffix}.html`);
  writeFileSync(file, `<body style="margin:0;padding:8px;background:#111;color:#ccc;font:11px system-ui,sans-serif">${chunk.join("")}</body>`);
  pages.push({ file, count: chunk.length });
  console.log(file);
}

if (png) {
  const chrome = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].find((p) => existsSync(p));
  if (!chrome) {
    console.error("No Chrome found for --png; open the HTML instead.");
    process.exit(1);
  }
  for (const page of pages) {
    const out = page.file.replace(/\.html$/, ".png");
    const width = 16 + PER_ROW * (CELL + 6);
    const height = 16 + page.count * (CELL + 28 + 36);
    const result = spawnSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        `--user-data-dir=${path.join(dir, "chrome")}`,
        `--window-size=${width},${height}`,
        `--screenshot=${out}`,
        `file:///${page.file.replaceAll("\\", "/")}`,
      ],
      { stdio: "ignore" },
    );
    if (result.status !== 0 || !existsSync(out)) {
      console.error(`Chrome did not write ${out}.`);
      process.exit(1);
    }
    console.log(out);
  }
}
