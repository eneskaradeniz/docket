// stores/search-palette.test.ts — the centered search palette's pure state (U-15): what the
// index covers (projects and repos by name, nothing else), how the query reshapes the results,
// and how the keyboard walks them. The component renders this module's decisions only.
import { describe, expect, it } from 'vitest';

import type { ProjectTree } from '../../api/queries';
import {
  CLOSED_PALETTE,
  SEARCH_HISTORY_KEY,
  SEARCH_HISTORY_LIMIT,
  clearSearches,
  diffRows,
  focusRestoredOnClose,
  paletteBody,
  paletteReducer,
  paletteRowId,
  parseHistory,
  readSearchHistory,
  recordSearch,
  removeSearch,
  searchTree,
  serializeHistory,
  settlesAtOnce,
  writeSearchHistory,
  type SearchHistory,
  type SearchHistoryPersistence,
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
    expect(paletteBody('', '', 0)).toBe('none');
    expect(paletteBody('   ', 'zzz', 0)).toBe('none');
    // The query alone decides: even a stray count cannot open a body under an empty input.
    expect(paletteBody('', '', 2)).toBe('none');
  });

  it('a settled query with results shows the list', () => {
    expect(paletteBody('odoo', 'odoo', 2)).toBe('results');
    expect(paletteBody(' odoo ', ' odoo ', 1)).toBe('results');
  });

  it('a settled query without results shows the no-results line', () => {
    expect(paletteBody('zzz', 'zzz', 0)).toBe('no-results');
  });

  it('a typed query still settling keeps the current standing — never a transient no-results', () => {
    // The first character over nothing settled: the body stays as it was — collapsed.
    expect(paletteBody('a', '', 0)).toBe('keep');
    // A later keystroke over a settled list: the previous rows stay while the new ones settle.
    expect(paletteBody('anteroX', 'antero', 7)).toBe('keep');
    // Pending means keep whatever the count is — the line never outlives its own query.
    expect(paletteBody('kadife', 'zzz', 0)).toBe('keep');
  });
});

describe('settlesAtOnce', () => {
  it('with nothing settled yet (just opened, or cleared) the next query settles without waiting', () => {
    expect(settlesAtOnce('')).toBe(true);
  });

  it('once any text has settled, later changes ride the debounce', () => {
    expect(settlesAtOnce('a')).toBe(false);
    expect(settlesAtOnce('antero')).toBe(false);
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

describe('recordSearch', () => {
  it('records a trimmed query at the top — the newest leads', () => {
    expect(recordSearch([], '  odoo  ')).toStrictEqual(['odoo']);
    expect(recordSearch(['odoo'], 'antero')).toStrictEqual(['antero', 'odoo']);
  });

  it('a query under two characters (after the trim) records nothing — the same list returns', () => {
    const history: SearchHistory = ['odoo'];
    expect(recordSearch(history, 'a')).toBe(history);
    expect(recordSearch(history, '  x  ')).toBe(history);
    expect(recordSearch(history, '   ')).toBe(history);
    expect(recordSearch([], '')).toStrictEqual([]);
  });

  it('a query is stored cut at sixty characters', () => {
    const [entry] = recordSearch([], 'a'.repeat(80));
    expect(entry).toBe('a'.repeat(60));
  });

  it('re-querying an entry moves it to the top instead of duplicating it — compared case-insensitively', () => {
    let history = recordSearch([], 'odoo');
    history = recordSearch(history, 'antero');
    history = recordSearch(history, 'ANTERO');
    expect(history).toStrictEqual(['ANTERO', 'odoo']);
  });

  it('holds ten; the eleventh record drops the oldest', () => {
    let history: SearchHistory = [];
    for (let i = 0; i < 11; i += 1) history = recordSearch(history, `q${i}`);
    expect(history).toHaveLength(SEARCH_HISTORY_LIMIT);
    expect(history[0]).toBe('q10');
    expect(history).not.toContain('q0');
  });
});

describe('removeSearch', () => {
  it('removes the query case-insensitively and keeps the rest in order', () => {
    expect(removeSearch(['odoo', 'Antero', 'api'], 'ANTERO')).toStrictEqual(['odoo', 'api']);
  });

  it('an unknown query removes nothing', () => {
    expect(removeSearch(['odoo'], 'zzz')).toStrictEqual(['odoo']);
  });
});

describe('clearSearches', () => {
  it('empties the list — Temizle owes no confirmation', () => {
    expect(clearSearches()).toStrictEqual([]);
  });
});

describe('serializeHistory / parseHistory', () => {
  it('round-trips what the record path builds', () => {
    const history = recordSearch(recordSearch([], 'odoo'), 'antero');
    expect(parseHistory(serializeHistory(history))).toStrictEqual(history);
  });

  it('writes at most the ten entries storage owes', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `q${i}`);
    expect(JSON.parse(serializeHistory(eleven))).toHaveLength(SEARCH_HISTORY_LIMIT);
  });

  it('null, blank and non-JSON garbage read as empty', () => {
    expect(parseHistory(null)).toStrictEqual([]);
    expect(parseHistory('')).toStrictEqual([]);
    expect(parseHistory('{oops')).toStrictEqual([]);
  });

  it('a JSON value that is not an array reads as empty', () => {
    expect(parseHistory('"odoo"')).toStrictEqual([]);
    expect(parseHistory('{"q":"odoo"}')).toStrictEqual([]);
    expect(parseHistory('42')).toStrictEqual([]);
  });

  it('drops non-strings and holds the rest to the record rules', () => {
    expect(parseHistory(JSON.stringify(['odoo', 7, null, {}, 'antero']))).toStrictEqual(['odoo', 'antero']);
  });

  it('drops blank and too-short strings and dedupes case-insensitively', () => {
    expect(parseHistory(JSON.stringify(['a', '  ', '', 'ODOO', 'odoo', 'antero']))).toStrictEqual(['ODOO', 'antero']);
  });

  it('caps length at sixty and count at ten', () => {
    const parsed = parseHistory(JSON.stringify(['b'.repeat(100), ...Array.from({ length: 14 }, (_, i) => `q${i}`)]));
    expect(parsed).toHaveLength(SEARCH_HISTORY_LIMIT);
    expect(parsed[0]).toBe('b'.repeat(60));
    expect(parsed).not.toContain('q9');
  });
});

describe('readSearchHistory / writeSearchHistory', () => {
  /** A map dressed as the storage slice the history persists through. */
  const mapPersistence = (map: Map<string, string>): SearchHistoryPersistence => ({
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  });

  it('writes and reads back through the one versioned key', () => {
    expect(SEARCH_HISTORY_KEY).toBe('docket.searchHistory.v1');
    const map = new Map<string, string>();
    const persistence = mapPersistence(map);
    writeSearchHistory(persistence, recordSearch([], 'odoo'));
    expect(map.get(SEARCH_HISTORY_KEY)).toBe(JSON.stringify(['odoo']));
    expect(readSearchHistory(persistence)).toStrictEqual(['odoo']);
  });

  it('a corrupt stored value reads as empty', () => {
    const persistence = mapPersistence(new Map([[SEARCH_HISTORY_KEY, 'nonsense']]));
    expect(readSearchHistory(persistence)).toStrictEqual([]);
  });

  it('a storage that throws reads as empty and never breaks a write', () => {
    const blocked: SearchHistoryPersistence = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readSearchHistory(blocked)).toStrictEqual([]);
    expect(() => writeSearchHistory(blocked, ['odoo'])).not.toThrow();
  });
});
