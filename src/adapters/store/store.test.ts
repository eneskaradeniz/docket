import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, seedFixtureWorkOrders } from './index';
import { OBSERVED_TABLES } from './schema';
import { woid } from '../ids';
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

describe('SQLite store — starts empty (no fixture seeding)', () => {
  it('a fresh DB has no workspaces and no work orders (the operator creates them)', async () => {
    const store = createStore(freshDb());
    expect((await store.getWorkspaces()).length).toBe(0);
    expect((await store.getWorkOrders()).length).toBe(0);
  });

  it('re-opening an empty DB stays empty (no auto-seed)', () => {
    const p = freshDb();
    createStore(p);
    const store = createStore(p);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace').get() as { n: number }).n).toBe(0);
  });

  it('hydrates a work order with DERIVED stage, tracks, sessions, sources', async () => {
    const store = fixtureStore();
    const wo = await store.getWorkOrder(woid('WO-1001'));
    expect(wo).toBeDefined();
    expect(wo!.stage).toBe('implementation'); // derived (deriveStage), not a stored column
    expect(wo!.tracks).toHaveLength(1);
    expect(wo!.sessions.some((s) => s.status === 'stopped_asking')).toBe(true);
  });

  it('serves documents from the working tree, not fixtures (WO-0016)', async () => {
    const store = fixtureStore();
    const docs = await store.getWorkOrderDocs(woid('WO-1001'));
    // Fixture WOs are test data with no on-disk order.md → empty (ADR-0010: docs read at view time).
    expect(docs).toEqual({ order: '', plan: '' });
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

describe('SQLite store — migrates a legacy DB (rebuilds track without its stored stage column)', () => {
  it('a pre-TD-008 dev DB (track has a NOT NULL stage column) is rebuilt, preserving rows', () => {
    const p = freshDb();
    // Hand-build the legacy shape: a session table predating WO-0010 + a track table with stored stage + a row.
    const raw = new DatabaseSync(p);
    raw.exec(
      'CREATE TABLE session (id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id TEXT, role TEXT, scope_track_id TEXT, status TEXT, transcript TEXT, stop_and_ask TEXT)',
    );
    raw.exec(
      'CREATE TABLE track (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL, repo TEXT NOT NULL, stage TEXT NOT NULL, pr_url TEXT, pr_head_sha TEXT, ci_kind TEXT NOT NULL, ci_blob TEXT NOT NULL, merged_at TEXT, observed_at TEXT NOT NULL)',
    );
    raw
      .prepare("INSERT INTO track (id, work_order_id, repo, stage, ci_kind, ci_blob, observed_at) VALUES (?,?,?,?,?,?,?)")
      .run('t1', 'WO-1', 'app', 'implementation', 'run', '{}', '2026-01-01T00:00:00Z');
    raw.close();

    const store = createStore(p); // SCHEMA_SQL (IF NOT EXISTS no-ops the legacy tables) + migrate
    const trackCols = (store.db.prepare('PRAGMA table_info(track)').all() as { name: string }[]).map((c) => c.name);
    expect(trackCols).not.toContain('stage'); // stage is derived, never stored
    // The track row was preserved (minus the stage column); workspaces/work_orders are untouched.
    const row = store.db.prepare('SELECT * FROM track WHERE id = ?').get('t1') as { repo: string; work_order_id: string };
    expect(row.repo).toBe('app');
    expect(row.work_order_id).toBe('WO-1');
    // The session table gained the WO-0010 columns (the additive half still runs).
    const sessionCols = (store.db.prepare('PRAGMA table_info(session)').all() as { name: string }[]).map((c) => c.name);
    expect(sessionCols).toContain('provider_session_id');
    expect(sessionCols).toContain('cost_usd');
  });
});

describe('SQLite store — observed | owned split (ADR-0010)', () => {
  it('dropping every observed table leaves owned rows intact on re-open (no auto-seed)', async () => {
    const p = freshDb();
    const store0 = createStore(p);
    seedFixtureWorkOrders(store0.db); // observed WO data (test)
    // An owned decision: an extra session for WO-1001.
    store0.db
      .prepare(
        'INSERT INTO session (work_order_id, role, scope_track_id, status, transcript, stop_and_ask) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('WO-1001', 'verifier', null, 'idle', JSON.stringify([]), null);
    const ownedBefore = (store0.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n;
    for (const t of OBSERVED_TABLES) store0.db.exec(`DELETE FROM ${t}`);

    // Re-open: observed is empty (no fixture seeding); the owned session survived.
    const store = createStore(p);
    const ownedAfter = (store.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n;
    expect(ownedAfter).toBe(ownedBefore);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace').get() as { n: number }).n).toBe(0);
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

describe('SQLite store — plan approval + doc reads (WO-0016)', () => {
  const wsInRoot = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Test', repos: [{ path: root }] });
    return { ws, root };
  };

  it('getWorkOrderDocs reads the authored order.md (plan empty until approved)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Doc read', description: 'the objective', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    const docs = await store.getWorkOrderDocs(wo.id);
    expect(docs.order).toContain('the objective');
    expect(docs.plan).toBe('');
  });

  it('approvePlan writes plan.md and flips the plan_approval gate → stage advances to implementation', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Approve me', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    expect((await store.getWorkOrder(wo.id))!.stage).toBe('written');

    await store.approvePlan(wo.id, '# The plan\n1. do the thing');

    const docs = await store.getWorkOrderDocs(wo.id);
    expect(docs.plan).toBe('# The plan\n1. do the thing');
    const approved = (store.db.prepare('SELECT gate_plan_approved AS v FROM work_order WHERE id = ?').get(wo.id) as { v: number }).v;
    expect(approved).toBe(1);
    const reloaded = await store.getWorkOrder(wo.id);
    expect(reloaded!.gateInputs.planApproved).toBe(true);
    expect(reloaded!.stage).toBe('implementation'); // planApproved + no merged tracks
  });

  it('approvePlan persists across a reopen (gate stays approved, plan.md on disk)', async () => {
    const root = freshRoot();
    const p = freshDb();
    const store = createStore(p);
    const ws = await store.createWorkspace({ label: 'Test', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Persist plan', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# persisted plan');
    const reloaded = await createStore(p).getWorkOrder(wo.id);
    expect(reloaded!.gateInputs.planApproved).toBe(true);
    expect((await createStore(p).getWorkOrderDocs(wo.id)).plan).toBe('# persisted plan');
  });
});

describe('closeWorkOrder — operator-attested closure (WO-0025 / P1-2)', () => {
  const wsInRoot = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Close test', repos: [{ path: root }] });
    return { ws, root };
  };
  it('rejects when a step lacks a verdict (preconditions from the DB)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Not reviewable', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```');
    store.recordStep(wo.id, 1, { status: 'active' });
    await expect(store.closeWorkOrder(wo.id, 'note')).rejects.toThrow('step_not_done');
  });

  it('closes: order.md gains ## Closure, gates + merged_at set, stage closed, key settings round-trip', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Close me', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```');
    store.recordStep(wo.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
    store.recordStepVerdict(wo.id, 1, 'proceed', 'ok');

    await store.closeWorkOrder(wo.id, 'deneme kapanis');

    const docs = await store.getWorkOrderDocs(wo.id);
    expect(docs.order).toContain('## Closure');
    expect(docs.order).toContain('deneme kapanis');
    const row = store.db.prepare('SELECT gate_verifier_resolvable AS v, gate_closure_docs_sha AS s FROM work_order WHERE id = ?').get(wo.id) as { v: number; s: string };
    expect(row.v).toBe(1);
    expect(row.s).toBeTruthy(); // 'uncommitted' in a non-git tmp root, a real sha in a git repo
    const merged = store.db.prepare('SELECT COUNT(*) AS n FROM track WHERE work_order_id = ? AND merged_at IS NOT NULL').get(wo.id) as { n: number };
    expect(merged.n).toBeGreaterThan(0);
    const reloaded = await store.getWorkOrder(wo.id);
    expect(reloaded!.stage).toBe('closed');

    await store.setProviderKey('sk-test-123');
    expect(await store.getProviderKey()).toBe('sk-test-123');
    await store.setProviderKey(undefined);
    expect(await store.getProviderKey()).toBeUndefined();
  });
});
