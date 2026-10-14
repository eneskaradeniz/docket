// settings-menu.test.ts — the menu's vertical budget (U-23 targets, U-46 window): the layout audit
// proved the 13th section ends outside the panel at the smallest supported window, so the sum of
// the menu's own heights is pinned here against the rail the window frame gives it. Every menu
// number comes from MENU_GEOMETRY; every frame number is parsed off window-frame.tsx's real
// classes, so a spacing change on either side re-runs the arithmetic instead of silently
// overflowing again. The environment numbers (root px, line-height, smallest window) are named
// because they are the browser's and the audit plan's, not this component's.
import { describe, expect, it } from 'vitest';

import { SETTINGS_MENU } from '../stores/settings-panel';
import { MENU_GEOMETRY } from './settings-menu';

const SOURCES = import.meta.glob(['./settings-menu.tsx', './window-frame.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const menuText = SOURCES['./settings-menu.tsx'] ?? '';
const frameText = SOURCES['./window-frame.tsx'] ?? '';

// The audit plan's smallest window: 1024×640 — the case that binds.
const SMALLEST_VIEWPORT_H = 640;
// The browser default the root clamp floors to below 1440px (tokens.css, U-53): 1rem = 16px.
const ROOT_PX = 16;
// Tailwind's preflight line-height; the menu rows set no leading of their own.
const LINE_HEIGHT = 1.5;
// The menu row's type: text-[0.8125rem].
const ROW_TEXT_REM = 0.8125;
// The layout floor every interactive target keeps (U-23 accessibility).
const MIN_TARGET_PX = 24;
// The slack the sum must keep, so rounding and a dot badge never tip it over.
const SLACK_PX = 4;

/** The rem steps the menu's spacing classes name, as their Tailwind suffixes. */
const UTILITY_OF_REM: ReadonlyArray<readonly [number, string]> = [
  [0.125, '0.5'],
  [0.25, '1'],
];

const utilityOf = (rem: number): string => {
  const hit = UTILITY_OF_REM.find(([step]) => step === rem)?.[1];
  expect(hit, `no known spacing utility for ${rem}rem`).toBeDefined();
  return hit ?? '';
};

const rowHeightPx = ROW_TEXT_REM * ROOT_PX * LINE_HEIGHT + 2 * MENU_GEOMETRY.rowPaddingYRem * ROOT_PX;

const menuHeightPx = (): number => {
  const sections = SETTINGS_MENU.flatMap((group) => group.sections);
  const boundaries = SETTINGS_MENU.length - 1;
  const inGroupGaps = SETTINGS_MENU.reduce((sum, group) => sum + group.sections.length - 1, 0);
  return (
    sections.length * rowHeightPx +
    (inGroupGaps + boundaries) * MENU_GEOMETRY.gapRem * ROOT_PX +
    boundaries * (2 * MENU_GEOMETRY.separatorRem * ROOT_PX + MENU_GEOMETRY.separatorBorderPx)
  );
};

/** The rail the frame hands the menu: the panel's inner height minus the nav's own paddings,
 *  border, the brand block and the gap below it — every number off the real class string. */
const railPx = (): number => {
  const nav = frameText.match(/<nav[^>]*className="([^"]*)"/)?.[1] ?? '';
  expect(nav, 'window-frame.tsx no longer carries the nav class string').toContain('gap-[18px]');
  const panelCap = Number(frameText.match(/max-h-\[calc\(100vh-(\d+)px\)\]/)?.[1]);
  const navGap = Number(nav.match(/gap-\[(\d+)px\]/)?.[1]);
  const navPadTop = Number(nav.match(/pt-\[(\d+)px\]/)?.[1]);
  const navPadBottom = Number(nav.match(/pb-(\d+)(?!\[)/)?.[1]) * 4;
  // The panel and the nav each draw one vertical border pixel.
  const bordersPx = 2;
  // BrandMark: the mark is h-[18px]; the word beside it inherits the base line box.
  const brandMarkPx = Number(frameText.match(/h-\[(\d+)px\] w-\[\d+px\]/)?.[1]);
  const brandPx = Math.max(brandMarkPx, ROOT_PX * LINE_HEIGHT);
  return SMALLEST_VIEWPORT_H - panelCap - bordersPx - navPadTop - navPadBottom - brandPx - navGap;
};

describe('settings menu fits the smallest window (U-46, U-23)', () => {
  it('the menu classes say exactly what MENU_GEOMETRY claims', () => {
    expect(menuText).toContain(`py-[${MENU_GEOMETRY.rowPaddingYRem}rem]`);
    expect(menuText).toContain(`gap-${utilityOf(MENU_GEOMETRY.gapRem)}`);
    expect(menuText).toMatch(new RegExp(`\\bmt-${utilityOf(MENU_GEOMETRY.separatorRem)}\\b`));
    expect(menuText).toMatch(new RegExp(`\\bpt-${utilityOf(MENU_GEOMETRY.separatorRem)}\\b`));
  });

  it('every row stays a 24px target after the tightening', () => {
    expect(rowHeightPx).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  });

  it('rows, gaps and separators together fit the rail with slack to spare', () => {
    expect(menuHeightPx()).toBeLessThanOrEqual(railPx() - SLACK_PX);
  });
});
