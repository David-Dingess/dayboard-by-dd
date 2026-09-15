/**
 * The posable figure behind every drawn exercise animation on the Health tab.
 *
 * WHY DRAWN. The programme used to show a licensed exercise dataset's GIFs:
 * 180 pixels at most, nothing at all for a third of the moves, and "nearest"
 * matches for many of the rest — a floor stretch standing in for a chair one, a
 * plank lowering standing in for a plank. A picture of a different movement is
 * worse than none, and none left you reading cues for shapes you had never
 * seen. So every move is drawn here, from its own cue, in one consistent style.
 *
 * HOW. A figure is a handful of joints. A pose says where the pelvis is, which
 * way the torso, neck and head point, and where each hand and foot wants to be;
 * two-bone inverse kinematics puts the elbows and knees wherever the bones
 * allow. An animation is a list of timed key poses, eased between and looped.
 * The output is plain shapes — lines and circles in named tones — so the React
 * component only turns them into SVG, and all of this renders and tests without
 * a DOM.
 *
 * COORDINATES. Every animation draws into a 400x400 box, y down. Angles are in
 * degrees: 0 points right, 90 points down, -90 up. In side view the figure
 * faces right unless a pose turns it round; the "near" limbs are its right side.
 *
 * Pure, like the rest of lib/health: no React, no node, no next.
 */

export type Pt = [number, number];

/* ----------------------------------------------------------------- poses --- */

/** Reach for a point and let the elbow or knee fall where it must. */
export interface IkLimb {
  to: Pt;
  /** Which side of the reach line the middle joint bends toward. */
  bend: 1 | -1;
  /** Absolute angle of the hand or foot. */
  end: number;
  /** Override the two bone lengths, for a limb seen end-on (a crossed leg). */
  len?: [number, number];
}

/** Reach for a point on the body — a hand on a knee, a bell at the chest. */
export interface GrabLimb {
  grab: GrabRef;
  offset: Pt;
  bend: 1 | -1;
  end: number;
  len?: [number, number];
}

/** Two absolute bone angles, for when there is nothing to reach for. */
export interface AngleLimb {
  a: [number, number];
  end: number;
  len?: [number, number];
}

/**
 * Both joints placed by hand: a knee on the floor, an elbow on the mat. Bone
 * lengths are not enforced — this is for contact poses IK would only approximate.
 */
export interface ViaLimb {
  via: Pt;
  at: Pt;
  end: number;
}

export type Limb = IkLimb | GrabLimb | AngleLimb | ViaLimb;

export type LimbName = "armN" | "armF" | "legN" | "legF";

export type GrabRef =
  | `${LimbName}.${"joint" | "knee" | "wrist" | "ankle" | "tip" | "mid"}`
  | "head.back"
  | "chest"
  | "hip.front";

export interface BodyPose {
  pelvis: Pt;
  /** Absolute angle of the lower torso; -90 is upright. */
  torso: number;
  /** Nudges the shoulder joints off the top of the torso — a shrug, a roll. */
  shoulderShift: Pt;
  neck: number;
  /** The head's up axis; in side view the face points 90 degrees clockwise of it. */
  head: number;
  /** Front view: half the shoulder width. Narrowing it reads as the chest turning. */
  shoulderW: number;
  /** Front view: -1..1, how far the face has turned toward the viewer's right. */
  headTurn: number;
  /**
   * Bend at mid-torso: the upper half points `spine` degrees clockwise of the
   * lower. For a figure facing right, positive rounds forward. Optional so the
   * chair poses written before it existed read as a straight back.
   */
  spine?: number;
  /** Torso width multiplier — a breath in. */
  chest?: number;
  /** In side view N is the near (right) side; in front view it is the figure's right. */
  armN: Limb;
  armF: Limb;
  legN: Limb;
  legF: Limb;
}

export interface HandPose {
  /** Flexion at each finger joint, degrees. 0 is straight. */
  mcp: number;
  pip: number;
  dip: number;
  thumb: number;
}

export type Tone = "near" | "mid" | "far" | "hot" | "prop" | "propSoft" | "face" | "gap" | "gear";

export type Shape =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; w: number; tone: Tone }
  | { kind: "circle"; cx: number; cy: number; r: number; tone: Tone };

