// components/detail-a11y.test.ts — the detail's accessibility contracts that live in the
// components' own source and in the token sheet: the inline dialog's trap (U-233, A3), the ⋯
// menu's keyboard model (U-234, A4), reduced-motion guards and control sizes (U-237, A9), and
// the contrast measurement of the tokens the screen pairs (U-240, A8) — the numbers the PR
// reports. Node environment: the bundler's raw imports and math, no DOM, no Node builtin — the
// presentation layer names none, tests included.
import { describe, expect, it } from 'vitest';

import { formatDurationMs, formatMoney, formatTokensCompact } from './detail-format';

const RAW = import.meta.glob(
  [
    './detail-dialog.tsx',
    './detail-row-menu.tsx',
    './detail-decision-card.tsx',
    './detail-strip.tsx',
    './detail-usage-line.tsx',
    '../screens/detail.tsx',
    '../screens/live.tsx',
    '../styles/tokens.css',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const source = (name: string): string => {
  const found = Object.entries(RAW).find(([path]) => path.endsWith(name));
  return found === undefined ? '' : found[1];
};

describe('the inline dialog trap (U-233, A3)', () => {
  it('U-233: the trap moves focus in on open, cycles Tab, closes on Esc and returns focus to the opener', () => {
    const dialog = source('detail-dialog.tsx');
    expect(dialog).toContain("event.key === 'Escape'");
    expect(dialog).toContain("event.key !== 'Tab'");
    expect(dialog).toContain('.focus()');
    // Focus moves to the first stop on open and back to the opener on close.
    expect(dialog).toContain('restore.current?.focus()');
    expect(dialog).toContain('stopsOf(holder.current)[0]');
    // The trap is a behaviour wrapper, not a modal: the page behind stays put.
    expect(dialog).not.toContain('aria-modal');
  });

  it('U-233: the reject box, the deploy confirmation and the close confirmation all sit inside traps', () => {
    const card = source('detail-decision-card.tsx');
    // The reject box: the trap is active exactly while the box is open.
    expect(card).toContain('<InlineDialog active={rejecting}');
    // The deploy form traps from the moment its card stands.
    expect(card).toContain('<InlineDialog active onClose');
    const screen = source('detail.tsx');
    // The close confirmation opens from two doors — the ⋯ menu and the failed card — one trap.
    expect(screen).toContain('<InlineDialog active onClose={() => setCloseConfirm(false)}>');
    expect(screen).toContain('data-detail-close');
    // The opening control keeps its accessible name: the menu button is labelled, and focus
    // returns to the very element that owns it.
    expect(source('detail-row-menu.tsx')).toContain('aria-label={t(locale, \'detail.menu.label\')}');
  });
});

describe('the ⋯ menu keyboard model (U-234, A4)', () => {
  it('U-234: haspopup and expansion are declared; the full menu key model is present', () => {
    const menu = source('detail-row-menu.tsx');
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain('aria-expanded={open}');
    expect(menu).toContain("event.key === 'ArrowDown'");
    expect(menu).toContain("event.key === 'ArrowUp'");
    expect(menu).toContain("event.key === 'Home'");
    expect(menu).toContain("event.key === 'End'");
    expect(menu).toContain("event.key === 'Escape'");
    expect(menu).toContain("event.key === 'Tab'");
    expect(menu).toContain("event.key === 'Enter'");
    // Esc restores focus to the button; Tab closes without moving focus back.
    expect(menu).toContain('buttonRef.current?.focus()');
    expect(menu).toContain('role="menu"');
    expect(menu).toContain('role="menuitem"');
  });
});

describe('targets and motion (U-237, A9)', () => {
  it('U-237: every animated cue is motion-safe and the snap yields under reduced motion', () => {
    // The strip's running dot and the pane's lamp pulse only when motion is allowed.
    expect(source('detail-strip.tsx')).toContain('motion-safe:animate-pulse');
    const live = source('live.tsx');
    expect(live).toContain('motion-safe:animate-pulse');
    // The stream's line snapping and the scroll helpers yield under prefers-reduced-motion.
    expect(live).toContain('motion-reduce:[scroll-snap-type:none]');
    const screen = source('detail.tsx');
    expect(screen).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
  });

  it('U-237: the zone\'s own actions are the 32 px tier; smaller icon controls carry a 32 px hit area', () => {
    const card = source('detail-decision-card.tsx');
    // Primary decisions render at md — the 2 rem (32 px) tier U-218 fixes.
    expect(card).toContain('variant="primary"');
    expect(card).toContain('size="md"');
    // The ⓘ estimate control is visually small but its grid cell is h-8 w-8 — 32 px square.
    expect(source('detail-usage-line.tsx')).toContain('grid h-8 w-8 place-items-center');
  });
});

describe('the formatters (U-229\'s voice)', () => {
  it('token counts read in the book\'s compact voice, both locales', () => {
    expect(formatTokensCompact('tr', 12_400)).toBe('12,4k');
    expect(formatTokensCompact('tr', 3_000)).toBe('3k');
    expect(formatTokensCompact('tr', 990)).toBe('990');
    expect(formatTokensCompact('en', 12_400)).toBe('12.4k');
    expect(formatTokensCompact('tr', 99_960)).toBe('100k');
  });

  it('money reads in the locale\'s currency, the estimate behind a tilde', () => {
    expect(formatMoney('tr', 1.42, false)).toBe('$1,42');
    expect(formatMoney('tr', 1.42, true)).toBe('≈$1,42');
    expect(formatMoney('en', 1.42, false)).toBe('$1.42');
  });

  it('durations read the bundle\'s words', () => {
    expect(formatDurationMs('tr', 43 * 60_000)).toBe('43 dk');
    expect(formatDurationMs('tr', 65 * 60_000)).toBe('1 sa 5 dk');
    expect(formatDurationMs('en', 43 * 60_000)).toBe('43 min');
  });
});

// --- U-240: the contrast measurement (A8) -----------------------------------------------------------------

const TOKENS_CSS = source('tokens.css');

/** The two themes' token maps, read off the sheet itself — the measurement measures what ships. */
const themeTokens = (): Readonly<Record<string, Readonly<Record<string, string>>>> => {
  const themes: Record<string, Record<string, string>> = { dark: {}, light: {} };
  const rootBlock = TOKENS_CSS.match(/:root\s*\{([^}]+)\}/)?.[1] ?? '';
  const lightBlock = TOKENS_CSS.match(/:root\[data-theme='light'\]\s*\{([^}]+)\}/)?.[1] ?? '';
  /** #000 and #000000 both normalise to the six-digit word the math reads. */
  const normalise = (hex: string): string =>
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const fill = (block: string, into: Record<string, string>): void => {
    for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
      into[match[1]] = normalise(match[2]);
    }
  };
  fill(rootBlock, themes.dark);
  fill(rootBlock, themes.light); // the light face re-declares its own deltas over the root
  fill(lightBlock, themes.light);
  return themes;
};

