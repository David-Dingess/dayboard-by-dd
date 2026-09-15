"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  gb,
  joinDrives,
  LEVEL_LABEL,
  levelFor,
  LIMITS,
  rate,
  rateParts,
  round,
  STALLED_FAN_ABOVE_C,
  uptimeLabel,
  vitalsUrl,
  worstOf,
  type Drive,
  type Level,
  type Limits,
  type Vitals,
} from "@/lib/vitals";
import { setTabStatus } from "@/components/tab-status";
import {
  CpuIcon,
  CritShape,
  DriveIcon,
  FanIcon,
  GpuIcon,
  MemoryIcon,
  NetworkIcon,
  OkShape,
  ProcessIcon,
  WarnShape,
} from "@/components/VitalsIcons";

/**
 * How the machine under the desk is doing.
 *
 * The second thing the local agent knows that a remote region cannot, and the
 * board's second client component for the same reason as the first: this is a
 * fact about this PC, and the browser — sitting on that PC — is the only
 * party who can see both ends.
 *
 * THE SHAPE IS A STATUS STRIP OVER DETAIL BANDS, which is the layout every host
 * dashboard converges on (Grafana's node-exporter, Task Manager's rail-plus-
 * detail): one row that answers "is it fine right now" from across the room,
 * and bands under it that answer "what exactly". The strip is the only place a
 * green appears — everything below stays in greys until it actually crosses a
 * limit, so a colour anywhere in the body means something is wrong, full stop.
 *
 * Every status carries THREE channels — shape, glyph and colour — because
 * colour alone fails for a red-green colourblind reader and in a greyscale
 * screenshot, and because the amber and the green measure ΔE 11.3 apart under
 * protanopia, which is passable but not something to lean the whole panel on.
 *
 * IT POLLS, AND IT STOPS. Unlike Now Playing, which is always on screen and
 * holds an EventSource open, this lives in a panel tab that is hidden most of
 * the time and Panel keeps hidden widgets MOUNTED. What decides "am I on screen"
 * is the widget measuring itself — `clientHeight > 0`, because Panel hides an
 * inactive tab with display:none — plus `document.visibilityState`.
 * IntersectionObserver is the textbook answer and does not fire at all in the
 * embedded dev browser: measured, on a fully visible 877x1353 element, no
 * callback ever arrives. A property read costs nothing and cannot not-happen.
 */

const POLL_MS = 2_000;
/**
 * While the tab is hidden. NOT zero, and that is the correction to the first
 * version: a widget that stops entirely can never learn that a disk filled up,
 * so the red dot on the tab — the whole point of which is to be seen from
 * another tab — could only ever appear once you were already looking at this
 * one. A minute apart costs a thirtieth of the visible rate, and it happens to
 * be exactly the ribbon's bucket size, so an hour of history stays honest while
 * you are not watching.
 */
const IDLE_POLL_MS = 60_000;
/** 90 samples at 2s — three minutes, the window "did that just spike" needs. */
const SPARK_POINTS = 90;
/** 60 buckets of one minute: "has this been fine all evening", which 3 minutes cannot say. */
const RIBBON_BUCKETS = 60;
const RIBBON_BUCKET_MS = 60_000;

type State = "looking" | "ok" | "down" | "old-agent";
type RailKey = "cpu" | "gpu" | "ram" | "net";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** A sparkline point. null is a gap, not a zero — see push(). */
type Point = number | null;

function push(ring: Point[], value: number | null | undefined) {
  // Deliberately NOT `?? 0`. An unelevated agent sends no CPU temperature, and
  // drawing that as a flat line on the floor is indistinguishable from a genuine
  // idle reading. A gap is the truth.
  ring.push(value === undefined ? null : value);
  if (ring.length > SPARK_POINTS) ring.shift();
}

/** One cell per minute, each holding the worst state seen inside it. */
interface Ribbon {
  cells: Level[];
  bucketAt: number;
}

function pushRibbon(ribbon: Ribbon, level: Level, now: number) {
  const bucket = Math.floor(now / RIBBON_BUCKET_MS);
  if (bucket !== ribbon.bucketAt) {
    ribbon.bucketAt = bucket;
    ribbon.cells.push(level);
    if (ribbon.cells.length > RIBBON_BUCKETS) ribbon.cells.shift();
    return;
  }
  // Same minute: the bucket keeps the worst thing that happened in it, so a
  // two-second spike cannot be smoothed away by the 58 calm seconds around it.
  const last = ribbon.cells.length - 1;
  if (last < 0) ribbon.cells.push(level);
  else ribbon.cells[last] = worstOf([ribbon.cells[last], level]);
}

