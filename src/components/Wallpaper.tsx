"use client";

import { useEffect, useRef } from "react";
import type { WallpaperGreys } from "@/lib/screen";

/**
 * The animated ground the board sits on.
 *
 * WHAT THIS IS. A recreation of "Minimalist Black" by ElliotIsLame, a Wallpaper
 * Engine preset — slow terraces of grey that morph in place. The original
 * board's author wanted the page transparent so the desktop showed through,
 * and it cannot be: Chrome on Windows always paints an opaque backdrop behind
 * the page. So the wallpaper is drawn here instead, and the panels above it go
 * translucent.
 *
 * IT CAN BE TURNED OFF, AND RECOLOURED. Settings -> Screen & look. Off, the
 * canvas is not rendered and --bg-ground on <html> shows through; recoloured,
 * the five tones come in as uniforms (lib/screen.ts derives them from the one
 * chosen ground), so the shader itself never changes.
 *
 * HOW IT WAS DERIVED, so the numbers below are not mystery constants. The
 * Workshop item is a preset of "Cascade", a scene shader, and its project.json
 * carries the settings: three octaves, four greys on a near-black ground. Two
 * measurements off the reference pinned the rest:
 *
 *   1. Phase-correlating 69 frames of the author's own preview gives a
 *      translation of EXACTLY ZERO at every frame pair. It morphs in place and
 *      never drifts. An earlier attempt slid the field diagonally and was wrong
 *      in a way that is obvious once seen.
 *   2. The tone histogram of the preset's preview.jpg is five flat plateaus:
 *      #101010 37.7%, #0d0d0d 33.7%, #181818 11.0%, #010101 5.9%, #1d1d1d 5.4%.
 *      Black is a SEAM, not the ground — the first attempt had that inverted and
 *      read as black with grey rings.
 *
 * LEVELS ARE PERCENTILES, BAKED. The three thresholds are the field's own
 * 38.4th/81.3rd/93.8th percentiles, which is what reproduces those shares. They
 * were measured by rendering the raw field and sorting the samples; doing that
 * at startup would cost a sort of a million floats on every board launch, so the
 * answer is baked. They depend on GAIN and the octave count and nothing else —
 * not on zoom, which changes only spatial frequency — so they stay correct as
 * long as those two are unchanged. Change either and re-measure.
 */

// Locked against the real wallpaper by eye, side by side on the board.
const ZOOM = 0.7;
const SPEED = 0.001;

// Seam width, in field units. Tuned until black covered 6.3% of the frame
// against the reference's 5.9%.
const RING = 0.006;

// How far the seam is displaced, so a terrace reads as sitting ABOVE the one
// below rather than merely being outlined. Screen units, so it holds its pixel
// width at any zoom.
const SHADOW = 0.012;

// Octave falloff. Below 0.5 keeps the outlines smooth and the shapes large,
// which is what separates this from generic noise mush.
const GAIN = 0.42;

const LEVELS: [number, number, number] = [-0.0275, 0.1451, 0.2235];

/**
 * Half resolution. The shapes are soft enough that the upscale is invisible, and
 * it quarters the fragment cost of something that runs 24 hours a day.
 */
const SCALE = 0.5;

/**
 * At SPEED 0.001 a full evolution takes hours, so a frame every 80ms is already
 * far more than the motion needs. The headroom is deliberate: if the speed is
 * ever raised this still looks continuous, where a 1fps budget would not.
 */
const FRAME_MS = 80;