export type Prop =
  | { kind: "chair"; x: number; seat: number; back: number; view: "side" | "front"; facing?: 1 | -1 }
  | { kind: "desk"; x: number; top: number; floor: number }
  | { kind: "floor"; y: number }
  | { kind: "guide"; x: number; y1: number; y2: number }
  | { kind: "wall"; x: number; top: number; floor: number }
  | { kind: "door"; x: number; top: number; floor: number }
  | { kind: "mat"; x1: number; x2: number; y: number };

export type HotPart =
  | "armN.upper"
  | "armN.fore"
  | "armF.upper"
  | "armF.fore"
  | "legN.thigh"
  | "legN.shin"
  | "legF.thigh"
  | "legF.shin"
  | "neck"
  | "torso"
  | "torsoLow"
  | "shoulderN"
  | "shoulderF"
  | "hipN"
  | "fingers";

/** A kettlebell or dumbbell in a hand. */
export interface Held {
  kind: "kettlebell" | "dumbbell";
  hand: "armN" | "armF";
  /** A kettlebell hangs straight down from the hand instead of following the forearm. */
  hang?: boolean;
}

export interface Bones {
  torso: number;
  neck: number;
  headR: number;
  upper: number;
  fore: number;
  hand: number;
  thigh: number;
  shin: number;
  foot: number;
  hipW: number;
}

export interface Key<P> {
  at: number;
  pose: P;
  /** Shown from this key until the next key that has one. */
  label?: string;
}

interface AnimBase {
  viewBox: [number, number, number, number];
  props: Prop[];
  hot: HotPart[];
  /** Linear for a continuous circle; eased for everything that holds. */
  ease?: "smooth" | "linear";
  /** Seconds. The last key eases back to the first over the remainder. */
  loop: number;
  /**
   * The cue says "switch halfway". The player mirrors the figure for the second
   * half of the work period; an untimed preview mirrors every other loop.
   */
  switchHalfway?: boolean;
}

export interface BodyAnim extends AnimBase {
  kind: "body";
  view: "side" | "front";
  /** Draw these limbs dimmed, as behind the body. Side view dims armF and legF regardless. */
  behind?: LimbName[];
  /** In side view, draw these in front instead — for a pose turned toward the viewer. */
  inFront?: LimbName[];
  bones?: Partial<Bones>;
  held?: Held[];
  keys: Key<BodyPose>[];
}

export interface HandAnim extends AnimBase {
  kind: "hand";
  keys: Key<HandPose>[];
}

export type FigureAnim = BodyAnim | HandAnim;

/* -------------------------------------------------------------- geometry --- */

export const SIDE_BONES: Bones = {
  torso: 100,
  neck: 22,
  headR: 20,
  upper: 58,
  fore: 54,
  hand: 24,
  thigh: 82,
  shin: 80,
  foot: 26,
  hipW: 0,
};

/** Front view, seated: the thigh points at the viewer, so it is drawn short. */
export const FRONT_BONES: Bones = {
  torso: 100,
  neck: 20,
  headR: 20,
  upper: 56,
  fore: 52,
  hand: 24,
  thigh: 30,
  shin: 76,
  foot: 12,
  hipW: 17,
};

/** Front view, standing: full-length legs. */
export const FRONT_STANDING_BONES: Partial<Bones> = { thigh: 82, shin: 80, foot: 14 };

const rad = (deg: number) => (deg * Math.PI) / 180;
export const dir = (deg: number): Pt => [Math.cos(rad(deg)), Math.sin(rad(deg))];
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const along = (from: Pt, deg: number, len: number): Pt => add(from, scale(dir(deg), len));

/**
 * Two-bone IK. Returns the middle joint and where the end actually landed — the
 * target, or the nearest point the bones reach if it is too far or too close.
 */
export function solveTwoBone(root: Pt, target: Pt, l1: number, l2: number, bend: 1 | -1): { joint: Pt; end: Pt } {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const raw = Math.hypot(dx, dy);
  const u: Pt = raw > 1e-6 ? [dx / raw, dy / raw] : [0, 1];
  const d = Math.min(Math.max(raw, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const base = add(root, scale(u, a));
  const perp: Pt = [-u[1], u[0]];
  return { joint: add(base, scale(perp, bend * h)), end: add(root, scale(u, d)) };
}

/* ------------------------------------------------------------- animation --- */

function lerpDeep<T>(a: T, b: T, u: number): T {
  if (typeof a === "number" && typeof b === "number") return (a + (b - a) * u) as T;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => lerpDeep(v, b[i], u)) as T;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      const av = ra[key] ?? rb[key];
      const bv = rb[key] ?? ra[key];
      out[key] = lerpDeep(av, bv, u);
    }
    return out as T;
  }
  return u < 0.5 ? a : b;
}

