"use client";

import { useEffect, useState } from "react";
import { FIGURES, drawFigure, labelAt, sideAt } from "@/lib/health";

/**
 * One exercise, animated and looping, with the step it is on written under it.
 *
 * Every move the Health tab can show — the programme's stations and the chair
 * routine's — is drawn in lib/health/figures; this turns its shapes into SVG
 * once a frame. Tones become classes so the colours live in the stylesheet with
 * the rest of the board's.
 *
 * IT DOES NOT HONOUR prefers-reduced-motion BY STOPPING. The motion is the
 * instruction — a still of a tendon glide is a picture of a hand — so it runs
 * regardless, the way a video someone pressed play on would.
 *
 * SIDES ARE A MIRROR. Every animation is drawn doing the right side. A caller
 * with a timer says which side it is (the chair routine's steps, a
 * switch-halfway station past its half); without one, a switch-halfway move
 * mirrors every other loop so a preview still shows both.
 */
export function ExerciseFigure({
  moveId,
  side,
  className = "",
}: {
  moveId: string | undefined;
  side?: "Right" | "Left";
  className?: string;
}) {
  const anim = moveId ? FIGURES[moveId] : undefined;
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!anim) return;
    let frame = 0;
    const started = performance.now();
    const loop = (now: number) => {
      setT((now - started) / 1000);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [anim]);

  if (!anim) return null;

  const [x, y, w, h] = anim.viewBox;
  const shapes = drawFigure(anim, t);
  const label = labelAt(anim, t);
  const facing = side ?? sideAt(anim, t);

  return (
    <figure className={`exfig ${className}`.trim()}>
      <svg viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label={label}>
        <g transform={facing === "Left" ? `translate(${2 * x + w} 0) scale(-1 1)` : undefined}>
          {shapes.map((shape, i) =>
            shape.kind === "line" ? (
              <line
                key={i}
                className={`is-${shape.tone}`}
                x1={shape.x1}
                y1={shape.y1}
                x2={shape.x2}
                y2={shape.y2}
                strokeWidth={shape.w}
              />
            ) : (
              <circle key={i} className={`is-${shape.tone}`} cx={shape.cx} cy={shape.cy} r={shape.r} />
            ),
          )}
        </g>
      </svg>
      <figcaption className="exfig-label">{label}</figcaption>
    </figure>
  );
}
