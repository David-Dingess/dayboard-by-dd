"use client";

import { useSyncExternalStore } from "react";

/**
 * A way for a client widget to put a mark on its own panel tab.
 *
 * `WidgetTab.alert` already exists and is the wrong tool here twice over: it is
 * a server-rendered boolean, and the PC panel's state is only known in the
 * browser (the agent is on loopback, page.tsx has never seen it); and on this
 * board green-and-pulsing is spoken for — it means "new, and you haven't dealt
 * with it", which a full disk is not. A disk that has been full since Tuesday
 * should say so quietly and permanently.
 *
 * So: a second, quieter channel. A widget calls `setTabStatus("pc", "crit")`,
 * Panel renders a small static red dot on that tab while it is not the active
 * one, and nothing pulses.
 *
 * `"alert"` is the exception that proves the first half of that rule. It draws
 * exactly what `WidgetTab.alert` draws, green and pulsing, and it means exactly
 * what that means — new, and you have not dealt with it. It exists because the
 * Health tab's nudges are decided in the browser: which of today's sessions has
 * already announced itself is in this browser's localStorage, and page.tsx has
 * never seen it. Same words, one of them just cannot be said from the server.
 *
 * Deliberately generic — Panel must not learn what a vitals is. It is the same
 * module-scope store the board uses for `watched`, `watching` and the panel
 * selection itself, minus localStorage: this is live state about right now, and
 * a red dot surviving a reload of a machine that has since cooled down would be
 * a lie.
 */

export type TabStatus = "ok" | "warn" | "crit" | "alert";

const listeners = new Set<() => void>();
let statuses: Record<string, TabStatus> = {};

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function setTabStatus(tabId: string, status: TabStatus) {
  if (statuses[tabId] === status) return; // no wake-up for an unchanged state
  statuses = { ...statuses, [tabId]: status };
  for (const listener of listeners) listener();
}

function read(): Record<string, TabStatus> {
  return statuses;
}

// The server marks nothing, and this has to be a stable reference or
// useSyncExternalStore re-renders forever.
const NONE: Record<string, TabStatus> = {};
function none(): Record<string, TabStatus> {
  return NONE;
}

export function useTabStatuses(): Record<string, TabStatus> {
  return useSyncExternalStore(subscribe, read, none);
}
