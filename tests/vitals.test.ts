import { describe, expect, it } from "vitest";
import {
  joinDrives,
  levelFor,
  LIMITS,
  rate,
  uptimeLabel,
  worstOf,
  type DiskReading,
  type DriveReading,
} from "../src/lib/vitals";

/**
 * The pure half of the PC panel. The fetch is not tested; everything that can
 * be wrong about a health state or a drive row can be tested without it.
 */

describe("levelFor", () => {
  it("is inclusive at each boundary — 85 is critical, not merely warm", () => {
    expect(levelFor(69.9, LIMITS.cpuTemp)).toBe("ok");
    expect(levelFor(70, LIMITS.cpuTemp)).toBe("warn");
    expect(levelFor(84.9, LIMITS.cpuTemp)).toBe("warn");
    expect(levelFor(85, LIMITS.cpuTemp)).toBe("crit");
  });

  it("treats an absent reading as OK, never as a problem", () => {
    // An unelevated agent sends null for CPU temperature. A missing sensor must
    // not paint the strip amber — that is indistinguishable from a real fault.
    expect(levelFor(null, LIMITS.cpuTemp)).toBe("ok");
    expect(levelFor(undefined, LIMITS.cpuTemp)).toBe("ok");
  });

  it("leaves this machine's idle readings green", () => {
    // The whole reason the limits deviate from the published defaults: a panel
    // that is amber at rest gets ignored.
    expect(levelFor(58, LIMITS.cpuTemp)).toBe("ok"); // observed CPU idle 53–58
    expect(levelFor(58, LIMITS.gpuTemp)).toBe("ok"); // observed GPU idle
    expect(levelFor(57, LIMITS.mem)).toBe("ok"); // observed memory
    expect(levelFor(41, LIMITS.driveTemp)).toBe("ok"); // the Samsung 980
  });

  it("calls the real problem on this machine critical", () => {
    expect(levelFor(95.4, LIMITS.diskUsed)).toBe("crit"); // C: is 95.4% full
  });
});

describe("worstOf", () => {
  it("takes the worst state present", () => {
    expect(worstOf(["ok", "ok"])).toBe("ok");
    expect(worstOf(["ok", "warn", "ok"])).toBe("warn");
    expect(worstOf(["warn", "crit", "ok"])).toBe("crit");
    expect(worstOf([])).toBe("ok");
  });
});

describe("joinDrives", () => {
  // The real payload from this machine, trimmed.
  const drives: DriveReading[] = [
    { name: "PHD 3.0 Silicon-Power", tempC: null, usedPct: 60.266033 },
    { name: "Samsung SSD 980 1TB", tempC: 41, usedPct: 95.35679 },
    { name: "WDC WDS100T2B0C-00PXH0", tempC: 34, usedPct: 69.86163 },
  ];
  const disks: DiskReading[] = [
    { name: "C:", freeGb: 43.19942092895508, totalGb: 930.5081214904785 },
    { name: "D:", freeGb: 740.2495880126953, totalGb: 1863.0146446228027 },
    { name: "F:", freeGb: 280.73765563964844, totalGb: 931.4960899353027 },
  ];

  it("matches every letter to the right model on the real payload", () => {
    const joined = joinDrives(drives, disks);
    expect(joined).toHaveLength(3);
    expect(joined.map((d) => [d.label, d.model])).toEqual([
      ["C:", "Samsung SSD 980 1TB"],
      ["D:", "PHD 3.0 Silicon-Power"],
      ["F:", "WDC WDS100T2B0C-00PXH0"],
    ]);
    expect(joined[0].tempC).toBe(41);
    expect(joined[0].freeGb).toBeCloseTo(43.199, 2);
  });

  it("never gives one sensor reading to two letters", () => {
    const joined = joinDrives(drives, disks);
    const models = joined.map((d) => d.model).filter(Boolean);
    expect(new Set(models).size).toBe(models.length);
  });

  it("refuses an ambiguous match rather than guessing", () => {
    // Two drives at the same fullness cannot be told apart by this rule.
    const twins: DriveReading[] = [
      { name: "Drive A", tempC: 30, usedPct: 50 },
      { name: "Drive B", tempC: 70, usedPct: 50.1 },
    ];
    const one: DiskReading[] = [{ name: "C:", freeGb: 50, totalGb: 100 }];
    const joined = joinDrives(twins, one);

    // C: renders with no model or temperature rather than a coin-flip, and both
    // sensor rows survive on their own.
    expect(joined[0]).toMatchObject({ label: "C:", model: null, tempC: null });
    expect(joined.map((d) => d.label)).toEqual(["C:", "Drive A", "Drive B"]);
  });

  it("keeps a sensor-only drive that Windows gave no letter", () => {
    const joined = joinDrives([{ name: "Unmounted", tempC: 38, usedPct: 12 }], disks);
    const extra = joined.find((d) => d.label === "Unmounted");
    expect(extra).toMatchObject({ tempC: 38, freeGb: null });
  });

  it("survives an empty sensor list — the unelevated case", () => {
    const joined = joinDrives([], disks);
    expect(joined).toHaveLength(3);
    expect(joined.every((d) => d.model === null && d.tempC === null)).toBe(true);
    expect(joined[0].usedPct).toBeCloseTo(95.36, 1);
  });

  it("does not divide by a zero-size disk", () => {
    const joined = joinDrives([], [{ name: "Z:", freeGb: 0, totalGb: 0 }]);
    expect(joined[0].usedPct).toBeNull();
  });
});

describe("formatting", () => {
  it("scales a throughput to something readable", () => {
    expect(rate(0)).toBe("0 B/s");
    expect(rate(900)).toBe("900 B/s");
    expect(rate(145239)).toBe("142 KB/s");
    expect(rate(5_500_000)).toBe("5.2 MB/s");
    expect(rate(null)).toBe("—");
  });

  it("reads an uptime at a glance", () => {
    expect(uptimeLabel(320330)).toBe("3d 16h");
    expect(uptimeLabel(7 * 3600 + 12 * 60)).toBe("7h 12m");
    expect(uptimeLabel(18 * 60)).toBe("18m");
  });
});
