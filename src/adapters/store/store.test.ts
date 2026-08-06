import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, seedFixtureWorkOrders } from './index';
import { OBSERVED_TABLES } from './schema';
import { woid } from '../ids';
import { workOrderDocs, workspaces } from '../fixtures';
import { deriveWorkOrderCost } from '../../core/derive';

const dbPath = join(tmpdir(), `docket-store-${Date.now()}.db`);
const freshDbs: string[] = [];
const freshRoots: string[] = [];
let freshCounter = 0;
const freshDb = (): string => {
  const p = join(tmpdir(), `docket-store-c${process.pid}-${freshCounter++}.db`);
  freshDbs.push(p);
  return p;
};
// A throwaway decision-store root for createWorkOrder tests (where order.md is written to disk).
const freshRoot = (): string => {
  const p = join(tmpdir(), `docket-ds-${process.pid}-${freshCounter++}`);
  mkdirSync(p, { recursive: true });
  freshRoots.push(p);
  return p;
};
// A store whose fixture work orders + sessions are seeded (the six-state coverage). Production no longer
// seeds these (WO-0015); tests opt in explicitly.
const fixtureStore = () => {
  const store = createStore(freshDb());
  seedFixtureWorkOrders(store.db);
  return store;
};
afterAll(() => {
  if (existsSync(dbPath)) rmSync(dbPath);
  for (const p of freshDbs) if (existsSync(p)) rmSync(p);
  for (const p of freshRoots) if (existsSync(p)) rmSync(p, { recursive: true, force: true });
});

describe('SQLite store — seed + hydration', () => {
  it('seeds workspaces from fixtures but NOT work orders (board starts empty — WO-0015)', async () => {
    const store = createStore(freshDb());
    expect((await store.getWorkspaces()).length).toBe(workspaces.length);
    expect((await store.getWorkOrders()).length).toBe(0); // fixtures are test data, not production seed
  });

  it('re-opening an already-seeded DB does not duplicate workspaces (idempotent)', async () => {
    const p = freshDb();
    createStore(p);
    const store = createStore(p);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace').get() as { n: number }).n).toBe(workspaces.length);
  });

  it('hydrates a work order with DERIVED stage, tracks, sessions, sources', async () => {
    const store = fixtureStore();
    const wo = await store.getWorkOrder(woid('WO-1001'));
    expect(wo).toBeDefined();
    expect(wo!.stage).toBe('implementation'); // derived (deriveStage), not a stored column
    expect(wo!.tracks).toHaveLength(1);
    expect(wo!.sessions.some((s) => s.status === 'stopped_asking')).toBe(true);
  });

  it('serves document text from fixtures (never stored)', async () => {
    const store = fixtureStore();
    const docs = await store.getWorkOrderDocs(woid('WO-1001'));
    expect(docs.order).toBe(workOrderDocs[woid('WO-1001')].order);
  });
});