function segment<P>(anim: { keys: Key<P>[]; loop: number }, t: number) {
  const time = ((t % anim.loop) + anim.loop) % anim.loop;
  const { keys } = anim;
  let i = keys.length - 1;
  for (let k = 0; k < keys.length; k++) {
    if (keys[k].at <= time) i = k;
    else break;
  }
  const from = keys[i];
  const last = i === keys.length - 1;
  const to = last ? keys[0] : keys[i + 1];
  const end = last ? anim.loop : to.at;
  const span = end - from.at;
  return { time, i, from, to, u: span > 0 ? Math.min(1, Math.max(0, (time - from.at) / span)) : 1 };
}

export function poseAt<P>(anim: { keys: Key<P>[]; loop: number; ease?: "smooth" | "linear" }, t: number): P {
  const { from, to, u } = segment(anim, t);
  const eased = anim.ease === "linear" ? u : (1 - Math.cos(Math.PI * u)) / 2;
  return lerpDeep(from.pose, to.pose, eased);
}

export function labelAt(anim: FigureAnim, t: number): string {
  const { i } = segment(anim as { keys: Key<unknown>[]; loop: number }, t);
  for (let k = i; k >= 0; k--) {
    const label = anim.keys[k].label;
    if (label) return label;
  }
  return "";
}

/* --------------------------------------------------------------- drawing --- */

function drawProps(props: Prop[]): Shape[] {
  const out: Shape[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, w: number, tone: Tone = "prop") =>
    out.push({ kind: "line", x1, y1, x2, y2, w, tone });

  for (const prop of props) {
    if (prop.kind === "floor") {
      line(-100, prop.y, 500, prop.y, 3, "propSoft");
    } else if (prop.kind === "guide") {
      for (let y = prop.y1; y < prop.y2; y += 12) line(prop.x, y, prop.x, Math.min(y + 5, prop.y2), 2, "prop");
    } else if (prop.kind === "desk") {
      line(prop.x, prop.top, 520, prop.top, 12);
      line(prop.x + 92, prop.top, prop.x + 92, prop.floor, 8, "propSoft");
    } else if (prop.kind === "wall") {
      line(prop.x, prop.top, prop.x, prop.floor, 12, "propSoft");
    } else if (prop.kind === "door") {
      line(prop.x, prop.top, prop.x, prop.floor, 12, "prop");
      line(prop.x - 70, prop.top, prop.x + 6, prop.top, 12, "prop");
    } else if (prop.kind === "mat") {
      line(prop.x1, prop.y + 4, prop.x2, prop.y + 4, 8, "propSoft");
    } else if (prop.view === "side") {
      const { x, seat, back } = prop;
      const f = prop.facing ?? 1;
      line(x - 58 * f, seat - 4, x - 64 * f, back, 14);
      line(x - 50 * f, seat, x + 48 * f, seat, 12);
      line(x, seat, x, seat + 52, 8, "propSoft");
      line(x - 46, seat + 62, x + 46, seat + 62, 7, "propSoft");
      out.push({ kind: "circle", cx: x - 46, cy: seat + 70, r: 6, tone: "propSoft" });
      out.push({ kind: "circle", cx: x + 46, cy: seat + 70, r: 6, tone: "propSoft" });
    } else {
      const { x, seat, back } = prop;
      line(x, seat - 16, x, back, 92, "propSoft");
      line(x - 56, seat, x + 56, seat, 12);
      line(x, seat, x, seat + 52, 8, "propSoft");
      line(x - 50, seat + 62, x + 50, seat + 62, 7, "propSoft");
      out.push({ kind: "circle", cx: x - 50, cy: seat + 70, r: 6, tone: "propSoft" });
      out.push({ kind: "circle", cx: x + 50, cy: seat + 70, r: 6, tone: "propSoft" });
    }
  }
  return out;
}

interface Solved {
  root: Pt;
  joint: Pt;
  wrist: Pt;
  tip: Pt;
}

