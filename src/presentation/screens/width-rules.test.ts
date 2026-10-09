// width-rules.test.ts — the U-53 … U-56 structural half of the width wave (#793): the root clamp
// and the no-override rule (U-53), the absent caps and the rem edge padding (U-54), the
// container-bound thresholds and the card-grid minimums (U-55), and the screens' structural
// binding to the sparse-row decision (U-56). The dynamic halves live elsewhere: the pure decision
// in sparse-row.test.ts, the measured fill and the scaled sidebar in e2e/layout-rules.mjs (L-1b,
// L-5a). The sources are read as raw text through Vite's ?raw glob — a presentation test may not
// touch the filesystem, and rendered markup cannot prove the absence of a class.
import { describe, expect, it } from 'vitest';

import { SIDEBAR_GRID } from '../components/sidebar-geometry';

const SOURCES = import.meta.glob(
  ['../**/*.ts', '../**/*.tsx', '../styles/tokens.css', '!../**/*.test.*'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const src = (name: string): string => {
  const hit = Object.entries(SOURCES).find(([path]) => path.endsWith(`/${name}`));
  if (hit === undefined) throw new Error(`source not globbed: ${name}`);
  return hit[1];
};

const DATA_SCREENS = ['cockpit.tsx', 'roadmap.tsx', 'account-view.tsx', 'detail.tsx'] as const;

describe('proportional scale (U-53)', () => {
  it('U-53: the scale is one CSS rule on the root — the clamp the prototype measured', () => {
    expect(src('tokens.css')).toContain(
      'html {\n  font-size: clamp(100%, calc(100% + (100vw - 1440px) * 0.003571), 125%);\n}',
    );
  });

  it('U-53: the unitless multiplier is a length factor — 16 px at 1440, ~17.7 px at 1920, 20 px at 2560', () => {
    const clamp = src('tokens.css').match(/calc\(100% \+ \(100vw - 1440px\) \* (\d+(?:\.\d+)?)\)/);
    if (clamp === null) throw new Error('root clamp not found in tokens.css');
    // 100 % resolves against the 16 px default, so the factor adds px: 0.003571 = 4 px / 1120 px.
    const rootAt = (viewport: number): number =>
      Math.min(20, Math.max(16, 16 + (viewport - 1440) * Number(clamp[1])));
    expect(rootAt(1440)).toBe(16);
    expect(rootAt(1920)).toBeCloseTo(17.7, 1);
    expect(rootAt(2560)).toBeCloseTo(20, 2);
  });

  it('U-53: no screen or component overrides the root font-size', () => {
    for (const [path, text] of Object.entries(SOURCES)) {
      if (path.endsWith('tokens.css')) continue; // the clamp's own home — pinned above
      expect(text, path).not.toMatch(/(^|\n)\s*(html|:root)\b[^{}]*\{[^}]*font-size/);
      // Reading the live scale (the sparse rows' rem→px) is fine; writing any font-size is not.
      expect(text, path).not.toMatch(/documentElement\.style\.fontSize|style\.fontSize\s*=/);
    }
  });

  it('U-53: the sidebar rides the scale — 16.5 rem, 264 px at 100 %, 330 px at 125 %', () => {
    expect(SIDEBAR_GRID).toBe('grid-cols-[16.5rem_minmax(0,1fr)]');
  });

  it('U-53: the data screens speak rem — the page h1 1.25 rem, the body line 0.8125 rem, no px type', () => {
    expect(src('cockpit.tsx')).toContain('text-[1.25rem]');
    expect(src('cockpit.tsx')).toContain('text-[0.8125rem]');
    for (const name of [...DATA_SCREENS, 'cockpit-skeleton.tsx']) {
      expect(src(name), name).not.toMatch(/text-\[\d*\.?\d+px\]/);
    }
  });

  it('U-53: the shared row interiors the width wave left px speak rem — buttons, cockpit rows, live panel', () => {
    // The dated amendment of #856: the action button, the cockpit's row interiors and the live
    // panel ride the scale. The badges the modals share (state pill, provider mark) keep px until
    // their own decision — the wizard and Settings still pass px sizes.
    const converted = [
      'action-button.tsx',
      'cockpit-attention.tsx',
      'cockpit-closed.tsx',
      'cockpit-projects.tsx',
      'cockpit-running.tsx',
      'cockpit-section.tsx',
      'cockpit-states.tsx',
      'live.tsx',
    ];
    for (const name of converted) {
      expect(src(name), name).not.toMatch(/text-\[\d*\.?\d+px\]/);
    }
    // The paddings and gaps those rows hand-type in px are gone too; Tailwind's own spacing
    // scale (px-3.5, gap-2 …) is rem already and may stay.
    for (const name of ['action-button.tsx', 'cockpit-closed.tsx', 'cockpit-projects.tsx', 'cockpit-running.tsx', 'live.tsx']) {
      expect(src(name), name).not.toMatch(/(?:p|m|gap|leading|max-w)-(?:x|y)?-\[\d*\.?\d+px\]/);
    }
  });
});

describe('full sections (U-54)', () => {
  it('U-54: the four data screens carry no max-w cap — their sections fill the main column', () => {
    for (const name of DATA_SCREENS) {
      expect(src(name), name).not.toContain('max-w-');
    }
  });

  it('U-54: the main column’s edge padding is a fixed rem measure', () => {
    expect(src('shell.tsx')).toContain('px-[1.375rem]');
    expect(src('shell.tsx')).toContain('py-[1.125rem]');
  });
});

describe('columnation on the main container (U-55)', () => {
  it('U-55: no viewport-bound breakpoint rides the data screens or their skeletons', () => {
    for (const name of [...DATA_SCREENS, 'cockpit-skeleton.tsx']) {
      expect(src(name), name).not.toMatch(/(?:min|max)-\[\d+px\]:/);
    }
  });

  it('U-55: the main element is the container the thresholds ride on', () => {
    expect(src('shell.tsx')).toContain('@container');
  });

  it('U-55: the detail’s live pane is the fixed 22.5 rem second column from ≥900; the runs column (21.25 rem) arrives at ≥1700', () => {
    const detail = src('detail.tsx');
    expect(detail).toContain('@[900px]:grid-cols-[minmax(0,1fr)_22.5rem]');
    expect(detail).toContain('@[1700px]:grid-cols-[minmax(0,1fr)_22.5rem_21.25rem]');
  });

  it('U-55: the account view columnates on the main container — one column below 900, two from ≥900', () => {
    expect(src('account-view.tsx')).toContain('@[900px]:grid-cols-[repeat(2,minmax(0,1fr))]');
  });

  it('U-55: card grids fill their row — 21.25 rem row cards, 22 rem project cards, 23.75 rem roadmap phases', () => {
    // The row cards' minimum lives with the sparse-row decision that sizes their fill grid.
    const sparseRow = src('sparse-row.ts');
    expect(sparseRow).toContain('ROW_CARD_MIN_REM = 21.25');
    expect(sparseRow).toContain('minmax(21.25rem,1fr)');
    expect(src('cockpit.tsx')).toContain('minmax(22rem,1fr)');
    expect(src('cockpit-skeleton.tsx')).toContain('minmax(21.25rem,1fr)');
    expect(src('roadmap.tsx')).toContain('minmax(23.75rem,1fr)');
  });
});

describe('sparse row → side panel (U-56)', () => {
  it('U-56: the cockpit binds its rows through the sparse helper, never a hand-tuned grid', () => {
    const cockpit = src('cockpit.tsx');
    expect(cockpit).toContain('useSparseRow(');
    expect(cockpit).not.toMatch(/grid-cols-\[repeat\(\d[,\d]/);
  });

  it('U-56: the account view is the fixed composition — the spanning band closes every row, no orphan column', () => {
    expect(src('account-view.tsx')).toContain('@[900px]:col-span-2');
  });
});
