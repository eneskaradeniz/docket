// rescan-button.test.ts — U-160, U-161: the one "Yeniden tara" control as markup. Right-aligned in
// its section's header row, with the age of the last scan beside it; while it runs only the icon
// turns, about its own centre — the button box never moves.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RescanButton, type RescanButtonProps } from './rescan-button';

const html = (props: Partial<RescanButtonProps> = {}): string =>
  renderToStaticMarkup(createElement(RescanButton, { locale: 'tr', busy: false, onRescan: () => undefined, ...props }));

/** The opening tag of the first button in the markup. */
const buttonTag = (out: string): string => /<button[^>]*>/.exec(out)?.[0] ?? '';

describe('RescanButton — idle (U-160)', () => {
  it('U-160: reads "Yeniden tara" with a refresh icon, as a small secondary button', () => {
    const out = html();
    expect(out).toContain('Yeniden tara');
    expect(out).toContain('<svg');
    expect(buttonTag(out)).toContain('type="button"');
    expect(buttonTag(out)).toContain('border-bord');
    expect(buttonTag(out)).not.toContain('border-transparent');
    expect(buttonTag(out)).not.toContain('text-inkdim');
    expect(buttonTag(out)).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(buttonTag(out)).not.toContain('aria-busy="true"');
  });

  it('U-160: the whole control sits right-aligned in the header row (ml-auto)', () => {
    expect(/^<div[^>]*class="[^"]*\bml-auto\b/.test(html())).toBe(true);
    expect(html({ variant: 'icon' }).startsWith('<button')).toBe(true);
  });

  it('U-160: once a scan exists, muted small text "Son tarama: 2 dakika önce" (the existing age formatter) stands beside the button; before one, none', () => {
    const none = html();
    expect(none).not.toContain('Son tarama');
    const out = html({ scannedAt: 0, now: 120_000 });
    expect(out).toMatch(/Son tarama: 2 dakika önce/);
    expect(out).toContain('text-inkdim');
    expect(out.indexOf('Son tarama')).toBeLessThan(out.indexOf('<button'));
    expect(html({ locale: 'en', scannedAt: 0, now: 120_000 })).toContain('Last scan: 2 minutes ago');
  });

  it('U-160: the click handler is the one the screen hands down; the english label reads "Scan again"', () => {
    expect(html({ locale: 'en' })).toContain('Scan again');
  });
});

describe('RescanButton — busy (U-161)', () => {
  it('U-161: while scanning the button stays, reads "Taranıyor…", is disabled and aria-busy', () => {
    const out = html({ busy: true });
    expect(out).toContain('<span>Taranıyor…</span>');
    expect(out).not.toContain('Yeniden tara');
    expect(buttonTag(out)).toMatch(/\sdisabled(=|\s|>)/);
    expect(buttonTag(out)).toContain('aria-busy="true"');
  });

  it('U-161: only the ICON turns — linear, 0.9 s, behind motion-safe — and the button box carries no rotation', () => {
    const out = html({ busy: true });
    const svg = /<svg[^>]*>/.exec(out)?.[0] ?? '';
    expect(svg).toContain('motion-safe:animate-spin');
    expect(svg).toContain('[animation-duration:0.9s]');
    expect(svg).toContain('origin-center');
    expect(buttonTag(out)).not.toContain('animate-spin');
    expect(buttonTag(out)).not.toContain('rotate');
    // Under reduced motion nothing turns: every spin class is gated, none stands bare.
    expect(out).not.toMatch(/(?<!motion-safe:)animate-spin/);
  });

  it('U-161: idle, nothing turns', () => {
    expect(html()).not.toContain('animate-spin');
  });

  it('U-161: the icon variant keeps no label — tooltip and aria-label "Yeniden tara" — and turns only its icon', () => {
    const idle = html({ variant: 'icon' });
    expect(buttonTag(idle)).toContain('aria-label="Yeniden tara"');
    expect(buttonTag(idle)).toContain('title="Yeniden tara"');
    expect(idle).not.toContain('<span>');
    const busy = html({ variant: 'icon', busy: true });
    expect(buttonTag(busy)).not.toContain('animate-spin');
    expect(/<svg[^>]*>/.exec(busy)?.[0]).toContain('motion-safe:animate-spin');
    expect(buttonTag(busy)).toContain('aria-busy="true"');
  });
});
