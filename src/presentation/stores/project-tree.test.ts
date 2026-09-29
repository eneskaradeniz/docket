// project-tree.test.ts — U-15: the sidebar's project → repo tree. The store mirrors the
// `project.tree` query, re-queries on the shell's change events, keeps the groups' expanded
// state for the session, cycles the sort mode through local persistence, and derives the row
// shapes and selection states the shell renders. Api, change signal, clock and persistence are
// injected fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { ProjectTree, ProjectTreeItem, Query, RepoNode } from '../../api/queries';
import {
  createProjectTreeStore,
  orderTree,
  pillCount,
  projectRows,
  treeSelection,
  type TreePlace,
} from './project-tree';
import type { ShellChange, ShellChangeSignal } from './shell';

const repoNode = (repo: string, overrides: Partial<RepoNode> = {}): RepoNode => ({
  repo,
  name: repo,
  main: false,
  active: 0,
  running: 0,
  waiting: 0,
  status: 'idle',
  ...overrides,
});

const projectItem = (project: string, name: string, repos: readonly RepoNode[]): ProjectTreeItem => ({
  project,
  name,
  mainRepo: repos[0]?.repo ?? '',
  repos,
  active: repos.reduce((sum, node) => sum + node.active, 0),
  running: repos.reduce((sum, node) => sum + node.running, 0),
  waiting: repos.reduce((sum, node) => sum + node.waiting, 0),
  status: repos.some((node) => node.status === 'waiting')
    ? 'waiting'
    : repos.some((node) => node.status === 'running')
      ? 'running'
      : 'idle',
});

/** The prototype's world, trimmed to what the rules read: Antero with six repos, plus flat rows. */
const world = (): ProjectTree => [
  projectItem('antero', 'Antero', [
    repoNode('antreo-docs', { main: true }),
    repoNode('antreo-api', { active: 3, running: 1, status: 'running' }),
    repoNode('antreo-mobile', { active: 2, waiting: 1, status: 'waiting' }),
    repoNode('antreo-web'),
    repoNode('antreo-devops', { active: 2, running: 2, status: 'running' }),
    repoNode('antreo-admin-web'),
  ]),
  projectItem('telerelay', 'telerelay', [repoNode('telerelay', { active: 1, running: 1, status: 'running' })]),
  projectItem('kadife-odoo', 'Kadife Odoo', [repoNode('kadife-odoo', { active: 2, waiting: 2, status: 'waiting' })]),
];

interface FakeTreeApi extends Pick<Api, 'query'> {
  readonly queries: Query[];
  setReply(reply: unknown): void;
}

const fakeTreeApi = (initial: unknown): FakeTreeApi => {
  const queries: Query[] = [];
  let reply: unknown = initial;
  return {
    queries,
    setReply: (next) => {
      reply = next;
    },
    query: (query) => {
      queries.push(query);
      return Promise.resolve(reply);
    },
  };
};

interface FakeSignal {
  readonly signal: ShellChangeSignal;
  emit(change: ShellChange): void;
}

