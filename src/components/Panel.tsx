"use client";

import { Children, useCallback, useEffect, useSyncExternalStore } from "react";
import { useTabStatuses } from "@/components/tab-status";
import { ackKey, ackTab, clearAck, useAcks } from "@/components/tab-ack";

/**
 * One column of the triboard. It holds several widgets, shows one, and puts the
 * toggle at the very bottom where the hand is.
 *
 * The widgets are rendered on the SERVER and handed in as children — this
 * component only decides which is visible. That keeps every widget a server
 * component with direct file and network access, and makes switching instant
 * with no refetch.
 *
 * CONTRACT: children are positional — the Nth child belongs to the Nth tab.
 * That is what keeps "add a widget" to two lines in page.tsx with no CSS to
 * touch.
 *
 * Selection is per-device, so it lives in localStorage, read through
 * useSyncExternalStore rather than an effect that calls setState (which would
 * cascade a second render on every mount).
 */

export interface WidgetTab {
  id: string;
  label: string;
  /**
   * Something is waiting inside this widget. The tab pulses — but only while you
   * are looking at a different one, since a tab you are already on has nothing
   * left to tell you.
   */
  alert?: boolean;
}

const listeners = new Set<() => void>();
const keyFor = (side: string) => `dayboard.panel.${side}`;

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function read(side: string): string {
  try {
    return localStorage.getItem(keyFor(side)) ?? "";
  } catch {
    return "";
  }
}

/**
 * Show a panel's tab from anywhere.
 *
 * Exported because clicking a video in the RIGHT panel has to bring up the
 * player in the CENTRE one, and the two panels never meet in the tree. They meet
 * here instead, through the store they were already sharing.
 */
export function selectTab(side: string, id: string) {
  try {
    localStorage.setItem(keyFor(side), id);
  } catch {
    // A private window still switches for this session.
  }
  for (const listener of listeners) listener();
}

/**
 * Which tab a panel is showing, for something rendered outside that panel.
 *
 * The server snapshot is null here where Panel's own is "" — and the difference
 * matters. Panel needs "" so the server renders tabs[0] and hydration is quiet.
 * A reader needs to tell "localStorage has not been read yet" from "you are
 * looking at the calendar", because those call for different first frames. Same
 * distinction watched.ts calls `known`. The store is shared; only the snapshot
 * function differs, which is allowed and is the point.
 */
export function usePanelTab(side: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => read(side),
    () => null,
  );
}

/**
 * The same answer, read once instead of subscribed to.
 *
 * For code that runs on a timer rather than in a render: the eye break has to
 * note which tab you were on before it takes the panel, and then put you back.
 * A hook would re-render that component every time anyone switched tabs, to no
 * purpose — it does not draw the answer, it remembers it.
 */
export function readPanelTab(side: string): string {
  return read(side);
}

export function Panel({
  side,
  tabs,
  children,
}: {
  side: string;
  tabs: WidgetTab[];
  children: React.ReactNode;
}) {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(side),
    // The server has no preference, so it renders the first tab — which is also
    // what a first visit sees, so the markup matches and hydration is quiet.
    () => "",
  );
  const active = tabs.some((t) => t.id === stored) ? stored : tabs[0]?.id;
  const slots = Children.toArray(children);
  // A second, quieter alert channel, written by the widget itself rather than by
  // the server — see components/tab-status.ts for why `alert` could not do it.
  const statuses = useTabStatuses();
  // Which pulsing tabs have already been looked at — see components/tab-ack.ts.
  const acks = useAcks();

  const alerting = (tab: WidgetTab) => tab.alert || statuses[tab.id] === "alert";

  // Opening a pulsing tab is dealing with it, so it stops asking.
  const select = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (tab && alerting(tab)) ackTab(ackKey(side, id));
      selectTab(side, id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [side, tabs, statuses],
  );

  // An acknowledgement lasts until the alert itself goes away. Releasing it here
  // rather than on a timer is what lets the NEXT one through: a second game
  // kicking off is new and should pulse, the one already watched should not.
  useEffect(() => {
    for (const tab of tabs) {
      if (!alerting(tab)) clearAck(ackKey(side, tab.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, tabs, statuses]);

  return (
    <section className="panel">
      {/* Named so WatchPlayer can measure this column when the player is asked
          to fill the panel. Nothing else reads it. */}
      <div className="panel-body" data-panel={side}>
        {slots.map((child, index) => (
          <div
            key={tabs[index]?.id ?? index}
            className={`widget-slot${tabs[index]?.id === active ? " is-active" : ""}`}
          >
            {child}
          </div>
        ))}
      </div>

      {tabs.length > 1 && (
        <nav className="panel-tabs" aria-label={`${side} panel`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={
                `panel-tab` +
                (alerting(tab) && tab.id !== active && !acks[ackKey(side, tab.id)]
                  ? " has-alert"
                  : "") +
                (statuses[tab.id] === "crit" && tab.id !== active ? " has-warn" : "")
              }
              aria-pressed={tab.id === active}
              onClick={() => select(tab.id)}
            >
              {tab.label}
              {statuses[tab.id] === "crit" && tab.id !== active && (
                <span className="panel-tab-dot" aria-label="something needs attention" />
              )}
            </button>
          ))}
        </nav>
      )}
    </section>
  );
}
