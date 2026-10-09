// cockpit-attention.test.ts — the attention card's own rules as rendered markup: U-62's two-line
// project line (the narrow-card truncation fix of #856) and the card's half of U-53's dated
// amendment (the shared row interiors speak rem). The card's other lines — the work-order title's
// single-line truncate, the ask band — keep their own contracts and are pinned only as far as
// this rule touches them.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AttentionItem } from '../../api/queries';
import { CockpitAttentionRow } from './cockpit-attention';

const item: AttentionItem = {
  workOrderId: 'wo-1',
  number: 31,
  project: 'docket',
  repo: 'docket',
  title: 'Kullanıcı rolleri',
  kind: 'awaiting_human',
  stage: 'Hazırlık',
  since: 0,
};

const markup = (): string =>
  renderToStaticMarkup(
    createElement(CockpitAttentionRow, { item, ask: undefined, locale: 'tr', ageMs: 240_000, onOpen: () => {}, onAnswer: () => {} }),
  );

/** The card's project line — the span that carries `kod · proje / repo · aşama · yaş`. */
const projectLine = (html: string): string => {
  const at = html.indexOf('data-attention-line');
  if (at === -1) return '';
  const from = html.lastIndexOf('<span', at);
  const to = html.indexOf('>', at);
  return from === -1 || to === -1 ? '' : html.slice(from, to + 1);
};

describe('CockpitAttentionRow (U-62, U-53)', () => {
  it('U-62: the project line wraps and clamps at two lines — never a single-line truncate', () => {
    const html = markup();
    const line = projectLine(html);
    expect(line, 'the project line carries its audit hook').not.toBe('');
    expect(line).toContain('line-clamp-2');
    expect(line).toContain('[overflow-wrap:anywhere]');
    // The truncate grammar is gone from this line: it wraps, and the clamp owns the ellipsis.
    expect(line).not.toContain('whitespace-nowrap');
    expect(line).not.toContain('text-ellipsis');
  });

  it('U-62: the full line stays reachable through the title — the clamped case’s fallback', () => {
    const line = projectLine(markup());
    expect(line).toContain('title="İE-0031 · docket / docket · Hazırlık');
  });

  it('U-62: the second line’s space is reserved — a one-line and a two-line name render one card height', () => {
    const line = projectLine(markup());
    // Two of the line's own boxes as the card renders them: the preflight's inherited 1.5
    // leading × the 0.71875rem mono size × 2 = 34.5px = 2.15625rem, exact at every root scale.
    expect(line).toContain('min-h-[2.15625rem]');
  });

  it('U-53: the card’s interiors speak rem — no px type rides the row', () => {
    const html = markup();
    // The card's own tags — the badge the modals share keeps px until its own decision, so the
    // assertion walks the row's surfaces, not the badge child rendered inside it.
    const root = html.slice(0, html.indexOf('>'));
    expect(root).not.toMatch(/(?:text|p|py|px|m|gap|leading|max-w)-?(?:x|y)?-\[\d*\.?\d+px\]/);
    const line = projectLine(html);
    expect(line).not.toMatch(/(?:text|p|py|px|m|gap|leading|max-w)-?(?:x|y)?-\[\d*\.?\d+px\]/);
  });

  it('U-62: the card root names itself for the layout audit’s width walk', () => {
    expect(markup()).toContain('data-attention-card');
  });
});
