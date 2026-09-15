/**
 * The key faces, drawn as SVG.
 *
 * setImage takes an SVG string outright, so nothing here is built ahead of time
 * and there are no PNGs to keep in step with the data. The manifest still ships
 * a flat placeholder per action — that is only what a key looks like in the
 * Stream Deck app's action list, before a live one has drawn itself.
 *
 * THE PALETTE IS THE BOARD'S, from src/styles/theme.css. A deck sitting under
 * the board it drives should not be a different colour from it.
 *
 * DRAWN AT 144, SHOWN AT 72. Keys are 72px on an MK.2 and the app downsamples,
 * so working at 2x is what stops small text turning to mush. Every size below is
 * therefore double what it looks like.
 */

export const INK = "#ececec";
export const DIM = "#8a8a8a";
export const BG = "#111111";
export const SURFACE = "#1c1c1c";
export const LINE = "#2a2a2a";
export const ACCENT = "#4bc0c8";
export const ACCENT_INK = "#06232a";
export const OK = "#0ca30c";
export const WARN = "#fab219";
export const CRIT = "#d03b3b";

const SIZE = 144;

/**
 * An SVG, wrapped as a data URI for setImage.
 *
 * THE SDK'S TYPES SAY setImage TAKES "an SVG string", AND THE APP DOES NOT.
 * A raw <svg …> is accepted over the websocket without complaint — the promise
 * resolves, nothing is logged, and the key quietly goes on showing the image
 * from the manifest. Seventy of those before it was obvious. It has to be a
 * data URI, and base64 rather than a URL-encoded payload so no character in a
 * video title has to be escaped correctly.
 *
 * Applied at the very edge, in keys/live.ts, so every function below still
 * returns real SVG that a browser can render — which is what makes the key art
 * previewable without a Stream Deck plugged in.
 */
export function asKeyImage(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** XML, so five characters have to go. */
export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Break text into lines that fit, greedily, on whole words.
 *
 * Character counts rather than measured widths: there is no text metric
 * available in a plugin process, and for a bold sans at these sizes the count is
 * close enough that the alternative — bundling a font and a measuring library to
 * lay out four words — would be absurd. A word longer than the line is cut with
 * an ellipsis rather than allowed to bleed off the key.
 */
export function wrap(text: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue;
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= perLine) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (lines.length === maxLines) break;
    line = word.length > perLine ? `${word.slice(0, perLine - 1)}…` : word;
  }
  if (line && lines.length < maxLines) lines.push(line);

  // Whatever did not fit is marked as missing on the last line rather than
  // silently dropped — a truncated key that does not look truncated is a key you
  // misread.
  const used = lines.join(" ");
  if (used.length < text.trim().length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.endsWith("…") ? last : `${last.slice(0, perLine - 1)}…`;
  }
  return lines;
}

interface TextBlock {
  lines: string[];
  y: number;
  size: number;
  fill?: string;
  weight?: number;
  anchor?: "middle" | "start" | "end";
  x?: number;
}

function block(b: TextBlock): string {
  const anchor = b.anchor ?? "middle";
  const x = b.x ?? SIZE / 2;
  const step = Math.round(b.size * 1.15);
  return b.lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${b.y + i * step}" fill="${b.fill ?? INK}" font-size="${b.size}" ` +
        `font-weight="${b.weight ?? 600}" text-anchor="${anchor}" ` +
        `font-family="Segoe UI, system-ui, sans-serif">${esc(line)}</text>`,
    )
    .join("");
}

function frame(body: string, background = BG): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" fill="${background}"/>` +
    body +
    `</svg>`
  );
}

/** A full-bleed picture, dimmed enough that text on top of it stays readable. */
function backdrop(dataUri: string | null, opacity = 0.32): string {
  if (!dataUri) return "";
  return (
    `<image href="${dataUri}" x="0" y="0" width="${SIZE}" height="${SIZE}" ` +
    `preserveAspectRatio="xMidYMid slice" opacity="${opacity}"/>` +
    // A little extra weight under the lower half, where the small type sits.
    `<rect y="${SIZE / 2}" width="${SIZE}" height="${SIZE / 2}" fill="${BG}" opacity="0.45"/>`
  );
}

/* ----------------------------------------------------------------- glyphs -- */

