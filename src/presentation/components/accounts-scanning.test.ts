// components/accounts-scanning.test.ts — U-52 as markup: the one scanning surface the wizard's
// Hesaplar step and Settings → Hesaplar share. While a scan runs the toolbar reads its own word
// with an em-dash count and a disabled "Taranıyor…" button carrying a spinning icon, the note
// line and the thin indeterminate progress line sit under it, and six skeleton assistant groups
// — mark, dimmed name, one or two shimmering rows about the real size — hold the list's place;
// discovery reports no number, so nothing here ever shows one. The container is aria-busy, the
// end speaks "n hesap bulundu" politely, and the groups that land stagger in order (40 ms
// apart, 160 ms fade, 8 px rise) unless prefers-reduced-motion trades it for an immediate swap.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AccountsScanning, SCAN_STYLE_CSS, scanDoneLine, type AccountsScanningProps } from './accounts-scanning';
import { MOTION } from './motion';
import { SKELETON_STYLE_CSS } from './skeleton';

/** The body stands in for the screen's own list: it records the reveal the surface hands down. */
const body = (reveal: boolean) => createElement('div', { 'data-scan-body': '', 'data-reveal': String(reveal) });

const html = (props: Partial<AccountsScanningProps> = {}): string =>
  renderToStaticMarkup(
    createElement(AccountsScanning, {
      locale: 'tr',
      titleKey: 'accountGroups.scanned',
      scanning: false,
      onRescan: () => undefined,
      totals: { accounts: 3, assistants: 2 },
      now: () => 1_000,
      children: body,
      ...props,
    }),
  );

/** The markup without the mounted style sheets: copy assertions read what is shown, not CSS. */
const shown = (out: string): string => out.replace(/<style>[\s\S]*?<\/style>/g, '');

/** Only the text a reader or a screen reader meets — attributes are styling, not copy. */
const copy = (out: string): string => shown(out).replace(/<[^>]*>/g, '');

describe('AccountsScanning (U-52)', () => {
  it('U-52: a scan in flight shows six skeleton assistant groups — mark, dimmed name, one or two shimmering rows about the real size — under the line "Asistanlar ve hesaplar taranıyor…" with a thin indeterminate progress line, never a percentage or a counter', () => {
    const out = html({ scanning: true });
    expect(out).toContain('Asistanlar ve hesaplar taranıyor…');
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('animate-[scan_1s_linear_infinite]');
    // Indeterminate: no value attribute, and no percentage or counter in the copy.
    expect(shown(out)).not.toContain('aria-valuenow');
    expect(copy(out)).not.toMatch(/[%\d]/);
    // Six skeleton groups: three open with two rows each, three of one row behind the closed
    // failed shell — about the size of the real two-section list they stand in for.
    expect(out.match(/data-scan-skeleton-group/g)).toHaveLength(6);
    const failedAt = out.indexOf('data-scan-skeleton-section="failed"');
    expect(failedAt).toBeGreaterThan(-1);
    expect(out.slice(0, failedAt).match(/data-scan-skeleton-row/g)).toHaveLength(6);
    expect(out.slice(failedAt).match(/data-scan-skeleton-row/g)).toHaveLength(3);
    // The failed shell starts closed, as the real section does (U-45).
    expect(out.slice(failedAt)).toContain('<div hidden');
    // Each group head carries the mark box and the dimmed name; rows keep the real 56 px height.
    expect(out.match(/width:26px/g)).toHaveLength(6);
    expect(out.match(/width:96px/g)).toHaveLength(6);
    expect(out).toContain('min-h-[56px]');
    // The placeholder rows shimmer through the shared skeleton blocks, and the body waits.
    expect(out).toContain('data-skeleton-block');
    expect(out).not.toContain('data-scan-body');
  });

  it('U-52: the toolbar count reads "Taranan · —" and the button "Taranıyor…" — a spinning icon, disabled — until the scan ends', () => {
    const out = html({ scanning: true });
    expect(out).toContain('Taranan');
    expect(out).toContain('· —');
    expect(out).toContain('<button type="button" disabled');
    expect(out).toContain('Taranıyor…');
    expect(out).toContain('data-scan-spin');
    expect(out).toContain('rounded-full');
    const idle = html();
    expect(idle).toContain('3 hesap · 2 asistan');
    expect(idle).toContain('Yeniden tara');
    expect(idle).not.toContain('<button type="button" disabled');
    expect(idle).not.toContain('· —');
  });

  it('U-52: the container has aria-busy while scanning and the end announces "n hesap bulundu" politely', () => {
    expect(html({ scanning: true })).toContain('aria-busy="true"');
    const idle = html();
    expect(idle).not.toContain('aria-busy');
    expect(idle).toContain('role="status"');
    expect(idle).toContain('aria-live="polite"');
    expect(scanDoneLine('tr', 3)).toBe('3 hesap bulundu');
    expect(scanDoneLine('en', 3)).toBe('3 accounts found');
  });

  it('U-52: Settings → Hesaplar uses the same component — its own toolbar word rides the same scanning surface', () => {
    const out = html({ titleKey: 'accountGroups.added', scanning: true });
    expect(out).toContain('Eklenenler');
    expect(out).toContain('· —');
    expect(out.match(/data-scan-skeleton-group/g)).toHaveLength(6);
    expect(out).toContain('Taranıyor…');
  });

  it('U-52: the groups then appear in order, 40 ms apart, each fading in over 160 ms with an 8 px rise', () => {
    expect(MOTION.scan.staggerMs).toBe(40);
    expect(MOTION.scan.fadeMs).toBe(160);
    expect(MOTION.scan.risePx).toBe(8);
    expect(SCAN_STYLE_CSS).toContain('animation: docket-scan-group-in 160ms ease-out backwards');
    expect(SCAN_STYLE_CSS).toContain('from { opacity: 0; transform: translateY(8px); }');
    // The body is told a skeleton preceded it only after one did — a list that never scanned
    // mounts as it is, with no stagger to play.
    expect(html()).toContain('data-reveal="false"');
  });

  it('U-52: under prefers-reduced-motion there is no shimmer or rise — a static dim skeleton and an immediate swap', () => {
    const reduced = SCAN_STYLE_CSS.slice(SCAN_STYLE_CSS.indexOf('@media (prefers-reduced-motion'));
    expect(reduced).toContain('animation: none');
    const shimmerReduced = SKELETON_STYLE_CSS.slice(SKELETON_STYLE_CSS.indexOf('@media (prefers-reduced-motion'));
    expect(shimmerReduced).toContain('animation: none');
    // The indeterminate line stands still too.
    expect(html({ scanning: true })).toContain('motion-reduce:animate-none');
  });
});
