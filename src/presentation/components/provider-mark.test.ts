// provider-mark.test.ts — the account badge as markup: a known provider renders one inline SVG
// carrying its path verbatim in the row's text colour; every without-standing (null mark) renders
// the neutral rounded-square outline of the same size — never a letter, never a name. Both
// standings name their provider (`data-provider`) and the neutral glyph marks itself
// (`data-mark="neutral"`), the two hooks the layout audit's L-12 reads. Rendered through the
// static renderer, so the assertions read the real element tree.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MARK_SIZE, ProviderMark } from './provider-mark';
import type { ProviderMark as ProviderMarkValue } from '../stores/provider-marks';

const MARK: ProviderMarkValue = { viewBox: '0 0 24 24', path: 'M12 2 22 12 12 22 2 12Z', fillRule: 'evenodd' };

describe('ProviderMark', () => {
  it('renders the mark as one inline SVG in the current colour at the default size', () => {
    const html = renderToStaticMarkup(createElement(ProviderMark, { provider: 'codex', mark: MARK }));
    expect(html).toContain('data-provider-mark');
    expect(html).toContain('data-provider="codex"');
    // A drawn mark is not the neutral glyph — the marker belongs to the outline alone.
    expect(html).not.toContain('data-mark');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('fill-rule="evenodd"');
    expect(html).toContain('clip-rule="evenodd"');
    expect(html).toContain(`d="${MARK.path}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`width:${MARK_SIZE.default}px`);
    expect(html).toContain(`height:${MARK_SIZE.default}px`);
    // The mark is the whole badge — no letter, no name rides along.
    expect(/>[^<]+</.test(html)).toBe(false);
  });

  it('renders the dense size where the row is dense', () => {
    const html = renderToStaticMarkup(
      createElement(ProviderMark, { provider: 'codex', mark: MARK, size: MARK_SIZE.dense }),
    );
    expect(html).toContain(`width:${MARK_SIZE.dense}px`);
    expect(html).toContain(`height:${MARK_SIZE.dense}px`);
  });

  it('renders the neutral rounded-square outline for a null mark, at the same size', () => {
    const html = renderToStaticMarkup(createElement(ProviderMark, { provider: 'p-x', mark: null }));
    expect(html).toContain('data-provider-mark');
    expect(html).toContain('data-provider="p-x"');
    expect(html).toContain('data-mark="neutral"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('rounded-control');
    expect(html).toContain('border-[1.5px]');
    expect(html).toContain(`width:${MARK_SIZE.default}px`);
    // The neutral glyph is an empty outline — no letter, no vendor name.
    expect(html.includes('svg')).toBe(false);
    expect(/>[^<]+</.test(html)).toBe(false);
  });
});
