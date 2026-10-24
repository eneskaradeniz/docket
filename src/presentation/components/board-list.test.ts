// board-list.test.ts — the list's half of U-369: a row whose run waits on a permission ask
// carries the same badge the card carries, and the table grows its İzin column only while some
// row asks — a board without asks keeps its four-column grid and shows no badge.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { KanbanCard, ListGroup } from '../stores/board';
import { BoardList } from './board-list';

const rowOf = (id: string, number: number, askSince?: number): KanbanCard => ({
  id,
  number,
  title: 'Fatura PDF’inde başlık satırı tekrarlanıyor',
  status: 'running',
  tone: 'running',
  ...(askSince === undefined ? {} : { askSince }),
});

const groupsOf = (rows: readonly KanbanCard[]): readonly ListGroup[] => [
  { key: 'stage:test', kind: 'stage', name: 'Test', rows, running: rows.length, waiting: 0, open: true },
];

const markup = (rows: readonly KanbanCard[]): string =>
  renderToStaticMarkup(
    createElement(BoardList, { groups: groupsOf(rows), locale: 'tr', onOpenWorkOrder: () => {}, onToggleGroup: () => {} }),
  );

describe('BoardList permission badge (U-369)', () => {
  it('U-369: a row with a pending ask carries the badge; the table grows its İzin column', () => {
    const html = markup([rowOf('wo-147', 147), rowOf('wo-148', 148, Date.now() - 12 * 60_000)]);
    expect(html).toContain('data-board-permission-badge');
    expect(html).toContain('İzin bekleniyor · 12 dk');
    // The header names the column; the asking row and the calm row share the five-column grid.
    expect(html).toContain('>İzin</span>');
    expect(html).toContain('grid-cols-[20px_72px_minmax(0,1fr)_auto_184px]');
  });

  it('U-369: no asks — the four-column grid stays and no badge renders', () => {
    const html = markup([rowOf('wo-147', 147)]);
    expect(html).not.toContain('data-board-permission-badge');
    expect(html).not.toContain('İzin bekleniyor');
    expect(html).not.toContain('>İzin</span>');
    expect(html).toContain('grid-cols-[20px_72px_minmax(0,1fr)_184px]');
  });

  it('U-369: a row without an ask inside an asking table renders an empty İzin cell', () => {
    const html = markup([rowOf('wo-148', 148, Date.now() - 34 * 60_000), rowOf('wo-147', 147)]);
    expect(html).toContain('İzin bekleniyor · 34 dk');
    expect(html).toContain('data-board-permission-badge="hot"');
    expect(html).toContain('İE-0147');
  });
});
