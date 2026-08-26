import { afterAll, describe, expect, it } from 'vitest';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from './index';
import { OBSERVED_TABLES, SEED_OBSERVED_AT } from './schema';
import { workOrders } from '../fixtures';
import { rid, woid } from '../ids';
import type { RepoId, WorkspaceId } from '../../core/types';
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
// The fixture work orders + their sessions are TEST DATA, not production seed (WO-0015: the board
// starts empty — the operator creates work orders). WO-0043 moved this helper out of the production
// module; the body is verbatim. Clears observed WO tables + session first so it is safe to call on
// an already-seeded DB.
function seedFixtureWorkOrders(db: DatabaseSync): void {
  db.exec('DELETE FROM session');
  for (const t of ['track_depends_on', 'track', 'work_order_source', 'work_order']) db.exec(`DELETE FROM ${t}`);
  for (const wo of workOrders) {
    db.prepare(
      `INSERT INTO work_order (id, workspace_id, title, mode, gate_plan_approved, gate_verifier_resolvable,
       gate_closure_docs_sha, cost_tokens_in, cost_tokens_out, cost_usd, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      wo.id, wo.workspace, wo.title, wo.mode,
      wo.gateInputs.planApproved ? 1 : 0,
      wo.gateInputs.verifierReport?.resolvablePointers ? 1 : null,
      wo.gateInputs.closureDocsSha ?? null,
      0, 0, 0, SEED_OBSERVED_AT, // work_order.cost_* inert — derived from session rows at hydrate (TD-023)
    );
    wo.sources.forEach((s, idx) => {
      db.prepare('INSERT INTO work_order_source (work_order_id, idx, kind, label, ref) VALUES (?, ?, ?, ?, ?)').run(
        wo.id, idx, s.kind, s.label, s.ref,
      );
    });
    for (const t of wo.tracks) {
      const ciBlob =
        t.ci.kind === 'exempt'
          ? JSON.stringify({ reason: t.ci.reason })
          : JSON.stringify({ state: t.ci.state, checks: t.ci.checks });
      db.prepare(
        `INSERT INTO track (id, work_order_id, repo, pr_url, pr_head_sha, ci_kind, ci_blob, merged_at, observed_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(t.id, wo.id, t.repo, t.pr?.url ?? null, t.pr?.headSha ?? null, t.ci.kind, ciBlob, t.merge?.at ?? null, SEED_OBSERVED_AT);
      for (const dep of t.dependsOn) {
        db.prepare('INSERT INTO track_depends_on (track_id, depends_on_track_id) VALUES (?, ?)').run(t.id, dep);
      }
    }
  }
  for (const wo of workOrders) {
    for (const s of wo.sessions) {
      db.prepare(
        'INSERT INTO session (work_order_id, role, scope_track_id, status, transcript, stop_and_ask, cost_tokens_in, cost_tokens_out, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        wo.id, s.role, s.scope ?? null, s.status, JSON.stringify(s.transcript),
        s.status === 'stopped_asking' ? JSON.stringify(s.stopAndAsk) : null,
        s.cost?.tokensIn ?? null, s.cost?.tokensOut ?? null, s.cost?.usd ?? null,
      );
    }
  }
}

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

  // ===== WO-0033 — the ledger read + the path move + the basename-collision refusal =====

  it('repoConnections returns {id, path} from the connection table', async () => {
    const p = freshDb();
    const store = createStore(p);
    const ws = await store.createWorkspace({ label: 'Ledger', repos: [{ path: '/tmp/api' }, { path: '/tmp/mobile' }] });
    const conns = await store.repoConnections(ws.id);
    expect(conns).toEqual([
      { id: rid('api'), path: '/tmp/api' },
      { id: rid('mobile'), path: '/tmp/mobile' },
    ]);
  });

  it('updateRepoPath rewrites local_path only — remote + definition untouched', async () => {
    const p = freshDb();
    const store = createStore(p);
    const ws = await store.createWorkspace({ label: 'Move', repos: [{ path: '/old/place/api', remote: 'git@x:api.git' }] });
    await store.updateRepoPath(ws.id, rid('api'), '/new/place/api');
    expect(await store.repoConnections(ws.id)).toEqual([{ id: rid('api'), path: '/new/place/api' }]);
    const conn = store.db.prepare('SELECT repo_remote, local_path FROM connection WHERE workspace_id = ?').get(ws.id) as {
      repo_remote: string;
      local_path: string;
    };
    expect(conn.repo_remote).toBe('git@x:api.git'); // the row key survives the move
    expect((await store.getWorkspaces()).find((w) => w.id === ws.id)!.repos).toEqual([rid('api')]);
  });

  it('updateRepoPath throws on a basename change and writes nothing', async () => {
    const p = freshDb();
    const store = createStore(p);
    const ws = await store.createWorkspace({ label: 'Rename', repos: [{ path: '/tmp/api' }] });
    await assert.rejects(() => store.updateRepoPath(ws.id, rid('api'), '/tmp/other'), /basename is the identity/);
    expect(await store.repoConnections(ws.id)).toEqual([{ id: rid('api'), path: '/tmp/api' }]);
  });

  it('updateRepoPath throws on an unknown repo', async () => {
    const p = freshDb();
    const store = createStore(p);
    const ws = await store.createWorkspace({ label: 'Unknown', repos: [{ path: '/tmp/api' }] });
    await assert.rejects(() => store.updateRepoPath(ws.id, rid('ghost'), '/tmp/ghost'), /no connection/);
  });

  it('addRepoConnection refuses a basename collision — no silent swallow (AC 9)', async () => {
    const p = freshDb();
    const store = createStore(p);
    const ws = await store.createWorkspace({ label: 'Dup', repos: [{ path: '/tmp/a' }] });
    await assert.rejects(() => store.addRepoConnection(ws.id, { path: '/elsewhere/a' }), /duplicate repo: a/);
    // One row, the ORIGINAL path — the second repo neither replaced nor joined it.
    expect((await store.getWorkspaces()).find((w) => w.id === ws.id)!.repos).toEqual([rid('a')]);
    expect(await store.repoConnections(ws.id)).toEqual([{ id: rid('a'), path: '/tmp/a' }]);
  });

  it('createWorkspace refuses duplicate basenames in its own input — nothing half-written', async () => {
    const p = freshDb();
    const store = createStore(p);
    await assert.rejects(
      () => store.createWorkspace({ label: 'Double', repos: [{ path: '/tmp/a' }, { path: '/other/a' }] }),
      /duplicate repo: a/,
    );
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace WHERE label = ?').get('Double') as { n: number }).n).toBe(0);
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

  it('planApprovedFor — closed until approvePlan, open after; a missing WO fails closed (WO-0038 guard)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Gated', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    expect(store.planApprovedFor(wo.id)).toBe(false);
    await store.approvePlan(wo.id, '# The plan\n1. do the thing');
    expect(store.planApprovedFor(wo.id)).toBe(true);
    expect(store.planApprovedFor('WO-NONE' as never)).toBe(false);
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

describe('WO-0026 — transcript persistence + startup sweep', () => {
  const wsInRoot2 = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Hardening test', repos: [{ path: root }] });
    return { ws, root };
  };
  it('recordSession persists the transcript; hydrate round-trips it', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot2(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Transcript', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    store.recordSession({
      providerSessionId: 'sess-t1', workOrderId: wo.id, role: 'implementer', status: 'idle',
      cost: { tokensIn: 5, tokensOut: 1, usd: 0.1 }, stepIdx: 1,
      transcript: [
        { speaker: 'assistant', text: 'yapiliyor' },
        { speaker: 'tool_use', tool: 'Write', detail: '/a' },
        { speaker: 'tool_result', summary: 'ok', isError: false },
      ],
    });
    const wo2 = await store.getWorkOrder(wo.id);
    expect(wo2!.sessions[0]!.transcript).toEqual([
      { speaker: 'assistant', text: 'yapiliyor' },
      { speaker: 'tool_use', tool: 'Write', detail: '/a' },
      { speaker: 'tool_result', summary: 'ok', isError: false },
    ]);
  });
  it('the startup sweep flips leftover running rows to idle on reopen', async () => {
    const db = freshDb();
    const store = createStore(db);
    const { ws } = await wsInRoot2(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Sweep', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    store.recordSession({ providerSessionId: 'sess-r1', workOrderId: wo.id, role: 'architect', status: 'running' });
    expect((await store.getWorkOrder(wo.id))!.sessions[0]!.status).toBe('running');
    const reopened = createStore(db); // the process-kill emulation: a fresh open sweeps
    expect((await reopened.getWorkOrder(wo.id))!.sessions[0]!.status).toBe('idle');
  });
});

describe('WO-0027 — askı kalıcılığı + süreler', () => {
  const wsInRoot3 = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Ask test', repos: [{ path: root }] });
    return { ws, root };
  };
  it('a stopped_asking record persists its asks; hydrate round-trips them (Bulgu 9)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot3(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Asks', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    store.recordSession({
      providerSessionId: 'sess-a1', workOrderId: wo.id, role: 'implementer', status: 'stopped_asking', stepIdx: 1,
      asks: [
        { requestId: 'r1', tool: 'Write', input: { file_path: '/a' } },
        { requestId: 'r2', tool: 'Edit', input: { file_path: '/b' } },
      ],
    });
    const s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect(s.status).toBe('stopped_asking');
    if (s.status !== 'stopped_asking') throw new Error('unreachable');
    expect(s.stopAndAsk.asks?.map((a) => a.requestId)).toEqual(['r1', 'r2']);
  });
  it('started_at/ended_at round-trip (İstek 7)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot3(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Durations', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    store.recordSession({ providerSessionId: 'sess-d1', workOrderId: wo.id, role: 'architect', status: 'running', startedAt: '2026-08-15T10:00:00.000Z' });
    store.recordSession({ providerSessionId: 'sess-d1', workOrderId: wo.id, role: 'architect', status: 'idle', startedAt: '2026-08-15T10:00:00.000Z', endedAt: '2026-08-15T10:04:12.000Z' });
    const s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect(s.startedAt).toBe('2026-08-15T10:00:00.000Z');
    expect(s.endedAt).toBe('2026-08-15T10:04:12.000Z');
  });
});

