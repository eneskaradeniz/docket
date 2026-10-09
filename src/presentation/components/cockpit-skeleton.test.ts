// cockpit-skeleton.test.ts — the cockpit's loading composition as rendered markup (U-26): the
// sections mirror the standing the audit's slow walk loads — three open gates, three runs, five
// project cards, five closes — in the ready screen's own fill grids, and every block height is
// the text line's own box (the sans 1.366 and mono 1.3 normal line-height factors), so the
// content's arrival moves nothing the height audit can see.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CockpitSkeleton } from './cockpit-skeleton';

const markup = (): string => renderToStaticMarkup(createElement(CockpitSkeleton, { locale: 'tr' }));

describe('CockpitSkeleton (U-26)', () => {
  it('U-26: the composition is one status surface — the holder speaks, the shapes stay silent', () => {
    const html = markup();
    expect(html).toContain('data-skeleton=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Yükleniyor');
  });

  it('U-26: the rows mirror the seed\'s standing — three attention, three running, five project cards, five closed', () => {
    const html = markup();
    expect((html.match(/grid-cols-\[auto_minmax\(0,1fr\)_auto\]/g) ?? []).length).toBe(3);
    expect((html.match(/flex min-h-12 w-full/g) ?? []).length).toBe(3);
    expect((html.match(/grid min-w-0 gap-2 rounded-card/g) ?? []).length).toBe(5);
    expect((html.match(/\[grid-template-columns:auto_minmax\(0,1fr\)_auto_auto_auto\]/g) ?? []).length).toBe(5);
  });

  it('U-26: the rows ride the ready screen\'s own grids — the 21.25 rem fill twice, the 22 rem cards once', () => {
    const html = markup();
    expect((html.match(/minmax\(21\.25rem,1fr\)/g) ?? []).length).toBe(2);
    expect((html.match(/minmax\(22rem,1fr\)/g) ?? []).length).toBe(1);
  });

  it('U-26: every block sits at its text line\'s own box — the font metrics\' heights, not guesses', () => {
    const html = markup();
    // 14 px sans title lines (attention, project cards): 14 × 1.366.
    expect((html.match(/height:19\.12px/g) ?? []).length).toBe(8);
    // 13 px sans fold-head titles: 13 × 1.366.
    expect((html.match(/height:17\.76px/g) ?? []).length).toBe(3);
    // 12 px sans foot lines (project cards): 12 × 1.366.
    expect((html.match(/height:16\.39px/g) ?? []).length).toBe(5);
    // 11.5 px mono meta lines (attention): 11.5 × 1.3.
    expect((html.match(/height:14\.95px/g) ?? []).length).toBe(3);
    // The project card's leading-none 22 px number line, and the 18 px count pills.
    expect((html.match(/height:22px/g) ?? []).length).toBe(5);
    expect(html).toContain('height:18px');
  });

  it('U-26: the closed rows stand at the list\'s own 2.25 rem stance', () => {
    expect(markup()).toContain('min-h-9 ');
  });
});
