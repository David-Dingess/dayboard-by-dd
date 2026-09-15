/**
 * The PC panel's metric icons, and the three status shapes.
 *
 * Literals rather than a package: the board has no icon system and does not want
 * one for six glyphs — every other SVG here is an inline literal too. They are
 * drawn to the house idiom (a 16 viewBox, `stroke: currentColor`, 1.6 width,
 * round caps and joins), which is what `.video-watched svg` established.
 *
 * THE ICON SAYS WHICH METRIC. THE COLOUR SAYS HOW IT IS DOING. These never take
 * a status colour — overloading one channel with both is how a panel becomes
 * unreadable, and it is the one thing every reference monitor agrees on.
 *
 * The status shapes are the exception, and they are shapes on purpose: a circle,
 * a square and a triangle are told apart at 8px with no colour at all, which is
 * what keeps the strip legible for a red-green colourblind reader and in a
 * greyscale screenshot. Colour alone would fail WCAG 1.4.1.
 */

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
};

export function CpuIcon() {
  return (
    <svg {...base}>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M6.5 1.5v3M9.5 1.5v3M6.5 11.5v3M9.5 11.5v3M1.5 6.5h3M1.5 9.5h3M11.5 6.5h3M11.5 9.5h3" />
    </svg>
  );
}

export function GpuIcon() {
  return (
    <svg {...base}>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <circle cx="5.5" cy="8" r="1.8" />
      <path d="M10 6.5h2.5M10 9.5h2.5" />
    </svg>
  );
}

export function MemoryIcon() {
  return (
    <svg {...base}>
      <path d="M1.5 5h13v5.5h-2l-1 2h-2l-1-2h-1l-1 2h-2l-1-2h-2z" />
      <path d="M5 7v1.5M8 7v1.5M11 7v1.5" />
    </svg>
  );
}

export function NetworkIcon() {
  return (
    <svg {...base}>
      <rect x="5.5" y="10.5" width="5" height="4" rx="0.8" />
      <path d="M8 10.5v-2M3 8.5h10M3 8.5v2M13 8.5v2" />
      <path d="M5 4.5a4 4 0 0 1 6 0" />
    </svg>
  );
}

export function DriveIcon() {
  return (
    <svg {...base}>
      <rect x="1.5" y="4.5" width="13" height="7" rx="1.5" />
      <circle cx="11.5" cy="8" r="1.2" />
      <path d="M4 8h4" />
    </svg>
  );
}

export function FanIcon() {
  return (
    <svg {...base}>
      <circle cx="8" cy="8" r="1.4" />
      <path d="M8 6.6c0-2 .6-3.6 2.2-3.6 1.2 0 1.8 1.4.7 2.6L8 6.6z" />
      <path d="M9.4 8c2 0 3.6.6 3.6 2.2 0 1.2-1.4 1.8-2.6.7L9.4 8z" />
      <path d="M6.6 8c-2 0-3.6-.6-3.6-2.2C3 4.6 4.4 4 5.6 5.1L6.6 8z" />
      <path d="M8 9.4c0 2-.6 3.6-2.2 3.6-1.2 0-1.8-1.4-.7-2.6L8 9.4z" />
    </svg>
  );
}

/* --------------------------------------------------------- status shapes -- */

export function OkShape() {
  return (
    <svg {...base} width={13} height={13} strokeWidth={2}>
      <circle cx="8" cy="8" r="6.4" strokeWidth={1.6} />
      <path d="M5.2 8.2l2 2 3.6-4.2" />
    </svg>
  );
}

export function WarnShape() {
  return (
    <svg {...base} width={13} height={13}>
      <rect x="2" y="2" width="12" height="12" rx="1.6" />
      <path d="M8 5v4M8 11.2v.2" strokeWidth={2} />
    </svg>
  );
}

export function CritShape() {
  return (
    <svg {...base} width={13} height={13}>
      <path d="M8 1.8l6.4 11.4H1.6z" />
      <path d="M8 6.2v3.4M8 11.6v.2" strokeWidth={2} />
    </svg>
  );
}

/**
 * Three stacked bars of decreasing length — a ranked list, not a metric. Reads
 * as "the top few of something" and cannot be mistaken for MemoryIcon's chip.
 */
export function ProcessIcon() {
  return (
    <svg {...base}>
      <path d="M3 4.5h10" />
      <path d="M3 8h7" />
      <path d="M3 11.5h4" />
    </svg>
  );
}