/**
 * One mark per panel tab, so a row of five keys is told apart at a glance
 * rather than read.
 *
 * A WORD IS SLOWER THAN A SHAPE at arm's length, and "Planner" and "Packages"
 * start with the same letter, and those are exactly the keys you are choosing
 * between in the panel folder. The label stays underneath: the glyph
 * is what you find the key by, the word is what confirms it.
 *
 * Every one is drawn in a 40x56 box centred at x=72, above a label baseline of
 * 118. Stroke weights are heavy on purpose; a 3px line at 144 is invisible once
 * the app has scaled it to a 72px key.
 */
const GLYPHS: Record<string, (colour: string) => string> = {
  calendar: (c) =>
    `<rect x="44" y="30" width="56" height="50" rx="7" fill="none" stroke="${c}" stroke-width="7"/>` +
    `<path d="M44 48 h56" stroke="${c}" stroke-width="7"/>` +
    `<path d="M60 22 v14 M84 22 v14" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`,
  watch: (c) =>
    `<rect x="40" y="28" width="64" height="46" rx="7" fill="none" stroke="${c}" stroke-width="7"/>` +
    `<path d="M64 40 l20 11 l-20 11 z" fill="${c}"/>`,
  // A controller, kept for the Watch tab's key: YouTube and Twitch.
  gaming: (c) =>
    `<path d="M50 34 h44 a18 18 0 0 1 18 18 v8 a12 12 0 0 1 -22 6 l-5 -7 h-26 l-5 7 a12 12 0 0 1 -22 -6 v-8 a18 18 0 0 1 18 -18 z" ` +
    `fill="none" stroke="${c}" stroke-width="7" stroke-linejoin="round"/>` +
    `<path d="M51 44 v14 M44 51 h14" stroke="${c}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="88" cy="47" r="4" fill="${c}"/><circle cx="96" cy="55" r="4" fill="${c}"/>`,
  // A ball: the Sports tab, where the team streams play.
  sports: (c) =>
    `<circle cx="72" cy="52" r="28" fill="none" stroke="${c}" stroke-width="7"/>` +
    `<path d="M72 40 l12 9 l-5 14 h-14 l-5 -14 z" fill="${c}"/>` +
    `<path d="M72 40 v-12 M84 49 l12 -4 M79 63 l7 11 M65 63 l-7 11 M60 49 l-12 -4" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
  // A pair of beamed quavers: the Music tab, which is Apple Music.
  music: (c) =>
    `<path d="M58 72 V32 L100 24 V64" fill="none" stroke="${c}" stroke-width="7" stroke-linejoin="round"/>` +
    `<ellipse cx="50" cy="73" rx="11" ry="8" fill="${c}"/>` +
    `<ellipse cx="92" cy="65" rx="11" ry="8" fill="${c}"/>`,
  health: (c) =>
    `<path d="M52 51 h40" stroke="${c}" stroke-width="9" stroke-linecap="round"/>` +
    `<rect x="34" y="33" width="14" height="36" rx="5" fill="${c}"/>` +
    `<rect x="96" y="33" width="14" height="36" rx="5" fill="${c}"/>`,
  planner: (c) =>
    [26, 50, 74]
      .map(
        (y, i) =>
          `<circle cx="46" cy="${y}" r="6" fill="${c}"/>` +
          `<path d="M62 ${y} h${i === 2 ? 28 : 44}" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`,
      )
      .join(""),
  notes: (c) =>
    `<rect x="46" y="22" width="52" height="60" rx="7" fill="none" stroke="${c}" stroke-width="7"/>` +
    `<path d="M60 42 h24 M60 58 h24" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`,
  // An envelope.
  mail: (c) =>
    `<rect x="36" y="30" width="72" height="48" rx="7" fill="none" stroke="${c}" stroke-width="7"/>` +
    `<path d="M40 36 l32 24 l32 -24" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>`,
  // A parcel.
  amazon: (c) =>
    `<path d="M72 22 l32 14 v34 l-32 14 l-32 -14 v-34 z" fill="none" stroke="${c}" stroke-width="7" stroke-linejoin="round"/>` +
    `<path d="M40 36 l32 14 l32 -14 M72 50 v34" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>`,
  computer: (c) =>
    `<rect x="38" y="24" width="68" height="46" rx="7" fill="none" stroke="${c}" stroke-width="7"/>` +
    `<path d="M58 82 h28 M72 70 v12" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`,
};

/* ------------------------------------------------------------------ keys -- */

export function tabKey(label: string, active: boolean, icon?: string): string {
  const ink = active ? ACCENT_INK : INK;
  const glyph = icon ? GLYPHS[icon] : undefined;
  return frame(
    (active
      ? `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="12" fill="${ACCENT}"/>`
      : `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="12" fill="${SURFACE}" ` +
        `stroke="${LINE}" stroke-width="2"/>`) +
      (glyph
        ? // With a mark, the word drops to a caption under it.
          glyph(active ? ACCENT_INK : ACCENT) +
          block({ lines: wrap(label, 11, 1), y: 118, size: 17, weight: 600, fill: ink })
        : // Without one, it is the whole key.
          block({ lines: wrap(label, 9, 3), y: 66, size: 21, weight: 700, fill: ink })),
  );
}

export function videoKey(
  opts: { game: string | null; statement: string; ago: string; fresh: boolean },
  thumb: string | null,
): string {
  // The game leads, because on this channel it is the half that decides whether
  // you press the key — the same argument the video tiles on the board make.
  const heading = opts.game ?? opts.statement;
  const under = opts.game ? opts.statement : "";
  return frame(
    backdrop(thumb) +
      block({ lines: wrap(heading, 13, 2), y: 44, size: 19, weight: 700 }) +
      (under ? block({ lines: wrap(under, 19, 2), y: 96, size: 13, weight: 500, fill: DIM }) : "") +
      block({ lines: [opts.ago], y: 134, size: 13, weight: 500, fill: DIM }) +
      (opts.fresh ? `<circle cx="128" cy="16" r="8" fill="${OK}"/>` : ""),
  );
}

export function streamKey(
  opts: { channel: string; game: string; viewers: string },
  avatar: string | null,
): string {
  return frame(
    backdrop(avatar, 0.28) +
      `<circle cx="16" cy="16" r="8" fill="${CRIT}"/>` +
      block({ lines: wrap(opts.channel, 12, 2), y: 48, size: 20, weight: 700 }) +
      block({ lines: wrap(opts.game, 18, 2), y: 96, size: 13, weight: 500, fill: DIM }) +
      block({ lines: [opts.viewers], y: 134, size: 14, weight: 600, fill: DIM }),
  );
}

/**
 * A team in the Sports folder: the crest, who they play next, and when.
 *
 * The team's own colour is the lip down the left, the same device the board's
 * tiles use, so four keys read as four clubs before the words are read. Live is
 * the red dot every live thing on this deck wears.
 */
export function teamKey(
  opts: { name: string; line: string; when: string; live: boolean; color: string; playable: boolean },
  logo: string | null,
): string {
  const crest = logo
    ? `<image href="${logo}" x="44" y="10" width="56" height="56" preserveAspectRatio="xMidYMid meet"` +
      (opts.playable ? "" : ` opacity="0.4"`) +
      `/>`
    : "";
  return frame(
    `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="12" fill="${SURFACE}" stroke="${LINE}" stroke-width="2"/>` +
      `<rect x="4" y="16" width="8" height="${SIZE - 32}" rx="4" fill="${esc(opts.color)}"/>` +
      crest +
      (opts.live ? `<circle cx="126" cy="18" r="8" fill="${CRIT}"/>` : "") +
      block({ lines: wrap(logo ? opts.line : opts.name, 15, 1), y: logo ? 90 : 60, size: 15, weight: 700, fill: opts.playable ? INK : DIM }) +
      block({ lines: [opts.when || (opts.playable ? "" : "no stream")], y: 118, size: 14, weight: 500, fill: opts.live ? CRIT : DIM }),
  );
}

/**
 * The board's reset — the button beside the Agent light, as a key: reload the
 * board, and restart its server when one is supervising it.
 */
export function resetKey(spinning: boolean): string {
  const c = spinning ? ACCENT : INK;
  return frame(
    `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="12" fill="${SURFACE}" stroke="${LINE}" stroke-width="2"/>` +
      `<path d="M98 52 a28 28 0 1 1 -8 -20" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M100 18 v18 h-18" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
      block({ lines: [spinning ? "Resetting" : "Reset"], y: 118, size: 17, weight: 600, fill: spinning ? ACCENT : INK }),
  );
}