describe('WO-0029 — maliyet birikimi + idempotent kapanış + override', () => {
  const wsInRoot4 = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'W29 test', repos: [{ path: root }] });
    return { ws, root };
  };
  it('a RESUMED session accumulates cost across turns and keeps the earliest start (B17)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot4(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Accum', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    store.recordSession({ providerSessionId: 'sess-x', workOrderId: wo.id, role: 'architect', status: 'idle', cost: { tokensIn: 1000, tokensOut: 200, usd: 0.10 }, startedAt: '2026-08-15T10:00:00.000Z', endedAt: '2026-08-15T10:02:00.000Z' });
    store.recordSession({ providerSessionId: 'sess-x', workOrderId: wo.id, role: 'architect', status: 'idle', cost: { tokensIn: 3000, tokensOut: 600, usd: 0.20 }, startedAt: '2026-08-15T11:00:00.000Z', endedAt: '2026-08-15T11:01:00.000Z' });
    const s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect(s.cost!.tokensIn).toBe(4000);
    expect(s.cost!.tokensOut).toBe(800);
    expect(s.cost!.usd).toBeCloseTo(0.3, 10); // float sum
    expect(s.startedAt).toBe('2026-08-15T10:00:00.000Z'); // earliest survives the resume
    expect(s.endedAt).toBe('2026-08-15T11:01:00.000Z');
  });
  it('closing twice refuses the second time (B21)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot4(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Idem', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```');
    store.recordStep(wo.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
    store.recordStepVerdict(wo.id, 1, 'proceed', 'ok');
    await store.closeWorkOrder(wo.id, 'n');
    await expect(store.closeWorkOrder(wo.id, 'n')).rejects.toThrow('already closed');
  });
  it('a revise verdict blocks close until overridden (B19)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot4(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Revise', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```');
    store.recordStep(wo.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
    store.recordStepVerdict(wo.id, 1, 'revise', 'eksik');
    await expect(store.closeWorkOrder(wo.id, 'n')).rejects.toThrow('step_not_resolved');
    await store.overrideStepVerdict(wo.id, 1);
    await store.closeWorkOrder(wo.id, 'n'); // now closes
    expect((await store.getWorkOrder(wo.id))!.stage).toBe('closed');
  });
  it('permission rule round-trips; the legacy ask/auto values keep their meaning (WO-0031c)', async () => {
    const store = createStore(freshDb());
    // no keys at all → ask_every: a fresh install never silently auto-approves (operator ruling)
    expect(await store.getPermissionRule()).toBe('ask_every');
    await store.setPermissionRule('full_auto');
    expect(await store.getPermissionRule()).toBe('full_auto');
    // legacy mapping: a pre-c2 operator's stored choice keeps its meaning
    store.db.prepare("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('permission_mode', 'auto')").run();
    store.db.prepare("DELETE FROM app_setting WHERE key = 'permission_rule'").run();
    expect(await store.getPermissionRule()).toBe('risky_excluded');
    store.db.prepare("UPDATE app_setting SET value = 'ask' WHERE key = 'permission_mode'").run();
    expect(await store.getPermissionRule()).toBe('ask_every');
  });
  it('locale round-trips; absent or garbage reads undefined (WO-0035)', async () => {
    const store = createStore(freshDb());
    // no row → undefined: the store never invents a choice; the renderer detects the system language
    expect(await store.getLocale()).toBeUndefined();
    await store.setLocale('en');
    expect(await store.getLocale()).toBe('en');
    store.db.prepare("UPDATE app_setting SET value = 'xx' WHERE key = 'locale'").run();
    expect(await store.getLocale()).toBeUndefined();
  });
});

