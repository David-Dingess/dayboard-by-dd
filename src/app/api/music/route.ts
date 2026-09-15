import { MusicCommandSchema } from "@/lib/music";
import { musicState, runMusic } from "@/lib/stream-host";
import { todoGate } from "@/lib/todo-actions";

/**
 * The music window's one door — /api/stream's twin, gated the same way and for
 * the same reason: it drives a browser holding your music login. Read
 * todoGate()'s docblock before mistaking it for authentication; serve.ps1
 * binding 127.0.0.1 is the real fence.
 *
 * Both verbs answer with the state afterwards.
 */

function refuse(message: string, status: number) {
  return Response.json({ ok: false, reason: message }, { status });
}

export async function GET() {
  const gate = await todoGate();
  if (!gate.ok) return refuse("Music only plays on the board's own machine.", 403);
  return Response.json(await musicState());
}

export async function POST(request: Request) {
  const gate = await todoGate();
  if (!gate.ok) return refuse("Music only plays on the board's own machine.", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse("body is not JSON", 400);
  }

  const parsed = MusicCommandSchema.safeParse(body);
  if (!parsed.success) return refuse(parsed.error.issues[0]?.message ?? "unrecognised command", 400);

  return Response.json(await runMusic(parsed.data));
}