export function drawBody(anim: BodyAnim, pose: BodyPose): Shape[] {
  const front = anim.view === "front";
  const G: Bones = { ...(front ? FRONT_BONES : SIDE_BONES), ...anim.bones };
  const shapes: Shape[] = drawProps(anim.props);
  const spine = pose.spine ?? 0;
  const chest = pose.chest ?? 1;
  const upperAngle = pose.torso + spine;

  const mid = along(pose.pelvis, pose.torso, G.torso / 2);
  const top = spine === 0 ? along(pose.pelvis, pose.torso, G.torso) : along(mid, upperAngle, G.torso / 2);
  const perp = dir(upperAngle + 90);
  const hipPerp = dir(pose.torso + 90);
  const shoulderN = front
    ? add(add(top, scale(perp, -pose.shoulderW)), pose.shoulderShift)
    : add(top, pose.shoulderShift);
  const shoulderF = front
    ? add(add(top, scale(perp, pose.shoulderW)), pose.shoulderShift)
    : add(add(top, pose.shoulderShift), [-3, 3]);
  const hipW = front ? G.hipW : 0;
  const hipN = add(pose.pelvis, scale(hipPerp, -hipW));
  const hipF = add(pose.pelvis, scale(hipPerp, hipW));
  const neckEnd = along(top, pose.neck, G.neck);
  const head = along(neckEnd, pose.head, G.headR);
  const face = dir(pose.head + 90);

  const roots: Record<LimbName, Pt> = { armN: shoulderN, armF: shoulderF, legN: hipN, legF: hipF };
  const lengths: Record<LimbName, [number, number, number]> = {
    armN: [G.upper, G.fore, G.hand],
    armF: [G.upper, G.fore, G.hand],
    legN: [G.thigh, G.shin, G.foot],
    legF: [G.thigh, G.shin, G.foot],
  };

  const solved: Partial<Record<LimbName, Solved>> = {};

  const refPoint = (ref: GrabRef): Pt => {
    if (ref === "head.back") return add(head, scale(face, -G.headR * 0.9));
    if (ref === "chest") return add(along(pose.pelvis, pose.torso, G.torso * 0.72), scale(perp, 18));
    if (ref === "hip.front") return add(pose.pelvis, scale(hipPerp, 14));
    const [name, part] = ref.split(".") as [LimbName, string];
    const s = solve(name);
    if (part === "knee" || part === "joint") return s.joint;
    if (part === "tip") return s.tip;
    if (part === "wrist" || part === "ankle") return s.wrist;
    return add(s.wrist, scale([s.tip[0] - s.wrist[0], s.tip[1] - s.wrist[1]], 0.55));
  };

  function solve(name: LimbName): Solved {
    const done = solved[name];
    if (done) return done;
    const limb = pose[name];
    const root = roots[name];
    let joint: Pt;
    let wrist: Pt;
    if ("via" in limb) {
      joint = limb.via;
      wrist = limb.at;
    } else {
      const [l1, l2] = limb.len ?? [lengths[name][0], lengths[name][1]];
      if ("a" in limb) {
        joint = along(root, limb.a[0], l1);
        wrist = along(joint, limb.a[1], l2);
      } else {
        const target = "grab" in limb ? add(refPoint(limb.grab), limb.offset) : limb.to;
        const ik = solveTwoBone(root, target, l1, l2, limb.bend);
        joint = ik.joint;
        wrist = ik.end;
      }
    }
    const result = { root, joint, wrist, tip: along(wrist, limb.end, lengths[name][2]) };
    solved[name] = result;
    return result;
  }

  const hot = new Set(anim.hot);
  const inFront = new Set<string>(anim.inFront ?? []);
  const behind = new Set<string>(
    anim.view === "side"
      ? ["armF", "legF", ...(anim.behind ?? [])].filter((name) => !inFront.has(name))
      : (anim.behind ?? []),
  );

  const seg = (a: Pt, b: Pt, w: number, t: Tone) =>
    shapes.push({ kind: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1], w, tone: t });

  const gear = (name: LimbName, tone: Tone) => {
    for (const item of anim.held ?? []) {
      if (item.hand !== name) continue;
      const s = solve(name);
      const handDir: Pt = [s.tip[0] - s.wrist[0], s.tip[1] - s.wrist[1]];
      const len = Math.hypot(handDir[0], handDir[1]) || 1;
      const u: Pt = [handDir[0] / len, handDir[1] / len];
      const grip = add(s.wrist, scale(u, len * 0.6));
      if (item.kind === "kettlebell") {
        const down: Pt = item.hang ? [0, 1] : u;
        const bell = add(grip, scale(down, 22));
        seg(grip, add(grip, scale(down, 10)), 10, "gap");
        seg(grip, add(grip, scale(down, 10)), 5, "gear");
        shapes.push({ kind: "circle", cx: bell[0], cy: bell[1], r: 17, tone: "gap" });
        shapes.push({ kind: "circle", cx: bell[0], cy: bell[1], r: 14, tone: "gear" });
      } else if (front) {
        const across: Pt = [-u[1], u[0]];
        const a = add(grip, scale(across, -15));
        const b = add(grip, scale(across, 15));
        seg(a, b, 7, "gear");
        seg(add(a, scale(u, -7)), add(a, scale(u, 7)), 11, "gear");
        seg(add(b, scale(u, -7)), add(b, scale(u, 7)), 11, "gear");
      } else {
        shapes.push({ kind: "circle", cx: grip[0], cy: grip[1], r: 12, tone: "gap" });
        shapes.push({ kind: "circle", cx: grip[0], cy: grip[1], r: 9, tone: tone === "far" ? "far" : "gear" });
      }
    }
  };

  const limb = (name: LimbName, widths: [number, number, number]) => {
    const s = solve(name);
    const tone: Tone = behind.has(name) ? "far" : "near";
    // A limb in front of the body is the body's colour, so it gets a thin outline
    // in the background colour or it vanishes into the torso.
    if (tone === "near") {
      seg(s.root, s.joint, widths[0] + 6, "gap");
      seg(s.joint, s.wrist, widths[1] + 6, "gap");
      seg(s.wrist, s.tip, widths[2] + 6, "gap");
    }
    seg(s.root, s.joint, widths[0], tone);
    seg(s.joint, s.wrist, widths[1], tone);
    seg(s.wrist, s.tip, widths[2], tone);
    const isArm = name.startsWith("arm");
    if (hot.has(`${name}.${isArm ? "upper" : "thigh"}` as HotPart)) seg(s.root, s.joint, widths[0] - 5, "hot");
    if (hot.has(`${name}.${isArm ? "fore" : "shin"}` as HotPart)) seg(s.joint, s.wrist, widths[1] - 5, "hot");
    if (isArm) gear(name, tone);
  };

  const widthsOf = (name: LimbName): [number, number, number] =>
    name.startsWith("arm") ? [13, 12, 9] : [16, 14, 10];

  // Back to front: what is behind the body, the body, what is in front of it.
  for (const name of ["legF", "armF", "legN", "armN"] as const) {
    if (behind.has(name)) limb(name, widthsOf(name));
  }

  const torsoW = (front ? 44 : 28) * chest;
  if (spine === 0) {
    seg(pose.pelvis, top, torsoW, "near");
  } else {
    seg(pose.pelvis, mid, torsoW, "near");
    seg(mid, top, torsoW, "near");
  }
  if (hot.has("torso")) {
    const from = spine === 0 ? along(pose.pelvis, pose.torso, G.torso * 0.45) : mid;
    shapes.push({ kind: "line", x1: from[0], y1: from[1], x2: top[0], y2: top[1], w: (front ? 30 : 16) * chest, tone: "hot" });
  }
  if (hot.has("torsoLow")) {
    const to = spine === 0 ? along(pose.pelvis, pose.torso, G.torso * 0.5) : mid;
    shapes.push({ kind: "line", x1: pose.pelvis[0], y1: pose.pelvis[1], x2: to[0], y2: to[1], w: (front ? 30 : 16) * chest, tone: "hot" });
  }
  if (front) {
    seg(shoulderN, shoulderF, 18, "near");
  }
  seg(top, neckEnd, 13, "near");
  if (hot.has("neck")) seg(top, neckEnd, 8, "hot");
  shapes.push({ kind: "circle", cx: head[0], cy: head[1], r: G.headR + 3, tone: "gap" });
  shapes.push({ kind: "circle", cx: head[0], cy: head[1], r: G.headR, tone: "near" });

  if (front) {
    const across = dir(pose.head + 90);
    const up = dir(pose.head);
    const turn = pose.headTurn * 8;
    for (const side of [-1, 1]) {
      const eye = add(add(head, scale(across, side * 7 + turn)), scale(up, 2));
      shapes.push({ kind: "circle", cx: eye[0], cy: eye[1], r: 2.6, tone: "face" });
    }
  } else {
    const noseA = along(head, pose.head + 90, G.headR - 2);
    const noseB = along(noseA, pose.head + 115, 7);
    seg(noseA, noseB, 6, "near");
    const eye = add(along(head, pose.head + 90, G.headR * 0.45), scale(dir(pose.head), G.headR * 0.2));
    shapes.push({ kind: "circle", cx: eye[0], cy: eye[1], r: 2.6, tone: "face" });
  }

  for (const name of ["legF", "legN", "armF", "armN"] as const) {
    if (!behind.has(name)) limb(name, widthsOf(name));
  }

  if (hot.has("shoulderN")) shapes.push({ kind: "circle", cx: shoulderN[0], cy: shoulderN[1], r: 9, tone: "hot" });
  if (hot.has("shoulderF")) shapes.push({ kind: "circle", cx: shoulderF[0], cy: shoulderF[1], r: 9, tone: "hot" });
  if (hot.has("hipN")) shapes.push({ kind: "circle", cx: hipN[0], cy: hipN[1], r: 11, tone: "hot" });

  return shapes;
}