const newRibbon = (): Ribbon => ({ cells: [], bucketAt: 0 });

export function VitalsWidget() {
  const root = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<State>("looking");
  const [vitals, setVitals] = useState<Vitals | null>(null);

  const sparks = useRef<Record<RailKey, Point[]>>({ cpu: [], gpu: [], ram: [], net: [] });
  const ribbons = useRef<Record<RailKey, Ribbon>>({
    cpu: newRibbon(),
    gpu: newRibbon(),
    ram: newRibbon(),
    net: newRibbon(),
  });
  // The ribbon is rendered, so its cells have to be state — the ring above is
  // the accumulator and this is the copy React is allowed to read.
  const [ribbonCells, setRibbonCells] = useState<Record<RailKey, Level[]>>({
    cpu: [],
    gpu: [],
    ram: [],
    net: [],
  });
  const canvases = useRef<Partial<Record<RailKey, HTMLCanvasElement | null>>>({});
  const inkRef = useRef<string>("#737373");
  const widths = useRef<Partial<Record<RailKey, number>>>({});

  const draw = useCallback((key: RailKey) => {
    const canvas = canvases.current[key];
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    // Same guard as the EQ's, and for the same reason: a hidden panel measures
    // 0x0, and drawing into that is wasted at best and a throw at worst.
    if (width < 1 || height < 1) return;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      // getComputedStyle is a layout read; once per resize, not 4x per tick.
      inkRef.current = getComputedStyle(canvas).color;
    }
    widths.current[key] = width;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const values = sparks.current[key];
    const real = values.filter((v): v is number => v !== null);
    if (real.length < 2) return;

    // AUTO-SCALED, unlike the first version's hard-wired 0-100. Memory sitting
    // flat at 57% rendered as a featureless filled slab — the y-range has to
    // follow the data, with a floor so a genuinely flat line does not get
    // magnified into noise.
    const lo = Math.min(...real);
    const hi = Math.max(...real);
    const span = Math.max(hi - lo, 12);
    const mid = (hi + lo) / 2;
    const top = mid + span / 2;
    const bottom = mid - span / 2;

    // Stretched across the samples we have, not across the window we would like
    // to have. Points are only collected while this tab is on screen, and it is
    // looked at in glances — so a fixed 90-slot x-axis would draw a stub in the
    // right-hand corner essentially forever. The trace therefore means "the
    // recent trend", and the ribbon underneath is what carries a fixed window,
    // because that one keeps accruing while nobody is looking.
    const step = width / Math.max(1, values.length - 1);
    const x = (i: number) => i * step;
    const y = (v: number) => {
      const t = (v - bottom) / (top - bottom);
      return height - Math.min(1, Math.max(0, t)) * (height - 3) - 1.5;
    };

    const ink = inkRef.current;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // One path per unbroken run, so a gap in the data is a gap on screen.
    let open = false;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null) {
        if (open) ctx.stroke();
        open = false;
        continue;
      }
      if (!open) {
        ctx.beginPath();
        ctx.moveTo(x(i), y(v));
        open = true;
      } else {
        ctx.lineTo(x(i), y(v));
      }
    }
    if (open) ctx.stroke();

    // A whisper of fill under the most recent run, for weight. Only under a
    // contiguous tail — filling across a gap would invent data.
    let tail = values.length - 1;
    while (tail >= 0 && values[tail] !== null) tail--;
    const from = tail + 1;
    if (from < values.length - 1) {
      ctx.beginPath();
      ctx.moveTo(x(from), y(values[from] as number));
      for (let i = from + 1; i < values.length; i++) ctx.lineTo(x(i), y(values[i] as number));
      ctx.lineTo(x(values.length - 1), height);
      ctx.lineTo(x(from), height);
      ctx.closePath();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }, []);

  const drawAll = useCallback(() => {
    draw("cpu");
    draw("gpu");
    draw("ram");
    draw("net");
  }, [draw]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    // Panel hides an inactive tab with display:none, so an off-screen widget has
    // no box and no height. One property read, and it cannot fail to happen.
    const onScreen = () =>
      document.visibilityState === "visible" && (root.current?.clientHeight ?? 0) > 0;

    // The loop always TICKS at the visible rate and decides each time whether to
    // ASK. Sleeping for a whole idle interval instead would mean up to a minute
    // of "looking for the agent…" after switching back to this tab, and a tick
    // is one property read.
    let lastIdleFetch = 0;

    (async function loop() {
      while (!cancelled) {
        const visible = onScreen();
        if (visible || Date.now() - lastIdleFetch >= IDLE_POLL_MS) {
          if (!visible) lastIdleFetch = Date.now();
          try {
            const res = await fetch(vitalsUrl(), { cache: "no-store", signal: controller.signal });
            if (res.status === 404) {
              // An agent that predates /vitals — dist/ is not in git, so the old
              // exe runs until it is rebuilt. Say so, and keep checking slowly
              // rather than dying, so a rebuild does not need a page reload.
              if (!cancelled) setState("old-agent");
              await sleep(30_000, controller.signal);
              continue;
            }
            if (!res.ok) throw new Error(String(res.status));
            const next = (await res.json()) as Vitals;
            if (cancelled) return;

            const now = Date.now();
            // The tab mark is the reason this runs at all while hidden.
            setTabStatus("pc", worstOf(Object.values(allLevels(next))));

            // Sparkline points are only collected while visible: the buffer is a
            // fixed 90 samples read as an evenly spaced three minutes, and
            // mixing 2-second and 60-second gaps into it would draw a time axis
            // that lies. The ribbon has no such problem — its buckets are
            // minutes, which is the idle rate exactly.
            if (visible) {
              push(sparks.current.cpu, next.cpu?.loadPct);
              push(sparks.current.gpu, next.gpu?.loadPct);
              push(sparks.current.ram, next.ram?.loadPct);
              push(sparks.current.net, netTotal(next));
            }

            pushRibbon(ribbons.current.cpu, cpuLevel(next), now);
            pushRibbon(ribbons.current.gpu, gpuLevel(next), now);
            pushRibbon(ribbons.current.ram, levelFor(next.ram?.loadPct, LIMITS.mem), now);
            pushRibbon(ribbons.current.net, "ok", now);
            if (visible) {
              setRibbonCells({
                cpu: [...ribbons.current.cpu.cells],
                gpu: [...ribbons.current.gpu.cells],
                ram: [...ribbons.current.ram.cells],
                net: [...ribbons.current.net.cells],
              });
            }

            if (visible) {
              setVitals(next);
              setState("ok");
            }
            // Drawn here rather than from an effect on `vitals`: the canvases
            // are stable refs and the data is a ring buffer, so there is nothing
            // to wait for a render for. Not a rAF loop either — that is right
            // for a 30Hz EQ and 120x oversampled for a 0.5Hz readout.
            if (visible) drawAll();
          } catch {
            // No claim about a machine we cannot reach.
            setTabStatus("pc", "ok");
            if (!cancelled && visible) setState("down");
          }
        }
        await sleep(POLL_MS, controller.signal);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [drawAll]);

  // A resize leaves every canvas stretched until the next tick. There is no
  // ResizeObserver here for the same reason there is no IntersectionObserver:
  // comparing the width we last drew at costs nothing and always works.
  useEffect(() => {
    const onResize = () => {
      const canvas = canvases.current.cpu;
      if (canvas && canvas.clientWidth !== widths.current.cpu) drawAll();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawAll]);

  const cpu = vitals?.cpu;
  const gpu = vitals?.gpu;
  const ram = vitals?.ram;
  const net = vitals?.net;
  const drives = vitals ? joinDrives(vitals.drives, vitals.disks) : [];

  const levels = vitals ? allLevels(vitals) : null;

  return (
    <div className="widget" ref={root}>
      <div className="widget-head">
        <h2 className="widget-title">Computer</h2>
        <span className="widget-meta">
          {state === "ok" && vitals
            ? `up ${uptimeLabel(vitals.uptimeSec)}`
            : state === "looking"
              ? "looking for the agent…"
              : ""}
        </span>
      </div>

      <div className="widget-scroll">
        {state === "down" && (
          <p className="empty">
            The Dayboard agent isn&apos;t running. Start <code>dayboard-nowplaying</code> on this
            machine.
          </p>
        )}

        {state === "old-agent" && (
          <p className="empty">
            This needs a newer agent build — run <code>dotnet publish -c Release -o dist</code> in{" "}
            <code>agent/nowplaying</code>, then restart it.
          </p>
        )}

        {state === "ok" && vitals && levels && (
          <>
            <ul className="vstrip">
              <Pill label="CPU" level={levels.cpu} />
              <Pill label="GPU" level={levels.gpu} />
              <Pill label="MEM" level={levels.mem} />
              <Pill label="DISK" level={levels.disk} />
              <Pill label="FANS" level={levels.fans} />
              {net && <Pill label="NET" level={levels.net} />}
            </ul>

            <Rail
              icon={<CpuIcon />}
              label="CPU"
              sub={cpu?.name ?? ""}
              value={cpu?.tempC === null || cpu?.tempC === undefined ? null : `${round(cpu.tempC)}°`}
              unit=""
              level={levels.cpu}
              meterPct={cpu?.loadPct ?? null}
              meterLimits={LIMITS.load}
              detail={[
                `${round(cpu?.loadPct)}% load`,
                cpu?.powerW === null || cpu?.powerW === undefined ? null : `${round(cpu.powerW)} W`,
                cpu?.clockMhz ? `${(cpu.clockMhz / 1000).toFixed(2)} GHz` : null,
              ]}
              ribbon={ribbonCells.cpu}
              canvasRef={(el) => {
                canvases.current.cpu = el;
              }}
            />

            <Rail
              icon={<GpuIcon />}
              label="GPU"
              sub={gpu?.name ?? ""}
              value={gpu?.tempC === null || gpu?.tempC === undefined ? null : `${round(gpu.tempC)}°`}
              unit=""
              level={levels.gpu}
              meterPct={gpu?.loadPct ?? null}
              meterLimits={LIMITS.load}
              detail={[
                `${round(gpu?.loadPct)}% load`,
                gpu?.powerW === null || gpu?.powerW === undefined ? null : `${round(gpu.powerW)} W`,
                gpu?.memUsedMb === null || gpu?.memUsedMb === undefined
                  ? null
                  : `${(gpu.memUsedMb / 1024).toFixed(1)}${
                      gpu.memTotalMb ? ` / ${(gpu.memTotalMb / 1024).toFixed(0)}` : ""
                    } GB VRAM`,
                // Zero is not missing: an idle card stops its fans entirely.
                gpu?.fanRpm === null || gpu?.fanRpm === undefined
                  ? null
                  : gpu.fanRpm === 0
                    ? "fans off"
                    : `${round(gpu.fanRpm)} rpm`,
              ]}
              ribbon={ribbonCells.gpu}
              canvasRef={(el) => {
                canvases.current.gpu = el;
              }}
            />

            <Rail
              icon={<MemoryIcon />}
              label="Memory"
              sub={ram?.totalGb ? `${round(ram.totalGb)} GB installed` : ""}
              value={ram?.usedGb === null || ram?.usedGb === undefined ? null : round(ram.usedGb, 1)}
              unit="GB"
              level={levels.mem}
              meterPct={ram?.loadPct ?? null}
              meterLimits={LIMITS.mem}
              detail={[
                `${round(ram?.loadPct)}% used`,
                ram?.totalGb ? `${gb(ram.totalGb - (ram.usedGb ?? 0), 1)} free` : null,
              ]}
              ribbon={ribbonCells.ram}
              canvasRef={(el) => {
                canvases.current.ram = el;
              }}
            />

            {net && (
              <Rail
                icon={<NetworkIcon />}
                label="Network"
                sub={net.name ?? ""}
                value={rateParts(net.rxBps)[0]}
                unit={rateParts(net.rxBps)[1]}
                level="ok"
                meterPct={null}
                meterLimits={LIMITS.load}
                detail={[`↓ ${rate(net.rxBps)}`, `↑ ${rate(net.txBps)}`]}
                ribbon={ribbonCells.net}
                canvasRef={(el) => {
                  canvases.current.net = el;
                }}
              />
            )}

            {drives.length > 0 && (
              <section className="vsection">
                <h3 className="vsection-head">
                  <span className="vsection-icon">
                    <DriveIcon />
                  </span>
                  Drives
                </h3>
                <ul className="vdrives">
                  {drives.map((drive) => (
                    <DriveRow key={drive.label} drive={drive} />
                  ))}
                </ul>
              </section>
            )}

            {vitals.fans.length > 0 && (
              <section className="vsection">
                <h3 className="vsection-head">
                  <span className="vsection-icon">
                    <FanIcon />
                  </span>
                  Fans
                </h3>
                <ul className="vfans">
                  {vitals.fans.map((fan) => (
                    <li key={fan.name} className="vfan">
                      <span className="vfan-rpm">{fan.rpm.toFixed(0)}</span>
                      <span className="vfan-name">{fan.name}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Last, and after everything sampled from hardware: this is the
                answer to the question the CPU rail provokes and cannot itself
                give. Absent for the first few seconds of an agent's life — a
                percentage is a rate, and the first pass has nothing to
                difference against. */}
            {vitals.processes && vitals.processes.length > 0 && (
              <section className="vsection">
                <h3 className="vsection-head">
                  <span className="vsection-icon">
                    <ProcessIcon />
                  </span>
                  Processes
                </h3>
                <ul className="vprocs">
                  {vitals.processes.map((proc) => (
                    <li key={proc.name} className="vproc">
                      <span className="vproc-name">
                        <b>{proc.name}</b>
                        {proc.count > 1 && <span className="vproc-count">×{proc.count}</span>}
                      </span>
                      <span className="vproc-cpu">{proc.cpu.toFixed(1)}%</span>
                      <Meter pct={proc.cpu} limits={LIMITS.load} />
                      <span className="vproc-mem">{gb(proc.memMb / 1024, 1)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!vitals.elevated && (
              <p className="vnote">
                Temperatures, case fans and drive sensors need the elevated task — see{" "}
                <code>docs/agents.md</code>.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- parts -- */

function Pill({ label, level }: { label: string; level: Level }) {
  const Shape = level === "crit" ? CritShape : level === "warn" ? WarnShape : OkShape;
  return (
    <li className={`vpill is-${level}`} title={`${label}: ${LEVEL_LABEL[level]}`}>
      <span className="vpill-shape">
        <Shape />
      </span>
      <span className="vpill-label">{label}</span>
    </li>
  );
}

function Rail({
  icon,
  label,
  sub,
  value,
  unit,
  level,
  meterPct,
  meterLimits,
  detail,
  ribbon,
  canvasRef,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  /** Null when this machine cannot see it — the rail still shows its meter. */
  value: string | null;
  unit: string;
  level: Level;
  meterPct: number | null;
  meterLimits: Limits;
  detail: (string | null)[];
  ribbon: Level[];
  canvasRef: (el: HTMLCanvasElement | null) => void;
}) {
  const shown = detail.filter(Boolean) as string[];
  return (
    <section className={`vrail is-${level}`}>
      <div className="vrail-head">
        {/* The icon says WHICH metric and never takes the status colour — one
            channel, one job. */}
        <span className="vrail-icon">{icon}</span>
        <h3 className="vrail-label">{label}</h3>
        <span className="vrail-sub">{sub}</span>
      </div>

      <div className="vrail-body">
        <p className="vrail-big">
          {value ?? "—"}
          {value && <span className="vrail-unit">{unit}</span>}
        </p>

        <div className="vrail-right">
          {meterPct !== null && <Meter pct={meterPct} limits={meterLimits} />}
          <p className="vrail-detail">{shown.join(" · ")}</p>
        </div>
      </div>

      <canvas className="vspark" ref={canvasRef} aria-hidden />
      {ribbon.length > 0 && <Ribbon cells={ribbon} />}
    </section>
  );
}

/**
 * A meter, segmented rather than solid.
 *
 * The unlit cells are the point: they show how much headroom is left, so you
 * read distance-to-limit without decoding a hue at all. Two hairline ticks mark
 * where amber and red begin, which is the same information again in a third
 * channel. (Grafana calls this "Retro LCD" and gives exactly this reason.)
 */
const clampPct = (n: number) => Math.min(100, Math.max(0, n));

function Meter({ pct, limits }: { pct: number; limits: Limits }) {
  const level = levelFor(pct, limits);
  return (
    <div className="vmeter">
      <span
        className={`vmeter-fill is-${level}`}
        style={{ width: `${clampPct(pct)}%` }}
      />
      {/* Clamped: a limit expressed above 100 (or below 0) would otherwise put
          the mark outside the track, and the track cannot clip it — segmenting
          the background means it has no overflow to hide behind. */}
      <span className="vmeter-tick is-warn" style={{ left: `${clampPct(limits.warn)}%` }} />
      <span className="vmeter-tick is-crit" style={{ left: `${clampPct(limits.crit)}%` }} />
    </div>
  );
}

/**
 * An hour of state, one cell per minute, each holding the worst thing that
 * happened inside it.
 *
 * The sparkline says what a metric is doing; this says whether it has been fine
 * all evening, which three minutes of sparkline structurally cannot. Borrowed
 * from Uptime Kuma's heartbeat bar, including its rule that a downsampled bucket
 * takes the worst status it contains — the opposite of an average, and the only
 * honest choice for a health signal.
 */
function Ribbon({ cells }: { cells: Level[] }) {
  // Always the full hour of cells, filling from the right as history accrues.
  // A ribbon that grew from one cell to sixty would change width for an hour
  // after every restart, and a single cell stretched across the panel would
  // read as a solid bar rather than as "one minute of data".
  const pad = Math.max(0, RIBBON_BUCKETS - cells.length);
  return (
    <div className="vribbon" title={`the last ${cells.length} minute(s)`} aria-hidden>
      {Array.from({ length: pad }, (_, i) => (
        <span key={`pad-${i}`} className="vribbon-cell is-empty" />
      ))}
      {cells.map((level, i) => (
        <span key={i} className={`vribbon-cell is-${level}`} />
      ))}
    </div>
  );
}

function DriveRow({ drive }: { drive: Drive }) {
  const level = driveLevel(drive);
  const temp = levelFor(drive.tempC, LIMITS.driveTemp);
  return (
    <li className={`vdrive is-${level}`}>
      <span className="vdrive-name">
        <b>{drive.label}</b>
        {drive.model && <span className="vdrive-model">{drive.model}</span>}
      </span>
      <span className={`vdrive-temp is-${temp}`}>
        {drive.tempC === null ? "" : `${drive.tempC.toFixed(0)}°`}
      </span>
      {drive.usedPct === null ? (
        <span />
      ) : (
        <Meter pct={drive.usedPct} limits={LIMITS.diskUsed} />
      )}
      <span className="vdrive-free">
        {drive.freeGb === null ? `${round(drive.usedPct)}% used` : `${gb(drive.freeGb)} free`}
      </span>
    </li>
  );
}

/* --------------------------------------------------------------- levels -- */

/**
 * Every family's state, from one payload. Shared by the render (which draws the
 * pills) and the poll loop (which marks the tab from behind a hidden panel), so
 * the dot and the strip can never disagree.
 */
function allLevels(v: Vitals): Record<string, Level> {
  return {
    cpu: cpuLevel(v),
    gpu: gpuLevel(v),
    mem: levelFor(v.ram?.loadPct, LIMITS.mem),
    disk: worstOf(joinDrives(v.drives, v.disks).map(driveLevel)),
    fans: fanLevel(v),
    net: "ok",
  };
}

function cpuLevel(v: Vitals): Level {
  return worstOf([levelFor(v.cpu?.tempC, LIMITS.cpuTemp), levelFor(v.cpu?.loadPct, LIMITS.load)]);
}

function gpuLevel(v: Vitals): Level {
  return worstOf([levelFor(v.gpu?.tempC, LIMITS.gpuTemp), levelFor(v.gpu?.loadPct, LIMITS.load)]);
}

function driveLevel(drive: Drive): Level {
  return worstOf([
    levelFor(drive.usedPct, LIMITS.diskUsed),
    levelFor(drive.tempC, LIMITS.driveTemp),
  ]);
}

/**
 * The only fan alarm worth having: one that has stopped while the part it cools
 * is hot. A GPU sitting at 0 rpm below 60 °C is zero-RPM mode working correctly,
 * and a case fan's absolute speed means nothing without knowing the chassis —
 * which is why no monitoring tool ships a default fan threshold at all.
 */
function fanLevel(v: Vitals): Level {
  const hot = (v.cpu?.tempC ?? 0) > STALLED_FAN_ABOVE_C;
  if (hot && v.fans.length > 0 && v.fans.every((f) => f.rpm === 0)) return "crit";
  if ((v.gpu?.tempC ?? 0) > STALLED_FAN_ABOVE_C && v.gpu?.fanRpm === 0) return "warn";
  return "ok";
}

function netTotal(v: Vitals): number | null {
  if (!v.net) return null;
  const rx = v.net.rxBps ?? 0;
  const tx = v.net.txBps ?? 0;
  return rx + tx;
}
