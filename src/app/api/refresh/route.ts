import { deckSubscriberCount, publishDeck } from "@/lib/deck-bus";

/**
 * "Re-render now" for the whole board.
 *
 * A CLI write (npm run event / notes / water / todo) lands on disk instantly but
 * the board only re-reads on its own thirty-second AutoRefresh tick. This route
 * is the push that closes that gap: it drops one `refresh` frame on the deck bus
 * and every board listening calls router.refresh() within a tick of the write.
 * See scripts/notify-board.ts for the caller and DeckBridge for the board's end.
 *
 * NOT GATED, unlike /api/deck. It changes nothing and exposes nothing — a
 * re-render reads the same local files the board already renders, so the worst a
 * caller can do is ask the board to repaint. serve.ps1 binds 127.0.0.1, which is
 * the only fence this needs: nothing off the machine can reach it to begin with.
 *
 * The count of boards that heard it goes back in the reply, the same courtesy the
 * deck route pays: zero means the ping worked and nothing was listening — a
 * closed tab or a board still booting — rather than a failure here.
 */
export async function POST() {
  publishDeck({ type: "refresh" });
  return Response.json({ ok: true, boards: deckSubscriberCount() }, { status: 202 });
}
