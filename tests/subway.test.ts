import { describe, expect, it } from "vitest";
import { selectAlerts, countdown, lineColor, lineInk, feedFor, type LineConfig } from "../src/lib/subway";

/**
 * A rider on the Upper East Side going downtown: the shape the private board
 * shipped with, kept here as the worked example because its "beyond" lists are
 * what make the segment rules testable. The generic board builds these from
 * settings with empty `beyond` lists — see linesFromSettings.
 */
const LEX = ["626","627","628","629","630","631","632","633","634","635","636","637","638","639","640"];
const LEX_BEYOND = ["234","235","236","237","238","239","248","249","250","251","252","253","254","255","256","257","418","419","420","423"];
const LINES: LineConfig[] = [
  { route: "Q", feed: "nqrw", arrivalStop: "Q04S", arrivalPlace: "86 St", segmentLabel: "86 St → 14 St-Union Sq",
    segment: ["Q04","Q03","B08","R14","R15","R16","R17","R18","R19","R20"],
    beyond: ["D24","D25","D26","D27","D28","D29","D30","D31","D32","D33","D34","D35","D37","D38","D39","D40","D41","D42","D43","Q01","R21","R22","R30"] },
  { route: "4", feed: "irt", arrivalStop: "626S", arrivalPlace: "86 St", segmentLabel: "86 St → Brooklyn Bridge", segment: LEX, beyond: LEX_BEYOND },
  { route: "5", feed: "irt", arrivalStop: "626S", arrivalPlace: "86 St", segmentLabel: "86 St → Brooklyn Bridge", segment: LEX, beyond: LEX_BEYOND },
  { route: "6", feed: "irt", arrivalStop: "626S", arrivalPlace: "86 St", segmentLabel: "86 St → Brooklyn Bridge", segment: LEX, beyond: LEX_BEYOND },
  { route: "L", feed: "l", segmentLabel: "Union Sq → Jefferson St",
    segment: ["L03","L05","L06","L08","L10","L11","L12","L13","L14","L15"],
    beyond: ["L16","L17","L19","L20","L21","L22","L24","L25","L26","L27","L28","L29"] },
  { route: "F", feed: "bdfm", segmentLabel: "Lex Av/63 St → Delancey St",
    segment: ["B08","B10","D15","D16","D17","D18","D19","D20","D21","F14","F15"],
    beyond: ["A41","D42","D43","F16","F18","F20","F21","F22","F23","F24","F25","F26","F27","F29","F30","F31","F32","F33","F34","F35","F36","F38","F39"] },
];

const now = 1_800_000_000;

function alert(opts: {
  id: string;
  route: string;
  stops?: string[];
  text: string;
  type?: string;
  start?: number;
  end?: number;
}) {
  return {
    id: opts.id,
    alert: {
      active_period: [{ start: opts.start ?? now - 600, end: opts.end }],
      informed_entity: (opts.stops ?? [null]).map((s) => ({
        route_id: opts.route,
        ...(s ? { stop_id: s } : {}),
      })),
      header_text: { translation: [{ language: "en", text: opts.text }] },
      "transit_realtime.mercury_alert": { alert_type: opts.type ?? "Delays" },
    },
  };
}

const six = LINES.find((l) => l.route === "6")!;
const q = LINES.find((l) => l.route === "Q")!;

describe("segment filtering", () => {
  it("keeps an alert inside the stretch the rider takes", () => {
    // 631 = Grand Central-42 St, squarely between 86 St and Brooklyn Bridge.
    const out = selectAlerts([alert({ id: "a", route: "4", stops: ["631N"], text: "Signal problem" })], LINES, now);
    expect(out.get("4")).toHaveLength(1);
    // ...and only the 4: the 5 and 6 share the segment but not this alert.
    expect(out.get("6")).toHaveLength(0);
  });

  it("keeps an alert upstream of you, because it reaches you", () => {
    // 621 is uptown of 86 St. Those are the trains that come to your platform,
    // so a delay up there is your problem a few minutes from now.
    const out = selectAlerts([alert({ id: "b", route: "6", stops: ["621N", "620N"], text: "Bronx delays" })], LINES, now);
    expect(out.get("6")).toHaveLength(1);
  });

  it("drops an alert only when every station is past the end of the ride", () => {
    // 250 is deep in Brooklyn on the 4; you are off the train by Brooklyn Bridge.
    const out = selectAlerts([alert({ id: "b2", route: "4", stops: ["250N", "251N"], text: "Brooklyn delays" })], LINES, now);
    expect(out.get("4")).toHaveLength(0);
  });

  it("keeps an alert that straddles the end of your ride", () => {
    // One station you ride through, one past it: still your problem.
    const out = selectAlerts([alert({ id: "b3", route: "4", stops: ["640N", "418N"], text: "Straddles" })], LINES, now);
    expect(out.get("4")).toHaveLength(1);
  });

  it("keeps a line-wide alert that names no station", () => {
    // No stop at all means the disruption is not locatable; dropping it would
    // hide something that probably does affect you.
    const out = selectAlerts([alert({ id: "c", route: "Q", text: "Q trains delayed" })], LINES, now);
    expect(out.get("Q")).toHaveLength(1);
  });

  it("routes each alert only to the group whose line it names", () => {
    const out = selectAlerts([alert({ id: "d", route: "L", stops: ["L06"], text: "L delays" })], LINES, now);
    expect(out.get("L")).toHaveLength(1);
    expect(out.get("6")).toHaveLength(0);
    expect(out.get("Q")).toHaveLength(0);
    expect(out.get("F")).toHaveLength(0);
  });

  it("ignores alerts that are not currently active", () => {
    const future = selectAlerts([alert({ id: "e", route: "4", stops: ["631"], text: "Later", start: now + 9999 })], LINES, now);
    expect(future.get("4")).toHaveLength(0);
    const past = selectAlerts([alert({ id: "f", route: "4", stops: ["631"], text: "Over", start: now - 9999, end: now - 100 })], LINES, now);
    expect(past.get("4")).toHaveLength(0);
  });

  it("collapses the duplicate the feed files per affected station", () => {
    const dupes = [
      alert({ id: "g", route: "6", stops: ["631"], text: "Same disruption" }),
      alert({ id: "h", route: "6", stops: ["632"], text: "Same disruption" }),
    ];
    expect(selectAlerts(dupes, LINES, now).get("6")).toHaveLength(1);
  });

  it("sorts unplanned disruptions above planned work", () => {
    const mixed = [
      alert({ id: "i", route: "6", stops: ["631"], text: "Planned work", type: "Planned - Reroute" }),
      alert({ id: "j", route: "6", stops: ["632"], text: "Actual delay", type: "Delays" }),
    ];
    const out = selectAlerts(mixed, LINES, now).get("6")!;
    expect(out.map((a) => a.text)).toEqual(["Actual delay", "Planned work"]);
    expect(out[0].planned).toBe(false);
  });
});

