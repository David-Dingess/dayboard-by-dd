import { agentBase } from "./nowplaying";

/**
 * The shapes `GET /vitals` answers with, the limits that turn them into a
 * health state, and the join that makes three drives out of six tiles.
 *
 * Mirrors the records in agent/nowplaying/Vitals.cs, which serialises camelCase.
 * EVERY NUMBER IS NULLABLE and that is the design, not defensiveness: without an
 * elevated agent the CPU's temperature, package power and clock are simply not
 * visible, while the GPU, memory and network are — so the widget renders per
 * field rather than deciding the whole panel is unavailable.
 */

export interface CpuVitals {
  name: string | null;
  loadPct: number | null;
  tempC: number | null;
  powerW: number | null;
  clockMhz: number | null;
}

export interface GpuVitals {
  name: string | null;
  loadPct: number | null;
  tempC: number | null;
  powerW: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  /** 0 is a real answer: an idle card stops its fans entirely. */
  fanRpm: number | null;
}

export interface RamVitals {
  usedGb: number | null;
  totalGb: number | null;
  loadPct: number | null;
}

export interface NetVitals {
  name: string | null;
  rxBps: number | null;
  txBps: number | null;
}

export interface FanReading {
  name: string;
  rpm: number;
}

/** A drive as the SENSORS see it: a model name, a temperature, a fullness. */
export interface DriveReading {
  name: string;
  tempC: number | null;
  usedPct: number | null;
}

/** The same drive as WINDOWS sees it: a letter and free bytes. */
export interface DiskReading {
  name: string;
  freeGb: number;
  totalGb: number;
}

/** One physical Voicemeeter bus. A null device means nothing is assigned to it. */
export interface AudioOutput {
  device: string | null;
  muted: boolean;
}

/**
 * The mixer, as the agent reads it out of Voicemeeter.
 *
 * `headphones` and `speakers` are ROLES, not bus numbers — the agent works out
 * which physical bus holds which by device name, so either can be null while
 * only one of them is assigned. `live` is the answer to the only question
 * the widget asks: which one is the room actually hearing.
 */
export interface AudioState {
  ok: boolean;
  /** False means Voicemeeter is installed but its window is closed. */
  running: boolean;
  headphones: AudioOutput | null;
  speakers: AudioOutput | null;
  live: "headphones" | "speakers" | "both" | "none";
}

export interface Vitals {
  ok: boolean;
  /** False means the agent is running as you rather than as Administrator. */
  elevated: boolean;
  cpu: CpuVitals | null;
  gpu: GpuVitals | null;
  ram: RamVitals | null;
  /** Absent on an agent built before the network rail — the rail just doesn't render. */
  net?: NetVitals | null;
  /**
   * Absent on an agent built before the process list, exactly like `net` — and
   * also absent for the first few seconds of any run, because a CPU percentage
   * is a rate and one sample cannot be one.
   */
  processes?: ProcessGroup[] | null;
  fans: FanReading[];
  drives: DriveReading[];
  disks: DiskReading[];
  uptimeSec: number;
  updatedAt: string;
}

/**
 * One executable, summed across every instance of it.
 *
 * Grouped by name rather than listed per pid because Chrome is thirty processes
 * and Ableton spawns plugin hosts — five chrome rows would be true and useless.
 * `memMb` therefore over-counts a group the way Task Manager's Memory column
 * does: shared pages are counted once per instance.
 */
export interface ProcessGroup {
  name: string;
  cpu: number;
  memMb: number;
  count: number;
}

export function vitalsUrl(): string {
  // The same agent, and deliberately the same base: one process, one port, one
  // CORS allowlist, one autostart task. See lib/nowplaying.ts.
  return `${agentBase()}/vitals`;
}

/**
 * Where the mixer reads and writes. One of the agent's two mutating endpoints —
 * the other is /nowplaying, in lib/nowplaying.ts.
 *
 * Read directly rather than off /vitals, which used to carry the mixer so the PC
 * tab could run one poll loop. The controls moved to the player bar, which is a
 * different component with a different lifetime, so it asks for itself.
 */
export function audioUrl(): string {
  return `${agentBase()}/audio`;
}

/**
 * Which output the room is hearing, from the two mute flags. The agent computes
 * this too — it is duplicated here so the widget can predict the result of a
 * click before the response lands, and tested here because that is where a
 * disagreement between the two would show.
 */
export function liveOutput(headphonesMuted: boolean, speakersMuted: boolean): AudioState["live"] {
  if (!headphonesMuted && speakersMuted) return "headphones";
  if (headphonesMuted && !speakersMuted) return "speakers";
  if (!headphonesMuted && !speakersMuted) return "both";
  return "none";
}

/* ------------------------------------------------------------- health ---- */

export type Level = "ok" | "warn" | "crit";

export interface Limits {
  warn: number;
  crit: number;
}

/**
 * Where each reading stops being fine — tuned to THIS machine, not copied.
 *
 * The published defaults are the obvious starting point and they are wrong here:
 * glances ships CPU-core "careful" at 45 °C and memory at 50%, and this 5800X
 * idles at 53–58 °C with memory at 57%. Adopting those would paint the panel
 * amber at rest, and a status colour that is always on is a status colour you
 * stop reading — which is the only way this feature can actually fail.
 *
 * So each number is set against observed idle, with the headroom that matters:
 *   cpuTemp    5800X Tjmax is 90; warn well before, crit just under
 *   gpuTemp    an RTX 3060 begins throttling around 83
 *   driveTemp  glances says 45/52/60 for spinning rust; NVMe runs hotter
 *   load       glances cpu total 65/75/85, relaxed one step
 *   mem        90+ is where Windows starts paging in earnest
 *   diskUsed   the one that is already critical here: C: is 95.4% full
 *
 * btop does something smarter and worth knowing about: it normalises every
 * temperature against the part's OWN reported critical limit
 * (`value * 100 / temp_max`), so one gradient serves any CPU or GPU with no
 * configuration. LibreHardwareMonitor does not put Tjmax on the wire for us, so
 * absolute limits pinned to this hardware are the honest version — but if that
 * field ever appears, this table should become a ratio.
 */
