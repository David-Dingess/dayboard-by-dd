"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lineColor, lineInk, type Alert } from "@/lib/subway-client";

/**
 * Six bullets telling you whether each line is fine, and nothing more until you
 * ask. THE CIRCLE IS THE WHOLE MESSAGE: a line with problems gets a red ring
 * behind its bullet and shows its messages on hover. The word "Good" and the
 * count in a triangle both went — six pills each carrying a word cost more width
 * than the trains beside them, and neither said anything the colour did not.
 *
 * The card FLOATS rather than expanding in place. In the left stack this widget
 * sits above three others, so an inline panel would shove Weather, Now Playing
 * and Discord down the column every time a pointer crossed a badge.
 *
 * That forces a portal: `.panel` is `overflow: hidden` and `.widget-scroll` is
 * `overflow: auto`, so anything positioned inside a widget is clipped by one of
 * them. Rendering into `document.body` with `position: fixed` is the way out of
 * both, and it is why the card carries its own z-index rather than relying on
 * source order.
 */

export interface LineState {
  route: string;
  segmentLabel: string;
  alerts: Alert[];
}

/** Long enough to cross the gap from badge to card, short enough to feel instant. */
const CLOSE_DELAY_MS = 120;

/** How close to the window edge the card is allowed to sit. */
const EDGE = 8;

interface Placement {
  left: number;
  top: number;
}

export function LineStatus({ lines }: { lines: LineState[] }) {
  // The TRIGGER ELEMENT is what gets held, not a captured rect: the board
  // re-renders itself every thirty seconds, and a rect measured before that
  // render describes where the badge used to be.
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expanded = lines.find((l) => l.route === openRoute && l.alerts.length > 0);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const close = useCallback(() => {
    cancelClose();
    setOpenRoute(null);
    setAnchor(null);
    setPlace(null);
  }, [cancelClose]);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
  }, [cancelClose, close]);

  const open = useCallback(
    (route: string, element: HTMLElement) => {
      cancelClose();
      setOpenRoute(route);
      setAnchor(element);
    },
    [cancelClose],
  );

  useEffect(() => cancelClose, [cancelClose]);

  // Placement, measured from both boxes rather than guessed: below the badge if
  // it fits, flipped above if it does not, and always clamped inside the viewport
  // so a badge at the edge of a narrow column cannot push the card offscreen.
  useLayoutEffect(() => {
    if (!anchor || !expanded) return;

    const position = () => {
      const card = cardRef.current;
      if (!card) return;
      if (!anchor.isConnected) {
        close();
        return;
      }

      const a = anchor.getBoundingClientRect();
      const width = card.offsetWidth;
      const height = card.offsetHeight;

      const below = a.bottom + 6;
      const above = a.top - height - 6;
      const top = below + height > window.innerHeight - EDGE && above >= EDGE ? above : below;

      const left = Math.min(
        Math.max(a.left, EDGE),
        Math.max(EDGE, window.innerWidth - width - EDGE),
      );

      setPlace({ left, top: Math.max(EDGE, top) });
    };

    position();

    // Capture phase: the badge lives inside a scrollable widget, and a scroll on
    // an inner element does not bubble to window.
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [anchor, expanded, close]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, close]);

  // The grid fills downward, column by column, in the order the lines were
  // picked in settings — so the first three picked are the left column.
  const ordered = lines;

  return (
    <section className="linestatus">
      <ul className="statusrow">
        {ordered.map((line) => {
          const count = line.alerts.length;
          const clear = count === 0;
          const isOpen = openRoute === line.route;
          return (
            <li key={line.route}>
              <button
                type="button"
                className={`statuspill${clear ? " is-clear" : " is-alert"}${isOpen ? " is-open" : ""}`}
                // A clear line has nothing to show, so it is not a target.
                disabled={clear}
                aria-expanded={clear ? undefined : isOpen}
                // The handlers only exist on a line with problems. `disabled`
                // stops a click but NOT a pointerenter, so a clear pill was
                // still setting openRoute — no card to show, but it took the
                // is-open styling and turned red under the cursor. Six green
                // pills that each flashed red as you swept past them.
                onPointerEnter={clear ? undefined : (e) => open(line.route, e.currentTarget)}
                onPointerLeave={clear ? undefined : closeSoon}
                onFocus={clear ? undefined : (e) => open(line.route, e.currentTarget)}
                onBlur={clear ? undefined : closeSoon}
                // Touch has no hover, so a tap is the same gesture there.
                onClick={
                  clear ? undefined : (e) => (isOpen ? close() : open(line.route, e.currentTarget))
                }
                title={
                  clear
                    ? `${line.route}: good service`
                    : `${line.route}: ${count} issue${count === 1 ? "" : "s"} — ${line.segmentLabel}`
                }
              >
                <span
                  className="bullet"
                  style={{
                    background: lineColor(line.route),
                    color: lineInk(line.route),
                    // Sized so three of these stacked come to less than the
                    // train tiles beside them: at 24px the bullets set the
                    // widget's height and the whole column paid for it.
                    width: 20,
                    height: 20,
                    fontSize: 11,
                  }}
                >
                  <span className="bullet-label">{line.route}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* No portal on the server: `expanded` can only become truthy from a
          pointer or focus event, so this branch never runs during SSR. */}
      {expanded &&
        createPortal(
          <div
            ref={cardRef}
            className="statusdetail statuscard"
            role="tooltip"
            // Hidden until measured, so it never flashes at 0,0 on the way in.
            style={
              place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }
            }
            onPointerEnter={cancelClose}
            onPointerLeave={closeSoon}
          >
            <p className="statusdetail-head">
              <span
                className="bullet"
                style={{
                  background: lineColor(expanded.route),
                  color: lineInk(expanded.route),
                  width: 20,
                  height: 20,
                  fontSize: 11,
                }}
              >
                <span className="bullet-label">{expanded.route}</span>
              </span>
              <span className="statusdetail-seg">{expanded.segmentLabel}</span>
            </p>
            <ul className="alerts">
              {expanded.alerts.map((alert) => (
                <li key={alert.id} className={`alert${alert.planned ? " is-planned" : ""}`}>
                  <span className="alert-body">
                    <span className="alert-type">{alert.type}</span>
                    <span className="alert-text">{alert.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </section>
  );
}
