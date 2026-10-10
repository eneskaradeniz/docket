// stores/proposals.test.ts — U-137 (grouping), U-138 (counts, selection fallback), U-136 (the
// nav badge count), U-139 (scope names), U-143 (a decision that lands), U-144 (refusals), U-145
// (one decision in flight per proposal), U-146 (refresh triggers) and U-149 (list keys) over a
// scripted api and a fake focus signal.
import { describe, expect, it } from 'vitest';

import type { CommandResult } from '../../api/commands';
import type { ProposalDetailView, ProposalListItem, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import {
  createProposalsStore,
  effectiveSelection,
  moveSelection,
  proposalBadge,
  proposalCounts,
  proposalGroup,
  proposalScopeName,
  shownProposals,
} from './proposals';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };

const listItem = (id: string, patch: Partial<ProposalListItem> = {}): ProposalListItem => ({
  id,
  summary: `Öneri ${id}`,
  target: 'roles/test.yaml',
  scopeKind: 'global',
  status: 'pending',
  author: { kind: 'agent', label: 'planlayici' },
  createdAt: 1_700_000_000_000,
  ...patch,
});

const detailOf = (item: ProposalListItem, patch: Partial<ProposalDetailView> = {}): ProposalDetailView => ({
  ...item,
  before: 'a\n',
  after: 'b\n',
  lines: [
    { kind: 'remove', text: 'a' },
    { kind: 'add', text: 'b' },
  ],
  truncated: false,
  currentlyStale: false,
  ...patch,
});

interface Script {
  items: ProposalListItem[];
  stale: Set<string>;
  listFails: string | null;
  /** When set, the next list read waits for this promise before answering. */
  hold: Promise<void> | null;
  decide: (id: string, decision: string) => Promise<CommandResult>;
  queries: Query[];
  commands: unknown[];
}