export const LIMITS = {
  cpuTemp: { warn: 70, crit: 85 },
  gpuTemp: { warn: 70, crit: 83 },
  driveTemp: { warn: 50, crit: 60 },
  load: { warn: 70, crit: 90 },
  mem: { warn: 80, crit: 92 },
  diskUsed: { warn: 75, crit: 90 },
} satisfies Record<string, Limits>;

/** A fan that has stopped is only news if the thing it cools is hot. */
export const STALLED_FAN_ABOVE_C = 60;

/** For a reading where MORE is worse: temperature, load, fullness. */
export function levelFor(value: number | null | undefined, limits: Limits): Level {
  if (value === null || value === undefined) return "ok";
  if (value >= limits.crit) return "crit";
  if (value >= limits.warn) return "warn";
  return "ok";
}

/** The worst state in a set. Absent readings never make anything worse. */
export function worstOf(levels: Level[]): Level {
  if (levels.includes("crit")) return "crit";
  if (levels.includes("warn")) return "warn";
  return "ok";
}

export const LEVEL_LABEL: Record<Level, string> = {
  ok: "OK",
  warn: "Watch",
  crit: "Critical",
};

/* -------------------------------------------------------------- drives --- */

export interface Drive {
  /** "C:" when the join worked, else the model name. */
  label: string;
  /** The model, when it is not already the label. */
  model: string | null;
  tempC: number | null;
  usedPct: number | null;
  freeGb: number | null;
  totalGb: number | null;
}

const JOIN_TOLERANCE = 0.5;

/**
 * One row per physical drive, from the two half-views of it the agent sends.
 *
 * `disks[]` knows the letter and the free bytes; `drives[]` knows the model and
 * the temperature. They are the same hardware described by the OS and by the
 * sensors, and rendering both — which is what the first version did — puts every
 * drive on screen twice, once as "C: 44 GB free" and once as "Samsung SSD 980
 * 1TB, 95% used", with nothing saying they are the same object.
 *
 * They join on fullness, and on this machine the join is exact: the worst match
 * is off by 0.0006 percentage points while the nearest wrong candidate is 9.6
 * away. That gap is the whole safety argument — a tolerance of half a point
 * cannot pick the wrong drive here, and if two drives were ever genuinely that
 * close in fullness the match is refused as ambiguous and both lists render
 * separately, which is merely the old behaviour.
 */
export function joinDrives(drives: DriveReading[], disks: DiskReading[]): Drive[] {
  const taken = new Set<DriveReading>();

  const joined: Drive[] = disks.map((disk) => {
    const usedPct = disk.totalGb > 0 ? (1 - disk.freeGb / disk.totalGb) * 100 : null;

    const candidates =
      usedPct === null
        ? []
        : drives.filter(
            (drive) =>
              !taken.has(drive) &&
              drive.usedPct !== null &&
              Math.abs(drive.usedPct - usedPct) < JOIN_TOLERANCE,
          );

    // Exactly one candidate or none. Two drives within half a point of each
    // other cannot be told apart by this rule, so we do not guess.
    const match = candidates.length === 1 ? candidates[0] : null;
    if (match) taken.add(match);

    return {
      label: disk.name,
      model: match?.name ?? null,
      tempC: match?.tempC ?? null,
      usedPct,
      freeGb: disk.freeGb,
      totalGb: disk.totalGb,
    };
  });

  // Anything the sensors saw that Windows did not give a letter to — an
  // unmounted disk, or a drive whose join was refused.
  for (const drive of drives) {
    if (taken.has(drive)) continue;
    joined.push({
      label: drive.name,
      model: null,
      tempC: drive.tempC,
      usedPct: drive.usedPct,
      freeGb: null,
      totalGb: null,
    });
  }

  return joined;
}

/* ----------------------------------------------------------- formatting -- */

export function round(value: number | null | undefined, places = 0): string {
  return value === null || value === undefined ? "—" : value.toFixed(places);
}

/**
 * Bytes per second, split into the number and its unit.
 *
 * Two parts rather than one string because the rail sets them at different
 * sizes — the unit is smaller and dimmed, on the same baseline. Splitting a
 * formatted string on a space to get there works right up until a unit contains
 * one.
 */
export function rateParts(bps: number | null | undefined): [string, string] {
  if (bps === null || bps === undefined) return ["—", ""];
  if (bps < 1024) return [String(Math.round(bps)), "B/s"];
  if (bps < 1024 * 1024) return [(bps / 1024).toFixed(0), "KB/s"];
  return [(bps / (1024 * 1024)).toFixed(1), "MB/s"];
}

export function rate(bps: number | null | undefined): string {
  const [value, unit] = rateParts(bps);
  return unit ? `${value} ${unit}` : value;
}

export function gb(value: number | null | undefined, places = 0): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(places)} GB`;
}

/** "4d 6h", "6h 12m", "18m". Uptime is read at a glance or not at all. */
export function uptimeLabel(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