describe('WO-0030 — yaşam döngüsü olay günlüğü (audit)', () => {
  const wsInRoot5 = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'W30 test', repos: [{ path: root }] });
    return { ws, root };
  };
  it('the full lifecycle writes ordered events; legacy WOs read []', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot5(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Audit', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```');
    store.recordStep(wo.id, 1, { status: 'active' });
    store.recordStepReport(wo.id, 1, 'implementer', 'r');
    store.recordStepVerdict(wo.id, 1, 'proceed', 'ok');
    await store.closeWorkOrder(wo.id, 'n');
    const kinds = (await store.getWorkOrderEvents(wo.id)).map((e) => e.kind);
    expect(kinds).toEqual(['created', 'plan_approved', 'step_started', 'step_done', 'step_verdict', 'closed']);
    // a legacy WO (created before the log) reads [] — no backfill by design
    const legacy = createStore(freshDb());
    const { ws: lws } = await wsInRoot5(legacy);
    // simulate legacy: delete the events of a fresh WO, then read
    const lwo = await legacy.createWorkOrder({ workspaceId: lws.id, title: 'L', description: 'x', trackRepos: lws.repos, reviewMode: 'gates', contextFiles: [] });
    legacy.db.prepare('DELETE FROM wo_event WHERE work_order_id = ?').run(lwo.id);
    expect(await legacy.getWorkOrderEvents(lwo.id)).toEqual([]);
  });
  it('plan_saved + override events land too; delete cascades the log', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot5(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'A2', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    store.savePendingPlan(wo.id, '# plan');
    await store.approvePlan(wo.id, '# plan');
    store.recordStep(wo.id, 1, { status: 'done', reportPath: 'r' });
    store.recordStepVerdict(wo.id, 1, 'revise', 'eksik');
    await store.overrideStepVerdict(wo.id, 1);
    const kinds = (await store.getWorkOrderEvents(wo.id)).map((e) => e.kind);
    expect(kinds).toContain('plan_saved');
    expect(kinds).toContain('verdict_overridden');
    await store.deleteWorkOrder(wo.id);
    expect(await store.getWorkOrderEvents(wo.id)).toEqual([]);
  });

  it('WO-0031c: an old-schema wo_event (narrow CHECK) migrates — rows survive in order, new kinds insert', async () => {
    const dbPath = freshDb();
    const bootstrap = createStore(dbPath); // create the store's tables first, then swap wo_event for the old shape
    bootstrap.db.exec('DROP TABLE wo_event');
    bootstrap.db.exec(`CREATE TABLE wo_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('created','plan_saved','plan_approved','step_started','step_done','step_verdict','verdict_overridden','closed')),
      detail TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL
    )`);
    bootstrap.db.prepare('INSERT INTO wo_event (work_order_id, kind, detail, at) VALUES (?,?,?,?)').run('WO-X', 'created', 't', '2026-01-01T00:00:00.000Z');
    bootstrap.db.prepare('INSERT INTO wo_event (work_order_id, kind, detail, at) VALUES (?,?,?,?)').run('WO-X', 'closed', '', '2026-01-02T00:00:00.000Z');
    bootstrap.db.close?.();
    const store = createStore(dbPath); // migrate() runs here
    const events = store.db.prepare('SELECT kind FROM wo_event ORDER BY id').all() as { kind: string }[];
    expect(events.map((e) => e.kind)).toEqual(['created', 'closed']); // order preserved through the copy
    // the widened CHECK now accepts the new kinds
    store.db.prepare('INSERT INTO wo_event (work_order_id, kind, detail, at) VALUES (?,?,?,?)').run('WO-X', 'wo_edited', 'title', '2026-01-03T00:00:00.000Z');
    expect((store.db.prepare('SELECT COUNT(*) c FROM wo_event').get() as { c: number }).c).toBe(3);
  });

  it('WO-0031c: updateWorkOrder rewrites order.md + DB title, and logs wo_edited/rule_changed', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot5(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Old', description: 'first goal', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.updateWorkOrder(wo.id, { title: 'New', description: 'second goal', reviewMode: 'every-step', permissionRule: 'full_auto' });
    expect((await store.getWorkOrder(wo.id))!.title).toBe('New');
    const { order } = await store.getWorkOrderDocs(wo.id);
    expect(order).toContain('title: New');
    expect(order).toContain('permission_rule: full_auto');
    expect(order).toContain('review_mode: every-step');
    expect(order).toContain('second goal');
    const events = await store.getWorkOrderEvents(wo.id);
    const last = events.slice(-2);
    expect(last.map((e) => e.kind)).toEqual(['wo_edited', 'rule_changed']);
    expect(last[0]!.detail).toBe('title · description · review_mode');
    expect(last[1]!.detail).toBe('full_auto');
  });

  // WO-0031f K1 — a closed work order is a record, not a document: the pencil is absent in the UI and
  // the store refuses the write (closed ⟺ gate_closure_docs_sha set — deriveStage's own test). Delete
  // stays legitimate (an archive cleanup), so deleteWorkOrder is NOT guarded.
  it('WO-0031f: updateWorkOrder throws on a closed work order (immutable archive)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot5(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'K1', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```');
    store.recordStep(wo.id, 1, { status: 'done', reportPath: 'r' });
    store.recordStepVerdict(wo.id, 1, 'proceed', 'ok');
    // control: the edit works right up to the close
    await store.updateWorkOrder(wo.id, { title: 'K1 önce' });
    await store.closeWorkOrder(wo.id, 'done');
    await expect(store.updateWorkOrder(wo.id, { title: 'K1 sonra' })).rejects.toThrow(/closed/i);
    await expect(store.updateWorkOrder(wo.id, { permissionRule: 'full_auto' })).rejects.toThrow(/closed/i);
    expect((await store.getWorkOrder(wo.id))!.title).toBe('K1 önce'); // nothing leaked through
  });

  it('WO-0031c: approvePlan carries the edited count; permission decisions land in the log', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot5(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'P', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# p', { editedCount: 3 });
    await store.recordPermissionDecision(wo.id, { allowed: true, tool: 'Write', target: 'check.yml' });
    const events = await store.getWorkOrderEvents(wo.id);
    const approved = events.find((e) => e.kind === 'plan_approved')!;
    expect(approved.detail).toBe('edited:3');
    const decision = events.find((e) => e.kind === 'permission_decision')!;
    expect(decision.detail).toBe('allowed · check.yml');
  });

  it('WO-0031c: woRepoPaths resolves the WO tracks to their connected local paths (the diff-peek jail)', async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const other = freshRoot();
    const ws = await store.createWorkspace({ label: 'R', repos: [{ path: root }, { path: other }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Jail', description: 'x', trackRepos: [ws.repos[0]!], reviewMode: 'gates', contextFiles: [] });
    const paths = store.woRepoPaths(wo.id);
    expect(paths).toEqual([root]); // the WO's OWN track repo — not cwd, not the workspace's other repos
    expect(store.woRepoPaths(woid('WO-YOK'))).toEqual([]);
  });

  it('WO-0031c: a created WO carries its rule; a pre-rule WO follows the Settings default', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot5(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'R', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [], permissionRule: 'ask_every' });
    expect(await store.getPermissionRuleFor(wo.id)).toBe('ask_every');
    const legacy = await store.createWorkOrder({ workspaceId: ws.id, title: 'L2', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    expect(await store.getPermissionRuleFor(legacy.id)).toBe('ask_every'); // no rule → the safe default
    await store.setPermissionRule('full_auto');
    expect(await store.getPermissionRuleFor(legacy.id)).toBe('full_auto'); // the default moved
    expect(await store.getPermissionRuleFor(wo.id)).toBe('ask_every'); // …but the WO's own rule wins
  });
});

