import { revalidatePath } from "next/cache";
import { DeckCommandSchema, eventsFor } from "@/lib/deck";
import { deckSubscriberCount, publishDeck } from "@/lib/deck-bus";
import { writeAudio, writeBoard } from "@/lib/deck-agent";
import { applyDrink, loadWater, saveWater } from "@/lib/water";
import { todayLocal } from "@/lib/time";
import { todoGate } from "@/lib/todo-actions";
import { resetBoard } from "@/lib/board-actions";

/**
 * The one door a Stream Deck key knocks on.
 *
 * THE GATE IS todoGate(), not a copy of it. It asks exactly the right question —
 * "did this request come from the machine the board runs on" — and it is checked
 * here rather than only at render time for the same reason that file gives: a
 * disabled button stops nobody from sending the same request. It also means
 * DAYBOARD_TODOS=0, which is how a read-only deployment is declared, silences
 * the deck's writes too rather than leaving one hole open. Read the docblock on
 * todoGate before assuming this is an authentication boundary; it is not, and it
 * is not trying to be. serve.ps1 binds 127.0.0.1 and that is the real fence.
 *
 * FOUR DESTINATIONS, and which one a command takes is the whole design:
 *
 *   water   -> the file, and the board finds out on its own AutoRefresh tick.
 *   audio   -> the agent, which owns Voicemeeter.
 *   pin     -> the agent, which owns the window.
 *   the rest-> the bus, because tabs and videos live in localStorage and there
 *              is no other way to reach them from outside the page.
 *
 * A press answers with what actually happened rather than an "ok": the mixer
 * keys need the state after the switch to redraw, and giving every command the
 * same courtesy means a key never has to follow up with a GET.
 */

function bad(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  const gate = await todoGate();
  // Its answer, not its wording: that reason names to-dos, and a Stream Deck log
  // saying a water key failed because of to-dos would send somebody looking in
  // the wrong file. The decision is the shared one; the sentence is ours.
  if (!gate.ok) return bad("the deck can only drive the board from its own machine", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("body is not JSON");
  }

  const parsed = DeckCommandSchema.safeParse(body);
  if (!parsed.success) {
    // The first issue only. A deck key showing a red triangle wants one line in
    // the log, not a zod tree.
    return bad(parsed.error.issues[0]?.message ?? "unrecognised command");
  }
  const command = parsed.data;

  switch (command.cmd) {
    case "water": {
      saveWater(applyDrink(loadWater(), todayLocal(), command.ounces));
      // water.ts is read uncached on every render, so this is all it takes.
      revalidatePath("/");
      break;
    }
    case "audio": {
      const state = await writeAudio(
        command.output ? { output: command.output } : { mute: command.mute! },
      );
      if (!state) return bad("the agent is not answering", 502);
      for (const event of eventsFor(command)) publishDeck(event);
      return Response.json({ ok: true, audio: state });
    }
    case "pin": {
      const board = await writeBoard(command.pin);
      if (!board) return bad("the agent is not answering", 502);
      return Response.json({ ok: true, board });
    }
    case "reset": {
      // The board's own reset, run here rather than by the page so a wedged
      // page can still be kicked. The page is told either way: to wait out the
      // restart and reload, or — with nothing supervising the server — just to
      // reload. restart-server.ps1 pauses before stopping the server, which is
      // what lets this frame and the reply get out first.
      const result = await resetBoard();
      if (!result.ok) return bad(result.reason, 502);
      publishDeck({ type: "reset", restarted: result.restarted });
      return Response.json({ ok: true, boards: deckSubscriberCount(), restarted: result.restarted }, { status: 202 });
    }
    default:
      break;
  }

  // tab / play / expand, and the water tick already written above. How many
  // boards were listening goes back with the answer, and zero is the reply worth
  // having: it means this route did its job and nothing on a second monitor moved, which
  // is a browser that is closed or has lost its stream — not a bad command.
  for (const event of eventsFor(command)) publishDeck(event);

  return Response.json({ ok: true, boards: deckSubscriberCount() }, { status: 202 });
}