const harness = (items: readonly ProposalListItem[]) => {
  const script: Script = {
    items: [...items],
    stale: new Set(),
    listFails: null,
    hold: null,
    decide: () => Promise.resolve({ ok: true }),
    queries: [],
    commands: [],
  };
  const focus = new Set<() => void>();
  const store = createProposalsStore({
    api: {
      query: async (query: Query) => {
        script.queries.push(query);
        if (query.type === 'proposals.list') {
          const snapshot = [...script.items];
          const gate = script.hold;
          script.hold = null;
          if (gate !== null) await gate;
          return script.listFails === null ? snapshot : { ok: false, code: script.listFails };
        }
        if (query.type === 'proposal.detail') {
          const item = script.items.find((row) => row.id === query.id);
          if (item === undefined) return { ok: false, code: 'not_found' };
          return detailOf(item, { currentlyStale: item.status === 'pending' && script.stale.has(item.id) });
        }
        if (query.type === 'project.tree') {
          return [{ project: 'antero', name: 'Antero', mainRepo: 'antero-api', repos: [{ repo: 'antero-api', name: 'Antero API', main: true }] }];
        }
        return null;
      },
      command: (_actor, command) => {
        script.commands.push(command);
        const c = command as { id: string; decision: string };
        return script.decide(c.id, c.decision);
      },
    },
    actor: ACTOR,
    focus: (listener) => {
      focus.add(listener);
      return () => focus.delete(listener);
    },
  });
  return { script, store, fire: () => focus.forEach((listener) => listener()) };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

const ready = async (items: readonly ProposalListItem[]): Promise<ReturnType<typeof harness>> => {
  const h = harness(items);
  await h.store.refresh();
  return h;
};

const MIXED: readonly ProposalListItem[] = [
  listItem('p1'),
  listItem('p2'),
  listItem('p3', { status: 'rejected' }),
  listItem('p4', { status: 'approved' }),
  listItem('p5', { status: 'stale' }),
];

describe('proposals store — grouping and counts (U-137, U-138)', () => {
  it('U-137: pending and current is Bekleyen, pending and stale is Bayat, approved and rejected are Karar verilen', async () => {
    const h = harness(MIXED);
    h.script.stale.add('p2');
    await h.store.refresh();
    const state = h.store.state();
    const group = (id: string) => proposalGroup(state, state.items.find((row) => row.id === id) ?? listItem(id));
    expect(group('p1')).toBe('pending');
    expect(group('p2')).toBe('stale');
    expect(group('p3')).toBe('decided');
    expect(group('p4')).toBe('decided');
    // A proposal the api already saved as stale is stale too.
    expect(group('p5')).toBe('stale');
  });

  it('U-137: the list comes from proposals.list and each pending proposal is read with proposal.detail for its staleness', async () => {
    const h = await ready(MIXED);
    expect(h.script.queries.filter((query) => query.type === 'proposals.list')).toHaveLength(1);
    const detailIds = h.script.queries.filter((query) => query.type === 'proposal.detail').map((query) => (query as { id: string }).id);
    expect(detailIds).toEqual(expect.arrayContaining(['p1', 'p2']));
  });

  it('U-138: the tab counts are the group sizes', async () => {
    const h = harness(MIXED);
    h.script.stale.add('p2');
    await h.store.refresh();
    expect(proposalCounts(h.store.state())).toEqual({ pending: 1, decided: 2, stale: 2 });
  });

  it('U-138: the first item of the shown tab is selected when the selection is not in it', async () => {
    const h = await ready(MIXED);
    expect(h.store.state().tab).toBe('pending');
    expect(effectiveSelection(h.store.state())).toBe('p1');
    h.store.select('p2');
    expect(effectiveSelection(h.store.state())).toBe('p2');
    h.store.setTab('decided');
    expect(shownProposals(h.store.state()).map((row) => row.id)).toEqual(['p3', 'p4']);
    expect(effectiveSelection(h.store.state())).toBe('p3');
  });

  it('U-138: an empty tab selects nothing', async () => {
    const h = await ready([listItem('p1')]);
    h.store.setTab('decided');
    expect(effectiveSelection(h.store.state())).toBeNull();
  });

  it('U-138: choosing an item or a tab reads the detail of what is now selected', async () => {
    const h = await ready(MIXED);
    h.store.setTab('decided');
    await flush();
    expect(h.store.state().details.p3?.id).toBe('p3');
  });

  it('U-136: the nav badge counts pending, non-stale proposals only', async () => {
    const h = harness(MIXED);
    h.script.stale.add('p2');
    await h.store.refresh();
    expect(proposalBadge(h.store.state())).toBe(1);
    expect(proposalBadge(harness([]).store.state())).toBe(0);
  });
});

describe('proposals store — scope names (U-139)', () => {
  it('U-139: global has no name; a project or repo resolves from project.tree; an unknown slug stays as the slug', async () => {
    const h = await ready([]);
    const state = h.store.state();
    expect(proposalScopeName(state, listItem('a'))).toBeNull();
    expect(proposalScopeName(state, listItem('a', { scopeKind: 'project', scopeId: 'antero' }))).toBe('Antero');
    expect(proposalScopeName(state, listItem('a', { scopeKind: 'repo', scopeId: 'antero-api' }))).toBe('Antero API');
    expect(proposalScopeName(state, listItem('a', { scopeKind: 'project', scopeId: 'bilinmeyen' }))).toBe('bilinmeyen');
  });
});

describe('proposals store — deciding (U-143, U-144, U-145)', () => {
  it('U-143: an approval sends proposal.decide, re-queries, switches to Karar verilen and selects the item', async () => {
    const h = await ready(MIXED);
    h.script.decide = async (id) => {
      h.script.items = h.script.items.map((row) => (row.id === id ? { ...row, status: 'approved' } : row));
      return { ok: true };
    };
    const before = h.script.queries.length;
    const result = await h.store.decide('p1', 'approved');
    expect(result).toEqual({ ok: true });
    expect(h.script.commands).toEqual([{ type: 'proposal.decide', id: 'p1', decision: 'approved' }]);
    const state = h.store.state();
    expect(state.tab).toBe('decided');
    expect(effectiveSelection(state)).toBe('p1');
    expect(state.details.p1?.status).toBe('approved');
    expect(h.script.queries.length).toBeGreaterThan(before);
    expect(state.note).toBeNull();
  });

  it('U-143: a rejection lands the same way', async () => {
    const h = await ready(MIXED);
    h.script.decide = async (id) => {
      h.script.items = h.script.items.map((row) => (row.id === id ? { ...row, status: 'rejected' } : row));
      return { ok: true };
    };
    await h.store.decide('p2', 'rejected');
    expect(h.store.state().tab).toBe('decided');
    expect(effectiveSelection(h.store.state())).toBe('p2');
  });

  it('U-144: a refusal keeps the tab and keeps its code for the note — never a blank state', async () => {
    const h = await ready(MIXED);
    h.script.decide = () => Promise.resolve({ ok: false, code: 'self_approval' });
    const result = await h.store.decide('p1', 'approved');
    expect(result).toEqual({ ok: false, code: 'self_approval' });
    const state = h.store.state();
    expect(state.tab).toBe('pending');
    expect(state.note).toBe('self_approval');
    expect(state.deciding).toEqual([]);
  });

  it('U-144: stale moves the item to Bayat and keeps it selected with the note', async () => {
    const h = await ready(MIXED);
    h.script.decide = async (id) => {
      h.script.items = h.script.items.map((row) => (row.id === id ? { ...row, status: 'stale' } : row));
      return { ok: false, code: 'stale' };
    };
    await h.store.decide('p1', 'approved');
    const state = h.store.state();
    expect(state.tab).toBe('stale');
    expect(effectiveSelection(state)).toBe('p1');
    expect(state.note).toBe('stale');
  });

  it('U-144: not_found re-reads the list and keeps the note', async () => {
    const h = await ready(MIXED);
    h.script.decide = async (id) => {
      h.script.items = h.script.items.filter((row) => row.id !== id);
      return { ok: false, code: 'not_found' };
    };
    await h.store.decide('p1', 'rejected');
    const state = h.store.state();
    expect(state.items.some((row) => row.id === 'p1')).toBe(false);
    expect(state.note).toBe('not_found');
    expect(effectiveSelection(state)).toBe('p2');
  });

  it('U-144: choosing another item or tab clears the note', async () => {
    const h = await ready(MIXED);
    h.script.decide = () => Promise.resolve({ ok: false, code: 'invalid_after' });
    await h.store.decide('p1', 'approved');
    expect(h.store.state().note).toBe('invalid_after');
    h.store.select('p2');
    expect(h.store.state().note).toBeNull();
  });

  it('U-145: a second click while a decision is in flight sends nothing', async () => {
    const h = await ready(MIXED);
    let release: (result: CommandResult) => void = () => undefined;
    h.script.decide = () => new Promise<CommandResult>((resolve) => (release = resolve));
    const first = h.store.decide('p1', 'approved');
    const second = await h.store.decide('p1', 'rejected');
    expect(second).toBeNull();
    expect(h.store.state().deciding).toEqual(['p1']);
    expect(h.script.commands).toHaveLength(1);
    release({ ok: true });
    await first;
    expect(h.store.state().deciding).toEqual([]);
  });

  it('U-145: a different proposal may be decided while one is in flight', async () => {
    const h = await ready(MIXED);
    h.script.decide = () => new Promise<CommandResult>(() => undefined);
    void h.store.decide('p1', 'approved');
    void h.store.decide('p2', 'rejected');
    await flush();
    expect(h.script.commands).toHaveLength(2);
  });
});

describe('proposals store — refresh (U-146)', () => {
  it('U-146: a window focus re-queries the list', async () => {
    const h = await ready(MIXED);
    const before = h.script.queries.filter((query) => query.type === 'proposals.list').length;
    h.fire();
    await flush();
    expect(h.script.queries.filter((query) => query.type === 'proposals.list').length).toBe(before + 1);
  });

  it('U-146: a refresh that fails after a list stands keeps the list; before the first list the failure shows', async () => {
    const h = await ready(MIXED);
    h.script.listFails = 'io_failed';
    await h.store.refresh();
    expect(h.store.state().items).toHaveLength(5);
    expect(h.store.state().failed).toBeNull();
    const cold = harness(MIXED);
    cold.script.listFails = 'io_failed';
    await cold.store.refresh();
    expect(cold.store.state().failed).toBe('io_failed');
    expect(cold.store.state().loaded).toBe(false);
  });

  it('U-146: a slower, older reply never overwrites a newer one', async () => {
    const h = harness([listItem('p1')]);
    let release: () => void = () => undefined;
    h.script.hold = new Promise<void>((resolve) => (release = resolve));
    const older = h.store.refresh();
    await flush();
    h.script.items = [listItem('p1'), listItem('p2')];
    await h.store.refresh();
    expect(h.store.state().items).toHaveLength(2);
    release();
    await older;
    expect(h.store.state().items).toHaveLength(2);
  });

  it('U-146: nothing re-queries by itself — no polling', async () => {
    const h = await ready(MIXED);
    const n = h.script.queries.length;
    await flush();
    expect(h.script.queries.length).toBe(n);
  });
});

describe('proposals store — list keys (U-149)', () => {
  it('U-149: ArrowDown and ArrowUp move the selection within the list and stop at its ends; Enter does nothing', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveSelection(ids, 'a', 'ArrowDown')).toBe('b');
    expect(moveSelection(ids, 'c', 'ArrowDown')).toBe('c');
    expect(moveSelection(ids, 'b', 'ArrowUp')).toBe('a');
    expect(moveSelection(ids, 'a', 'ArrowUp')).toBe('a');
    expect(moveSelection(ids, null, 'ArrowDown')).toBe('a');
    expect(moveSelection(ids, 'b', 'Enter')).toBeNull();
    expect(moveSelection([], null, 'ArrowDown')).toBeNull();
  });
});