const CHANNEL = 255;
/** WCAG relative luminance of a #rrggbb word. */
const luminance = (hex: string): number => {
  const value = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(value.slice(at, at + 2), 16) / CHANNEL;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (foreHex: string, backHex: string): number => {
  const fore = luminance(foreHex);
  const back = luminance(backHex);
  return (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05);
};

describe('contrast (U-240, A8)', () => {
  const themes = themeTokens();

  /** Every text pair the detail reads, against every surface it sits on. */
  const TEXT_PAIRS: readonly (readonly [string, string[]])[] = [
    ['ink', ['bg', 'surface', 'raised', 'band']],
    ['dim', ['bg', 'surface', 'raised', 'band']],
    ['signal-soft', ['bg', 'surface', 'raised', 'band']],
    ['proceed', ['bg', 'surface', 'band']],
    ['error', ['bg', 'surface', 'band']],
    ['info', ['bg', 'surface', 'band']],
  ];

  it('U-240: text sits at 4.5:1 or better on every surface it is drawn on, in both themes', () => {
    expect(Object.keys(themes)).toEqual(['dark', 'light']);
    for (const [theme, tokens] of Object.entries(themes)) {
      for (const [word, surfaces] of TEXT_PAIRS) {
        for (const surface of surfaces) {
          const measured = ratio(tokens[word] ?? '', tokens[surface] ?? '');
          expect(
            measured,
            `${theme}: ${word} on ${surface} (${tokens[word]} on ${tokens[surface]})`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      // The primary button's own text on its amber fill.
      expect(ratio(tokens['signal-ink'], tokens.signal), `${theme}: signal-ink on signal`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('U-240: the state-carrying boundaries and the focus ring sit at 3:1 or better in dark; the light amber\'s shortfall is pinned as the finding', () => {
    // Dark: the focus ring and the pending-gate edge ride every surface at 3:1 or better. The
    // badges' 45 % tinted edges stay unmeasured by design — A6 makes them redundant cues; the
    // word carries the state, the edge only decorates it.
    const dark = themes.dark;
    for (const surface of ['bg', 'surface', 'raised', 'band']) {
      expect(ratio(dark.signal, dark[surface]), `dark: focus signal on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    // The strip's solid standing bars are boundaries of state, not decoration.
    expect(ratio(dark.proceed, dark.surface), 'dark: the done bar on surface').toBeGreaterThanOrEqual(3);
    expect(ratio(dark.signal, dark.surface), 'dark: a waiting dot on surface').toBeGreaterThanOrEqual(3);

    // Light: the sheet's light --signal (#f5b544 on the near-white surfaces) measures ≈1.74:1 —
    // the measured A8 finding this PR reports. The issue's clause allows only the amber TEXT
    // token to change, and the text token passes in both themes (the test above); darkening the
    // light ring would retune the primary fill and every lamp, an architect decision outside
    // #972. This assertion pins the number so the token fix must come here to turn it.
    const light = themes.light;
    expect(ratio(light['signal-soft'], light.surface), 'light: the amber TEXT token passes').toBeGreaterThanOrEqual(4.5);
    expect(ratio(light.signal, light.bg), 'light: the amber ring shortfall, pinned as the finding').toBeLessThan(3);
  });
});