describe('SQLite store — WO deletion removes the decision-store dir (WO-0032 fix)', () => {
  const wsInRoot = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Del fix', repos: [{ path: root }] });
    return { ws, root };
  };
  it('deleteWorkOrder removes the WO dir from disk (woDir used to resolve after the row delete — a silent no-op)', async () => {
    const store = createStore(freshDb());
    const { ws, root } = await wsInRoot(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Dir fix', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    const woDir = join(root, 'docs', 'work-orders', 'WO-0001-dir-fix');
    expect(existsSync(woDir)).toBe(true); // order.md landed under the throwaway root
    await store.deleteWorkOrder(wo.id);
    expect(existsSync(woDir)).toBe(false); // …and the delete really removed it
    expect((await store.getWorkOrders()).some((w) => w.id === wo.id)).toBe(false);
  });
});

describe('SQLite store — workspace deletion (WO-0032)', () => {
  it('deleteWorkspace cascades every WO row + removes the decision-store dirs', async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Cascade', repos: [{ path: root }] });
    const woIds: string[] = [];
    for (const title of ['Cascade one', 'Cascade two']) {
      const wo = await store.createWorkOrder({ workspaceId: ws.id, title, description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
      await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```');
      store.recordStep(wo.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
      store.recordSession({ providerSessionId: `casc-${wo.id}`, workOrderId: wo.id, role: 'implementer', status: 'idle', cost: { tokensIn: 1, tokensOut: 1, usd: 0.1 } });
      woIds.push(wo.id as string);
    }
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM work_order WHERE workspace_id = ?').get(ws.id) as { n: number }).n).toBe(2);

    await store.deleteWorkspace(ws.id);

    // every WO-child table is emptied for both ids
    const cleared: Array<[string, string]> = [
      ['work_order', 'id'],
      ['work_order_source', 'work_order_id'],
      ['track', 'work_order_id'],
      ['work_order_step', 'work_order_id'],
      ['session', 'work_order_id'],
      ['wo_event', 'work_order_id'],
    ];
    for (const woId of woIds) {
      for (const [t, col] of cleared) {
        expect((store.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`).get(woId) as { n: number }).n).toBe(0);
      }
    }
    // both decision-store dirs are gone
    expect(existsSync(join(root, 'docs', 'work-orders', 'WO-0001-cascade-one'))).toBe(false);
    expect(existsSync(join(root, 'docs', 'work-orders', 'WO-0002-cascade-two'))).toBe(false);
    // the definition + connection rows are gone, and the ports reflect it
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace WHERE id = ?').get(ws.id) as { n: number }).n).toBe(0);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace_repo WHERE workspace_id = ?').get(ws.id) as { n: number }).n).toBe(0);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM connection WHERE workspace_id = ?').get(ws.id) as { n: number }).n).toBe(0);
    expect((await store.getWorkspaces()).some((w) => w.id === ws.id)).toBe(false);
    expect((await store.getWorkOrders()).some((w) => woIds.includes(w.id as string))).toBe(false);
  });

  it('deleteWorkspace throws on a running session and deletes nothing', async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Guard', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Live', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    store.recordSession({ providerSessionId: 'live-1', workOrderId: wo.id, role: 'architect', status: 'running' });

    await expect(store.deleteWorkspace(ws.id)).rejects.toThrow(/running/);

    // the guard fired before any delete: WO row, session row, dir, workspace rows all intact
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM work_order WHERE id = ?').get(wo.id) as { n: number }).n).toBe(1);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM session WHERE work_order_id = ?').get(wo.id) as { n: number }).n).toBe(1);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace WHERE id = ?').get(ws.id) as { n: number }).n).toBe(1);
    expect(existsSync(join(root, 'docs', 'work-orders', 'WO-0001-live'))).toBe(true);

    // once the drive ends, the same delete goes through
    store.recordSession({ providerSessionId: 'live-1', workOrderId: wo.id, role: 'architect', status: 'idle' });
    await store.deleteWorkspace(ws.id);
    expect((await store.getWorkspaces()).some((w) => w.id === ws.id)).toBe(false);
  });

  it("a shared decision store loses only the deleted workspace's WO dirs (TD-035 shape)", async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const wsA = await store.createWorkspace({ label: 'Shared A', repos: [{ path: root }] });
    const a = await store.createWorkOrder({ workspaceId: wsA.id, title: 'Stays', description: 'x', trackRepos: wsA.repos, reviewMode: 'gates', contextFiles: [] });
    const wsB = await store.createWorkspace({ label: 'Shared B', repos: [{ path: root }] });
    const b = await store.createWorkOrder({ workspaceId: wsB.id, title: 'Goes', description: 'x', trackRepos: wsB.repos, reviewMode: 'gates', contextFiles: [] });

    await store.deleteWorkspace(wsB.id);

    expect(existsSync(join(root, 'docs', 'work-orders', 'WO-0001-stays'))).toBe(true);
    expect(existsSync(join(root, 'docs', 'work-orders', 'WO-0002-goes'))).toBe(false);
    expect((await store.getWorkOrders()).some((w) => w.id === a.id)).toBe(true);
    expect((await store.getWorkOrders()).some((w) => w.id === b.id)).toBe(false);
  });
});


