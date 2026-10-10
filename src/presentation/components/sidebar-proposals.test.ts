// sidebar-proposals.test.ts — U-136: the Öneriler nav row, its pending count and its route.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { START_NAV_HISTORY, navHistoryReducer, type NavRoute } from '../stores/nav-history';
import { SidebarNav } from './sidebar-nav';

const nav = (patch: { readonly proposalsCurrent?: boolean; readonly proposalsCount?: number; readonly locale?: 'tr' | 'en' } = {}): string =>
  renderToStaticMarkup(
    createElement(SidebarNav, {
      locale: patch.locale ?? 'tr',
      homeCurrent: false,
      searchCurrent: false,
      settingsSection: null,
      libraryCurrent: false,
      libraryCount: 0,
      proposalsCurrent: patch.proposalsCurrent ?? false,
      proposalsCount: patch.proposalsCount ?? 0,
      badge: null,
      onHome: () => undefined,
      onSearch: () => undefined,
      onLibrary: () => undefined,
      onProposals: () => undefined,
      onPhone: () => undefined,
      onSettings: () => undefined,
    }),
  );

describe('Öneriler nav row (U-136)', () => {
  it('U-136: the row "Öneriler" (en "Proposals") stands under Anasayfa', () => {
    const html = nav();
    expect(html).toContain('data-nav-proposals');
    expect(html.indexOf('Anasayfa')).toBeLessThan(html.indexOf('Öneriler'));
    expect(html.indexOf('Öneriler')).toBeLessThan(html.indexOf('>Ara<'));
    expect(nav({ locale: 'en' })).toContain('Proposals');
  });

  it('U-136: the pending count shows in a mono badge only above zero', () => {
    expect(nav({ proposalsCount: 0 })).not.toContain('data-proposals-badge');
    const html = nav({ proposalsCount: 3 });
    expect(html).toMatch(/data-proposals-badge[^>]*>3</);
    expect(html.slice(html.indexOf('data-proposals-badge'), html.indexOf('data-proposals-badge') + 250)).toContain('font-mono');
  });

  it('U-136: the row is current on the proposals route and not otherwise', () => {
    const row = (html: string): string => html.slice(html.indexOf('data-nav-proposals') - 300, html.indexOf('data-nav-proposals') + 100);
    expect(row(nav({ proposalsCurrent: true }))).toContain('aria-current="page"');
    expect(row(nav())).not.toContain('aria-current');
  });

  it('U-136: /proposals is a route of its own — pushed once, never doubled', () => {
    const route: NavRoute = { name: 'proposals' };
    const opened = navHistoryReducer(START_NAV_HISTORY, { type: 'push', route, scroll: 0 });
    expect(opened.entries[opened.index]?.route).toStrictEqual(route);
    expect(navHistoryReducer(opened, { type: 'push', route, scroll: 0 })).toBe(opened);
  });
});