/** A hand in profile, palm facing right: the wrist at the bottom, four fingers stacked in depth. */
export function drawHand(anim: HandAnim, pose: HandPose): Shape[] {
  const shapes: Shape[] = drawProps(anim.props);
  const wrist: Pt = [196, 300];
  const palmAngle = -90;
  const knuckle = along(wrist, palmAngle, 104);
  const line = (a: Pt, b: Pt, w: number, tone: Tone) =>
    shapes.push({ kind: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1], w, tone });

  const fingers = [
    { depth: 3, scale: 0.8, tone: "far" as Tone },
    { depth: 2, scale: 0.95, tone: "far" as Tone },
    { depth: 1, scale: 1.05, tone: "mid" as Tone },
    { depth: 0, scale: 1, tone: "near" as Tone },
  ];
  const hot = anim.hot.includes("fingers");

  for (const finger of fingers) {
    const base = add(knuckle, [-9 * finger.depth, 4 * finger.depth]);
    const a1 = palmAngle + pose.mcp;
    const a2 = a1 + pose.pip;
    const a3 = a2 + pose.dip;
    const p1 = along(base, a1, 50 * finger.scale);
    const p2 = along(p1, a2, 32 * finger.scale);
    const p3 = along(p2, a3, 26 * finger.scale);
    if (finger.depth === 0) {
      // The palm and forearm sit between the far fingers and the near one.
      line([wrist[0], 420], wrist, 40, "near");
      line(wrist, knuckle, 44, "near");
      line(base, p1, 30, "gap");
      line(p1, p2, 27, "gap");
      line(p2, p3, 24, "gap");
    }
    line(base, p1, 24, finger.tone);
    line(p1, p2, 21, finger.tone);
    line(p2, p3, 18, finger.tone);
    if (hot && finger.depth === 0) {
      line(base, p1, 9, "hot");
      line(p1, p2, 8, "hot");
      line(p2, p3, 7, "hot");
    }
  }

  const thumbBase = add(along(wrist, palmAngle, 34), [16, 0]);
  const t1 = along(thumbBase, palmAngle + pose.thumb, 36);
  const t2 = along(t1, palmAngle + pose.thumb + 20, 28);
  line(thumbBase, t1, 26, "gap");
  line(t1, t2, 23, "gap");
  line(thumbBase, t1, 20, "near");
  line(t1, t2, 17, "near");

  return shapes;
}

export function drawFigure(anim: FigureAnim, t: number): Shape[] {
  return anim.kind === "hand" ? drawHand(anim, poseAt(anim, t)) : drawBody(anim, poseAt(anim, t));
}

/** Which way to draw a switch-halfway move right now: by the timer if there is one, by the loop if not. */
export function sideAt(anim: FigureAnim, t: number, workSec?: number, remainingSec?: number): "Right" | "Left" {
  if (!anim.switchHalfway) return "Right";
  if (workSec !== undefined && remainingSec !== undefined) return remainingSec < workSec / 2 ? "Left" : "Right";
  return Math.floor(t / anim.loop) % 2 === 1 ? "Left" : "Right";
}