describe('SQLite store — reseed loses no decision, only time (ADR-0010)', () => {
  it('dropping every observed table + re-seeding preserves owned rows', async () => {
    const store = fixtureStore();
    const ownedBefore = (store.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n;
    // An owned decision: an extra session recorded for WO-1001 (a verifier session).
    store.db
      .prepare(
        'INSERT INTO session (work_order_id, role, scope_track_id, status, transcript, stop_and_ask) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('WO-1001', 'verifier', null, 'idle', JSON.stringify([]), null);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n).toBe(ownedBefore + 1);

    store.reseedObserved(); // drops + rebuilds every observed table (workspaces only); owned untouched

    // The owned session table is not part of the observed half — the extra verifier decision survived.
    const ownedAfter = (store.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n;
    expect(ownedAfter).toBe(ownedBefore + 1);
  });
});

describe('SQLite store — seeding respects the observed | owned split (verifier block B)', () => {
  it('C1: a workspace-populated, work-order-empty DB (the WO-0015 default) re-opens without re-seeding', () => {
    const p = freshDb();
    createStore(p); // seeds workspaces only; work_order empty by design
    // The work_order half is observed/discardable — losing it must not crash or trigger a re-seed.
    createStore(p).db.exec('DELETE FROM work_order');
    const store = createStore(p);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace').get() as { n: number }).n).toBe(workspaces.length);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM work_order').get() as { n: number }).n).toBe(0);
  });

  it('C2: observed empty, owned populated — re-open rebuilds observed (workspaces) without duplicating owned', async () => {
    const p = freshDb();
    const store0 = createStore(p); // workspaces seeded; WOs empty
    seedFixtureWorkOrders(store0.db); // test data
    // Record an owned decision, then drop observed, leaving owned populated.
    store0.db
      .prepare(
        'INSERT INTO session (work_order_id, role, scope_track_id, status, transcript, stop_and_ask) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('WO-1001', 'verifier', null, 'idle', JSON.stringify([]), null);
    const ownedBefore = (store0.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n;
    for (const t of OBSERVED_TABLES) store0.db.exec(`DELETE FROM ${t}`);

    // Re-open: observed empty (workspace 0) → seedObserved rebuilds workspaces; owned untouched.
    const store = createStore(p);
    const ownedAfter = (store.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n;
    expect(ownedAfter).toBe(ownedBefore); // owned survived, not duplicated
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace').get() as { n: number }).n).toBe(workspaces.length);
    // Work orders are not auto-restored (operator-created in production; fixtures are test data).
    expect((await store.getWorkOrders()).length).toBe(0);
  });
});

describe('SQLite store — live session persistence (WO-0010)', () => {
  it('recordSession upserts by provider id (no duplicate) and hydrates providerSessionId/status', async () => {
    const store = fixtureStore();
    const id = woid('WO-1001');
    store.recordSession({ providerSessionId: 'sess-A', workOrderId: id, role: 'implementer', status: 'running' });
    store.recordSession({ providerSessionId: 'sess-A', workOrderId: id, role: 'implementer', status: 'stopped_asking' });
    store.recordSession({ providerSessionId: 'sess-A', workOrderId: id, role: 'implementer', status: 'idle', cost: { tokensIn: 5, tokensOut: 6, usd: 0.2 } });

    const wo = await store.getWorkOrder(id);
    const live = wo!.sessions.find((s) => s.providerSessionId === 'sess-A');
    expect(live).toBeDefined();
    expect(live!.status).toBe('idle');
    expect(live!.role).toBe('implementer');
    const n = (store.db.prepare('SELECT COUNT(*) AS n FROM session WHERE provider_session_id = ?').get('sess-A') as { n: number }).n;
    expect(n).toBe(1); // upsert — never duplicated
  });

  it('a persisted session survives a reopen (resume-by-id is reachable)', async () => {
    const p = freshDb();
    seedFixtureWorkOrders(createStore(p).db); // WO-1001 must exist for the session to hydrate against
    createStore(p).recordSession({ providerSessionId: 'sess-B', workOrderId: woid('WO-1001'), role: 'implementer', status: 'idle', cost: { tokensIn: 9, tokensOut: 9, usd: 0.9 } });
    const wo = await createStore(p).getWorkOrder(woid('WO-1001'));
    expect(wo!.sessions.some((s) => s.providerSessionId === 'sess-B' && s.status === 'idle')).toBe(true);
  });

  it('migrates a pre-WO-0010 DB: adds provider_session_id + cost columns, keeps existing rows', () => {
    const p = freshDb();
    const raw = new DatabaseSync(p);
    raw.exec(
      'CREATE TABLE session (id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id TEXT NOT NULL, role TEXT NOT NULL, scope_track_id TEXT, status TEXT NOT NULL, transcript TEXT NOT NULL, stop_and_ask TEXT)',
    );
    raw.prepare('INSERT INTO session (work_order_id, role, status, transcript) VALUES (?,?,?,?)').run('WO-1001', 'implementer', 'idle', '[]');
    raw.close();

    const store = createStore(p); // migrate adds the new columns; the row is owned, so it survives
    const cols = (store.db.prepare('PRAGMA table_info(session)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('provider_session_id');
    expect(cols).toContain('cost_usd');
    const n = (store.db.prepare('SELECT COUNT(*) AS n FROM session WHERE work_order_id = ?').get('WO-1001') as { n: number }).n;
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe('SQLite store — per-WO cost derived from session rows (WO-0011)', () => {
  it('hydrates a recorded session cost onto the SessionRef', async () => {
    const store = fixtureStore();
    store.recordSession({
      providerSessionId: 'sess-cost', workOrderId: woid('WO-1001'), role: 'architect', status: 'idle',
      cost: { tokensIn: 7, tokensOut: 8, usd: 0.42 },
    });
    const wo = await store.getWorkOrder(woid('WO-1001'));
    const live = wo!.sessions.find((s) => s.providerSessionId === 'sess-cost');
    expect(live).toBeDefined();
    expect(live!.cost).toEqual({ tokensIn: 7, tokensOut: 8, usd: 0.42 });
  });

  it("derives a work order's cost from its session rows, not the inert work_order columns", async () => {
    const store = fixtureStore();
    const id = woid('WO-1001');
    // The work_order cost columns are inert (seeded 0) — cost must not be read from them.
    const inert = store.db.prepare('SELECT cost_usd AS v FROM work_order WHERE id = ?').get(id) as { v: number };
    expect(inert.v).toBe(0);
    store.recordSession({
      providerSessionId: 'sess-agg', workOrderId: id, role: 'verifier', status: 'idle',
      cost: { tokensIn: 3, tokensOut: 4, usd: 0.1 },
    });
    const wo = await store.getWorkOrder(id);
    // The recorded session's cost is in the aggregate, so wo.cost.usd > 0 despite the inert column.
    expect(wo!.cost.usd).toBeGreaterThanOrEqual(0.1);
    // And the aggregate is the derivation over the hydrated sessions (regression guard on hydrate).
    expect(wo!.cost).toEqual(deriveWorkOrderCost(wo!.sessions));
  });
});

describe('SQLite store — workspace CRUD (WO-0014)', () => {
  it('createWorkspace persists definition + connection and survives reopen', async () => {
    const p = freshDb();
    const ws = await createStore(p).createWorkspace({
      label: 'Test Project',
      repos: [{ path: '/tmp/api' }, { path: '/tmp/mobile' }],
    });
    expect(ws.label).toBe('Test Project');
    expect(ws.repos).toHaveLength(2);
    const reopened = await createStore(p).getWorkspaces();
    expect(reopened.some((w) => w.label === 'Test Project')).toBe(true);
  });

  it('connection rows survive reseedObserved (ADR-0010 contract extended to connection)', () => {
    const p = freshDb();
    const store = createStore(p);
    store.createWorkspace({ label: 'Survivor', repos: [{ path: '/tmp/repo' }] });
    const before = (store.db.prepare('SELECT COUNT(*) AS n FROM connection').get() as { n: number }).n;
    expect(before).toBeGreaterThan(0);
    store.reseedObserved();
    const after = (store.db.prepare('SELECT COUNT(*) AS n FROM connection').get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it('deleteWorkspace removes definition + connection rows', async () => {
    const p = freshDb();
    const store = createStore(p);
    const ws = await store.createWorkspace({ label: 'ToRemove', repos: [{ path: '/tmp/x' }] });
    store.deleteWorkspace(ws.id);
    const n = (store.db.prepare('SELECT COUNT(*) AS n FROM workspace WHERE id = ?').get(ws.id) as { n: number }).n;
    expect(n).toBe(0);
  });

  it('addRepoConnection + removeRepoConnection round-trip', async () => {
    const p = freshDb();
    const store = createStore(p);
    const ws = await store.createWorkspace({ label: 'Repos', repos: [{ path: '/tmp/a' }] });
    store.addRepoConnection(ws.id, { path: '/tmp/b' });
    const ws2 = await store.getWorkspaces();
    expect(ws2.find((w) => w.id === ws.id)!.repos).toHaveLength(2);
    store.removeRepoConnection(ws.id, '/tmp/b');
    const ws3 = await store.getWorkspaces();
    expect(ws3.find((w) => w.id === ws.id)!.repos).toHaveLength(1);
  });

  it('updateWorkspace renames label + sets decision store', async () => {
    const p = freshDb();
    const store = createStore(p);
    const ws = await store.createWorkspace({ label: 'OldName', repos: [{ path: '/tmp/a' }, { path: '/tmp/b' }] });
    store.updateWorkspace(ws.id, { label: 'NewName', decisionStorePath: '/tmp/b' });
    const ws2 = await store.getWorkspaces();
    const found = ws2.find((w) => w.id === ws.id)!;
    expect(found.label).toBe('NewName');
  });
});

describe('SQLite store — work-order creation (WO-0015)', () => {
  // A workspace whose decision-store connection points at a throwaway root, so order.md lands there
  // (never the real repo working tree). resolveDecisionStorePath matches repoBase(root) === decisionStore.
  const wsInRoot = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Test', repos: [{ path: root }] });
    return { ws, root };
  };

  it('creates a work order at stage written with tracks and no sessions', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store);
    const wo = await store.createWorkOrder({
      workspaceId: ws.id, title: 'Avatar crash', description: 'Fix the avatar upload crash.',
      trackRepos: ws.repos, reviewMode: 'gates', contextFiles: ['/tmp/log.txt'],
    });
    expect(wo.stage).toBe('written'); // deriveStage: no sessions + plan not approved → written
    expect(wo.title).toBe('Avatar crash');
    expect(wo.tracks).toHaveLength(1);
    expect(wo.sessions).toEqual([]);
  });

  it('writes order.md into the decision-store working tree (WO-0001 in an empty root) — not committed', async () => {
    const store = createStore(freshDb());
    const { ws, root } = await wsInRoot(store);
    await store.createWorkOrder({
      workspaceId: ws.id, title: 'Avatar crash', description: 'prompt', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [],
    });
    const md = join(root, 'docs', 'work-orders', 'WO-0001-avatar-crash', 'order.md');
    expect(existsSync(md)).toBe(true);
    const body = readFileSync(md, 'utf8');
    expect(body).toContain('id: WO-0001');
    expect(body).toContain('title: Avatar crash');
    expect(body).toContain('workspace: test');
    expect(body).toContain('review_mode: gates');
    expect(body).toContain('prompt');
  });

  it('a created work order is returned by getWorkOrders and survives a reopen', async () => {
    const root = freshRoot();
    const p = freshDb();
    const store = createStore(p);
    const ws = await store.createWorkspace({ label: 'Test', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({
      workspaceId: ws.id, title: 'Persist me', description: 'x', trackRepos: ws.repos, reviewMode: 'every-step', contextFiles: [],
    });
    expect((await store.getWorkOrders()).some((w) => w.id === wo.id)).toBe(true);
    const reopened = await createStore(p).getWorkOrder(wo.id);
    expect(reopened).toBeDefined();
    expect(reopened!.stage).toBe('written');
  });

  it('allocates increasing WO numbers from the on-disk sequence', async () => {
    const root = freshRoot();
    const store = createStore(freshDb());
    const ws = await store.createWorkspace({ label: 'Test', repos: [{ path: root }] });
    const a = await store.createWorkOrder({ workspaceId: ws.id, title: 'One', description: '', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    const b = await store.createWorkOrder({ workspaceId: ws.id, title: 'Two', description: '', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    expect(a.id).toBe('WO-0001');
    expect(b.id).toBe('WO-0002'); // max+1 from the directory listing after the first write
  });
});
