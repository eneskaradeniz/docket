// sidebar-frame.test.ts — U-51's frame half: the sidebar's own width and the nav rows' type
// scale. The grid column lives in its own module so the width is one named thing the shell
// renders and a test can read; the nav rows render for real against their markup.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SIDEBAR_GRID } from './sidebar-geometry';
import { SidebarNav } from './sidebar-nav';

describe('sidebar frame (U-51)', () => {
  it('U-51: the sidebar is 264 px wide at every window size', () => {
    expect(SIDEBAR_GRID).toBe('grid-cols-[264px_minmax(0,1fr)]');
  });

  it('U-51: the nav rows sit in the 13.5–14 px scale and the ⌘K hint holds 12 px', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarNav, {
        locale: 'tr',
        homeCurrent: false,
        searchCurrent: false,
        settingsSection: null,
        badge: null,
        onHome: () => undefined,
        onSearch: () => undefined,
        onPhone: () => undefined,
        onSettings: () => undefined,
      }),
    );
    expect(html).toContain('text-[13.5px]');
    expect(html).toContain('Anasayfa');
    expect(html).toMatch(/text-\[12px\][^>]*>⌘K|⌘K/);
    expect(html).not.toContain('text-[10.5px]');
  });
});
