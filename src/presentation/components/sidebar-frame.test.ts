// sidebar-frame.test.ts — U-51's frame half: the sidebar's own width and the nav rows' type
// scale. The grid column lives in its own module so the width is one named thing the shell
// renders and a test can read; the nav rows render for real against their markup. U-53 amends
// the fixed 264 px to 16.5 rem — the same 264 px at the clamp's 100 % floor, walking to 330 px
// at 125 %.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SIDEBAR_GRID } from './sidebar-geometry';
import { SidebarNav } from './sidebar-nav';

describe('sidebar frame (U-51)', () => {
  it('U-51: the sidebar is 264 px wide at every window size (U-53: 16.5 rem at the live scale)', () => {
    expect(SIDEBAR_GRID).toBe('grid-cols-[16.5rem_minmax(0,1fr)]');
  });

  it('U-51: the nav rows sit in the 13.5–14 px scale and the ⌘K hint holds 12 px', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarNav, {
        locale: 'tr',
        homeCurrent: false,
        searchCurrent: false,
        settingsSection: null,
        libraryCurrent: false,
        libraryCount: 0,
        badge: null,
        onHome: () => undefined,
        onSearch: () => undefined,
        onLibrary: () => undefined,
        onPhone: () => undefined,
        onSettings: () => undefined,
      }),
    );
    expect(html).toContain('text-[13.5px]');
    expect(html).toContain('Anasayfa');
    expect(html).toMatch(/text-\[12px\][^>]*>⌘K|⌘K/);
    expect(html).not.toContain('text-[10.5px]');
  });

  const nav = (patch: { readonly libraryCurrent?: boolean; readonly libraryCount?: number; readonly locale?: 'tr' | 'en' } = {}): string =>
    renderToStaticMarkup(
      createElement(SidebarNav, {
        locale: patch.locale ?? 'tr',
        homeCurrent: false,
        searchCurrent: false,
        settingsSection: null,
        libraryCurrent: patch.libraryCurrent ?? false,
        libraryCount: patch.libraryCount ?? 0,
        badge: null,
        onHome: () => undefined,
        onSearch: () => undefined,
        onLibrary: () => undefined,
        onPhone: () => undefined,
        onSettings: () => undefined,
      }),
    );

  it("U-84: the Artifact'lar row stands between Ara and Telefon", () => {
    const html = nav();
    const order = ['Anasayfa', 'Ara', 'Artifact&#x27;lar', 'Telefon', 'Ayarlar'].map((label) => html.indexOf(label));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('data-nav-library');
  });

  it('U-84: the row shows the total count in mono only when it is above zero', () => {
    expect(nav({ libraryCount: 0 })).not.toContain('data-library-count');
    const html = nav({ libraryCount: 7 });
    expect(html).toMatch(/data-library-count[^>]*>7</);
    expect(html.slice(html.indexOf('data-library-count') - 200, html.indexOf('data-library-count') + 200)).toContain('font-mono');
  });

  it('U-84: the row is current on the library route and not otherwise', () => {
    const on = nav({ libraryCurrent: true });
    const row = (html: string): string => html.slice(html.indexOf('data-nav-library') - 300, html.indexOf('data-nav-library') + 100);
    expect(row(on)).toContain('aria-current="page"');
    expect(row(nav())).not.toContain('aria-current');
  });
});
