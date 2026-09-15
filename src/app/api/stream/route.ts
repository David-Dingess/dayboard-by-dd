import { StreamCommandSchema } from "@/lib/stream";
import { runStream, streamState } from "@/lib/stream-host";
import { todoGate } from "@/lib/todo-actions";

/**
 * The stream window's one door.
 *
 * GATED LIKE /api/deck, with todoGate() and for the same reason: this drives a
 * browser that holds your streaming logins, and the question that matters is
 * "did this come from the machine the board runs on". Read that function's
 * docblock before mistaking it for authentication — serve.ps1 binding
 * 127.0.0.1 is the real fence, and this is the second one.
 *
 * Both verbs answer with the state afterwards, so the player never needs a
 * follow-up read to know whether its click landed.
 */

function refuse(message: string, status: number) {
  return Response.json({ ok: false, reason: message }, { status });
}

export async function GET() {
  const gate = await todoGate();
  if (!gate.ok) return refuse("Streams only play on the board's own machine.", 403);
  return Response.json(await streamState());
}

export async function POST(request: Request) {
  const gate = await todoGate();
  if (!gate.ok) return refuse("Streams only play on the board's own machine.", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse("body is not JSON", 400);
  }

  const parsed = StreamCommandSchema.safeParse(body);
  if (!parsed.success) return refuse(parsed.error.issues[0]?.message ?? "unrecognised command", 400);

  return Response.json(await runStream(parsed.data));
}