/** A slot with nothing in it. Blank, not an error — the list is simply shorter. */
export function emptyKey(label: string): string {
  return frame(
    `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="12" fill="none" ` +
      `stroke="${LINE}" stroke-width="2" stroke-dasharray="6 6"/>` +
      block({ lines: [label], y: 78, size: 14, weight: 500, fill: "#4a4a4a" }),
  );
}

export function waterKey(ounces: number, today: number, goal: number): string {
  const label = ounces > 0 ? `+${ounces}` : `${ounces}`;
  const share = goal > 0 ? Math.min(1, today / goal) : 0;
  return frame(
    // A bottle that fills, on the same principle as the one on the board: the
    // number says what the key does, the bar says where the day is.
    `<rect x="12" y="112" width="${SIZE - 24}" height="10" rx="5" fill="${SURFACE}"/>` +
      `<rect x="12" y="112" width="${Math.round((SIZE - 24) * share)}" height="10" rx="5" fill="${ACCENT}"/>` +
      block({ lines: [label], y: 62, size: 40, weight: 700 }) +
      block({ lines: [`${today}/${goal}`], y: 96, size: 16, weight: 500, fill: DIM }),
  );
}

export function expandKey(on: boolean): string {
  const stroke = on ? ACCENT : DIM;
  return frame(
    `<rect x="26" y="34" width="92" height="56" rx="6" fill="none" stroke="${stroke}" stroke-width="5"/>` +
      (on ? `<rect x="34" y="42" width="76" height="40" rx="3" fill="${ACCENT}" opacity="0.35"/>` : "") +
      block({ lines: [on ? "Full" : "Corner"], y: 122, size: 18, weight: 600, fill: stroke }),
  );
}

