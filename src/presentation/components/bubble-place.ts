// components/bubble-place.ts — where the info bubble sits (U-27): below its trigger with an 8px
// gap, flipped above when below does not fit and above does, centred on the trigger and clamped
// 8px inside the bounds. Pure geometry over rectangles in one shared coordinate space.

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface BubbleSize {
  readonly width: number;
  readonly height: number;
}

export interface BubblePlacement {
  readonly side: 'below' | 'above';
  readonly left: number;
  readonly top: number;
  /** The arrow's centre, measured from the bubble's left edge. */
  readonly arrowLeft: number;
}

export const BUBBLE_GAP = 8;
export const BUBBLE_MARGIN = 8;

export const placeBubble = (anchor: Rect, size: BubbleSize, bounds: Rect): BubblePlacement => {
  const belowTop = anchor.top + anchor.height + BUBBLE_GAP;
  const aboveTop = anchor.top - BUBBLE_GAP - size.height;
  const fitsBelow = belowTop + size.height <= bounds.top + bounds.height - BUBBLE_MARGIN;
  const fitsAbove = aboveTop >= bounds.top + BUBBLE_MARGIN;
  const above = !fitsBelow && fitsAbove;

  const centre = anchor.left + anchor.width / 2;
  const minLeft = bounds.left + BUBBLE_MARGIN;
  const maxLeft = Math.max(minLeft, bounds.left + bounds.width - BUBBLE_MARGIN - size.width);
  const left = Math.min(Math.max(centre - size.width / 2, minLeft), maxLeft);

  return {
    side: above ? 'above' : 'below',
    left,
    top: above ? aboveTop : belowTop,
    arrowLeft: centre - left,
  };
};