describe("alert text", () => {
  it("keeps the route character so the sentence still parses", () => {
    // Deleting [5] would leave "No between Bowling Green and E 180 St".
    const out = selectAlerts(
      [alert({ id: "k", route: "5", stops: ["635"], text: "No [5] between Bowling Green and E 180 St" })],
      LINES,
      now,
    );
    expect(out.get("5")![0].text).toBe("No 5 between Bowling Green and E 180 St");
  });

  it("tidies the spacing that leaves behind", () => {
    const out = selectAlerts(
      [alert({ id: "l", route: "6", stops: ["631"], text: "Uptown [4][6] trains  are delayed ." })],
      LINES,
      now,
    );
    expect(out.get("6")![0].text).toBe("Uptown 4 6 trains are delayed.");
  });
});

describe("line bullets", () => {
  it("uses the official colours", () => {
    expect(lineColor("6")).toBe("#00933c");
    expect(lineColor("Q")).toBe("#fccc0a");
    expect(lineColor("L")).toBe("#a7a9ac");
    expect(lineColor("F")).toBe("#ff6319");
  });

  it("puts dark ink on the yellow lines only", () => {
    expect(lineInk("Q")).toBe("#1a1a1a");
    expect(lineInk("6")).toBe("#ffffff");
  });
});

describe("the configured segments", () => {
  it("covers every line the rider named", () => {
    expect(LINES.map((l) => l.route).sort()).toEqual(["4", "5", "6", "F", "L", "Q"]);
  });

  it("only shows arrivals where you board", () => {
    expect(LINES.filter((l) => l.arrivalStop).map((l) => l.route)).toEqual(["Q", "4", "5", "6"]);
    expect(six.arrivalStop).toBe("626S");
    expect(q.arrivalStop).toBe("Q04S");
  });

  it("never lists a station as both ridden and beyond", () => {
    for (const line of LINES) {
      const seg = new Set(line.segment);
      expect(line.beyond.filter((s) => seg.has(s))).toEqual([]);
    }
  });

  it("runs each segment between the two stations named", () => {
    expect(six.segment[0]).toBe("626");
    expect(six.segment.at(-1)).toBe("640");
    expect(q.segment).toContain("R20");
    expect(LINES.find((l) => l.route === "L")!.segment).toEqual(
      expect.arrayContaining(["L03", "L15"]),
    );
    expect(LINES.find((l) => l.route === "F")!.segment).toEqual(
      expect.arrayContaining(["B08", "F15"]),
    );
  });
});

describe("countdown", () => {
  const t0 = 1_800_000_000_000;
  const at = (minutes: number, seconds = 0) => ({
    route: "6",
    at: t0 + minutes * 60_000 + seconds * 1000,
    minutes,
  });

  it("counts down as the clock moves, without a new fetch", () => {
    const arrivals = [at(4), at(9)];
    expect(countdown(arrivals, t0)).toEqual([4, 9]);
    expect(countdown(arrivals, t0 + 60_000)).toEqual([3, 8]);
    expect(countdown(arrivals, t0 + 120_000)).toEqual([2, 7]);
  });

  it("rounds to the nearest minute, so it turns over on the half", () => {
    const arrivals = [at(4)];
    expect(countdown(arrivals, t0 + 29_000)).toEqual([4]);
    expect(countdown(arrivals, t0 + 31_000)).toEqual([3]);
  });

  it("reads a train inside the last half-minute as pulling in", () => {
    expect(countdown([at(0, 20)], t0)).toEqual([0]);
  });

  it("drops a train once it is well past due, rather than pinning it at now", () => {
    // What a stalled feed looks like: the tile empties out and says so.
    const arrivals = [at(0), at(3)];
    expect(countdown(arrivals, t0 + 20_000)).toEqual([0, 3]);
    expect(countdown(arrivals, t0 + 45_000)).toEqual([2]);
    expect(countdown(arrivals, t0 + 400_000)).toEqual([]);
  });
});

describe("feedFor", () => {
  it("routes every line to the MTA feed that carries it", () => {
    expect(feedFor("6")).toBe("irt");
    expect(feedFor("Q")).toBe("nqrw");
    expect(feedFor("F")).toBe("bdfm");
    expect(feedFor("L")).toBe("l");
    expect(feedFor("A")).toBe("ace");
    expect(feedFor("G")).toBe("g");
    expect(feedFor("J")).toBe("jz");
    expect(feedFor("SI")).toBe("si");
  });
});