export function audioKey(live: string, unavailable: boolean): string {
  if (unavailable) return emptyKey("no agent");
  const headphones = live === "headphones";
  const glyph = headphones
    ? // A headset: a band and two cups.
      `<path d="M40 78 v-8 a32 32 0 0 1 64 0 v8" fill="none" stroke="${ACCENT}" stroke-width="7" stroke-linecap="round"/>` +
      `<rect x="30" y="74" width="18" height="26" rx="7" fill="${ACCENT}"/>` +
      `<rect x="96" y="74" width="18" height="26" rx="7" fill="${ACCENT}"/>`
    : // A speaker cone and two waves.
      `<path d="M46 62 h14 l18 -16 v52 l-18 -16 h-14 z" fill="${ACCENT}"/>` +
      `<path d="M88 60 a20 20 0 0 1 0 24" fill="none" stroke="${ACCENT}" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="M98 50 a34 34 0 0 1 0 44" fill="none" stroke="${ACCENT}" stroke-width="6" stroke-linecap="round"/>`;
  return frame(
    glyph + block({ lines: [headphones ? "Phones" : "Speakers"], y: 128, size: 17, weight: 600, fill: DIM }),
  );
}

export function muteKey(muted: boolean, unavailable: boolean): string {
  if (unavailable) return emptyKey("no agent");
  const colour = muted ? CRIT : DIM;
  return frame(
    `<path d="M42 60 h14 l18 -16 v52 l-18 -16 h-14 z" fill="${colour}"/>` +
      (muted
        ? `<path d="M88 56 l28 28 M116 56 l-28 28" stroke="${CRIT}" stroke-width="7" stroke-linecap="round"/>`
        : `<path d="M88 60 a20 20 0 0 1 0 24" fill="none" stroke="${colour}" stroke-width="6" stroke-linecap="round"/>`) +
      block({ lines: [muted ? "Muted" : "Sound"], y: 128, size: 17, weight: 600, fill: colour }),
  );
}

/**
 * Turn the alerts on — the banner's button, as a key.
 *
 * It does not know whether it worked, and that is honest rather than lazy:
 * whether the chime is armed lives in an AudioContext in the browser and is not
 * on /api/deck/state. The banner four feet away is already the readout, and it
 * takes itself down within four seconds of a press that landed.
 */
export function alertsKey(): string {
  return frame(
    // A bell, with a clapper.
    `<path d="M46 88 v-22 a26 26 0 0 1 52 0 v22 l10 12 h-72 z" fill="none" stroke="${ACCENT}" ` +
      `stroke-width="7" stroke-linejoin="round"/>` +
      `<path d="M64 104 a8 8 0 0 0 16 0" fill="none" stroke="${ACCENT}" stroke-width="7" stroke-linecap="round"/>` +
      `<circle cx="72" cy="36" r="5" fill="${ACCENT}"/>` +
      block({ lines: ["Alerts"], y: 132, size: 17, weight: 600, fill: DIM }),
  );
}

/** Nothing is answering on 6767. Every key says the same thing rather than lying. */
export function offlineKey(): string {
  return frame(
    `<circle cx="72" cy="58" r="26" fill="none" stroke="${CRIT}" stroke-width="6"/>` +
      `<path d="M54 40 l36 36" stroke="${CRIT}" stroke-width="6" stroke-linecap="round"/>` +
      block({ lines: ["no board"], y: 118, size: 16, weight: 600, fill: CRIT }),
  );
}
