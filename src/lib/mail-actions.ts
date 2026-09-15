"use server";

import { readFileSync } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { todoGate, type TodoResult } from "./todo-actions";
import { writeJsonAtomic } from "./atomic";
import { publishDeck } from "./deck-bus";
import { MailFileSchema } from "./mail";

/**
 * The Mail tab's one write: delete a message.
 *
 * The board cannot touch the mailbox — that is the agent's, and its credential
 * lives nowhere near this process. So a delete is two local edits and a note for
 * the agent: the message id goes into data/mail-queue.json, and the message is
 * dropped from data/mail.json so the board updates on the next tick without
 * waiting for a poll. The agent, next time it runs, moves every queued id to
 * Gmail's Trash BEFORE it re-fetches, which is what keeps a just-deleted message
 * from coming straight back. Trash, not a permanent delete — Gmail keeps it 30
 * days, so an X is undoable in Gmail.
 *
 * GATED like every other board write. On a read-only deployment (DAYBOARD_TODOS=0)
 * or a copy that is not the machine you sit at, this refuses — see todoGate.
 */

const DATA = path.join(process.cwd(), "data");
const MAIL = path.join(DATA, "mail.json");
const QUEUE = path.join(DATA, "mail-queue.json");

function readQueue(): string[] {
  try {
    const parsed = JSON.parse(readFileSync(QUEUE, "utf8"));
    return Array.isArray(parsed?.delete) ? parsed.delete.map(String) : [];
  } catch {
    return [];
  }
}

export async function deleteMail(id: string): Promise<TodoResult> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };
  // Only ever an IMAP UID, which is digits. Anything else is a malformed request.
  if (!/^\d+$/.test(id)) return { ok: false, error: "That isn't a message." };

  try {
    const queue = readQueue();
    if (!queue.includes(id)) queue.push(id);
    writeJsonAtomic(QUEUE, JSON.stringify({ delete: queue }, null, 2));

    // Drop it from the rendered list now, and take the badge down with it if it
    // was unread. The agent's next poll rewrites this file from Gmail anyway.
    try {
      const file = MailFileSchema.parse(JSON.parse(readFileSync(MAIL, "utf8")));
      const gone = file.messages.find((m) => m.id === id);
      if (gone) {
        file.messages = file.messages.filter((m) => m.id !== id);
        if (gone.unread) file.unreadCount = Math.max(0, file.unreadCount - 1);
        writeJsonAtomic(MAIL, JSON.stringify(file, null, 2));
      }
    } catch {
      // No mail.json yet, or unreadable — the queue entry still stands and the
      // agent will act on it. Nothing to show removed in the meantime.
    }

    revalidatePath("/");
    publishDeck({ type: "refresh" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
