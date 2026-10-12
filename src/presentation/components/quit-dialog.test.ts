// quit-dialog markup tests (U-295): the modal's copy, its list cap, its buttons and design tokens.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { QuitDialogView } from './quit-dialog';

const SOURCE = import.meta.glob('./quit-dialog.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const draw = (runs: readonly string[], chats: readonly string[], locale: 'tr' | 'en' = 'tr'): string =>
  renderToStaticMarkup(
    createElement(QuitDialogView, { state: { open: true, runs, chats }, locale, onCancel: () => undefined, onConfirm: () => undefined }),
  );

describe('quit dialog', () => {
  it('U-295: shows the exact copy from the bundle, the titles, and both buttons', () => {
    const html = draw(['Fatura raporu'], ['Önbellek']);
    expect(html).toContain('Docket kapatılsın mı?');
    expect(html).toContain('2 iş çalışıyor. Kapatırsan şunlar durdurulur:');
    expect(html).toContain('Fatura raporu');
    expect(html).toContain('Önbellek');
    expect(html).toContain('Durdurulan koşular iptal edilir, sonra devam ettirilebilir.');
    expect(html).toContain('Vazgeç');
    expect(html).toContain('Kapat ve durdur');
    expect(drawEnglish()).toContain('Quit Docket?');
  });

  const drawEnglish = (): string => draw(['A'], [], 'en');

  it('U-295: at most five titles, then the +N more line', () => {
    const html = draw(['1', '2', '3', '4', '5', '6', '7'], []);
    expect(html).toContain('+2 tane daha');
    expect(html).not.toContain('>6<');
  });

  it('U-295: Vazgeç is the outlined default, the stop button is the error-filled primary; radius tokens only', () => {
    const html = draw(['x'], []);
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
    const cancel = buttons.find((b) => b.includes('Vazgeç')) ?? '';
    const stop = buttons.find((b) => b.includes('Kapat ve durdur')) ?? '';
    expect(cancel).toContain('border-bord');
    expect(stop).toContain('bg-error');
    expect(html).toContain('rounded-panel');
    expect(html).not.toMatch(/rounded-(sm|md|lg|xl|2xl|full)\b|rounded-\[/);
  });

  it('U-295: the scrim is inert and Enter on the destructive button is swallowed', () => {
    const source = Object.values(SOURCE)[0] ?? '';
    expect(source).toContain('scrimCloses={false}');
    expect(source).toContain("event.key === 'Enter'");
  });

  it('U-295: nothing renders while closed', () => {
    const html = renderToStaticMarkup(
      createElement(QuitDialogView, { state: { open: false }, locale: 'tr', onCancel: () => undefined, onConfirm: () => undefined }),
    );
    expect(html).toBe('');
  });
});
