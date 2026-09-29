// stores/search-palette.test.ts — the centered search palette's pure state (U-15): what the
// index covers (projects and repos by name, nothing else), how the query reshapes the results,
// and how the keyboard walks them. The component renders this module's decisions only.
import { describe, expect, it } from 'vitest';

import type { ProjectTree } from '../../api/queries';
import { CLOSED_PALETTE, paletteBody, paletteReducer, searchTree } from './search-palette';

const TREE: ProjectTree = [
  {
    project: 'antero',
    name: 'Antero',
    mainRepo: 'antreo-docs',
    active: 3,
    running: 1,
    waiting: 0,
    status: 'running',
    repos: [
      { repo: 'antreo-docs', name: 'antreo-docs', main: true, active: 1, running: 0, waiting: 0, status: 'idle' },
      { repo: 'antreo-api', name: 'antreo-api', main: false, active: 2, running: 1, waiting: 0, status: 'running' },
    ],
  },
  {
    project: 'kadife-odoo',
    name: 'Kadife Odoo',
    mainRepo: 'kadife-odoo',
    active: 0,
    running: 0,
    waiting: 0,
    status: 'idle',
    repos: [{ repo: 'kadife-odoo', name: 'kadife-odoo', main: true, active: 0, running: 0, waiting: 0, status: 'idle' }],
  },
];

describe('searchTree', () => {
  it('matches projects and repos by name, case-insensitively, in the tree order', () => {
    expect(searchTree(TREE, 'odoo')).toStrictEqual([
      { kind: 'project', project: 'kadife-odoo', name: 'Kadife Odoo' },
      { kind: 'repo', project: 'kadife-odoo', repo: 'kadife-odoo', name: 'kadife-odoo' },
    ]);
    expect(searchTree(TREE, 'ANTREO-API')).toStrictEqual([
      { kind: 'repo', project: 'antero', repo: 'antreo-api', name: 'antreo-api' },
    ]);
  });

  it('an empty or blank query matches nothing — the palette never lists the whole tree', () => {
    expect(searchTree(TREE, '')).toStrictEqual([]);
    expect(searchTree(TREE, '   ')).toStrictEqual([]);
  });

  it('a query no name contains returns no results', () => {
    expect(searchTree(TREE, 'zzz')).toStrictEqual([]);
  });
});

describe('paletteBody', () => {
  it('an empty or blank query shows no body — the palette is the input row only', () => {
    expect(paletteBody('', 0)).toBe('none');
    expect(paletteBody('   ', 0)).toBe('none');
    // The query alone decides: even a stray count cannot open a body under an empty input.
    expect(paletteBody('', 2)).toBe('none');
  });

  it('a typed query with results shows the list', () => {
    expect(paletteBody('odoo', 2)).toBe('results');
    expect(paletteBody(' odoo ', 1)).toBe('results');
  });

  it('a typed query without results shows the no-results line', () => {
    expect(paletteBody('zzz', 0)).toBe('no-results');
  });
});

describe('paletteReducer', () => {
  it('open starts a fresh palette: open, empty query, no results, first row selected', () => {
    expect(paletteReducer(CLOSED_PALETTE, { type: 'open' })).toStrictEqual({
      open: true,
      query: '',
      results: [],
      selected: 0,
    });
  });

  it('open on an already-open palette keeps the typing — a stray ⌘K does not clear it', () => {
    const typed = paletteReducer(CLOSED_PALETTE, { type: 'open' });
    const withResults = paletteReducer(typed, { type: 'query', value: 'odoo', tree: TREE });
    expect(paletteReducer(withResults, { type: 'open' })).toStrictEqual(withResults);
  });

  it('close flips open off; a close on a closed palette changes nothing', () => {
    const opened = paletteReducer(paletteReducer(CLOSED_PALETTE, { type: 'open' }), {
      type: 'query',
      value: 'odoo',
      tree: TREE,
    });
    const closed = paletteReducer(opened, { type: 'close' });
    expect(closed.open).toBe(false);
    expect(paletteReducer(CLOSED_PALETTE, { type: 'close' })).toStrictEqual(CLOSED_PALETTE);
  });

  it('query recomputes the results over the tree and resets the selection to the first', () => {
    const opened = paletteReducer(CLOSED_PALETTE, { type: 'open' });
    const withResults = paletteReducer(opened, { type: 'query', value: 'odoo', tree: TREE });
    expect(withResults.results).toHaveLength(2);
    expect(withResults.selected).toBe(0);
    const moved = paletteReducer(withResults, { type: 'move', delta: 1 });
    const retyped = paletteReducer(moved, { type: 'query', value: 'kadife', tree: TREE });
    expect(retyped.selected).toBe(0);
    expect(retyped.results).toHaveLength(2);
  });

  it('move steps and wraps around both ends of the result list', () => {
    const opened = paletteReducer(paletteReducer(CLOSED_PALETTE, { type: 'open' }), {
      type: 'query',
      value: 'odoo',
      tree: TREE,
    });
    const down = paletteReducer(opened, { type: 'move', delta: 1 });
    expect(down.selected).toBe(1);
    const wrapped = paletteReducer(down, { type: 'move', delta: 1 });
    expect(wrapped.selected).toBe(0);
    const up = paletteReducer(wrapped, { type: 'move', delta: -1 });
    expect(up.selected).toBe(1);
  });

  it('move with no results stays put', () => {
    const opened = paletteReducer(paletteReducer(CLOSED_PALETTE, { type: 'open' }), {
      type: 'query',
      value: 'zzz',
      tree: TREE,
    });
    expect(paletteReducer(opened, { type: 'move', delta: 1 }).selected).toBe(0);
  });
});