const fakeSignal = (): FakeSignal => {
  const listeners: ((change: ShellChange) => void)[] = [];
  return {
    signal: (listener) => {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
  };
};

interface FakeClock {
  readonly now: () => number;
  tick(step: number): void;
}

const fakeClock = (): FakeClock => {
  let at = 1000;
  return {
    now: () => at,
    tick: (step) => {
      at += step;
    },
  };
};

interface FakePersistence {
  readonly storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  write(key: string, value: string): void;
}

const fakePersistence = (): FakePersistence => {
  const rows = new Map<string, string>();
  return {
    storage: {
      getItem: (key) => rows.get(key) ?? null,
      setItem: (key, value) => {
        rows.set(key, value);
      },
    },
    write: (key, value) => {
      rows.set(key, value);
    },
  };
};

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('project tree store', () => {
  it('U-15: the tree store is fed by the project.tree query', async () => {
    const api = fakeTreeApi(world());
    const store = createProjectTreeStore({
      api,
      changes: fakeSignal().signal,
      now: fakeClock().now,
      persistence: fakePersistence().storage,
    });

    expect(store.state().tree).toEqual([]);
    await store.load();
    expect(api.queries).toEqual([{ type: 'project.tree' }]);
    expect(store.state().tree.map((item) => item.project)).toEqual(['antero', 'telerelay', 'kadife-odoo']);
    expect(store.state().loading).toBe(false);
  });

  it('U-15: a multi-repo project renders a group, a single-repo project a flat row', () => {
    const rows = projectRows(world());
    expect(rows.map((row) => row.kind)).toEqual(['group', 'flat', 'flat']);
    expect(rows[0]?.item.repos.map((repo) => repo.repo)).toHaveLength(6);

    // An empty project list is a valid world: the rows are empty, the shell renders its hint.
    expect(projectRows([])).toEqual([]);
  });

  it('U-15: groups collapse and expand with the state kept for the session', async () => {
    const store = createProjectTreeStore({
      api: fakeTreeApi(world()),
      changes: fakeSignal().signal,
      now: fakeClock().now,
      persistence: fakePersistence().storage,
    });
    await store.load();

    // Groups start open — a fresh session shows every project's repos.
    expect(store.state().expanded).toEqual(['antero']);

    store.toggle('antero');
    expect(store.state().expanded).toEqual([]);

    store.toggle('antero');
    expect(store.state().expanded).toEqual(['antero']);

    // Collapsing one group leaves the others alone; a flat row has nothing to toggle.
    store.toggle('telerelay');
    expect(store.state().expanded).toEqual(['antero']);
  });

  it('U-15: the sort control cycles stored → A→Z → recently used, and the order follows', () => {
    const tree = [
      projectItem('kadife-odoo', 'Kadife Odoo', [repoNode('kadife-odoo')]),
      projectItem('antero', 'Antero', [repoNode('antreo-docs')]),
      projectItem('date-app', 'date-app', [repoNode('dateapp-api')]),
    ];
    const usedAt = { 'date-app': 30, antero: 20 };

    expect(orderTree(tree, 'stored', usedAt).map((item) => item.project)).toEqual([
      'kadife-odoo',
      'antero',
      'date-app',
    ]);
    // A→Z reads case-insensitively: Antero before date-app before Kadife Odoo.
    expect(orderTree(tree, 'alpha', usedAt).map((item) => item.project)).toEqual([
      'antero',
      'date-app',
      'kadife-odoo',
    ]);
    // Recently used first, a never-used project last in stored order.
    expect(orderTree(tree, 'recent', usedAt).map((item) => item.project)).toEqual([
      'date-app',
      'antero',
      'kadife-odoo',
    ]);
  });

  it('U-15: the sort choice persists locally and the store boots from it', async () => {
    const persistence = fakePersistence();
    const clock = fakeClock();
    const store = createProjectTreeStore({
      api: fakeTreeApi(world()),
      changes: fakeSignal().signal,
      now: clock.now,
      persistence: persistence.storage,
    });
    expect(store.state().sort).toBe('stored');

    store.cycleSort();
    expect(store.state().sort).toBe('alpha');
    expect(persistence.storage.getItem('docket.tree.sort')).toBe('alpha');

    const rebooted = createProjectTreeStore({
      api: fakeTreeApi(world()),
      changes: fakeSignal().signal,
      now: clock.now,
      persistence: persistence.storage,
    });
    expect(rebooted.state().sort).toBe('alpha');
  });

  it('U-15: the tree re-queries on the same change events the shell listens to', async () => {
    const api = fakeTreeApi(world());
    const emitter = fakeSignal();
    const store = createProjectTreeStore({
      api,
      changes: emitter.signal,
      now: fakeClock().now,
      persistence: fakePersistence().storage,
    });
    await store.load();
    expect(api.queries.length).toBe(1);

    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.length).toBe(2);

    // A run starting or ending moves the status dots, so it re-queries too.
    emitter.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();
    expect(api.queries.length).toBe(3);
  });

  it('U-15: a failed tree query keeps the previous tree', async () => {
    const api = fakeTreeApi(world());
    const store = createProjectTreeStore({
      api,
      changes: fakeSignal().signal,
      now: fakeClock().now,
      persistence: fakePersistence().storage,
    });
    await store.load();
    expect(store.state().tree).toHaveLength(3);

    api.setReply({ ok: false, code: 'not_found' });
    await store.load();
    expect(store.state().tree).toHaveLength(3);
    expect(store.state().problem).toBe('not_found');
    expect(store.state().loading).toBe(false);
  });

  it('U-15: recording use stamps a project for the recently-used order', async () => {
    const clock = fakeClock();
    const store = createProjectTreeStore({
      api: fakeTreeApi(world()),
      changes: fakeSignal().signal,
      now: clock.now,
      persistence: fakePersistence().storage,
    });

    clock.tick(10);
    store.recordUse('antero');
    clock.tick(5);
    store.recordUse('kadife-odoo');
    expect(store.state().usedAt).toEqual({ antero: 1010, 'kadife-odoo': 1015 });
  });

  it('U-15: a repo row keeps its project pale-selected while the repo is active', () => {
    const tree = world();
    // A repo row active → its project row reads pale-selected (psel), never fully selected.
    expect(treeSelection(tree, { kind: 'repo', repo: 'antreo-api' })).toEqual({
      project: { id: 'antero', state: 'psel' },
      repo: 'antreo-api',
    });
    // The main-repo row is a repo row like any other: it selects the board the same way.
    expect(treeSelection(tree, { kind: 'repo', repo: 'antreo-docs' })).toEqual({
      project: { id: 'antero', state: 'psel' },
      repo: 'antreo-docs',
    });
    // A flat project active on its board selects its own row fully.
    expect(treeSelection(tree, { kind: 'repo', repo: 'kadife-odoo' })).toEqual({
      project: { id: 'kadife-odoo', state: 'sel' },
      repo: 'kadife-odoo',
    });
  });

  it('U-15: the roadmap place selects its project row; every other place selects nothing', () => {
    const tree = world();
    expect(treeSelection(tree, { kind: 'roadmap', project: 'antero' })).toEqual({
      project: { id: 'antero', state: 'sel' },
      repo: null,
    });
    expect(treeSelection(tree, { kind: 'cockpit' })).toEqual({ project: null, repo: null });
    expect(treeSelection(tree, { kind: 'settings' })).toEqual({ project: null, repo: null });
    // A repo the tree does not know selects nothing rather than guessing a parent.
    expect(treeSelection(tree, { kind: 'repo', repo: 'ghost-repo' })).toEqual({ project: null, repo: null });
  });

  it('U-15: the shell places map onto the tree without mutating it', () => {
    const tree = world();
    const places: readonly TreePlace[] = [
      { kind: 'cockpit' },
      { kind: 'roadmap', project: 'antero' },
      { kind: 'repo', repo: 'antreo-api' },
      { kind: 'settings' },
    ];
    const before = JSON.stringify(tree);
    for (const place of places) treeSelection(tree, place);
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('tree sort', () => {
  it('U-15: cycling visits stored, alpha and recent in order and wraps', async () => {
    const store = createProjectTreeStore({
      api: fakeTreeApi(world()),
      changes: fakeSignal().signal,
      now: fakeClock().now,
      persistence: fakePersistence().storage,
    });
    expect(store.state().sort).toBe('stored');
    store.cycleSort();
    expect(store.state().sort).toBe('alpha');
    store.cycleSort();
    expect(store.state().sort).toBe('recent');
    store.cycleSort();
    expect(store.state().sort).toBe('stored');
  });
});

describe('tree pills', () => {
  it('U-10: a project pill is present only when active work orders exist — zero hides it', () => {
    expect(pillCount(0)).toBeNull();
    expect(pillCount(7)).toBe(7);
  });
});
