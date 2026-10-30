// appearance-rows.test.ts — U-371 on the two rows the wizard's Hoş geldin and Settings → Görünüm
// share: Dil and Tema are segment controls, not listboxes — the options stand as buttons in a
// labelled group, the current one pressed, and a pressed segment is a neutral fill (bg-raised),
// never amber (U-373). The stores are the real ones over inert persistence.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { createLocaleStore } from '../stores/locale';
import { createThemeStore } from '../stores/theme';
import { AppearanceRows } from './appearance-rows';

const noop = (): void => undefined;

const rows = (): string =>
  renderToStaticMarkup(
    createElement(AppearanceRows, {
      locale: 'tr',
      localeStore: createLocaleStore({ getItem: () => null, setItem: noop }),
      themeStore: createThemeStore({ getItem: () => null, setItem: noop }, { prefersDark: () => false, subscribe: () => () => undefined }),
    }),
  );

describe('appearance rows', () => {
  it('U-371: Dil and Tema are segment groups whose options stand as buttons', () => {
    const out = rows();
    expect(out).toContain('aria-label="Dil"');
    expect(out).toContain('aria-label="Tema"');
    for (const text of ['Türkçe', 'English', 'Sistem', 'Koyu', 'Açık']) {
      expect(out).toContain(`>${text}<`);
    }
    expect(out).not.toContain('role="listbox"');
  });

  it('U-371: the current choice is the pressed segment, in a neutral fill — never amber', () => {
    const out = rows();
    // Türkçe and Sistem are the standing choices of the fresh stores.
    expect(out.match(/aria-pressed="true"/g)?.length).toBe(2);
    expect(out).toContain('bg-raised');
    expect(out).not.toMatch(/signal/);
  });
});
