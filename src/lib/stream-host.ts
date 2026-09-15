import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { loadSettings } from "./settings";
import {
  artworkUrl,
  MUSIC_HOME,
  isMusicUrl,
  MUSIC_PORT,
  musicProfile,
  READ_TRACK,
  transportScript,
  type MusicCommand,
  type MusicState,
  type MusicTrack,
} from "./music";
import {
  chromeArgs,
  pageTargets,
  sameSite,
  STREAM_PORT,
  streamProfile,
  type CdpTarget,
  type StreamCommand,
  type StreamState,
} from "./stream";

/**
 * The stream window's IO: the helper that parents it, the Chrome that is it,
 * and the DevTools socket that drives it.
 *
 * THREE PROCESSES, ONE OWNER EACH.
 *   the Next server  runs this file, and is the only thing the page talks to.
 *   dayboard-stream  agent/stream — a child of this process on stdio pipes. It
 *                    owns every window call: parenting, placing, popups, focus.
 *                    If this server restarts, it exits and the next one starts
 *                    a new one, which takes the window over where it stands.
 *   chrome.exe       the stream browser, spawned DETACHED so it outlives a
 *                    server restart (a `npm run deploy` must not end a match).
 *                    Driven over http://127.0.0.1:9224, loopback only.
 *
 * TWO LANES, THE SAME THREE PROCESSES EACH. The Sports tab's stream and the
 * Music tab's music.apple.com are separate browsers with separate helpers — see
 * lib/music.ts for why music cannot share the stream's browser — and each lane
 * is one Host below. The routes only ever see streamState/runStream and
 * musicState/runMusic.
 *
 * WHY THE SERVER AND NOT THE PAGE drives Chrome: the DevTools port is a door
 * into a browser holding your streaming logins, and a page on the board
 * speaking to it directly would mean every script the board ever loads could
 * too. The route in front of this is gated like /api/deck.
 *
 * Everything fails soft into a state with a `reason` the player can show.
 * A stream that will not open is a sentence on the stage, never a thrown error
 * in a server component.
 */

interface HelperReply {
  id: number;
  ok: boolean;
  error: string | null;
  pid: number;
  board: boolean;
  adopted: boolean;
  visible: boolean;
  muted: boolean;
  monitor?: { x: number; y: number; w: number; h: number };
}

type Waiter = (reply: HelperReply | null) => void;

interface HostConfig {
  /** Passed to agent/stream as --lane. "stream" is the one that stays on top. */
  lane: "stream" | "music";
  port: number;
  profile: () => string;
  /** How long a closed window's browser is kept warm before it is shut. */
  idleCloseMs: number;
  /** What the refusals call it: "the stream", "the music". */
  noun: string;
}

interface Hub {
  helper: ChildProcess | null;
  waiting: Map<number, Waiter>;
  nextId: number;
  /** The lane's browser process, which is what the helper watches. */
  pid: number | null;
  sockets: Map<string, Cdp>;
  /** Commands that navigate run one at a time; placing the window does not wait. */
  queue: Promise<unknown>;
  idle: NodeJS.Timeout | null;
  /** When the page was last refitted to its window — see refit(). */
  refitAt: number;
}

interface Host {
  cfg: HostConfig;
  hub: Hub;
  base: string;
}

/**
 * On globalThis so `next dev`'s module reloads do not orphan a helper and open
 * a second one fighting it for the same window. The stream's key is the one it
 * has always had, so a hub made by an older build of this file is still found.
 */
function makeHost(globalKey: "__dayboardStream" | "__dayboardMusic", cfg: HostConfig): Host {
  const store = globalThis as unknown as { [key: string]: Hub | undefined };
  const hub = (store[globalKey] ??= {
    helper: null,
    waiting: new Map(),
    nextId: 1,
    pid: null,
    sockets: new Map(),
    queue: Promise.resolve(),
    idle: null,
    refitAt: 0,
  });
  // A hub made by an older build of this file, before the field existed.
  hub.refitAt ??= 0;
  return { cfg, hub, base: `http://127.0.0.1:${cfg.port}` };
}

const STREAM = makeHost("__dayboardStream", {
  lane: "stream",
  port: STREAM_PORT,
  profile: () => streamProfile(process.env.LOCALAPPDATA),
  idleCloseMs: 10 * 60 * 1000,
  noun: "the stream",
});

