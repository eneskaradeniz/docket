// components/board-icons.tsx — the board header's and the columns' small glyphs: the same stroke
// grammar as the shell's icons (currentColor, round caps, decorative).
const SVG_PROPS = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  className: 'block h-3.5 w-3.5',
} as const;

export const PencilIcon = () => (
  <svg {...SVG_PROPS}>
    <path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.4 12.7 2 13.6l.9-3.4z" />
  </svg>
);

export const KanbanIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="2" y="2.5" width="3.2" height="11" rx=".8" />
    <rect x="6.4" y="2.5" width="3.2" height="7" rx=".8" />
    <rect x="10.8" y="2.5" width="3.2" height="9" rx=".8" />
  </svg>
);

export const ListIcon = () => (
  <svg {...SVG_PROPS}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
    <circle cx="2.6" cy="4" r=".6" fill="currentColor" />
    <circle cx="2.6" cy="8" r=".6" fill="currentColor" />
    <circle cx="2.6" cy="12" r=".6" fill="currentColor" />
  </svg>
);

/** Points left: a column folds toward its rail. */
export const FoldIcon = () => (
  <svg {...SVG_PROPS}>
    <path d="M10 4L6 8l4 4" />
  </svg>
);

/** Points down: a shut column opens from its rail. */
export const UnfoldIcon = () => (
  <svg {...SVG_PROPS}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);