// ===== WO-0039 stabilization (2026-08-24, reviewer round) — this order's store rules =====
// The reviewer round named the gap: the parse-guard, the snapshot lifecycle, the transcript merge,
// the upsert scope and the session CHECK migration carried only single e2e assertions while the
// CHECK had ALREADY failed once live (round 4 — the record threw, the pipeline surfaced a fail
// card for an intentional Durdur). These pin them against real SQLite.

const GOOD_PLAN = ['# Gerçek plan', '', '```steps', '[{"role":"implementer","aim":"a","scope":"all"}]', '```', ''].join('\n');

// A work order under a throwaway decision-store root (the helpers' freshRoot idiom).
const woUnder = (store: ReturnType<typeof createStore>) =>
  store.createWorkspace({ label: 'st', repos: [{ path: freshRoot(), remote: 'r' }], decisionStorePath: freshRoots.at(-1) }).then((ws) =>
    store.createWorkOrder({ workspaceId: ws.id, title: 'Guard test', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] }),
  );

describe('store — savePendingPlan parse-guard (the overwrite incident)', () => {
  it('a parseable plan on disk survives a fence-less resubmission, and the refusal is audited', async () => {
    const store = createStore(freshDb());
    const wo = await woUnder(store);
    store.savePendingPlan(wo.id, GOOD_PLAN);
    store.savePendingPlan(wo.id, 'bekliyorum'); // the incident's degenerate re-submission
    const { plan } = await store.getWorkOrderDocs(wo.id);
    expect(plan).toBe(GOOD_PLAN);
    expect((await store.getWorkOrderEvents(wo.id)).some((e) => e.kind === 'plan_save_refused')).toBe(true);
  });

  it('a GOOD re-proposal (a plan that parses) still overwrites — the guard is degeneracy-only', async () => {
    const store = createStore(freshDb());
    const wo = await woUnder(store);
    const better = GOOD_PLAN.replace('"aim":"a"', '"aim":"b"');
    store.savePendingPlan(wo.id, better);
    const { plan } = await store.getWorkOrderDocs(wo.id);
    expect(plan).toBe(better);
  });

  it('the plan_original snapshot survives a REFUSED save; a fresh agent proposal clears it', async () => {
    const store = createStore(freshDb());
    const wo = await woUnder(store);
    store.savePendingPlan(wo.id, GOOD_PLAN);
    await store.savePlanDraft(wo.id, GOOD_PLAN.replace('"aim":"a"', '"aim":"edited"')); // first overwrite → snapshot
    expect(await store.getOriginalPlan(wo.id)).toBe(GOOD_PLAN);
    store.savePendingPlan(wo.id, 'bekliyorum'); // refused → the snapshot must NOT be cleared
    expect(await store.getOriginalPlan(wo.id)).toBe(GOOD_PLAN);
    store.savePendingPlan(wo.id, GOOD_PLAN.replace('"aim":"a"', '"aim":"yeni"')); // a real proposal clears it
    expect(await store.getOriginalPlan(wo.id)).toBeNull();
  });
});

