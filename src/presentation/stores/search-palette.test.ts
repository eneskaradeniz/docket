// stores/search-palette.test.ts — the centered search palette's pure state (U-15): what the
// index covers (projects and repos by name, nothing else), how the query reshapes the results,
// and how the keyboard walks them. The component renders this module's decisions only.
import { describe, expect, it } from 'vitest';

import type { ProjectTree } from '../../api/queries';
import {
  CLOSED_PALETTE,
  diffRows,
  focusRestoredOnClose,
  paletteBody,
  paletteReducer,
  paletteRowId,
  searchTree,
} from './search-palette';

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

describe('paletteRowId', () => {
  it('keys a row by its kind and target — a project and a repo may share a name', () => {
    const project = { kind: 'project', project: 'antero', name: 'Antero' } as const;
    const repo = { kind: 'repo', project: 'antero', repo: 'antero', name: 'Antero' } as const;
    expect(paletteRowId(project)).toBe('project:antero');
    expect(paletteRowId(repo)).toBe('repo:antero');
    expect(paletteRowId(project)).not.toBe(paletteRowId(repo));
  });
});

describe('diffRows', () => {
  // Rows for the diff cases, built directly — the diff is a list computation, not a search.
  const row = (id: string): { kind: 'project'; project: string; name: string } => ({
    kind: 'project',
    project: id,
    name: id,
  });
  const many = (ids: string[]): readonly { kind: 'project'; project: string; name: string }[] =>
    ids.map(row);

  it('identical lists stay whole: everything stays, nothing enters or leaves', () => {
    const list = many(['a', 'b', 'c']);
    expect(diffRows(list, many(['a', 'b', 'c']))).toStrictEqual({
      entering: [],
      staying: list,
      leaving: [],
    });
  });

  it('a narrowed list (20 → 5) keeps the five and sends fifteen away', () => {
    const twenty = many(Array.from({ length: 20 }, (_, i) => `r${i}`));
    const five = many(['r0', 'r5', 'r9', 'r14', 'r19']);
    const diff = diffRows(twenty, five);
    expect(diff.entering).toStrictEqual([]);
    expect(diff.staying).toStrictEqual(five);
    expect(diff.leaving).toStrictEqual(
      many(['r1', 'r2', 'r3', 'r4', 'r6', 'r7', 'r8', 'r10', 'r11', 'r12', 'r13', 'r15', 'r16', 'r17', 'r18']),
    );
  });

  it('disjoint lists swap the membership whole', () => {
    const before = many(['a', 'b']);
    const after = many(['x', 'y', 'z']);
    expect(diffRows(before, after)).toStrictEqual({ entering: after, staying: [], leaving: before });
  });

  it('an empty list growing shows every row as entering, in the next order', () => {
    const after = many(['a', 'b', 'c']);
    expect(diffRows([], after)).toStrictEqual({ entering: after, staying: [], leaving: [] });
  });

  it('a list emptied sends every row away', () => {
    const before = many(['a', 'b', 'c']);
    expect(diffRows(before, [])).toStrictEqual({ entering: [], staying: [], leaving: before });
  });

  it('staying keeps the next order even when the previous order differed', () => {
    const before = many(['b', 'a', 'c']);
    const after = many(['a', 'b', 'c']);
    expect(diffRows(before, after)).toStrictEqual({ entering: [], staying: after, leaving: [] });
  });
});

describe('focusRestoredOnClose', () => {
  it('a pointer-opened palette does not restore focus — the opener never asked for the keyboard', () => {
    expect(focusRestoredOnClose('pointer')).toBe(false);
  });

  it('a keyboard-opened palette (⌘K or key activation) restores focus to the opener', () => {
    expect(focusRestoredOnClose('keyboard')).toBe(true);
  });
});

describe('paletteReducer', () => {
  it('open starts a fresh palette: open, empty query, no results, first row selected', () => {
    expect(paletteReducer(CLOSED_PALETTE, { type: 'open', origin: 'keyboard' })).toStrictEqual({
      open: true,
      query: '',
      results: [],
      selected: 0,
      origin: 'keyboard',
    });
  });

  it('open carries how the palette was opened — the pointer origin is kept for the close', () => {
    const opened = paletteReducer(CLOSED_PALETTE, { type: 'open', origin: 'pointer' });
    expect(opened.origin).toBe('pointer');
  });

  it('open on an already-open palette keeps the typing — a stray ⌘K does not clear it', () => {
    const typed = paletteReducer(CLOSED_PALETTE, { type: 'open', origin: 'pointer' });
    const withResults = paletteReducer(typed, { type: 'query', value: 'odoo', tree: TREE });
    expect(paletteReducer(withResults, { type: 'open', origin: 'keyboard' })).toStrictEqual(withResults);
  });

  it('close flips open off and keeps the origin; a close on a closed palette changes nothing', () => {
    const opened = paletteReducer(paletteReducer(CLOSED_PALETTE, { type: 'open', origin: 'pointer' }), {
      type: 'query',
      value: 'odoo',
      tree: TREE,
    });
    const closed = paletteReducer(opened, { type: 'close' });
    expect(closed.open).toBe(false);
    expect(closed.origin).toBe('pointer');
    expect(paletteReducer(CLOSED_PALETTE, { type: 'close' })).toStrictEqual(CLOSED_PALETTE);
  });

  it('query recomputes the results over the tree and resets the selection to the first', () => {
    const opened = paletteReducer(CLOSED_PALETTE, { type: 'open', origin: 'keyboard' });
    const withResults = paletteReducer(opened, { type: 'query', value: 'odoo', tree: TREE });
    expect(withResults.results).toHaveLength(2);
    expect(withResults.selected).toBe(0);
    const moved = paletteReducer(withResults, { type: 'move', delta: 1 });
    const retyped = paletteReducer(moved, { type: 'query', value: 'kadife', tree: TREE });
    expect(retyped.selected).toBe(0);
    expect(retyped.results).toHaveLength(2);
  });

  it('move steps and wraps around both ends of the result list', () => {
    const opened = paletteReducer(paletteReducer(CLOSED_PALETTE, { type: 'open', origin: 'keyboard' }), {
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
    const opened = paletteReducer(paletteReducer(CLOSED_PALETTE, { type: 'open', origin: 'keyboard' }), {
      type: 'query',
      value: 'zzz',
      tree: TREE,
    });
    expect(paletteReducer(opened, { type: 'move', delta: 1 }).selected).toBe(0);
  });
});
