"use client";

import { useState, useTransition } from "react";
import { useAudioState } from "@/components/audio-state";
import { resetBoard } from "@/lib/board-actions";

/**
 * Whether the machine's half of the board is answering, and a way to kick it.
 *
 * ONE DOT, AND IT ONLY EVER MEANS ONE THING: is the local agent there. That is
 * the failure this board actually has — the widgets that go dark together are
 * Now Playing, the Computer tab and the mixer, all three of which read
 * 127.0.0.1:7343 from the browser, and all three of which look identical to "the
 * board is broken" when the answer is "one process is not running" or "this is
 * being served from the wrong port".
 *
 * The server needs no dot. If it were down this page would not be here.
 */
export function BoardHealth() {
  const audio = useAudioState();

  // null while the first fetch is in flight — "unknown" is not "down", and a red
  // dot for the half second before the agent answers is a lie twice a minute.
  const up = audio !== null;

  return (
    <>
      {/* Label on top, state underneath — the shape every other item in this row
          uses, so the whole thing shares one baseline. */}
      <span className="quick-label">
        <AgentIcon />
        Agent
      </span>
      <span className="quick-value is-small">
        <span
          className={`quick-dot${up ? " is-on" : " is-off"}`}
          title={up ? "The local agent is answering" : "No answer from the agent on 127.0.0.1:7343"}
        />
        {up ? "up" : "down"}
      </span>
    </>
  );
}

/**
 * After a reset: reload now, or — when the server is restarting — once it
 * answers again. Reloading into a server that is still down leaves the kiosk on
 * Chrome's error page, which nothing on a second monitor ever retries.
 *
 * Exported for DeckBridge, because the deck's reset key lands here too.
 */
export function reloadWhenBack(restarted: boolean, onGiveUp?: (note: string) => void) {
  if (!restarted) {
    window.location.reload();
    return;
  }
  const started = Date.now();
  const tick = async () => {
    if (Date.now() - started > 60_000) {
      onGiveUp?.("The server has not come back. Check the dayboard-server task.");
      return;
    }
    try {
      const res = await fetch("/robots.txt", { cache: "no-store" });
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      // Still down, which is expected for the first few seconds.
    }
    setTimeout(() => void tick(), 1000);
  };
  setTimeout(() => void tick(), 2000);
}

/**
 * The reset, as a button in the controls group rather than a word beside the
 * dot: it does the same KIND of thing the mixer buttons do — press it and
 * something on this machine changes — so it belongs in their row and at their
 * size.
 */
export function BoardReset({ writable }: { writable: boolean }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const reset = () => {
    setNote(null);
    startTransition(async () => {
      const result = await resetBoard();
      if (!result.ok) {
        setNote(result.reason);
        return;
      }
      reloadWhenBack(result.restarted, setNote);
    });
  };

  return (
    <>
      {/* A reset that failed has to say so somewhere. It is the only text in
          this group, truncated, and it only ever appears when something went
          wrong — a successful one reloads the page out from under it. */}
      {note && <span className="quick-note">{note}</span>}
      <button
        type="button"
        className={`watchbtn${pending ? " is-spinning" : ""}`}
        onClick={reset}
        disabled={!writable || pending}
        aria-label="Reset the board"
        title={note ?? "Reload the board, and restart its server when one is supervising it"}
      >
        <RefreshIcon />
      </button>
    </>
  );
}

function AgentIcon() {
  return (
    <svg className="quick-icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      {/* A little box with an aerial: the process on this machine. */}
      <rect x="2.4" y="7.2" width="11.2" height="6.4" rx="1.6" />
      <path d="M8 7.2V4.2" />
      <circle cx="8" cy="3" r="1.2" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8" />
      <path d="M13.6 2.2v3.4h-3.4" />
    </svg>
  );
}
