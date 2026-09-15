import type { Layer } from "@/lib/schema";

/**
 * The little mark beside an event: the club's actual crest for the four teams,
 * an emoji for everything else.
 *
 * Crests sit on a white disc. They are drawn for white backgrounds — a navy
 * crest on transparent simply disappears on Dayboard's dark ground — and a disc
 * also makes them read as one consistent badge set.
 *
 * The images are real PNGs served from public/logos, downloaded once rather than
 * hotlinked, so the page makes no third-party image requests and nothing breaks
 * when a CDN reorganises. They are trademarks of their clubs, used at thumbnail
 * size in a private personal calendar.
 *
 * Plain <img>, not next/image: fixed-size local files, so the optimiser would
 * add a request and a cache entry to save nothing.
 */
export function LayerMark({
  layer,
  size = 22,
  className,
}: {
  layer: Layer | undefined;
  size?: number;
  className?: string;
}) {
  if (!layer) return null;

  if (layer.logo) {
    return (
      <span
        className={`mark mark-logo${className ? ` ${className}` : ""}`}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a 22px local
            PNG; next/image would add a request and a cache entry to save nothing */}
        <img src={layer.logo} alt="" />
      </span>
    );
  }

  // A square box, the same size as the logo's disc, so a row of mixed marks
  // sits on one axis. Sized at 0.8 to match the logo's 76% inset optically.
  return (
    <span
      className={`mark mark-emoji${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.8) }}
      aria-hidden
    >
      {layer.emoji ?? "•"}
    </span>
  );
}