const MUSIC = makeHost("__dayboardMusic", {
  lane: "music",
  port: MUSIC_PORT,
  profile: () => musicProfile(process.env.LOCALAPPDATA),
  // Never sent a close — hiding the tab must not stop the music — so this only
  // matters if something ever does.
  idleCloseMs: 60 * 60 * 1000,
  noun: "the music",
});

class Refusal extends Error {}

/* ---------------------------------------------------------------- helper -- */

function helperExe(): string {
  return path.join(process.cwd(), "agent", "stream", "dist", "dayboard-stream.exe");
}

function ensureHelper(h: Host): ChildProcess {
  const { hub } = h;
  if (hub.helper && hub.helper.exitCode === null) return hub.helper;
  const exe = helperExe();
  if (!existsSync(exe)) {
    throw new Refusal("The stream helper is not built yet — run npm run deploy on the board's machine.");
  }

  // Piped, NOT detached. The trap in board-actions.ts is a detached console
  // program with no stdio, which starts and silently does nothing; this one is
  // meant to live exactly as long as this server and read its stdin.
  const child = spawn(/*turbopackIgnore: true*/ exe, ["--lane", h.cfg.lane], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  hub.helper = child;

  readline.createInterface({ input: child.stdout! }).on("line", (line) => {
    try {
      const reply = JSON.parse(line) as HelperReply;
      hub.waiting.get(reply.id)?.(reply);
      hub.waiting.delete(reply.id);
    } catch {
      // Not a reply. The helper logs to stderr, so this is not expected.
    }
  });
  child.stderr!.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  child.on("exit", () => {
    if (hub.helper === child) hub.helper = null;
    for (const waiter of hub.waiting.values()) waiter(null);
    hub.waiting.clear();
  });
  child.on("error", () => {
    if (hub.helper === child) hub.helper = null;
  });

  // A new helper knows nothing. Tell it which browser is the lane's, so it can
  // take over a window a previous helper left inside the board.
  if (hub.pid) child.stdin!.write(`${JSON.stringify({ id: 0, cmd: "expect", pid: hub.pid })}\n`);
  return child;
}

function helper(h: Host, command: Record<string, unknown>, timeoutMs = 3000): Promise<HelperReply | null> {
  const child = ensureHelper(h);
  const id = h.hub.nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      h.hub.waiting.delete(id);
      resolve(null);
    }, timeoutMs);
    h.hub.waiting.set(id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    child.stdin!.write(`${JSON.stringify({ id, ...command })}\n`);
  });
}

/* ------------------------------------------------------------------- CDP -- */

class Cdp {
  private readonly socket: WebSocket;
  private readonly waiting = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
  private next = 1;
  readonly ready: Promise<void>;
  closed = false;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve());
      this.socket.addEventListener("error", () => {
        // Marked dead so the next caller gets a fresh socket instead of this one.
        this.closed = true;
        reject(new Error("DevTools socket failed"));
      });
    });
    // Awaited by every send(); this only stops a socket that fails before its
    // first send from becoming an unhandled rejection, which ends a Node server.
    this.ready.catch(() => {});
    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (typeof message.id !== "number") return;
        this.waiting.get(message.id)?.(message);
        this.waiting.delete(message.id);
      } catch {
        // An event we did not subscribe to, or noise.
      }
    });
    this.socket.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.waiting.values()) waiter({ error: { message: "closed" } });
      this.waiting.clear();
    });
  }

  async send<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
    await this.ready;
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.waiting.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result as T);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // Already gone.
    }
  }
}

