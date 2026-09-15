/**
 * The two settings that have to be known on BOTH sides of the wire.
 *
 * Almost everything in data/settings.json is read on the server and rendered.
 * Two values are different: the timezone, which the health engine's nudge
 * clock needs in the browser, and the PC agent's URL, which the browser fetches
 * directly because a server has no route to 127.0.0.1 on somebody's desk.
 *
 * So `settings.ts` fills this on every load, `layout.tsx` stamps both onto
 * `<html>` as data attributes, and the readers below take whichever side they
 * are on. Neither file may import fs, so this is the one place both can meet.
 */

const state: { zone: string | null; agentUrl: string | null } = { zone: null, agentUrl: null };

export function configureRuntime(next: { zone?: string; agentUrl?: string }): void {
  if (next.zone) state.zone = next.zone;
  if (next.agentUrl) state.agentUrl = next.agentUrl;
}

function dataset(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.documentElement.dataset[name] || undefined;
}

/** The board's IANA zone: the settings file's, else the machine's own. */
export function zone(): string {
  const stamped = dataset("tz");
  if (stamped) return stamped;
  if (state.zone) return state.zone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Where the PC agent listens, without a trailing slash.
 *
 * 127.0.0.1 rather than "localhost" on purpose: Chrome exempts the loopback
 * ADDRESS from mixed-content blocking, which is what lets an HTTPS board read a
 * plain-HTTP agent. The hostname has historically not been treated the same
 * way, and the difference is silent when it bites.
 */
export function agentBase(): string {
  const url = dataset("agent") ?? state.agentUrl ?? "http://127.0.0.1:7343";
  return url.replace(/\/$/, "");
}