describe('store — the session row rules (transcript merge + upsert scope)', () => {
  it('the LONGER transcript wins — a late short record cannot wipe a fuller checkpoint (döküm kaybı)', async () => {
    const store = createStore(freshDb());
    const wo = await woUnder(store);
    store.recordSession({ providerSessionId: 's-merge', workOrderId: wo.id, role: 'implementer', status: 'idle', transcript: [
      { speaker: 'note', kind: 'session_started' },
      { speaker: 'assistant', text: 'çalıştı' },
      { speaker: 'tool_use', tool: 'Bash', detail: 'ls', callId: 'c1' },
    ], startedAt: '2026-08-24T01:00:00Z', endedAt: '2026-08-24T01:01:00Z' });
    store.recordSession({ providerSessionId: 's-merge', workOrderId: wo.id, role: 'implementer', status: 'stopped', transcript: [{ speaker: 'note', kind: 'interrupted' }] });
    const hydrated = await store.getWorkOrder(wo.id);
    expect(hydrated?.sessions[0]?.transcript).toHaveLength(3);
    expect(hydrated?.sessions[0]?.status).toBe('stopped'); // the status still follows the LAST record
  });

  it('the upsert is work-order-scoped — a foreign row with the same provider id survives (the e2e incident)', async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'scope', repos: [{ path: root }] });
    const woA = await store.createWorkOrder({ workspaceId: ws.id, title: 'WO A', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    const woB = await store.createWorkOrder({ workspaceId: ws.id, title: 'WO B', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    store.recordSession({ providerSessionId: 'shared-id', workOrderId: woA.id, role: 'architect', status: 'idle', transcript: [] });
    store.recordSession({ providerSessionId: 'shared-id', workOrderId: woB.id, role: 'architect', status: 'stopped', transcript: [] });
    const [a, b] = await Promise.all([store.getWorkOrder(woA.id), store.getWorkOrder(woB.id)]);
    expect(a?.sessions.some((s) => s.providerSessionId === 'shared-id' && s.status === 'idle')).toBe(true);
    expect(b?.sessions.some((s) => s.providerSessionId === 'shared-id' && s.status === 'stopped')).toBe(true);
  });
});

describe('store — the session CHECK migration (round 4: the live failure this guards against)', () => {
  it('an old-shape DB migrates: rows preserved, and a stopped session records without a CHECK throw', () => {
    const p = freshDb();
    const raw = new DatabaseSync(p);
    raw.exec(
      'CREATE TABLE session (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_session_id TEXT, work_order_id TEXT NOT NULL, ' +
        "role TEXT NOT NULL CHECK (role IN ('implementer','architect','verifier')), scope_track_id TEXT, " +
        "status TEXT NOT NULL CHECK (status IN ('running','stopped_asking','idle','none')), transcript TEXT NOT NULL, stop_and_ask TEXT, " +
        'cost_tokens_in INTEGER, cost_tokens_out INTEGER, cost_usd REAL, started_at TEXT, ended_at TEXT, step_idx INTEGER)',
    );
    raw
      .prepare('INSERT INTO session (provider_session_id, work_order_id, role, status, transcript, started_at, ended_at) VALUES (?,?,?,?,?,?,?)')
      .run('legacy-1', 'WO-LEGACY', 'architect', 'idle', '[]', '2026-08-23T20:00:00Z', '2026-08-23T20:01:00Z');
    raw.close();

    const store = createStore(p); // migrate() runs here — the widen this test pins
    const kept = store.db.prepare('SELECT provider_session_id, status FROM session').all() as Array<{ provider_session_id: string; status: string }>;
    expect(kept).toEqual([{ provider_session_id: 'legacy-1', status: 'idle' }]);
    // the pre-fix behavior: this INSERT threw (CHECK rejected 'stopped') and the pipeline's catch
    // surfaced it as a fail card for an intentional Durdur
    store.recordSession({ providerSessionId: 'legacy-1', workOrderId: woid('WO-LEGACY'), role: 'architect', status: 'stopped', transcript: [{ speaker: 'note', kind: 'interrupted' }] });
    const stopped = store.db.prepare("SELECT status FROM session WHERE provider_session_id = 'legacy-1'").get() as { status: string };
    expect(stopped.status).toBe('stopped');
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'session_legacy'").get()).toBeUndefined();
  });
});

describe('SQLite store — steer mirror + flow mode (WO-0045)', () => {
  const wsInRoot = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Test', repos: [{ path: root }] });
    return { ws, root };
  };
  const mkWo = async (store: ReturnType<typeof createStore>, ws: { id: WorkspaceId; repos: RepoId[] }) =>
    store.createWorkOrder({ workspaceId: ws.id, title: 'Steer', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });

  it('recordSession pendingNotes: latest-wins overwrite, undefined KEEPS the prior mirror', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store);
    const wo = await mkWo(store, ws);
    const base = { workOrderId: wo.id, role: 'implementer' as const };
    store.recordSession({ ...base, providerSessionId: 's1', status: 'running', pendingNotes: [{ id: 'n1', text: 'bir' }, { id: 'n2', text: 'iki' }] });
    store.recordSession({ ...base, providerSessionId: 's1', status: 'running', pendingNotes: [{ id: 'n2', text: 'iki' }] });
    expect(store.pendingNotesFor(wo.id, 's1')).toEqual([{ id: 'n2', text: 'iki' }]); // delivery shrank it
    store.recordSession({ ...base, providerSessionId: 's1', status: 'stopped' }); // notes-blind record
    expect(store.pendingNotesFor(wo.id, 's1')).toEqual([{ id: 'n2', text: 'iki' }]); // not silently dropped
    // and the hydrated session row carries it (the Sürdür seed reads this)
    const hydrated = (await store.getWorkOrder(wo.id))!.sessions.find((s) => s.providerSessionId === 's1');
    expect(hydrated?.pendingNotes).toEqual([{ id: 'n2', text: 'iki' }]);
  });

  it('retractSteerNote rewrites the stopped mirror, audits, and refuses an absent note', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store);
    const wo = await mkWo(store, ws);
    store.recordSession({ workOrderId: wo.id, role: 'implementer', providerSessionId: 's1', status: 'stopped', pendingNotes: [{ id: 'n1', text: 'bir' }] });
    expect(await store.retractSteerNote(wo.id, 's1', 'ghost')).toBe(false);
    expect(await store.retractSteerNote(wo.id, 's1', 'n1')).toBe(true);
    expect(store.pendingNotesFor(wo.id, 's1')).toEqual([]);
    const events = await store.getWorkOrderEvents(wo.id);
    expect(events.some((e) => e.kind === 'steer_retracted')).toBe(true);
  });

  it('recordAuditEvent writes the steer lifecycle kinds', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store);
    const wo = await mkWo(store, ws);
    store.recordAuditEvent(wo.id, 'steer_queued', 'not: bir');
    const events = await store.getWorkOrderEvents(wo.id);
    expect(events.some((e) => e.kind === 'steer_queued' && e.detail === 'not: bir')).toBe(true);
  });

  it('flowModeFor reads order.md — auto default, manual after the chip toggle', async () => {
    const store = createStore(freshDb());
    const { ws, root } = await wsInRoot(store);
    const wo = await mkWo(store, ws);
    expect(store.flowModeFor(wo.id)).toBe('auto'); // no flow_mode key — silence IS auto
    await store.updateWorkOrder(wo.id, { flowMode: 'manual' });
    expect(store.flowModeFor(wo.id)).toBe('manual');
    const md = readFileSync(join(root, 'docs', 'work-orders', 'WO-0001-steer', 'order.md'), 'utf8');
    expect(md).toContain('flow_mode: manual');
    const events = await store.getWorkOrderEvents(wo.id);
    expect(events.some((e) => e.kind === 'flow_mode_changed' && e.detail === 'manual')).toBe(true);
    expect(events.some((e) => e.kind === 'wo_edited' && e.detail.includes('flow_mode'))).toBe(true);
  });

  it('creation emits flow_mode only when manual (silence IS auto)', async () => {
    const store = createStore(freshDb());
    const { ws, root } = await wsInRoot(store);
    await store.createWorkOrder({ workspaceId: ws.id, title: 'Auto one', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    const md1 = readFileSync(join(root, 'docs', 'work-orders', 'WO-0001-auto-one', 'order.md'), 'utf8');
    expect(md1).not.toContain('flow_mode');
    await store.createWorkOrder({ workspaceId: ws.id, title: 'Manual one', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', flowMode: 'manual', contextFiles: [] });
    const md2 = readFileSync(join(root, 'docs', 'work-orders', 'WO-0002-manual-one', 'order.md'), 'utf8');
    expect(md2).toContain('flow_mode: manual');
  });
});
