"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A row that runs off the side, and says so.
 *
 * A horizontal scroller cut dead at the panel edge reads as a rendering fault
 * rather than as "there is more this way" — the tile just stops mid-word. So the
 * edge is faded out instead, and the fade is the only thing telling you the row
 * carries on.
 *
 * WHICH MEANS IT HAS TO BE CONDITIONAL. A row whose tiles all fit is not
 * trailing off, and fading it would dim a tile for no reason — worse, it would
 * dim the single full-width stream tile that is the whole row. Hence the two
 * flags: one per end, each true only while there is really something past it.
 * That is not a thing CSS can work out on its own.
 *
 * `count` exists so the check re-runs when the list changes length. A refresh
 * tick can add a video or drop a stream, and a ResizeObserver watching the
 * scroller sees the box, not its contents.
 */
export function Rail({ count, children }: { count: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ back: false, more: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => {
      const back = el.scrollLeft > 2;
      const more = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEnds((was) => (was.back === back && was.more === more ? was : { back, more }));
    };

    check();
    el.addEventListener("scroll", check, { passive: true });

    const size = new ResizeObserver(check);
    size.observe(el);

    // THE FIRST MEASUREMENT IS USUALLY WRONG, and not by accident: Panel hydrates
    // showing its first tab, so if you left the board on Watch this row is
    // inside a display:none slot at mount and measures zero. Something has to
    // look again once it is on screen. A ResizeObserver alone gets there, but
    // only in a tab that is actually painting — Chrome defers those callbacks in
    // a background tab, which is exactly how this looked broken while it was
    // fine. Visibility is its own signal, so treat it as one.
    const shown = new IntersectionObserver(check);
    shown.observe(el);

    return () => {
      el.removeEventListener("scroll", check);
      size.disconnect();
      shown.disconnect();
    };
  }, [count]);

  return (
    <div
      ref={ref}
      className={`rail${ends.back ? " has-back" : ""}${ends.more ? " has-more" : ""}`}
    >
      {children}
    </div>
  );
}
