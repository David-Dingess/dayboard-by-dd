/**
 * Timer sounds, synthesised rather than bundled.
 *
 * A few sine blips need no audio assets and no licence, and they stay crisp at
 * any volume. Distinct voices so you can tell what happened without looking up:
 * a soft tick for the countdown, a bright tone when work starts, a low one when
 * it stops, a small chord at the end of a session, a two-note knock for a nudge,
 * and a pair for the eye break — one to look away, one to come back.
 *
 * Ported from the standalone app, plus the last three.
 */
let ctx: AudioContext | null = null;

/**
 * The board's master volume, 0–1, board-local.
 *
 * One knob over everything synthesised here — the countdown ticks and interval
 * tones, the session chord, the nudge and its full-screen takeover, the two eye
 * chimes, and the Discord doorbell. It does NOT touch the videos or the music:
 * those play through WatchPlayer and the system mixer, never through this file,
 * so a quiet board still lets a video be as loud as it wants. Applied as a
 * master gain inside `tone()` so every sound obeys it without each having to
 * remember to.
 *
 * It lives in localStorage rather than health.json because it is a fact about
 * this board's speakers, not about the program — the same reasoning that keeps
 * the fired markers out of the file — and the board's Chrome profile is
 * persistent, so it survives a reboot.
 */
const VOLUME_KEY = "dayboard.sound.volume";

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function readVolume(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    return raw === null ? 1 : clamp01(Number(raw));
  } catch {
    return 1;
  }
}

let masterVolume = readVolume();

// A module-store, the same shape tab-status and watching use: the slider reads
// it through useSyncExternalStore rather than seeding state in an effect, which
// is both the house rule and what keeps the server's render (full volume) from
// hydrating into a mismatch with a board that had turned it down.
const volumeListeners = new Set<() => void>();

export function subscribeVolume(callback: () => void): () => void {
  volumeListeners.add(callback);
  return () => {
    volumeListeners.delete(callback);
  };
}

export function getSoundVolume(): number {
  return masterVolume;
}

export function setSoundVolume(value: number): void {
  const next = clamp01(value);
  if (next === masterVolume) return;
  masterVolume = next;
  try {
    localStorage.setItem(VOLUME_KEY, String(masterVolume));
  } catch {
    // A private window keeps the level for this page life and no longer.
  }
  for (const listener of volumeListeners) listener();
}

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, durationMs: number, gain: number, delayMs = 0): void {
  // The master volume scales every sound here. A peak at or below the ramp's
  // floor is silence, and exponentialRamp to zero is illegal besides — so a
  // muted board (volume 0) stops here rather than throwing, which is also what
  // makes the slider's 0% actually quiet.
  const peak = gain * masterVolume;
  if (peak <= 0.0001) return;
  const audio = context();
  if (!audio) return;

  const start = audio.currentTime + delayMs / 1000;
  const osc = audio.createOscillator();
  const amp = audio.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);

  // A short attack and exponential release keeps it a blip, not a beep that rings.
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);

  osc.connect(amp).connect(audio.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.05);
}

export const sounds = {
  /** The 3-2-1 before a work period. */
  tick: () => tone(660, 90, 0.14),
  /** Work starts. */
  go: () => tone(880, 220, 0.22),
  /** Work ends, rest begins. */
  rest: () => tone(440, 200, 0.16),
  /**
   * Switch sides. A quick up-and-back — low, high, low — so it sounds like a
   * swap rather than a start or a stop, and cannot be mistaken for the go tone
   * it sometimes follows. `delayMs` lets it wait for that tone to finish.
   */
  switchSides: (delayMs = 0) => {
    tone(784, 120, 0.24, delayMs);
    tone(1046.5, 120, 0.24, delayMs + 140);
    tone(784, 180, 0.24, delayMs + 280);
  },
  /** Session complete. */
  finish: () => {
    tone(523.25, 260, 0.18, 0);
    tone(659.25, 260, 0.18, 130);
    tone(783.99, 420, 0.2, 260);
  },
  /**
   * The full-screen takeover. Three notes climbing and holding, at half volume
   * — loud enough to turn a head, and distinct from every other sound here
   * because it is the only one that comes with the whole board going dark.
   */
  takeover: () => {
    tone(392, 220, 0.5, 0);
    tone(523.25, 220, 0.5, 170);
    tone(659.25, 900, 0.5, 340);
  },
  /**
   * Somebody just joined a voice channel you are not in.
   *
   * A BELL, not a beep: two notes a fifth apart with the upper one ringing on,
   * which is the shape of a doorbell and reads as "someone is here" rather than
   * as a timer. At 0.4 of the scale it is audible across the room without being
   * the loudest thing this board does — a call is an invitation, and the green
   * pulse is doing most of the work.
   */
  voice: () => {
    tone(880, 260, 0.4, 0);
    tone(1318.51, 620, 0.4, 120);
  },
  /** A slot came due. Quieter than the session tones — it is an offer, not a rep. */
  nudge: () => {
    tone(587.33, 180, 0.13, 0);
    tone(784, 260, 0.13, 150);
  },
  /**
   * Five seconds until an eye break. Two soft notes falling, so it reads as
   * "wind up what you are doing" rather than as an alarm.
   *
   * Both eye sounds sit under the session tones but not by much: a sine blip
   * played over whatever you are already listening to has to clear it, and the
   * first pass at a tenth of full gain cleared nothing at all.
   */
  eyeWarn: () => {
    tone(494, 220, 0.3, 0);
    tone(392, 340, 0.3, 170);
  },
  /** Twenty seconds are up. The same two, rising, so the pair are never confused. */
  eyeEnd: () => {
    tone(392, 200, 0.3, 0);
    tone(587.33, 300, 0.3, 150);
  },
};

/**
 * Browsers only allow audio after a gesture, so nothing here makes a sound until
 * something calls this from inside one. The board is a page you leave open
 * for days and may not have touched since it loaded — see HealthApp, which arms
 * it on the first pointer, key or wheel event anywhere as well as on the Start
 * button.
 */
export function primeAudio(): void {
  context();
}

/**
 * Whether a sound would actually be heard right now.
 *
 * There is no way to make audio work in a page nobody has touched, so the next
 * best thing is to stop pretending it does: the Health settings say so out loud
 * rather than leaving you to wonder why a chime never came.
 */
export function audioArmed(): boolean {
  return ctx !== null && ctx.state === "running";
}