const VERT = `
attribute vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec3  G1;
uniform vec3  G2;
uniform vec3  G3;
uniform vec3  G4;
uniform vec3  SEAM;

// ---- simplex noise (Ashima / Gustavson, public domain) -------------------
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// Three octaves, each flowing a quarter turn off the last. That reads as
// organic movement, and the directions cancel, so the frame never drifts —
// which is the one thing the reference measurably does not do.
float fbm(vec2 xy, float t){
  vec3 p = vec3(xy, t);
  float v = 0.0, amp = 1.0, nrm = 0.0;
  vec2 flow = vec2(0.11, 0.07);
  for (int i = 0; i < 3; i++){
    v += amp * snoise(p + vec3(flow * t, 0.0));
    nrm += amp;
    p *= 2.0;
    amp *= ${GAIN.toFixed(3)};
    flow = vec2(-flow.y, flow.x) * 1.6;
  }
  return v / nrm;
}

// Four tones that TILE THE PLANE (G1 lowest, G4 highest), and the seam that
// appears only between them — all five are uniforms, set from the ground
// colour in settings. The measured originals were #0d0d0d, #101010, #181818,
// #1d1d1d and a #010101 seam.

const vec3 LEVELS = vec3(${LEVELS[0]}, ${LEVELS[1]}, ${LEVELS[2]});
const float ZOOM = ${ZOOM};
const float RING = ${RING};
const float SHADOW = ${SHADOW};

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 p = uv * ZOOM;

  float f = fbm(p, uTime);
  float aa = max(ZOOM * 1.2 / uRes.y, 0.0008);

  vec2 so = vec2(SHADOW, -SHADOW) * ZOOM;
  float fs = fbm(p + so, uTime);

  vec3 col = G1;
  float lv, edge;

  // Terrace: fill everything above the level, then lay the seam on its edge.
  // The seam's width is constant in FIELD units, so it runs wide where the
  // field is flat and tapers where it is steep — which is what gives the real
  // one its varying ribbons.
  lv = LEVELS.x;
  col = mix(col, G2, smoothstep(lv - aa, lv + aa, f));
  edge = smoothstep(lv - RING - aa, lv - RING + aa, fs)
       * (1.0 - smoothstep(lv + RING - aa, lv + RING + aa, fs));
  col = mix(col, SEAM, edge);

  lv = LEVELS.y;
  col = mix(col, G3, smoothstep(lv - aa, lv + aa, f));
  edge = smoothstep(lv - RING - aa, lv - RING + aa, fs)
       * (1.0 - smoothstep(lv + RING - aa, lv + RING + aa, fs));
  col = mix(col, SEAM, edge);

  lv = LEVELS.z;
  col = mix(col, G4, smoothstep(lv - aa, lv + aa, f));
  edge = smoothstep(lv - RING - aa, lv - RING + aa, fs)
       * (1.0 - smoothstep(lv + RING - aa, lv + RING + aa, fs));
  col = mix(col, SEAM, edge);

  gl_FragColor = vec4(col, 1.0);
}
`;

function build(gl: WebGLRenderingContext) {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = vs && fs ? gl.createProgram() : null;
  if (!vs || !fs || !prog) return null;

  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

  return {
    prog,
    uRes: gl.getUniformLocation(prog, "uRes"),
    uTime: gl.getUniformLocation(prog, "uTime"),
    tones: ["G1", "G2", "G3", "G4", "SEAM"].map((name) => gl.getUniformLocation(prog, name)),
  };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function Wallpaper({ enabled, greys }: { enabled: boolean; greys: WallpaperGreys }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tones = [greys.g1, greys.g2, greys.g3, greys.g4, greys.seam].join(",");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !enabled) return;

    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    // No WebGL, no wallpaper. --bg-deep on <html> is what shows instead, so the
    // board degrades to the flat ground it had before rather than to nothing.
    if (!gl) return;

    let u = build(gl);
    if (!u) return;
    const setTones = (built: NonNullable<typeof u>) => {
      tones.split(",").forEach((hex, i) => gl.uniform3fv(built.tones[i], rgb(hex)));
    };
    setTones(u);

    let raf = 0;
    let last = -Infinity;

    /**
     * A page that stays open for weeks WILL lose its context eventually — a
     * driver reset, a GPU power event. Without this the wallpaper goes black
     * until someone reloads the board, which on a second monitor means until someone
     * notices.
     */
    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      u = null;
    };
    const onRestored = () => {
      u = build(gl);
      if (u) setTones(u);
      last = -Infinity;
      raf = requestAnimationFrame(frame);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    function frame(ms: number) {
      raf = requestAnimationFrame(frame);
      if (!u || ms - last < FRAME_MS) return;
      last = ms;

      const c = canvas as HTMLCanvasElement;
      const w = Math.max(1, Math.round(c.clientWidth * SCALE));
      const h = Math.max(1, Math.round(c.clientHeight * SCALE));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        gl!.viewport(0, 0, w, h);
      }

      gl!.uniform2f(u.uRes, w, h);
      gl!.uniform1f(u.uTime, (ms / 1000) * SPEED);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      // A recolour rebuilds from scratch; losing the context on purpose frees
      // the old program rather than leaving one per colour change.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [enabled, tones]);

  if (!enabled) return null;
  return <canvas ref={ref} className="wallpaper" aria-hidden />;
}
