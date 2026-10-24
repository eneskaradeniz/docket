// board-card.test.ts — the card's half of U-369: a work order whose run waits on a permission
// ask carries the “İzin bekleniyor · N dk” badge beside its code, the status word stays as the
// status derives it, and a wait of 30 minutes or more renders the emphasised badge. A card
// without an ask carries no badge at all. The ask instants are placed relative to the render
// clock, so the floored minutes hold for the whole second the static markup takes.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { KanbanCard } from '../stores/board';
import { BoardCard } from './board-card';

const cardOf = (askSince?: number): KanbanCard => ({
  id: 'wo-2',
  number: 148,
  title: 'Fatura PDF’inde başlık satırı tekrarlanıyor',
  status: 'running',
  tone: 'running',
  ...(askSince === undefined ? {} : { askSince }),
});

const markup = (askSince?: number): string =>
  renderToStaticMarkup(createElement(BoardCard, { card: cardOf(askSince), locale: 'tr', onOpen: () => {} }));

describe('BoardCard permission badge (U-369)', () => {
  it('U-369: a pending ask carries the badge with whole minutes; the status word stays', () => {
    const html = markup(Date.now() - 12 * 60_000);
    expect(html).toContain('data-board-permission-badge');
    expect(html).toContain('İzin bekleniyor · 12 dk');
    expect(html).toContain('Koşuyor');
  });

  it('U-369: a card without an ask carries no badge', () => {
    expect(markup()).not.toContain('data-board-permission-badge');
    expect(markup()).not.toContain('İzin bekleniyor');
  });

  it('U-369: a wait of 30 minutes or more renders the emphasised badge', () => {
    const html = markup(Date.now() - 30 * 60_000);
    expect(html).toContain('İzin bekleniyor · 30 dk');
    expect(html).toContain('data-board-permission-badge="hot"');
  });

  it('U-369: under 30 minutes the badge stays calm', () => {
    const html = markup(Date.now() - 29 * 60_000 - 30_000);
    expect(html).toContain('İzin bekleniyor · 29 dk');
    expect(html).toContain('data-board-permission-badge=""');
  });
});
