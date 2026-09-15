import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * The Mail tab's data: one file, `data/mail.json`, written by the agent in
 * agent/mail at the end of every poll.
 *
 * The board reads Gmail through nothing — it reads this file. The IMAP
 * connection, the app password and the "which label is the forwarded Outlook
 * mail" all live in the Python, off the render path, for the same reason the
 * pollers do: a 30-second re-render must not open a socket to a mail server,
 * and a credential has no business in a server component. This file's whole job
 * is to validate that document and hand it to the widget.
 *
 * NOTHING HERE MARKS ANYTHING READ. The agent fetches with BODY.PEEK so that
 * looking at the board is not the same as opening the mail; `unread` is whatever
 * Gmail said when it last polled, and it changes when you read it in the mailbox,
 * not when the board shows it.
 */

const MailMessageSchema = z.object({
  /** The IMAP UID as a string — stable for the life of the mailbox. */
  id: z.string(),
  from: z.string(),
  subject: z.string(),
  /** A short plain-text preview, already trimmed by the agent. */
  snippet: z.string(),
  /** The full message as readable plain text, for reading it open in the tab.
   *  Capped by the agent; absent on files written before this field existed. */
  body: z.string().default(""),
  /** ISO datetime the message was received. */
  receivedAt: z.string(),
  unread: z.boolean(),
});

export const MailFileSchema = z.object({
  schema: z.number().int(),
  /** When the agent last polled, ISO. */
  fetchedAt: z.string(),
  /** Gmail's own unread count for the watched mailbox, which may exceed the list. */
  unreadCount: z.number().int().min(0),
  /** The mailbox or label watched, for the widget's meta line. */
  mailbox: z.string().default("INBOX"),
  /** Newest first, already capped by the agent. */
  messages: z.array(MailMessageSchema).default([]),
});

export type MailFile = z.infer<typeof MailFileSchema>;
export type MailMessage = z.infer<typeof MailMessageSchema>;

const FILE = path.join(process.cwd(), "data", "mail.json");

/**
 * Read fresh, like the packages file — the agent rewrites it
 * from another process on its own poll, so a cache would only ever be wrong.
 */
export function loadMail(): MailFile | null {
  try {
    return MailFileSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch (err) {
    // No poll yet is the ordinary state on a fresh checkout, not a fault.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error(`dayboard: mail.json unreadable — ${(err as Error).message.split("\n")[0]}`);
    return null;
  }
}

/** How many of the listed messages are unread — the badge number. */
export function unreadCount(file: MailFile | null): number {
  return file?.unreadCount ?? 0;
}
