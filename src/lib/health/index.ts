/**
 * The Health program engine — the standalone app's `src/engine`, moved in whole.
 *
 * the standalone app was a standalone Electron app (2026-08-10) running a 52-week
 * self-scaling exercise program. It was folded into this board on 2026-09-06 for
 * the reason everything gets folded in: a tool with its own window is a tool
 * that stops getting opened. The engine came across verbatim — it was written
 * pure by rule, no electron, no node, no React — with one exception, which is
 * dates.ts: the original kept local time, and a page that renders on a UTC
 * server for a New York browser needs one clock. See that file.
 *
 * Still pure. Nothing in this directory may import `next/*`, React, or `node:*`;
 * it runs in the browser (the alert tick, the timer), on the server (today's
 * session), and under plain tsx (the CLI), and the tests are all of functions.
 */
export * from "./types";
export * from "./store-types";
export * from "./dates";
export * from "./ladders";
export * from "./phases";
export * from "./session";
export * from "./progress";
export * from "./steps";
export * from "./videos";
export * from "./slots";
export * from "./eyebreak";
export * from "./chair";
export * from "./figures";
export { defaultSettings, DEFAULT_SLOTS, PROGRAM_WEEKS } from "./defaults";
