import { DateTime } from "luxon";
import { MailList } from "@/components/MailList";
import type { MailFile } from "@/lib/mail";
import { todoGate } from "@/lib/todo-actions";
import { zone } from "@/lib/time";

/**
 * The forwarded Outlook mail, landing in Gmail and shown here.
 *
 * A small poller in agent/mail reads one mailbox over IMAP and writes
 * over IMAP and writes data/mail.json. This renders it — the header, the glow,
 * the badge — and hands the rows to MailList, the one client island, which owns
 * opening a message to read it and the X that trashes one.
 *
 * GREEN GLOW WHEN THERE IS UNREAD, and a count badge — the one thing worth
 * crossing the room for on this panel, drawn the same green the rest of the board
 * keeps for "new, and you have not dealt with it". Read it in Gmail and the next
 * poll clears both; this board never marks anything read itself.
 *
 * The list is already newest-first and capped by the agent. A read message stays
 * in the list, greyed, so the panel does not jump every time one is opened. The
 * gate decides whether the X is offered at all, the same read-only rule the rest
 * of the board's writes keep.
 */

export async function MailWidget({ file }: { file: MailFile | null }) {
  if (!file) {
    return (
      <div className="widget mailwidget">
        <div className="widget-head">
          <h2 className="widget-title">Mail</h2>
        </div>
        <div className="widget-scroll">
          <p className="empty">
            No poll yet. Start the <code>Dayboard Mail</code> task, or run{" "}
            <code>agent/mail/run_poll.cmd</code> once your Gmail app password is set.
          </p>
        </div>
      </div>
    );
  }

  const hasUnread = file.unreadCount > 0;
  const gate = await todoGate();

  return (
    <div className={`widget mailwidget${hasUnread ? " has-unread" : ""}`}>
      <div className="widget-head">
        <h2 className="widget-title">
          Mail
          {hasUnread && (
            <span className="mail-badge" aria-label={`${file.unreadCount} unread`}>
              {file.unreadCount}
            </span>
          )}
        </h2>
        <span className="widget-meta">
          {file.mailbox} · {DateTime.fromISO(file.fetchedAt).setZone(zone()).toRelative()}
        </span>
      </div>

      <div className="widget-scroll">
        {file.messages.length === 0 ? (
          <p className="empty">Inbox clear.</p>
        ) : (
          <MailList messages={file.messages} writable={gate.ok} />
        )}
      </div>
    </div>
  );
}
