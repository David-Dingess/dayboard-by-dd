"use client";

import { useState } from "react";
import { DateTime } from "luxon";
import { deleteMail } from "@/lib/mail-actions";
import type { MailMessage } from "@/lib/mail";
import { zone } from "@/lib/time";

/**
 * The mail rows, made openable and deletable.
 *
 * A row is a button: click it to expand and read the body in place, click it
 * again to close. The X moves the message to Gmail's Trash (via the agent — see
 * mail-actions.ts) and hides it here at once, so the board does not wait on the
 * poll to catch up. If the write is refused the row comes back with the reason.
 *
 * The list is server-rendered every thirty seconds; this only owns which row is
 * open and which ones are on their way out, so a refresh never fights a click.
 */

function when(iso: string): string {
  const dt = DateTime.fromISO(iso).setZone(zone());
  return dt.isValid ? (dt.toRelative({ style: "short" }) ?? "") : "";
}

export function MailList({ messages, writable }: { messages: MailMessage[]; writable: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = messages.filter((m) => !gone.has(m.id));
  if (visible.length === 0) {
    return <p className="empty">{error ?? "Inbox clear."}</p>;
  }

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    // Optimistic: hide it now, restore if the write is refused.
    setGone((prev) => new Set(prev).add(id));
    const result = await deleteMail(id);
    setBusyId(null);
    if (!result.ok) {
      setGone((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setError(result.error ?? "That didn't delete.");
    }
  };

  return (
    <>
      {error && <p className="mailerror">{error}</p>}
      <ul className="maillist">
        {visible.map((message) => {
          const open = openId === message.id;
          return (
            <li key={message.id} className={`mailrow${message.unread ? " is-unread" : ""}${open ? " is-open" : ""}`}>
              <button
                type="button"
                className="mailrow-main"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : message.id)}
              >
                <span className="mailrow-top">
                  <span className="mailrow-from">{message.from}</span>
                  <span className="mailrow-when">{when(message.receivedAt)}</span>
                </span>
                <span className="mailrow-subject">{message.subject || "(no subject)"}</span>
                {!open && message.snippet && <span className="mailrow-snippet">{message.snippet}</span>}
              </button>

              {writable && (
                <button
                  type="button"
                  className="mailrow-x"
                  aria-label={`Delete: ${message.subject || message.from}`}
                  disabled={busyId === message.id}
                  onClick={() => void remove(message.id)}
                >
                  ✕
                </button>
              )}

              {open && (
                <div className="mailrow-body">
                  {message.body ? message.body : <span className="mailrow-nobody">No text to show.</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
