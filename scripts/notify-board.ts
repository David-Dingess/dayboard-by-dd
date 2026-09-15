/**
 * "The files moved — re-render now" to the running board.
 *
 * A CLI write lands on disk the moment `save` returns, but the board only
 * re-reads on its own thirty-second AutoRefresh tick, so `npm run event` felt
 * like it took up to half a minute to show on the board. This pings the server's
 * /api/refresh, which publishes one `refresh` frame down the same SSE the Stream
 * Deck uses; every board listening calls router.refresh() within a tick of the
 * write. The 30-second tick stays as the fallback for when this does not land.
 *
 * BEST EFFORT, AND FIRED WITHOUT AWAIT. The CLI scripts have no process.exit on
 * their success path, so Node keeps the loop alive for this pending request and
 * drains it before the script ends — no top-level await needed, and no change to
 * how any command reads. A board that is not up (the server is a separate
 * scheduled task, and this also runs on Josh's fork with no server at all) just
 * refuses the connection; the timeout bounds the wait, the catch eats the error,
 * and the write already succeeded regardless.
 *
 * NO next/* IMPORTS, the rule every file scripts reach for keeps: this is called
 * from plain tsx and must not pull a server tree in behind it.
 */

const PORT = process.env.DAYBOARD_PORT ?? process.env.PORT ?? "6767";

export function notifyBoard(): void {
  void fetch(`http://127.0.0.1:${PORT}/api/refresh`, {
    method: "POST",
    // serve.ps1 binds loopback, so a hang means the server is wedged, not slow.
    // Two seconds is long enough to never trip on a healthy box and short enough
    // that a wedged one does not hold a chat session's CLI call open.
    signal: AbortSignal.timeout(2000),
  }).catch(() => {
    // No board, or no server. The next AutoRefresh tick shows the write anyway.
  });
}
