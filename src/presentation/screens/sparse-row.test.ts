// sparse-row.test.ts — U-56's decision half: the sparse-row helper is pure and decides, from the
// item count, the row's measured width and the card minimum, whether the cards keep their natural
// minimum with a 1fr side panel beside them (the items fit on one line with room to spare) or the
// row fills itself (U-55's auto-fill minimum). The numbers below are the prototype's formula at
// the clamp's 100 % floor (1 rem = 16 px), where the audit's own windows sit; the binding half —
// the screens reaching for this helper, never a hand-tuned grid — lives in width-rules.test.ts.
import { describe, expect, it } from 'vitest';

import { ROW_CARD_MIN_REM, ROW_GAP_REM, sparseRowPlan } from './sparse-row';

const REM = 16;
const MIN = ROW_CARD_MIN_REM * REM;
const GAP = ROW_GAP_REM * REM;

describe('sparse row (U-56)', () => {
  it('U-56: items that fit on one line with room to spare keep their minimum and open the panel', () => {
    // A 2560-class row (2175 px): four cards of 340 with 16 px gaps take 1564, and the 611 px
    // leftover holds another full card — so the cards stay at their minimum, panel on.
    expect(sparseRowPlan(4, 2175, MIN, GAP)).toEqual({ columns: 4, panel: true });
    expect(sparseRowPlan(2, 1200, MIN, GAP)).toEqual({ columns: 2, panel: true });
    expect(sparseRowPlan(1, 900, MIN, GAP)).toEqual({ columns: 1, panel: true });
  });

  it('U-56: items that need more than one line fill the row themselves — no panel, no stretched card', () => {
    // A 968-class row holds two 340 px cards per line; five items wrap, so the row falls back to
    // the auto-fill grid and every card stretches to its track.
    expect(sparseRowPlan(5, 968, MIN, GAP)).toEqual({ columns: 2, panel: false });
    expect(sparseRowPlan(3, 716, MIN, GAP)).toEqual({ columns: 2, panel: false });
  });

  it('U-56: a leftover shorter than a full card minimum is not room to spare', () => {
    // Two cards in 700 px leave 4 px — not a panel's worth; one card in 679 px is 1 px short of
    // the 680 px that would leave a full second minimum. Both fill instead.
    expect(sparseRowPlan(2, 700, MIN, GAP)).toEqual({ columns: 2, panel: false });
    expect(sparseRowPlan(1, 679, MIN, GAP)).toEqual({ columns: 1, panel: false });
  });

  it('U-56: an empty or degenerate row never opens a panel', () => {
    expect(sparseRowPlan(0, 1200, MIN, GAP)).toEqual({ columns: 0, panel: false });
    // A row narrower than one card minimum: the fill grid owns the outcome, never a panel.
    expect(sparseRowPlan(2, 300, MIN, GAP)).toEqual({ columns: 0, panel: false });
  });
});
