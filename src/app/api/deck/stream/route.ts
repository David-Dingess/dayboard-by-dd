import { subscribeDeck } from "@/lib/deck-bus";

/**
 * The board's end of the deck bus.
 *
 * ONE FRAME PER BUTTON PRESS AND NOTHING ELSE — this stream is silent for hours
 * at a time, which is the opposite of the agent's /events and the reason it is
 * not merged into it. That silence is also the one thing that needs handling:
 * an idle connection with no bytes on it gets closed by something eventually, so
 * a comment line goes down it every twenty seconds. A comment, not an event, so
 * EventSource ignores it entirely and the board's listener never sees a tick.
 *
 * `dynamic = "force-dynamic"` and no revalidation: a cached SSE response is a
 * contradiction, and Next will happily produce one for a GET that never touches
 * a request API.
 */
export const dynamic = "force-dynamic";

/** Comfortably under any proxy or browser idle timeout worth worrying about. */
const KEEPALIVE_MS = 20_000;

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;

      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Enqueued after the consumer went away. Nothing to do but stop.
          open = false;
        }
      };

      // Straight away, so a reconnecting board proves the round trip rather than
      // waiting up to twenty seconds to find out the stream is real.
      send(": open\n\n");

      const unsubscribe = subscribeDeck((event, id) => {
        // The event NAME is the command, so the browser can addEventListener per
        // kind instead of switching on a payload field. The id makes two
        // identical presses two distinct frames.
        send(`id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime when the request aborted.
        }
      };

      // The board closing its tab, or navigating, is the normal way this ends.
      if (request.signal.aborted) close();
      else request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      // Nothing sits in front of this today, but a buffering proxy would hold
      // every frame until the stream ended, which for this stream is never.
      "x-accel-buffering": "no",
    },
  });
}
