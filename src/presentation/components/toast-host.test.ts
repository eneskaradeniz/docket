// toast-host.test.ts — U-50: the one ToastHost's own markup. The host sits fixed at the top
// right sixteen pixels from the edges, newest toast first; each toast slides in from the right,
// announces itself politely (assertively for error), carries a close button whose label comes
// from the bundle, and drains a thin progress line over its own duration that pauses while the
// toast is hovered or focused. Colour rides only the existing tokens, and no other file in the
// layer draws toast markup of its own. U-50a adds the copy button a toast with a `copy` text
// carries — labelled from the bundle, with the raw code never rendered in the markup.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { COPIED_MS, ToastHost } from './toast-host';
import { createToastStore, type ToastInput } from '../stores/toasts';

/** A clock that never fires: the host test renders standings, not the passage of time. */
const stillClock = {
  now: () => 0,
  set: () => 0,
  clear: () => undefined,
};

const hostWith = (inputs: readonly ToastInput[]): string => {
  const store = createToastStore(stillClock);
  for (const input of inputs) store.toast(input);
  return renderToStaticMarkup(createElement(ToastHost, { store, locale: 'tr' }));
};

describe('ToastHost', () => {
  it('U-50: the host sits fixed at the top right, sixteen pixels from the edges, newest first', () => {
    const html = hostWith([
      { type: 'success', text: 'birinci' },
      { type: 'info', text: 'ikinci' },
    ]);
    expect(html).toContain('data-toast-host');
    expect(html).toContain('fixed');
    expect(html).toContain('top-4');
    expect(html).toContain('right-4');
    // The stack reads newest first: the second call sits above the first in the markup.
    expect(html.indexOf('ikinci')).toBeLessThan(html.indexOf('birinci'));
  });

  it('U-50: each toast announces itself politely, assertively for error', () => {
    for (const type of ['success', 'info', 'warn'] as const) {
      const html = hostWith([{ type, text: 'copy' }]);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
    }
    const error = hostWith([{ type: 'error', text: 'copy' }]);
    expect(error).toContain('role="alert"');
    expect(error).toContain('aria-live="assertive"');
  });

  it('U-50b: while the chat panel is open the stack steps left of it from lg up, and otherwise stays top right', () => {
    const store = createToastStore(stillClock);
    store.toast({ type: 'success', text: 'copy' });
    const beside = renderToStaticMarkup(createElement(ToastHost, { store, locale: 'tr', besideChat: true }));
    const alone = renderToStaticMarkup(createElement(ToastHost, { store, locale: 'tr' }));
    expect(beside).toContain('lg:right-[28rem]');
    expect(alone).not.toContain('lg:right-[28rem]');
    expect(alone).toContain('right-4');
  });

  it('U-50: each toast carries a close button labelled from the bundle', () => {
    const html = hostWith([{ type: 'success', text: 'copy' }]);
    expect(html).toContain('aria-label="Kapat"');
    expect((html.match(/<button/g) ?? [])).toHaveLength(1);
    const english = renderToStaticMarkup(
      createElement(ToastHost, {
        store: (() => {
          const store = createToastStore(stillClock);
          store.toast({ type: 'success', text: 'copy' });
          return store;
        })(),
        locale: 'en',
      }),
    );
    expect(english).toContain('aria-label="Dismiss"');
  });

  it('U-50: the thin progress line drains over the toast own duration and pauses on hover or focus', () => {
    const html = hostWith([
      { type: 'success', text: 'beş saniye' },
      { type: 'warn', text: 'sekiz saniye' },
    ]);
    expect(html).toContain('animation-duration:5000ms');
    expect(html).toContain('animation-duration:8000ms');
    expect(html).toContain('group-hover:[animation-play-state:paused]');
    expect(html).toContain('group-focus-within:[animation-play-state:paused]');
  });

  it('U-50: a toast slides in from the right', () => {
    const html = hostWith([{ type: 'info', text: 'copy' }]);
    expect(html).toContain('animate-[toast-in');
    expect(html).toContain('animate-[toast-drain');
  });

  it('U-50: only existing colour tokens ride a toast', () => {
    const expectations: ReadonlyArray<readonly ['success' | 'info' | 'warn' | 'error', readonly string[]]> = [
      ['success', ['text-proceed', 'bg-proceed']],
      ['info', ['text-info', 'bg-info']],
      // The book has no warn voice of its own: the amber signal token is the warn toast's colour.
      ['warn', ['text-signal', 'bg-signal', 'border-signal/45']],
      ['error', ['text-error', 'bg-error', 'border-error/45']],
    ];
    for (const [type, tokens] of expectations) {
      const html = hostWith([{ type, text: 'copy' }]);
      for (const token of tokens) expect(html).toContain(token);
      // No hand-mixed colour: everything rides a token utility, never a literal.
      expect(html).not.toContain('#');
      expect(html).not.toContain('rgb(');
    }
  });

  it('U-50: the host renders from a stable snapshot — repeated reads never look like a change', () => {
    const store = createToastStore(stillClock);
    store.toast({ type: 'success', text: 'copy' });
    // The getSnapshot contract the host's subscription rides on: the same stack reads as the
    // same reference, so a re-render never follows from reading alone.
    expect(store.state()).toBe(store.state());
    const first = renderToStaticMarkup(createElement(ToastHost, { store, locale: 'tr' }));
    const second = renderToStaticMarkup(createElement(ToastHost, { store, locale: 'tr' }));
    expect(second).toBe(first);
  });

  it('U-50: no screen draws its own toast — the only data-toast markup in the layer is the host', () => {
    const raw = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });
    const sources = raw as Readonly<Record<string, string>>;
    expect(Object.keys(sources).length).toBeGreaterThan(30);
    const drawing = Object.entries(sources)
      .filter(([, source]) => source.includes('data-toast'))
      .map(([file]) => file);
    expect(drawing).toEqual([expect.stringContaining('toast-host.tsx')]);
  });

  it("U-50a: a toast with copy shows the bundle's Kodu kopyala button, never the raw code in the markup", () => {
    const html = hostWith([{ type: 'error', text: 'İş emri güncellenemedi', copy: 'stale' }]);
    expect(html).toContain('Kodu kopyala');
    // The raw code lives only behind the button — the press hands it to the clipboard, so it
    // never appears in the rendered markup.
    expect(html).not.toContain('stale');
    const english = renderToStaticMarkup(
      createElement(ToastHost, {
        store: (() => {
          const store = createToastStore(stillClock);
          store.toast({ type: 'error', text: 'Could not update', copy: 'stale' });
          return store;
        })(),
        locale: 'en',
      }),
    );
    expect(english).toContain('Copy code');
  });

  it('U-50a: a toast without copy carries no copy button — the close button alone', () => {
    const html = hostWith([{ type: 'success', text: 'ok' }]);
    expect(html).not.toContain('Kodu kopyala');
    expect((html.match(/<button/g) ?? [])).toHaveLength(1);
  });

  it('U-50a: the copied confirmation holds two seconds', () => {
    expect(COPIED_MS).toBe(2000);
  });
});
