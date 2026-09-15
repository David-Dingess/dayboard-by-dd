import { loadSettings } from "./settings";

/**
 * One door, and it is not for a browser.
 *
 * The board itself is open: nothing on it is private enough to be worth a login
 * form standing between you and a glance at the board.
 *
 * The .ics feeds are the exception, and not because the events are secret — iOS
 * Calendar subscribes by URL and has no way to log in, so the URL has to carry
 * its own authorisation. A long random token in the path does that. Rotating it
 * (the setup guide's Calendars section) forces the phone to resubscribe, which is the only reason
 * you would.
 */

/** Constant-time compare, so a wrong token leaks nothing through timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Rotation with a grace window: put the new token first, resubscribe the phone,
 * then drop the old one. No tokens at all refuses everything rather than
 * defaulting open.
 */
export function feedTokenIsValid(token: string): boolean {
  const tokens = loadSettings().feed.tokens;
  if (!tokens.length) return false;
  return tokens.some((candidate) => safeEqual(candidate, token));
}