async function getJson<T>(h: Host, pathname: string, timeoutMs = 800): Promise<T | null> {
  try {
    const res = await fetch(`${h.base}${pathname}`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function socketFor(h: Host, key: string, url: string): Cdp {
  const existing = h.hub.sockets.get(key);
  if (existing && !existing.closed) return existing;
  const fresh = new Cdp(url);
  h.hub.sockets.set(key, fresh);
  return fresh;
}

async function browserSocket(h: Host): Promise<Cdp | null> {
  const version = await getJson<{ webSocketDebuggerUrl: string }>(h, "/json/version");
  return version ? socketFor(h, "browser", version.webSocketDebuggerUrl) : null;
}

/** The main video of whatever document this runs in, through shadow roots and same-origin frames. */
const VIDEO = `(() => {
  const found = [];
  const walk = (root) => {
    root.querySelectorAll('video').forEach((v) => found.push(v));
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
    root.querySelectorAll('iframe').forEach((f) => { try { if (f.contentDocument) walk(f.contentDocument); } catch {} });
  };
  walk(document);
  const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
  found.sort((a, b) => area(b) - area(a));
  return found[0] || null;
})()`;

async function evaluate<T>(cdp: Cdp, expression: string): Promise<T | null> {
  try {
    const out = await cdp.send<{ result?: { value?: T } }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      2500,
    );
    return (out.result?.value ?? null) as T | null;
  } catch {
    return null;
  }
}

/**
 * The tab being shown. A kiosk window can still hold several — a link that
 * opens a new tab does exactly that, invisibly — and the one on screen is the
 * one whose document says it is visible.
 */
async function activePage(h: Host): Promise<{ target: CdpTarget; cdp: Cdp } | null> {
  const targets = pageTargets((await getJson<CdpTarget[]>(h, "/json/list")) ?? []);
  if (targets.length === 0) return null;
  const withSockets = targets.map((target) => ({ target, cdp: socketFor(h, target.id, target.webSocketDebuggerUrl!) }));
  if (withSockets.length === 1) return withSockets[0];
  const states = await Promise.all(
    withSockets.map((page) => evaluate<string>(page.cdp, "document.visibilityState")),
  );
  return withSockets[states.indexOf("visible")] ?? withSockets[0];
}

/** Frames first failing that, because some players live in a cross-origin iframe of their own. */
async function videoCall<T>(h: Host, body: string): Promise<T | null> {
  const page = await activePage(h);
  if (!page) return null;
  const expression = `(async () => { const v = ${VIDEO}; if (!v) return null; ${body} })()`;
  const onPage = await evaluate<T>(page.cdp, expression);
  if (onPage !== null) return onPage;
  const frames = ((await getJson<CdpTarget[]>(h, "/json/list")) ?? []).filter(
    (t) => t.type === "iframe" && t.webSocketDebuggerUrl,
  );
  for (const frame of frames) {
    const inFrame = await evaluate<T>(socketFor(h, frame.id, frame.webSocketDebuggerUrl!), expression);
    if (inFrame !== null) return inFrame;
  }
  return null;
}

/* --------------------------------------------------------------- browser -- */

function findChrome(): string | null {
  // The same three places scripts/_common.ps1's Get-DayboardChrome looks.
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function browserPid(h: Host): Promise<number | null> {
  const browser = await browserSocket(h);
  if (!browser) return null;
  try {
    const info = await browser.send<{ processInfo: { type: string; id: number }[] }>(
      "SystemInfo.getProcessInfo",
      {},
      2500,
    );
    return info.processInfo.find((p) => p.type === "browser")?.id ?? h.hub.pid;
  } catch {
    return h.hub.pid;
  }
}

async function waitFor<T>(probe: () => Promise<T | null | false>, timeoutMs: number, stepMs = 200): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return null;
}

/**
 * Bring the lane's window up on `url`.
 *
 * `fresh` is the difference between you clicking a tile and the board
 * reloading with a stream already on it. A click always goes to the page it
 * names. A restore leaves the window alone if it is anywhere on the same site,
 * because you may be three pages deep into it and a reload is not a request to
 * start over.
 */
async function open(h: Host, url: string, fresh: boolean): Promise<void> {
  const { hub, cfg } = h;
  const board = await helper(h, { cmd: "state" });
  if (!board) throw new Refusal("The stream helper did not answer.");
  if (!board.board) throw new Refusal(`The board window is not open, so there is nowhere to put ${cfg.noun}.`);

  let navigated = false;
  if (!(await getJson(h, "/json/version"))) {
    const chrome = findChrome();
    if (!chrome) throw new Refusal("Chrome is not installed where the board expects it.");
    const child = spawn(
      /*turbopackIgnore: true*/ chrome,
      chromeArgs({
        profile: cfg.profile(),
        port: cfg.port,
        url,
        monitor: board.monitor ?? null,
      }),
      // Detached: its own process, not in this server's job, so it survives a
      // deploy. A GUI program, so no stdio is not a trap here.
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    hub.pid = child.pid ?? null;
    // Before its first window exists — the helper must already be watching
    // this process when the window appears, or the board sees the kiosk window.
    if (hub.pid) await helper(h, { cmd: "expect", pid: hub.pid });
    if (!(await waitFor(() => getJson(h, "/json/version", 500), 15_000, 250))) {
      throw new Refusal(`The browser for ${cfg.noun} did not start.`);
    }
    navigated = true;
  } else {
    const pid = await browserPid(h);
    if (pid) {
      hub.pid = pid;
      await helper(h, { cmd: "expect", pid });
    }
  }

  // Running, but with no window of its own inside the board — every tab was
  // closed, or the board window was restarted underneath it. A new window is
  // what the helper adopts.
  const now = await helper(h, { cmd: "state" });
  if (!navigated && now && !now.adopted) {
    const browser = await browserSocket(h);
    await browser?.send("Target.createTarget", { url, newWindow: true });
    navigated = true;
  }

  if (!navigated) {
    const page = await activePage(h);
    if (!page) {
      const browser = await browserSocket(h);
      await browser?.send("Target.createTarget", { url, newWindow: true });
    } else if (fresh || !sameSite(page.target.url, url)) {
      await page.cdp.send("Page.navigate", { url });
    }
  }

  await waitFor(async () => (await helper(h, { cmd: "state" }))?.adopted, 8000, 250);
  await helper(h, { cmd: "show", on: true });
  if (hub.idle) clearTimeout(hub.idle);
  hub.idle = null;
}

async function close(h: Host): Promise<void> {
  const { hub } = h;
  await helper(h, { cmd: "show", on: false });
  // Blank rather than closed: the sound stops at once, and the next tile click
  // reuses a warm browser instead of waiting for a cold one.
  const page = await activePage(h);
  await page?.cdp.send("Page.navigate", { url: "about:blank" }).catch(() => {});
  if (hub.idle) clearTimeout(hub.idle);
  hub.idle = setTimeout(async () => {
    hub.idle = null;
    const state = await helper(h, { cmd: "state" }).catch(() => null);
    if (state?.visible) return;
    const browser = await browserSocket(h);
    await browser?.send("Browser.close").catch(() => {});
  }, h.cfg.idleCloseMs);
  hub.idle.unref?.();
}

async function back(h: Host): Promise<void> {
  const page = await activePage(h);
  if (!page) return;
  const history = await page.cdp.send<{ currentIndex: number; entries: { id: number }[] }>(
    "Page.getNavigationHistory",
  );
  const previous = history.entries[history.currentIndex - 1];
  if (previous) await page.cdp.send("Page.navigateToHistoryEntry", { entryId: previous.id });
}

/**
 * Put the page back to the size of its window.
 *
 * FOUND ON THE WALL, NOT IN TESTING. Chrome sizes a FULLSCREEN window's page to
 * the monitor, not the window — so once anything knocks the kiosk window's
 * layout loose (a site toggling fullscreen, a moment without WS_CHILD) the page
 * lays itself out 3440 pixels wide inside a 1500-pixel box, centred, and the
 * half you need is off to the right. Leaving fullscreen and entering it
 * again makes Chrome measure the window it is actually in. agent/stream puts
 * the child style back in between, which Chrome takes away on the way out.
 *
 * Throttled, so a page that is somehow always the wrong size costs a blink
 * every few seconds rather than a loop.
 */
async function refit(h: Host, target: CdpTarget): Promise<void> {
  if (Date.now() - h.hub.refitAt < 5000) return;
  h.hub.refitAt = Date.now();
  const browser = await browserSocket(h);
  if (!browser) return;
  const { windowId } = await browser.send<{ windowId: number }>("Browser.getWindowForTarget", {
    targetId: target.id,
  });
  await browser.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  await helper(h, { cmd: "apply" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await browser.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
  await helper(h, { cmd: "apply" });
}

/**
 * Make sure the helper knows which browser is the lane's.
 *
 * A NEW SERVER KNOWS NOTHING. `npm run deploy` restarts this process while the
 * lane's browser, being detached, carries on playing inside the board — and
 * without this the new server would not know which Chrome that is until
 * somebody pressed a tile again, so the window would stop following the player
 * between tabs. One DevTools question answers it, and only gets asked once.
 */
async function recover(h: Host): Promise<void> {
  ensureHelper(h);
  if (h.hub.pid || !(await getJson(h, "/json/version"))) return;
  const pid = await browserPid(h);
  if (!pid) return;
  h.hub.pid = pid;
  await helper(h, { cmd: "expect", pid });
}

/** The page's size against its window's, and a refit when they disagree. */
async function fitCheck(h: Host, active: { target: CdpTarget; cdp: Cdp }, frame: HelperReply | null): Promise<void> {
  if (!frame?.adopted || !frame.visible) return;
  const fit = await evaluate<{ iw: number; ih: number; ow: number; oh: number }>(
    active.cdp,
    `(() => ({ iw: innerWidth * devicePixelRatio, ih: innerHeight * devicePixelRatio, ow: outerWidth, oh: outerHeight }))()`,
  );
  if (!fit) return;
  const { iw, ih, ow, oh } = fit;
  if (ow > 0 && oh > 0 && (Math.abs(iw - ow) > 24 || Math.abs(ih - oh) > 24)) {
    await refit(h, active.target).catch(() => {});
  }
}

/* ---------------------------------------------------------------- public -- */

function notHere(): string | null {
  return process.platform === "win32" ? null : "only plays on the board's own machine.";
}

function serial<T>(h: Host, work: () => Promise<T>): Promise<T> {
  const next = h.hub.queue.then(work, work);
  h.hub.queue = next.catch(() => {});
  return next;
}

const STREAM_DOWN: Omit<StreamState, "ok" | "reason"> = {
  running: false,
  adopted: false,
  visible: false,
  url: null,
  title: null,
  video: null,
  muted: null,
};

export async function streamState(): Promise<StreamState> {
  if (notHere()) return { ok: false, reason: "Streams only play on the board's own machine.", ...STREAM_DOWN };
  const h = STREAM;
  try {
    await recover(h);
    const [frame, version] = await Promise.all([helper(h, { cmd: "state" }), getJson(h, "/json/version")]);
    let page: { url: string; title: string; video: StreamState["video"] } | null = null;
    if (version) {
      const active = await activePage(h);
      if (active) {
        const read = await evaluate<{ url: string; title: string }>(
          active.cdp,
          `(() => ({ url: location.href, title: document.title }))()`,
        );
        page = read ? { url: read.url, title: read.title, video: null } : null;
        await fitCheck(h, active, frame);
        const video = await videoCall<{ playing: boolean; muted: boolean }>(
          h,
          "return { playing: !v.paused && !v.ended && v.readyState > 2, muted: v.muted };",
        );
        if (page) page.video = video;
      }
    }
    return {
      ok: true,
      running: Boolean(version),
      adopted: Boolean(frame?.adopted),
      visible: Boolean(frame?.visible),
      url: page?.url ?? null,
      title: page?.title ?? null,
      video: page?.video ?? null,
      muted: frame ? frame.muted : null,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Refusal ? err.message : "The stream window is not answering.",
      ...STREAM_DOWN,
    };
  }
}

/** Run one command. Navigation is serialised; placing and showing are not. */
export async function runStream(command: StreamCommand): Promise<StreamState> {
  if (notHere()) return streamState();
  const h = STREAM;

  try {
    await recover(h);
    switch (command.action) {
      case "place":
        await helper(h, { cmd: "place", x: command.x, y: command.y, w: command.w, h: command.h, r: command.r });
        // A place is sent many times a second while the corner player is
        // dragged; answering each one with a full read of the page would be
        // the slow part of the drag.
        return { ok: true, ...STREAM_DOWN, running: true, adopted: true, visible: true };
      case "show":
        await helper(h, { cmd: "show", on: command.on });
        break;
      case "open":
        // The schema's default is Apple Music; the configured service wins.
        await serial(h, () => open(h, command.url === MUSIC_HOME ? musicHome() : command.url, command.fresh));
        break;
      case "close":
        await serial(h, () => close(h));
        break;
      case "home":
        await serial(h, async () => {
          const page = await activePage(h);
          await page?.cdp.send("Page.navigate", { url: command.url });
        });
        break;
      case "back":
        await serial(h, () => back(h));
        break;
      case "reload":
        await serial(h, async () => {
          const page = await activePage(h);
          await page?.cdp.send("Page.reload");
        });
        break;
      case "play":
        await videoCall(h, "await v.play().catch(() => {}); return true;");
        break;
      case "pause":
        await videoCall(h, "v.pause(); return true;");
        break;
      case "mute":
        // At the Windows audio session, never on the page: see agent/stream's
        // Audio.cs for the Apple TV player that turned "mute" into "volume 0".
        await helper(h, { cmd: "mute", on: command.on });
        break;
    }
  } catch (err) {
    const state = await streamState();
    return {
      ...state,
      ok: false,
      reason: err instanceof Refusal ? err.message : `The stream window did not do that: ${(err as Error).message}`,
    };
  }
  return streamState();
}

/* ----------------------------------------------------------------- music -- */

const MUSIC_DOWN: Omit<MusicState, "ok" | "reason"> = {
  running: false,
  adopted: false,
  visible: false,
  url: null,
  signedIn: null,
  track: null,
};

/**
 * What the Music tab's head bar and the Now Playing widget read.
 *
 * NEVER STARTS ANYTHING BUT THE HELPER. The music browser is launched by an
 * `open`, which the tab sends the first time it is looked at — a board that
 * never visits Music never runs a third Chrome.
 */
export async function musicState(): Promise<MusicState> {
  if (notHere()) return { ok: false, reason: "Music only plays on the board's own machine.", ...MUSIC_DOWN };
  const h = MUSIC;
  try {
    const version = await getJson(h, "/json/version");
    // Nothing running and nothing to recover: answer without waking a helper.
    if (!version && !h.hub.helper) return { ok: true, ...MUSIC_DOWN };
    await recover(h);
    const frame = await helper(h, { cmd: "state" });
    let read: { url: string; signedIn: boolean | null; track: (Omit<MusicTrack, "artUrl"> & { artwork: string | null }) | null } | null =
      null;
    if (version) {
      const active = await activePage(h);
      if (active) {
        read = await evaluate(active.cdp, READ_TRACK);
        await fitCheck(h, active, frame);
      }
    }
    const track: MusicTrack | null = read?.track
      ? {
          title: read.track.title,
          artist: read.track.artist,
          album: read.track.album,
          artUrl: artworkUrl(read.track.artwork, 300),
          playing: read.track.playing,
          position: read.track.position,
          duration: read.track.duration,
        }
      : null;
    return {
      ok: true,
      running: Boolean(version),
      adopted: Boolean(frame?.adopted),
      visible: Boolean(frame?.visible),
      url: read?.url ?? null,
      signedIn: read?.signedIn ?? null,
      track,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Refusal ? err.message : "The music window is not answering.",
      ...MUSIC_DOWN,
    };
  }
}

export async function runMusic(command: MusicCommand): Promise<MusicState> {
  if (notHere()) return musicState();
  const h = MUSIC;

  try {
    // An open is what launches the browser; everything else only makes sense
    // once there is one, and a hide for a window that never existed is a no-op
    // that should not wake a helper to say so.
    if (command.action !== "open" && !(await getJson(h, "/json/version"))) return musicState();
    await recover(h);
    switch (command.action) {
      case "place":
        // r is always 0: the Music tab only ever docks, it has no corner player.
        await helper(h, {
          cmd: "place",
          x: command.x,
          y: command.y,
          w: command.w,
          h: command.h,
          r: 0,
          holes: command.holes,
        });
        return { ok: true, ...MUSIC_DOWN, running: true, adopted: true, visible: true };
      case "show":
        await helper(h, { cmd: "show", on: command.on });
        return { ok: true, ...MUSIC_DOWN, running: true, adopted: true, visible: command.on };
      case "open":
        await serial(h, () => open(h, command.url, command.fresh));
        break;
      case "home":
        await serial(h, async () => {
          const page = await activePage(h);
          await page?.cdp.send("Page.navigate", { url: musicHome() });
        });
        break;
      case "back":
        await serial(h, () => back(h));
        break;
      case "reload":
        await serial(h, async () => {
          const page = await activePage(h);
          await page?.cdp.send("Page.reload");
        });
        break;
      case "play":
      case "pause":
      case "next":
      case "previous": {
        const page = await activePage(h);
        const pressed = page ? await evaluate<boolean>(page.cdp, transportScript(command.action)) : null;
        if (!pressed) {
          const state = await musicState();
          return { ...state, ok: false, reason: "Apple Music's player is not ready on that page." };
        }
        break;
      }
    }
  } catch (err) {
    const state = await musicState();
    return {
      ...state,
      ok: false,
      reason: err instanceof Refusal ? err.message : `The music window did not do that: ${(err as Error).message}`,
    };
  }
  return musicState();
}

/** The music service's front page, from settings — Apple Music unless changed. */
export function musicHome(): string {
  const home = loadSettings().music.home.trim();
  return isMusicUrl(home) ? home : MUSIC_HOME;
}
