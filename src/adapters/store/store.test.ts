import { afterAll, describe, expect, it } from 'vitest';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from './index';
import { OBSERVED_TABLES, SCHEMA_SQL, SEED_OBSERVED_AT } from './schema';
import { workOrders } from '../fixtures';
import { antreoRoadmapMd } from '../../core/__tests__/antreo-roadmap';
import { buildRoadmapMd } from '../../core/roadmap-md';
import { monthWindow } from '../../core/budget';
import type { PromptOverrides } from '../../core/app-settings';
import { rid, tid, wid, woid } from '../ids';
import type { RepoId, TranscriptLine, TurnUsage, WorkOrderId, WorkspaceId } from '../../core/types';
import { deriveWorkOrderCost } from '../../core/derive';
import { implementerPrompt, verifierPrompt } from '../../core/order-md';

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
        'INSERT INTO session (workspace_id, work_order_id, role, scope_track_id, status, transcript, stop_and_ask, cost_tokens_in, cost_tokens_out, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        wo.workspace, wo.id, s.role, s.scope ?? null, s.status, JSON.stringify(s.transcript),
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
        'INSERT INTO session (workspace_id, work_order_id, role, scope_track_id, status, transcript, stop_and_ask) VALUES ((SELECT workspace_id FROM work_order WHERE id = ?), ?, ?, ?, ?, ?, ?)',
      )
      .run('WO-1001', 'WO-1001', 'verifier', null, 'idle', JSON.stringify([]), null);
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
        'INSERT INTO session (workspace_id, work_order_id, role, scope_track_id, status, transcript, stop_and_ask) VALUES ((SELECT workspace_id FROM work_order WHERE id = ?), ?, ?, ?, ?, ?, ?)',
      )
      .run('WO-1001', 'WO-1001', 'verifier', null, 'idle', JSON.stringify([]), null);
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
    store.recordSession({ providerSessionId: 'sess-A', owner: { kind: 'wo', workOrderId: id }, role: 'implementer', status: 'running' });
    store.recordSession({ providerSessionId: 'sess-A', owner: { kind: 'wo', workOrderId: id }, role: 'implementer', status: 'stopped_asking' });
    store.recordSession({ providerSessionId: 'sess-A', owner: { kind: 'wo', workOrderId: id }, role: 'implementer', status: 'idle', cost: { tokensIn: 5, tokensOut: 6, usd: 0.2 } });

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
    createStore(p).recordSession({ providerSessionId: 'sess-B', owner: { kind: 'wo', workOrderId: woid('WO-1001') }, role: 'implementer', status: 'idle', cost: { tokensIn: 9, tokensOut: 9, usd: 0.9 } });
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
      providerSessionId: 'sess-cost', owner: { kind: 'wo', workOrderId: woid('WO-1001') }, role: 'architect', status: 'idle',
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
      providerSessionId: 'sess-agg', owner: { kind: 'wo', workOrderId: id }, role: 'verifier', status: 'idle',
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
    const { ws, root } = await wsInRoot(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Close me', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    // WO-0069: the plan carries the verifier leg and its report lands BEFORE closure — the
    // verification gate is the record-time computation now, so an honest close flow has one.
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"},{"role":"verifier","aim":"v","scope":"all"}]\n```');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export {};\n');
    store.recordStep(wo.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
    store.recordStepVerdict(wo.id, 1, 'proceed', 'ok');
    store.recordStepReport(wo.id, 2, 'verifier', 'checked `src/a.ts:1`');
    store.recordStepVerdict(wo.id, 2, 'proceed', 'ok');

    await store.closeWorkOrder(wo.id, 'deneme kapanis');

    const docs = await store.getWorkOrderDocs(wo.id);
    expect(docs.order).toContain('## Closure');
    expect(docs.order).toContain('deneme kapanis');
    const row = store.db.prepare('SELECT gate_verifier_resolvable AS v, gate_closure_docs_sha AS s FROM work_order WHERE id = ?').get(wo.id) as { v: number; s: string };
    expect(row.v).toBe(1); // WO-0069: the RECORD-time computation wrote this — closure no longer attests it
    expect(row.s).toBeTruthy(); // 'uncommitted' in a non-git tmp root, a real sha in a git repo
    const merged = store.db.prepare('SELECT COUNT(*) AS n FROM track WHERE work_order_id = ? AND merged_at IS NOT NULL').get(wo.id) as { n: number };
    expect(merged.n).toBeGreaterThan(0);
    const reloaded = await store.getWorkOrder(wo.id);
    expect(reloaded!.stage).toBe('closed');

    // WO-0059 rev 4: the key round-trip that lived here died with the stored key — the sweep test
    // (the provider_key row deleted at open) carries the ruling now.
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
      providerSessionId: 'sess-t1', owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'idle',
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
    store.recordSession({ providerSessionId: 'sess-r1', owner: { kind: 'wo', workOrderId: wo.id }, role: 'architect', status: 'running' });
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
      providerSessionId: 'sess-a1', owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'stopped_asking', stepIdx: 1,
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
    store.recordSession({ providerSessionId: 'sess-d1', owner: { kind: 'wo', workOrderId: wo.id }, role: 'architect', status: 'running', startedAt: '2026-08-15T10:00:00.000Z' });
    store.recordSession({ providerSessionId: 'sess-d1', owner: { kind: 'wo', workOrderId: wo.id }, role: 'architect', status: 'idle', startedAt: '2026-08-15T10:00:00.000Z', endedAt: '2026-08-15T10:04:12.000Z' });
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
    store.recordSession({ providerSessionId: 'sess-x', owner: { kind: 'wo', workOrderId: wo.id }, role: 'architect', status: 'idle', cost: { tokensIn: 1000, tokensOut: 200, usd: 0.10 }, startedAt: '2026-08-15T10:00:00.000Z', endedAt: '2026-08-15T10:02:00.000Z' });
    store.recordSession({ providerSessionId: 'sess-x', owner: { kind: 'wo', workOrderId: wo.id }, role: 'architect', status: 'idle', cost: { tokensIn: 3000, tokensOut: 600, usd: 0.20 }, startedAt: '2026-08-15T11:00:00.000Z', endedAt: '2026-08-15T11:01:00.000Z' });
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
    const { ws, root } = await wsInRoot4(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Revise', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    // WO-0069: the plan carries the verifier leg — closure derives `closed` only over a computed
    // verification gate, so the honest flow records the verifier report before the close attempts.
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"},{"role":"verifier","aim":"v","scope":"all"}]\n```');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export {};\n');
    store.recordStep(wo.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
    store.recordStepVerdict(wo.id, 1, 'revise', 'eksik');
    store.recordStepReport(wo.id, 2, 'verifier', 'checked src/a.ts:1');
    store.recordStepVerdict(wo.id, 2, 'proceed', 'ok');
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
  it('per-role models round-trip; blank roles drop, unknown keys never persist, clear leaves no row (WO-0059 rev 2)', async () => {
    const store = createStore(freshDb());
    // no row → undefined: every role rides the provider's own default (the store never names a value)
    expect(await store.getModels()).toBeUndefined();
    await store.setModels({ architect: 'model-check-x', implementer: '  model-check-y  ', verifier: '  ' });
    expect(await store.getModels()).toEqual({ architect: 'model-check-x', implementer: 'model-check-y' });
    // a write with NO usable role clears the row entirely
    await store.setModels({ verifier: '  ' });
    expect(await store.getModels()).toBeUndefined();
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM app_setting WHERE key = 'models'").get()).toEqual({ n: 0 });
    // a garbage ROW reads undefined (the settingBudget posture): a corrupt map opens no gate
    store.db.prepare("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('models', 'not-json')").run();
    expect(await store.getModels()).toBeUndefined();
    store.db.prepare("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('models', '{\"architect\":5,\"unknown\":\"x\"}')").run();
    expect(await store.getModels()).toBeUndefined(); // a map with no usable role row is nothing
    // undefined clears
    await store.setModels({ architect: 'model-check-x' });
    await store.setModels(undefined);
    expect(await store.getModels()).toBeUndefined();
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM app_setting WHERE key = 'models'").get()).toEqual({ n: 0 });
  });
  it('a legacy provider_key row is swept at open — the stored-key concept retired (WO-0059 rev 4)', () => {
    const path = freshDb();
    const first = createStore(path);
    first.db.prepare("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('provider_key', 'sk-stale')").run();
    const second = createStore(path); // the reopen runs the sweep
    expect(second.db.prepare("SELECT COUNT(*) AS n FROM app_setting WHERE key = 'provider_key'").get()).toEqual({ n: 0 });
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
      store.recordSession({ providerSessionId: `casc-${wo.id}`, owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'idle', cost: { tokensIn: 1, tokensOut: 1, usd: 0.1 } });
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
    store.recordSession({ providerSessionId: 'live-1', owner: { kind: 'wo', workOrderId: wo.id }, role: 'architect', status: 'running' });

    await expect(store.deleteWorkspace(ws.id)).rejects.toThrow(/running/);

    // the guard fired before any delete: WO row, session row, dir, workspace rows all intact
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM work_order WHERE id = ?').get(wo.id) as { n: number }).n).toBe(1);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM session WHERE work_order_id = ?').get(wo.id) as { n: number }).n).toBe(1);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM workspace WHERE id = ?').get(ws.id) as { n: number }).n).toBe(1);
    expect(existsSync(join(root, 'docs', 'work-orders', 'WO-0001-live'))).toBe(true);

    // once the drive ends, the same delete goes through
    store.recordSession({ providerSessionId: 'live-1', owner: { kind: 'wo', workOrderId: wo.id }, role: 'architect', status: 'idle' });
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
    store.recordSession({ providerSessionId: 's-merge', owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'idle', transcript: [
      { speaker: 'note', kind: 'session_started' },
      { speaker: 'assistant', text: 'çalıştı' },
      { speaker: 'tool_use', tool: 'Bash', detail: 'ls', callId: 'c1' },
    ], startedAt: '2026-08-24T01:00:00Z', endedAt: '2026-08-24T01:01:00Z' });
    store.recordSession({ providerSessionId: 's-merge', owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'stopped', transcript: [{ speaker: 'note', kind: 'interrupted' }] });
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
    store.recordSession({ providerSessionId: 'shared-id', owner: { kind: 'wo', workOrderId: woA.id }, role: 'architect', status: 'idle', transcript: [] });
    store.recordSession({ providerSessionId: 'shared-id', owner: { kind: 'wo', workOrderId: woB.id }, role: 'architect', status: 'stopped', transcript: [] });
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
    store.recordSession({ providerSessionId: 'legacy-1', owner: { kind: 'wo', workOrderId: woid('WO-LEGACY') }, role: 'architect', status: 'stopped', transcript: [{ speaker: 'note', kind: 'interrupted' }] });
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
    const base = { owner: { kind: 'wo' as const, workOrderId: wo.id }, role: 'implementer' as const };
    store.recordSession({ ...base, providerSessionId: 's1', status: 'running', pendingNotes: [{ id: 'n1', text: 'bir' }, { id: 'n2', text: 'iki' }] });
    store.recordSession({ ...base, providerSessionId: 's1', status: 'running', pendingNotes: [{ id: 'n2', text: 'iki' }] });
    expect(store.pendingNotesFor({ kind: 'wo', workOrderId: wo.id }, 's1')).toEqual([{ id: 'n2', text: 'iki' }]); // delivery shrank it
    store.recordSession({ ...base, providerSessionId: 's1', status: 'stopped' }); // notes-blind record
    expect(store.pendingNotesFor({ kind: 'wo', workOrderId: wo.id }, 's1')).toEqual([{ id: 'n2', text: 'iki' }]); // not silently dropped
    // and the hydrated session row carries it (the Sürdür seed reads this)
    const hydrated = (await store.getWorkOrder(wo.id))!.sessions.find((s) => s.providerSessionId === 's1');
    expect(hydrated?.pendingNotes).toEqual([{ id: 'n2', text: 'iki' }]);
  });

  it('retractSteerNote rewrites the stopped mirror, audits, and refuses an absent note', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store);
    const wo = await mkWo(store, ws);
    store.recordSession({ owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', providerSessionId: 's1', status: 'stopped', pendingNotes: [{ id: 'n1', text: 'bir' }] });
    expect(await store.retractSteerNote(wo.id, 's1', 'ghost')).toBe(false);
    expect(await store.retractSteerNote(wo.id, 's1', 'n1')).toBe(true);
    expect(store.pendingNotesFor({ kind: 'wo', workOrderId: wo.id }, 's1')).toEqual([]);
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

describe('WO-0047 — workspace budget: threshold row, month window, gate verdict, delete sweep', () => {
  const now = new Date();
  // In-month stamps: fixed UTC noon, day ≤ 28 — never a 31st-in-a-30-day-month bug.
  const inMonth = (day: number): string =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(day, 28), 12)).toISOString();
  const prevMonth = (): string =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12)).toISOString();
  const wsInRoot = async (store: ReturnType<typeof createStore>, label: string) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label, repos: [{ path: root }] });
    return { ws, root };
  };
  const mkWo = (store: ReturnType<typeof createStore>, wsId: WorkspaceId, title: string) =>
    store.createWorkOrder({ workspaceId: wsId, title, description: 'x', trackRepos: [], reviewMode: 'gates', contextFiles: [] });
  // A session row with full control over the window stamp and the cost claim (NULL = no claim).
  const session = (
    store: ReturnType<typeof createStore>,
    woId: WorkOrderId,
    providerId: string,
    startedAt: string,
    usd: number | null,
  ) =>
    store.recordSession({
      providerSessionId: providerId,
      owner: { kind: 'wo', workOrderId: woId },
      role: 'implementer',
      status: 'idle',
      ...(usd === null ? {} : { cost: { tokensIn: 1, tokensOut: 1, usd } }),
      startedAt,
      endedAt: startedAt,
    });

  it('round-trips the threshold as one atomic JSON pair; undefined clears it', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store, 'Budget A');
    expect(await store.getBudget(ws.id)).toBeUndefined();
    await store.setBudget(ws.id, { capUsd: 50, warnPercent: 80 });
    expect(await store.getBudget(ws.id)).toEqual({ capUsd: 50, warnPercent: 80 });
    await store.setBudget(ws.id, undefined);
    expect(await store.getBudget(ws.id)).toBeUndefined();
  });

  it('reads garbage or partial rows as undefined — the gate fails open, never invents a number', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store, 'Budget A');
    for (const bad of ['not json', '{"capUsd":5}', '{"capUsd":"5","warnPercent":80}', '""']) {
      store.db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run(`budget:${ws.id}`, bad);
      expect(await store.getBudget(ws.id)).toBeUndefined();
    }
  });

  it('sums the current UTC month across the workspace’s WOs — prior month, other workspaces and NULL-cost rows excluded; NULL flagged', async () => {
    const store = createStore(freshDb());
    const a = await wsInRoot(store, 'Budget A'); // workspace A
    const b = await wsInRoot(store, 'Budget B'); // workspace B
    // Direct rows: WO numbering is per decision-store ROOT, so two roots both mint WO-0001 and
    // collide on the global work_order PK — the budget read only needs workspace_id + sessions.
    const woRow = (id: string, wsId: WorkspaceId): void => {
      store.db
        .prepare(
          `INSERT INTO work_order (id, workspace_id, title, mode, gate_plan_approved, gate_verifier_resolvable,
           gate_closure_docs_sha, cost_tokens_in, cost_tokens_out, cost_usd, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(id, wsId, `budget test ${id}`, 'direct', 1, null, null, 0, 0, 0, SEED_OBSERVED_AT);
    };
    woRow('WO-9001', a.ws.id);
    woRow('WO-9002', a.ws.id);
    woRow('WO-9003', b.ws.id);
    session(store, woid('WO-9001'), 's-a1-in', inMonth(3), 1.2);
    session(store, woid('WO-9001'), 's-a1-null', inMonth(4), null); // interrupted leg — no claim, no count
    session(store, woid('WO-9001'), 's-a1-prev', prevMonth(), 9.9); // last month
    session(store, woid('WO-9002'), 's-a2-in', inMonth(5), 3.0);
    session(store, woid('WO-9003'), 's-b-in', inMonth(6), 7.7); // other workspace
    const spendA = await store.workspaceMonthSpend(a.ws.id);
    expect(spendA.usd).toBeCloseTo(4.2, 10);
    expect(spendA.hasUnknown).toBe(true); // the s-a1-null row — "bilinen harcama"
    const spendB = await store.workspaceMonthSpend(b.ws.id);
    expect(spendB.usd).toBeCloseTo(7.7, 10);
    expect(spendB.hasUnknown).toBe(false);
  });

  it('budgetBlockFor: absent when unconfigured or at warn (warn is a line, never a block); payload at/over the cap', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store, 'Budget A');
    const wo = await mkWo(store, ws.id, 'gate');
    expect(store.budgetBlockFor(wo.id)).toBeUndefined(); // no threshold → fail open
    await store.setBudget(ws.id, { capUsd: 5, warnPercent: 80 });
    session(store, wo.id, 's-warn', inMonth(1), 4.2); // warn band — drives still start
    expect(store.budgetBlockFor(wo.id)).toBeUndefined();
    session(store, wo.id, 's-stop', inMonth(2), 0.8); // 5.00 total — exactly at the cap
    const atCap = store.budgetBlockFor(wo.id);
    expect(atCap?.capUsd).toBe(5);
    expect(atCap?.observedUsd).toBeCloseTo(5, 10);
    session(store, wo.id, 's-over', inMonth(3), 0.1); // over
    const over = store.budgetBlockFor(wo.id);
    expect(over?.capUsd).toBe(5);
    expect(over?.observedUsd).toBeCloseTo(5.1, 10);
  });

  it('deleting a workspace sweeps its threshold row — a recycled id inherits no dead cap', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store, 'Budget A');
    await store.setBudget(ws.id, { capUsd: 5, warnPercent: 80 });
    await store.deleteWorkspace(ws.id);
    expect(await store.getBudget(ws.id)).toBeUndefined();
    const row = store.db.prepare('SELECT COUNT(*) AS n FROM app_setting WHERE key = ?').get(`budget:${ws.id}`) as { n: number };
    expect(row.n).toBe(0);
  });
});

describe('WO-0048 — roadmap spine: roadmap.md, the view-time task join, the structure root', () => {
  // The antreo world on a REAL decision store: three repos (docs = the decision store), the
  // canonical roadmap.md (the mockup frame-01 fixture), and work orders whose closed flags come
  // from the closure-sha column (deriveStage's own rule) and whose task links live ONLY in their
  // order.md files — the join re-reads them at view time (ADR-0010 rule 1; TD-055).
  const antreoWorld = async (): Promise<{
    store: ReturnType<typeof createStore>;
    dbFile: string;
    root: string;
    ws: { id: WorkspaceId };
    woIds: string[]; // WO-0001..WO-0009 + WO-0012 in fixture order
  }> => {
    const root = freshRoot();
    for (const r of ['docs', 'api', 'mobile']) mkdirSync(join(root, r), { recursive: true });
    const dbFile = freshDb();
    const store = createStore(dbFile);
    const ws = await store.createWorkspace({
      label: 'Antreo App',
      repos: [{ path: join(root, 'docs') }, { path: join(root, 'api') }, { path: join(root, 'mobile') }],
      decisionStorePath: join(root, 'docs'),
    });
    // Ten real WOs: create twelve, delete the two spares (WO-0010/0011) — the sequence must reach 0012.
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const wo = await store.createWorkOrder({
        workspaceId: ws.id, title: `Görev ${i + 1}`, description: 'x',
        trackRepos: [rid('api')], reviewMode: 'gates', contextFiles: [],
      });
      ids.push(wo.id as string);
    }
    await store.deleteWorkOrder(woid('WO-0010'));
    await store.deleteWorkOrder(woid('WO-0011'));
    const woIds = [0, 1, 2, 3, 4, 5, 8, 6, 7, 11].map((i) => ids[i]!); // WO-0001..0006, WO-0009, WO-0007, WO-0008, WO-0012
    // Costs (observed session rows) + closure flags (direct rows — the WO-0047 idiom).
    const db = new DatabaseSync(dbFile);
    const costs: Record<string, number> = { 'WO-0001': 3.1, 'WO-0002': 4.2, 'WO-0003': 1.0, 'WO-0004': 2.6, 'WO-0005': 1.5, 'WO-0006': 0, 'WO-0012': 1.62 };
    let sess = 0;
    for (const [wo, usd] of Object.entries(costs)) {
      if (usd > 0) {
        store.recordSession({ providerSessionId: `s${sess++}`, owner: { kind: 'wo', workOrderId: woid(wo) }, role: 'implementer', status: 'idle', cost: { tokensIn: 1, tokensOut: 1, usd } });
      }
    }
    db.close();
    // Task links FIRST — only in order.md, through the edit port (a closed WO is immutable, so the
    // links go in before the closures below; that is the production order too).
    const links: Record<string, string> = {
      'WO-0001': 'f0-t1', 'WO-0002': 'f0-t1', 'WO-0003': 'f0-t1',
      'WO-0004': 'f0-t2', 'WO-0005': 'f0-t2', 'WO-0006': 'f1-t1', 'WO-0012': 'f1-t3',
    };
    for (const [wo, ref] of Object.entries(links)) await store.updateWorkOrder(woid(wo), { taskRef: ref });
    // Then the closures (direct rows — the WO-0047 idiom).
    const db2 = new DatabaseSync(dbFile);
    for (const wo of ['WO-0001', 'WO-0002', 'WO-0003', 'WO-0004', 'WO-0005', 'WO-0006']) {
      db2.prepare('UPDATE work_order SET gate_closure_docs_sha = ? WHERE id = ?').run('sha-closed', wo);
    }
    db2.close();
    await store.saveRoadmap(ws.id, antreoRoadmapMd);
    return { store, dbFile, root, ws, woIds };
  };

  it('absent roadmap → {kind:"absent"}; saveRoadmap round-trips byte-identical', async () => {
    const root = freshRoot();
    const store = createStore(freshDb());
    const ws = await store.createWorkspace({ label: 'Antreo App', repos: [{ path: root }], decisionStorePath: root });
    expect(await store.getRoadmap(ws.id)).toEqual({ kind: 'absent' });
    await store.saveRoadmap(ws.id, antreoRoadmapMd);
    expect(await store.getRoadmapMd(ws.id)).toBe(antreoRoadmapMd);
  });

  it('getRoadmap reproduces every pinned mockup fact through REAL files + DB rows', async () => {
    const { store, ws } = await antreoWorld();
    const v = await store.getRoadmap(ws.id);
    expect(v.kind).toBe('ready');
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(v.head).toMatchObject({ doneFazCount: 1, totalFazCount: 4, openWoCount: 4 });
    expect(v.head.totalCostUsd).toBeCloseTo(14.02, 10);
    expect(v.fazlar[0]).toMatchObject({ id: 'f0', status: 'tamam', closedWoCount: 5 });
    expect(v.fazlar[0]!.closedCostUsd).toBeCloseTo(12.4, 10);
    expect(v.fazlar[1]).toMatchObject({ id: 'f1', status: 'kosuyor', openWoCount: 1 });
    expect(v.fazlar[1]!.tasks[2]).toMatchObject({ id: 'f1-t3', status: 'kosuyor', openWoIds: ['WO-0012'] });
    expect(v.fazlar[2]).toMatchObject({ id: 'f2', status: 'bekliyor', blockedBy: ['f4'] });
    expect(v.siradaki).toEqual({ fazId: 'f1', taskId: 'f1-t2' });
  });

  it('saveRoadmap refuses a document it cannot re-read — bad JSON AND a missing fence — writing nothing', async () => {
    const { store, ws } = await antreoWorld();
    const before = await store.getRoadmapMd(ws.id);
    await assert.rejects(() => store.saveRoadmap(ws.id, '---\nworkspace: antreo-app\n---\n\n```fazlar\n[oops\n```\n'), /bad JSON/);
    await assert.rejects(() => store.saveRoadmap(ws.id, '---\nworkspace: antreo-app\n---\n\nProse only, no fence.'), /no fazlar fence/);
    expect(await store.getRoadmapMd(ws.id)).toBe(before); // untouched
  });

  it('createWorkOrder({taskRef}) writes task: into order.md and getRoadmap joins it into the task row', async () => {
    const { store, ws } = await antreoWorld();
    const wo = await store.createWorkOrder({
      workspaceId: ws.id, title: 'Doğrulama akışı uçtan uca', description: 'x',
      trackRepos: [rid('api')], reviewMode: 'gates', contextFiles: [], taskRef: 'f1-t2',
    });
    const docs = await store.getWorkOrderDocs(wo.id); // the file on disk, through the port
    expect(docs.order).toContain('task: f1-t2');
    const v = await store.getRoadmap(ws.id);
    if (v.kind !== 'ready') throw new Error('expected ready');
    expect(v.fazlar[1]!.tasks[1]!.openWoIds).toContain(wo.id as string);
  });

  it('a taskRef edit on a CLOSED work order throws (immutable archive, WO-0031f K1)', async () => {
    const { store } = await antreoWorld();
    await assert.rejects(() => store.updateWorkOrder(woid('WO-0001'), { taskRef: 'f1-t2' }), /is closed/);
  });

  it('the structure root: default docs/; .docket moves EVERY read/write; invalid roots refuse; corrupt rows fail open', async () => {
    const { store, dbFile, ws, root } = await antreoWorld();
    expect(await store.getDocsRoot(ws.id)).toBe('docs');
    await store.setDocsRoot(ws.id, '.docket');
    expect(await store.getDocsRoot(ws.id)).toBe('.docket');
    // The roadmap read now looks under .docket/ — the file is still under docs/ → absent until the
    // operator moves it (Docket never moves files — ADR-0016).
    expect(await store.getRoadmap(ws.id)).toEqual({ kind: 'absent' });
    await store.saveRoadmap(ws.id, antreoRoadmapMd);
    expect(existsSync(join(root, 'docs', '.docket', 'roadmap.md'))).toBe(true);
    // R3, pinned: creating under the EMPTY new root mints WO-0001 again and collides on the global
    // PK (TD-035's shape) — honest but abrupt; the CLI warns at the switch. The fix is the operator's
    // act: move the folders. Simulate it (fs in the test = the operator's hands) and create works.
    await assert.rejects(
      () => store.createWorkOrder({ workspaceId: ws.id, title: 'Yeni kökte', description: '', trackRepos: [rid('api')], reviewMode: 'gates', contextFiles: [] }),
      /UNIQUE constraint failed: work_order.id/,
    );
    // The failed create left an orphan WO-0001-* dir under the new root (the known TD-035 shape) —
    // the operator's move starts by clearing it.
    rmSync(join(root, 'docs', '.docket', 'work-orders'), { recursive: true, force: true });
    renameSync(join(root, 'docs', 'docs', 'work-orders'), join(root, 'docs', '.docket', 'work-orders'));
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Yeni kokte', description: '', trackRepos: [rid('api')], reviewMode: 'gates', contextFiles: [] });
    expect(existsSync(join(root, 'docs', '.docket', 'work-orders', `${wo.id as string}-yeni-kokte`, 'order.md'))).toBe(true);
    await assert.rejects(() => store.setDocsRoot(ws.id, '../x'), /not a safe relative root/);
    // A corrupt row must not hide the workspace's documents — the read fails open to docs/.
    const db = new DatabaseSync(dbFile);
    db.prepare("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('docs_root:antreo-app', '../../etc')").run();
    db.close();
    const reopened = createStore(dbFile);
    expect(await reopened.getDocsRoot(ws.id)).toBe('docs');
    expect((await reopened.getRoadmap(ws.id)).kind).toBe('ready'); // the docs/ copy is back
  });

  it('deleteWorkspace sweeps the docs_root row beside the budget row', async () => {
    const root = freshRoot();
    const store = createStore(freshDb());
    const ws = await store.createWorkspace({ label: 'Sweep Me', repos: [{ path: root }], decisionStorePath: root });
    await store.setDocsRoot(ws.id, '.docket');
    await store.deleteWorkspace(ws.id);
    expect(await store.getDocsRoot(ws.id)).toBe('docs'); // row gone — no inheritance for a recycled id
  });

  it('PRAGMA diff: EMPTY — no schema change, no task_ref column (AC3)', async () => {
    const { dbFile } = await antreoWorld();
    const db = new DatabaseSync(dbFile);
    const cols = (db.prepare('PRAGMA table_info(work_order)').all() as { name: string }[]).map((c) => c.name);
    db.close();
    expect(cols).toEqual(['id', 'workspace_id', 'title', 'mode', 'gate_plan_approved', 'gate_verifier_resolvable', 'gate_closure_docs_sha', 'cost_tokens_in', 'cost_tokens_out', 'cost_usd', 'observed_at']);
    expect(cols).not.toContain('task_ref');
  });
});

describe('WO-0050 — the owner migration: workspace_id backfill, nullable work_order_id', () => {
  // The WO-0049-vintage shape: every CHECK and column EXCEPT the owner pair. The rebuild's
  // copy is SESSION_REBUILD_COPY — pinned here end to end.
  const LEGACY_SESSION_DDL =
    'CREATE TABLE session (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_session_id TEXT, work_order_id TEXT NOT NULL, ' +
    "role TEXT NOT NULL CHECK (role IN ('implementer','architect','verifier')), scope_track_id TEXT, " +
    "status TEXT NOT NULL CHECK (status IN ('running','stopped_asking','idle','stopped','none')), transcript TEXT NOT NULL, stop_and_ask TEXT, " +
    'pending_notes TEXT, cost_tokens_in INTEGER, cost_tokens_out INTEGER, cost_usd REAL, started_at TEXT, ended_at TEXT, step_idx INTEGER)';

  it('rebuilds with workspace_id backfilled through the WO join; an orphan row keeps itself with the join-to-nothing key', () => {
    const p = freshDb();
    const raw = new DatabaseSync(p);
    raw.exec(SCHEMA_SQL);
    raw.exec('DROP TABLE session');
    raw.exec(LEGACY_SESSION_DDL);
    raw.prepare(
      `INSERT INTO work_order (id, workspace_id, title, mode, gate_plan_approved, gate_verifier_resolvable,
       gate_closure_docs_sha, cost_tokens_in, cost_tokens_out, cost_usd, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('WO-3001', 'ws-backfill', 'Backfill', 'direct', 1, null, null, 0, 0, 0, SEED_OBSERVED_AT);
    raw.prepare("INSERT INTO session (provider_session_id, work_order_id, role, status, transcript, started_at, ended_at, cost_usd) VALUES (?,?,?,?,?,?,?,?)")
      .run('own-1', 'WO-3001', 'architect', 'idle', '[]', '2026-08-27T10:00:00Z', '2026-08-27T10:01:00Z', 1.5);
    // An ORPHAN — its WO row is gone. The migration fixtures proved this vintage exists; the
    // backfill must keep the row (never brick startup), keying it to nothing ('' joins to no
    // workspace, hydrates into no ledger).
    raw.prepare("INSERT INTO session (provider_session_id, work_order_id, role, status, transcript) VALUES (?,?,?,?,?)")
      .run('orphan-1', 'WO-GONE', 'implementer', 'idle', '[]');
    raw.close();

    const store = createStore(p);
    const owned = store.db.prepare('SELECT provider_session_id, workspace_id, work_order_id FROM session ORDER BY id').all() as
      Array<{ provider_session_id: string; workspace_id: string; work_order_id: string }>;
    expect(owned).toEqual([
      { provider_session_id: 'own-1', workspace_id: 'ws-backfill', work_order_id: 'WO-3001' },
      { provider_session_id: 'orphan-1', workspace_id: '', work_order_id: 'WO-GONE' },
    ]);
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'session_legacy'").get()).toBeUndefined();
    // The widened table now accepts a WO-LESS row — the draft drive's shape.
    store.recordSession({
      providerSessionId: 'draft-1',
      owner: { kind: 'draft', workspaceId: 'ws-backfill' as WorkspaceId },
      role: 'architect',
      status: 'idle',
      cost: { tokensIn: 10, tokensOut: 10, usd: 0.3 },
      startedAt: '2026-08-27T11:00:00Z',
    });
    const draft = store.db.prepare("SELECT workspace_id, work_order_id FROM session WHERE provider_session_id = 'draft-1'").get() as
      { workspace_id: string; work_order_id: string | null };
    expect(draft).toEqual({ workspace_id: 'ws-backfill', work_order_id: null });
  });
});

describe('WO-0050 — the draft session row: budget visibility, ledger invisibility, upsert scope', () => {
  const now = new Date();
  const inMonth = (day: number): string =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(day, 28), 12)).toISOString();
  const wsInRoot = async (store: ReturnType<typeof createStore>, label: string) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label, repos: [{ path: root }] });
    return { ws, root };
  };

  it('counts in the month sum and the draft budget gate while no WO row moves', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store, 'Draft Budget');
    await store.setBudget(ws.id, { capUsd: 4, warnPercent: 80 });
    store.recordSession({
      providerSessionId: 'draft-spend',
      owner: { kind: 'draft', workspaceId: ws.id },
      role: 'architect',
      status: 'idle',
      cost: { tokensIn: 1, tokensOut: 1, usd: 5 },
      startedAt: inMonth(10),
    });
    expect((await store.workspaceMonthSpend(ws.id)).usd).toBeCloseTo(5, 10);
    expect(store.budgetBlockForDraft(ws.id)).toEqual({ observedUsd: 5, capUsd: 4 });
    // The pre-widening hole, pinned shut at the arithmetic layer: no WO exists for this spend.
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM work_order').get() as { n: number }).toEqual({ n: 0 });
  });

  it('never hydrates into any WO ledger — the draft is structurally invisible there', async () => {
    const store = createStore(freshDb());
    const { ws, root } = await wsInRoot(store, 'Draft Ledger');
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Bir iş', description: 'x', trackRepos: [], reviewMode: 'gates', contextFiles: [] });
    expect(root).toBeDefined();
    store.recordSession({ providerSessionId: 'wo-sess', owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'idle' });
    store.recordSession({ providerSessionId: 'draft-sess', owner: { kind: 'draft', workspaceId: ws.id }, role: 'architect', status: 'idle' });
    const hydrated = await store.getWorkOrder(wo.id);
    expect(hydrated!.sessions.map((s) => s.providerSessionId)).toEqual(['wo-sess']);
  });

  it('the NULL-safe upsert key: one provider id on a WO and a draft are two rows, never one stealing the other', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store, 'Draft Key');
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'İş', description: 'x', trackRepos: [], reviewMode: 'gates', contextFiles: [] });
    store.recordSession({ providerSessionId: 'shared', owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'idle', transcript: [{ speaker: 'assistant', text: 'wo' }] });
    store.recordSession({ providerSessionId: 'shared', owner: { kind: 'draft', workspaceId: ws.id }, role: 'architect', status: 'idle', transcript: [{ speaker: 'assistant', text: 'draft' }] });
    const rows = store.db.prepare("SELECT workspace_id, work_order_id, transcript FROM session WHERE provider_session_id = 'shared'").all() as
      Array<{ workspace_id: string; work_order_id: string | null; transcript: string }>;
    expect(rows).toHaveLength(2);
  });

  it('a running draft blocks workspace deletion; the cascade removes the draft rows', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsInRoot(store, 'Draft Delete');
    store.recordSession({ providerSessionId: 'draft-live', owner: { kind: 'draft', workspaceId: ws.id }, role: 'architect', status: 'running' });
    await assert.rejects(() => store.deleteWorkspace(ws.id), /running session/);
    store.recordSession({ providerSessionId: 'draft-live', owner: { kind: 'draft', workspaceId: ws.id }, role: 'architect', status: 'idle' });
    store.saveRoadmapDraft(ws.id, '# boş', undefined);
    await store.deleteWorkspace(ws.id);
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM roadmap_draft').get() as { n: number }).toEqual({ n: 0 });
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).toEqual({ n: 0 });
  });
});

describe('WO-0050 — the roadmap_draft row lifecycle (write → read → guard → approve)', () => {
  const wsInRoot = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    return store.createWorkspace({ label: 'Taslak WS', repos: [{ path: root }] });
  };
  const fazlar = [{ id: 'f0', title: 'Kullanıcı Yönetimi', blockedBy: [], tasks: [{ id: 'f0-t1', title: 'Kayıt akışı' }, { id: 'f0-t2', title: 'Giriş akışı' }] }];
  const validMd = (slug: string): string => buildRoadmapMd({ workspaceSlug: slug, title: 'Yol Haritası', fazlar });

  it('plan_ready write → the card read (md + provider id + session seed); the İtiraz handle survives', async () => {
    const store = createStore(freshDb());
    const ws = await wsInRoot(store);
    store.recordSession({ providerSessionId: 'draft-9', owner: { kind: 'draft', workspaceId: ws.id }, role: 'architect', status: 'idle', cost: { tokensIn: 1, tokensOut: 1, usd: 0.4 }, transcript: [{ speaker: 'assistant', text: 'taslak hazır' }] });
    store.saveRoadmapDraft(ws.id, validMd(ws.id as string), { providerSessionId: 'draft-9' });
    const draft = await store.getRoadmapDraft(ws.id);
    expect(draft).not.toBeNull();
    expect(draft!.providerSessionId).toBe('draft-9');
    expect(draft!.session?.providerSessionId).toBe('draft-9');
    expect(draft!.session?.cost?.usd).toBeCloseTo(0.4, 10);
    expect(draft!.md).toContain('```fazlar');
  });

  it('the supersede guard: a valid row is never overwritten by an unparseable proposal', async () => {
    const store = createStore(freshDb());
    const ws = await wsInRoot(store);
    store.saveRoadmapDraft(ws.id, validMd(ws.id as string), { providerSessionId: 'd1' });
    store.saveRoadmapDraft(ws.id, 'no fence at all', { providerSessionId: 'd2' });
    expect((await store.getRoadmapDraft(ws.id))!.md).toContain('```fazlar'); // the valid one kept
    // valid → valid still supersedes (the objection round's revised proposal)
    const revised = buildRoadmapMd({ workspaceSlug: ws.id as string, title: 'Yol Haritası 2', fazlar });
    store.saveRoadmapDraft(ws.id, revised, { providerSessionId: 'd2' });
    expect((await store.getRoadmapDraft(ws.id))!.md).toContain('Yol Haritası 2');
  });

  it('Onayla is atomic: parse-guard → byte-identical write → row gone', async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Onayla WS', repos: [{ path: root }] });
    const md = validMd(ws.id as string);
    store.saveRoadmapDraft(ws.id, md, { providerSessionId: 'd3' });
    await store.approveRoadmapDraft(ws.id);
    expect(await store.getRoadmapDraft(ws.id)).toBeNull(); // the row died with the decision
    expect((await store.getRoadmap(ws.id)).kind).toBe('ready'); // the file is the truth now
    expect(readFileSync(join(root, 'docs', 'roadmap.md'), 'utf8')).toBe(md); // byte-identical
  });

  it('approve refuses an unparseable row naming the reason, writing nothing', async () => {
    const store = createStore(freshDb());
    const ws = await wsInRoot(store);
    // invalid → invalid rows DO land (stored, not rejected — the card renders the honest line;
    // the guard lives HERE, at the approval boundary)
    store.db.prepare('INSERT INTO roadmap_draft (workspace_id, md, provider_session_id, created_at, updated_at) VALUES (?,?,?,?,?)').run(ws.id, 'çit yok', null, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z');
    await assert.rejects(() => store.approveRoadmapDraft(ws.id), /no fazlar fence/);
    expect(await store.getRoadmapDraft(ws.id)).not.toBeNull(); // the row stays — the operator still decides
    expect((await store.getRoadmapMd(ws.id))).toBe(''); // nothing written
  });

  it('Düzenle: updateRoadmapDraft refuses an unparseable edit loudly; a valid edit lands', async () => {
    const store = createStore(freshDb());
    const ws = await wsInRoot(store);
    store.saveRoadmapDraft(ws.id, validMd(ws.id as string), { providerSessionId: 'd4' });
    await assert.rejects(() => store.updateRoadmapDraft(ws.id, 'bozuk'), /no fazlar fence/);
    const edited = buildRoadmapMd({ workspaceSlug: ws.id as string, title: 'Düzenlendi', fazlar });
    await store.updateRoadmapDraft(ws.id, edited);
    expect((await store.getRoadmapDraft(ws.id))!.md).toContain('Düzenlendi');
  });

  it('roadmapDraftPromptFor composes from the workspace facts; undefined for a missing workspace', async () => {
    const store = createStore(freshDb());
    const ws = await wsInRoot(store);
    const p = store.roadmapDraftPromptFor(ws.id, 'iki fazlı taslak', ['/tmp/a.md', '/tmp/b.md']);
    expect(p).toContain('iki fazlı taslak');
    expect(p).toContain('- /tmp/a.md');
    expect(p).toContain(ws.id as string);
    expect(store.roadmapDraftPromptFor('ghost-ws' as WorkspaceId, 'x', [])).toBeUndefined();
  });
});

describe('WO-0051 — the ✦ source channels (depo scan · counts persistence · fence root)', () => {
  const fazlar = [{ id: 'f0', title: 'Kullanıcı Yönetimi', blockedBy: [], tasks: [{ id: 'f0-t1', title: 'Kayıt akışı' }] }];
  const validMd = (slug: string): string => buildRoadmapMd({ workspaceSlug: slug, title: 'Yol Haritası', fazlar });
  const wsWithDocs = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    return { root, ws: await store.createWorkspace({ label: 'Depo WS', repos: [{ path: root }] }) };
  };

  it('decisionDocs: the recursive .md scan — root-relative, sorted, .md only, dot-dirs skipped', async () => {
    const store = createStore(freshDb());
    const { root, ws } = await wsWithDocs(store);
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'faz-0-altyapi.md'), 'a', 'utf8');
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
    writeFileSync(join(root, 'docs', 'adr', 'ADR-9002-olcek.md'), 'b', 'utf8');
    writeFileSync(join(root, 'docs', 'adr', 'ADR-9001-keşif.md'), 'c', 'utf8');
    mkdirSync(join(root, 'docs', 'notlar'), { recursive: true });
    writeFileSync(join(root, 'docs', 'notlar', 'gorusme.md'), 'd', 'utf8');
    writeFileSync(join(root, 'docs', 'roadmap.md'), 'e', 'utf8'); // the prior document IS a source (D3)
    writeFileSync(join(root, 'docs', 'resim.png'), 'f', 'utf8'); // not .md
    mkdirSync(join(root, 'docs', '.hidden'), { recursive: true });
    writeFileSync(join(root, 'docs', '.hidden', 'gizli.md'), 'g', 'utf8'); // dot-dir
    expect(store.decisionDocs(ws.id)).toEqual({
      docsRoot: 'docs',
      files: ['adr/ADR-9001-keşif.md', 'adr/ADR-9002-olcek.md', 'faz-0-altyapi.md', 'notlar/gorusme.md', 'roadmap.md'],
    });
  });

  it('decisionDocs: a workspace with no docs dir fails open to [] (the zero-doc floor)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsWithDocs(store); // freshRoot exists; docs/ inside it does not
    expect(store.decisionDocs(ws.id)).toEqual({ docsRoot: 'docs', files: [] });
  });

  it('sourceSummary: persisted at save, read back through getRoadmapDraft; garbage reads undefined (fail-open)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsWithDocs(store);
    store.saveRoadmapDraft(ws.id, validMd(ws.id as string), {
      providerSessionId: 'd-51',
      sourceSummary: { store: 11, external: 1, freeExplore: true },
    });
    expect((await store.getRoadmapDraft(ws.id))!.sourceSummary).toEqual({ store: 11, external: 1, freeExplore: true });
    // a corrupt value degrades to absence — the card's kaynak line omits, never a crash
    store.db.prepare("UPDATE roadmap_draft SET source_summary = '{garbage'").run();
    expect((await store.getRoadmapDraft(ws.id))!.sourceSummary).toBeUndefined();
  });

  it('keep-prior: an İtiraz resume write WITHOUT a summary keeps the original figures (D2)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsWithDocs(store);
    store.saveRoadmapDraft(ws.id, validMd(ws.id as string), { sourceSummary: { store: 5, external: 2, freeExplore: false } });
    // the resume's plan_ready carries no composition (the renderer never re-sends it)
    const revised = buildRoadmapMd({ workspaceSlug: ws.id as string, title: 'Revize', fazlar });
    store.saveRoadmapDraft(ws.id, revised, { providerSessionId: 'd-resume' });
    expect((await store.getRoadmapDraft(ws.id))!.sourceSummary).toEqual({ store: 5, external: 2, freeExplore: false });
  });

  it('roadmapDraftPromptFor threads freeExplore — the ONE sentence appears iff the flag (D5)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsWithDocs(store);
    expect(store.roadmapDraftPromptFor(ws.id, 'not', [], true)).toContain('explore the repository yourself');
    expect(store.roadmapDraftPromptFor(ws.id, 'not', [])).not.toContain('explore the repository yourself');
  });

  it('decisionStoreRootFor: the draft AND the WO architect both land on the workspace structure root (D9 / TD-056)', async () => {
    const store = createStore(freshDb());
    const { root, ws } = await wsWithDocs(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'İş', description: 'x', trackRepos: [], reviewMode: 'gates', contextFiles: [] });
    expect(store.decisionStoreRootFor({ role: 'architect', workspaceId: ws.id, mode: 'plan', prompt: '', goalNote: 'n', docPaths: [] })).toBe(join(root, 'docs'));
    expect(store.decisionStoreRootFor({ role: 'architect', workOrderId: wo.id, mode: 'plan', prompt: '' })).toBe(join(root, 'docs'));
    expect(store.decisionStoreRootFor({ role: 'architect', workOrderId: woid('WO-YOK'), mode: 'plan', prompt: '' })).toBeUndefined();
  });

  it('migration: a pre-WO-0051 roadmap_draft vintage upgrades — the row survives, the summary reads honestly absent', () => {
    const p = freshDb();
    const raw = new DatabaseSync(p);
    raw.exec('CREATE TABLE roadmap_draft (workspace_id TEXT PRIMARY KEY, md TEXT NOT NULL, provider_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    raw.prepare('INSERT INTO roadmap_draft VALUES (?,?,?,?,?)').run('ws-old', 'eski taslak', 'sess-old', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z');
    raw.close();
    const store = createStore(p); // SCHEMA_SQL (IF NOT EXISTS keeps the vintage) + migrate → ALTER
    const cols = store.db.prepare('PRAGMA table_info(roadmap_draft)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('source_summary');
    const row = store.db.prepare("SELECT md FROM roadmap_draft WHERE workspace_id = 'ws-old'").get() as { md: string };
    expect(row.md).toBe('eski taslak');
  });
});

describe('WO-0050 — driveCwd (the connection-table fix)', () => {
  it('scoped WO drive → the track repo path; draft and unscoped WO → the decision-store repo; no match → process.cwd()', async () => {
    const store = createStore(freshDb());
    const rootApi = freshRoot();
    const rootDocs = freshRoot();
    const apiSlug = rootApi.split('/').pop()!;
    const docsSlug = rootDocs.split('/').pop()!;
    const ws = await store.createWorkspace({
      label: 'Cwd WS',
      repos: [{ path: rootApi }, { path: rootDocs }],
      decisionStorePath: rootDocs,
    });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'İş', description: 'x', trackRepos: [rid(apiSlug)], reviewMode: 'gates', contextFiles: [] });
    const hydrated = await store.getWorkOrder(wo.id);
    const track = hydrated!.tracks[0]!;
    // scoped drive (a step drive): the track repo's connected path
    expect(store.driveCwd({ role: 'implementer', workOrderId: wo.id, scope: track.id, mode: 'direct', prompt: '' })).toBe(rootApi);
    // unscoped WO drive (architect plan/free/verifier): the decision-store repo
    expect(store.driveCwd({ role: 'architect', workOrderId: wo.id, mode: 'plan', prompt: '' })).toBe(rootDocs);
    expect(store.driveCwd({ role: 'verifier', workOrderId: wo.id, mode: 'direct', prompt: '' })).toBe(rootDocs);
    // the draft: the decision-store repo (docsSlug pins the match — basename, not substring)
    expect(store.driveCwd({ role: 'architect', workspaceId: ws.id, mode: 'plan', prompt: '', goalNote: 'n', docPaths: [] })).toBe(rootDocs);
    expect(docsSlug.length).toBeGreaterThan(0);
    // nothing matches (a WO that does not exist): today's behavior, byte-for-byte
    expect(store.driveCwd({ role: 'architect', workOrderId: woid('WO-NONE'), mode: 'plan', prompt: '' })).toBe(process.cwd());
  });
});

// ===== WO-0052 — the usage instrumentation floor (session_usage + the ctx/final checkpoints) =====
// The floor's contract: every OBSERVED provider result appends ONE per-turn row (held intermediates
// included); the latest context reading and the final usage checkpoint onto the session row;
// ABSENT means NULL, never a fabricated 0. The aggregate cost columns' `prior + input` semantics
// are NOT this WO's — the WO-0029 pin above must stay green untouched.
describe('WO-0052 — session_usage rows + the ctx/finalUsage checkpoints', () => {
  const wsIn = async (store: ReturnType<typeof createStore>, label: string) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label, repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: label, description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    return { ws, wo };
  };
  // WO-0073: usageRowsFor (the CLI `show` tail's concrete read) is gone with the CLI; the row
  // persistence semantics stay witnessed COLUMN-level through this raw read (same SELECT, raw columns).
  const usageRows = (store: ReturnType<typeof createStore>, woId: string) =>
    store.db.prepare('SELECT * FROM session_usage WHERE work_order_id = ? ORDER BY id').all(woId) as Array<Record<string, unknown>>;
  const usageFull: TurnUsage = {
    cacheRead: 91008,
    cacheCreation: 2048,
    numTurns: 7,
    durationMs: 41200,
    durationApiMs: 38500,
    modelUsage: [{ model: 'm-1', tokensIn: 300, tokensOut: 90, usd: 0.05 }],
  };

  it('a usage-bearing result persists verbatim at the per-turn row (AC1, present direction)', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Usage full');
    const owner = { kind: 'wo', workOrderId: wo.id } as const;
    store.recordTurnUsage(owner, 'sess-u1', { at: '2026-08-28T10:00:00.000Z', delta: { tokensIn: 27802, tokensOut: 50, usd: 0.17658 }, usage: usageFull });
    const rows = usageRows(store, wo.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider_session_id: 'sess-u1',
      at: '2026-08-28T10:00:00.000Z',
      tokens_in: 27802,
      tokens_out: 50,
      usd_delta: 0.17658,
      cache_read: 91008,
      cache_creation: 2048,
      num_turns: 7,
      duration_ms: 41200,
      duration_api_ms: 38500,
      model: 'm-1', // single-model shortcut
    });
    expect(JSON.parse(rows[0]!.model_usage as string)).toEqual(usageFull.modelUsage); // the verbatim split
  });

  it('a usage-less result persists ABSENT — NULL cache/turns/durations/model, never zeros (AC1, absent direction)', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Usage bare');
    const owner = { kind: 'wo', workOrderId: wo.id } as const;
    store.recordTurnUsage(owner, 'sess-u2', { at: '2026-08-28T10:01:00.000Z', delta: { tokensIn: 44, tokensOut: 158, usd: 0.029322 } });
    const rows = usageRows(store, wo.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tokens_in: 44, tokens_out: 158, usd_delta: 0.029322 });
    expect(rows[0]!.cache_read).toBeNull();
    expect(rows[0]!.cache_creation).toBeNull();
    expect(rows[0]!.num_turns).toBeNull();
    expect(rows[0]!.duration_ms).toBeNull();
    expect(rows[0]!.duration_api_ms).toBeNull();
    expect(rows[0]!.model).toBeNull();
    expect(rows[0]!.model_usage).toBeNull();
  });

  it('every observed turn appends exactly one row; the session upsert never touches them (AC2)', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Usage append');
    const owner = { kind: 'wo', workOrderId: wo.id } as const;
    store.recordTurnUsage(owner, 'sess-u3', { at: '2026-08-28T10:00:00.000Z', delta: { tokensIn: 10, tokensOut: 2, usd: 0.01 }, usage: { cacheRead: 100 } });
    store.recordTurnUsage(owner, 'sess-u3', { at: '2026-08-28T10:01:00.000Z', delta: { tokensIn: 20, tokensOut: 4, usd: 0.02 } }); // a held intermediate
    // the session upsert (DELETE+INSERT of the session row) must not delete usage rows
    store.recordSession({ providerSessionId: 'sess-u3', owner, role: 'implementer', status: 'idle', cost: { tokensIn: 30, tokensOut: 6, usd: 0.03 } });
    store.recordSession({ providerSessionId: 'sess-u3', owner, role: 'implementer', status: 'idle', cost: { tokensIn: 1, tokensOut: 1, usd: 0.001 } });
    const rows = usageRows(store, wo.id);
    expect(rows).toHaveLength(2); // append-only through the upsert
    expect(rows.map((r) => r.at)).toEqual(['2026-08-28T10:00:00.000Z', '2026-08-28T10:01:00.000Z']); // insertion order
    // and the AGGREGATE accumulation stays exactly today's: prior + input, floats summed
    const s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect(s.cost!.tokensIn).toBe(31);
    expect(s.cost!.tokensOut).toBe(7);
    expect(s.cost!.usd).toBeCloseTo(0.031, 10);
  });

  it('resume legs append to the SAME session with no double-count — each delta is that leg own spend (AC2, c2 semantics)', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Usage legs');
    const owner = { kind: 'wo', workOrderId: wo.id } as const;
    // leg 1 (raw/c2: ended 0.094824) — two turns
    store.recordTurnUsage(owner, 'sess-leg', { at: '2026-08-28T11:00:00.000Z', delta: { tokensIn: 9599, tokensOut: 53, usd: 0.094824 } });
    // leg 2 (resumed: reported 0.056219 — SMALLER than leg 1's total, taken WHOLE)
    store.recordTurnUsage(owner, 'sess-leg', { at: '2026-08-28T11:05:00.000Z', delta: { tokensIn: 213, tokensOut: 194, usd: 0.056219 } });
    const rows = usageRows(store, wo.id);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((a, r) => a + (r.usd_delta as number), 0)).toBeCloseTo(0.151043, 6); // the true session total, no double-count
    expect(rows.reduce((a, r) => a + (r.tokens_in as number), 0)).toBe(9599 + 213);
  });

  it('a multi-model result NULLs the model shortcut and keeps the verbatim JSON split', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Usage multi');
    const owner = { kind: 'wo', workOrderId: wo.id } as const;
    const split: TurnUsage = { modelUsage: [
      { model: 'm-a', tokensIn: 100, tokensOut: 10, usd: 0.01 },
      { model: 'm-b', tokensIn: 200, tokensOut: 20, usd: 0.02 },
    ] };
    store.recordTurnUsage(owner, 'sess-multi', { at: '2026-08-28T10:02:00.000Z', delta: { tokensIn: 300, tokensOut: 30, usd: 0.03 }, usage: split });
    const rows = usageRows(store, wo.id);
    expect(rows[0]!.model).toBeNull(); // 0-or-≥2 models → the shortcut is honestly NULL
    expect(JSON.parse(rows[0]!.model_usage as string)).toEqual(split.modelUsage);
  });

  it('ctx/finalUsage checkpoint onto the session row: defined overwrites (latest-wins), undefined keeps prior (AC3)', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Usage ctx');
    const owner = { kind: 'wo', workOrderId: wo.id } as const;
    const base = { providerSessionId: 'sess-ctx', owner, role: 'architect' as const };
    store.recordSession({ ...base, status: 'running' });
    let s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect('ctx' in s).toBe(false); // no reading yet — absent, never zeros
    expect('finalUsage' in s).toBe(false);

    store.recordSession({ ...base, status: 'running', ctx: { usedTokens: 46000, maxTokens: 200000 }, finalUsage: usageFull });
    s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect(s.ctx).toEqual({ usedTokens: 46000, maxTokens: 200000 });
    expect(s.finalUsage).toEqual(usageFull);

    // a later record from a notes-blind/context-blind path keeps the latest KNOWN reading
    store.recordSession({ ...base, status: 'idle', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } });
    s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect(s.ctx).toEqual({ usedTokens: 46000, maxTokens: 200000 });
    expect(s.finalUsage).toEqual(usageFull);

    // a NEWER reading overwrites (latest-wins)
    store.recordSession({ ...base, status: 'idle', ctx: { usedTokens: 100608, maxTokens: 200000 } });
    s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect(s.ctx).toEqual({ usedTokens: 100608, maxTokens: 200000 });
  });

  it('a final_model_usage blob that is a JSON ARRAY hydrates ABSENT — not finalUsage: [] (review minor, fail-open)', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Usage blob');
    const owner = { kind: 'wo', workOrderId: wo.id } as const;
    store.recordSession({ providerSessionId: 'sess-blob', owner, role: 'architect', status: 'idle', finalUsage: usageFull });
    // corrupt the blob into the shape the guard must reject: a JSON array is an OBJECT to typeof
    store.db.prepare("UPDATE session SET final_model_usage = '[]' WHERE provider_session_id = ?").run('sess-blob');
    const s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect('finalUsage' in s).toBe(false); // absent — a corrupt blob must not brick hydration nor leak a non-TurnUsage
  });

  it('a session with no usage facts hydrates honestly absent (no ctx, no finalUsage)', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Usage none');
    store.recordSession({ providerSessionId: 'sess-none', owner: { kind: 'wo', workOrderId: wo.id }, role: 'verifier', status: 'stopped', cost: { tokensIn: 5, tokensOut: 5, usd: 0.05 } });
    const s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect('ctx' in s).toBe(false);
    expect('finalUsage' in s).toBe(false);
    expect(usageRows(store, wo.id)).toEqual([]); // an interrupted drive appends nothing
  });
  it('an interrupted leg writes NULL cost — the honest absent the known-spend basis reads (WO-0061)', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Usage null');
    // a Durdur/abort close carries NO cost (the pipeline passes undefined) — the row must stay
    // NULL, never a painted $0.00 the usage head would speak as truth
    store.recordSession({ providerSessionId: 'sess-null-cost', owner: { kind: 'wo', workOrderId: wo.id }, role: 'verifier', status: 'stopped' });
    const row = store.db.prepare('SELECT cost_usd FROM session WHERE provider_session_id = ?').get('sess-null-cost') as { cost_usd: number | null };
    expect(row.cost_usd).toBeNull();
  });

  it('draft rows surface under workspaceUsage(ws).draft (queue 4 landed — WO-0054): the workspace-scoped read carries them', async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Usage draft', repos: [{ path: root }] });
    const owner = { kind: 'draft', workspaceId: ws.id } as const;
    // The read windows by CALENDAR MONTH — an absolute stamp rots when the month rolls (found live
    // 2026-09-09: an August stamp went empty on Sept 1). Stamp inside the CURRENT month.
    const stamp = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 15, 10, 3)).toISOString();
    store.recordTurnUsage(owner, 'sess-draft', { at: stamp, delta: { tokensIn: 7, tokensOut: 7, usd: 0.007 }, usage: { cacheRead: 5 } });
    const raw = store.db.prepare('SELECT COUNT(*) AS n FROM session_usage WHERE provider_session_id = ?').get('sess-draft') as { n: number };
    expect(raw.n).toBe(1); // the row persisted under the draft owner
    const view = await store.workspaceUsage(ws.id);
    expect(view.empty).toBe(false); // draft rows ARE rows
    expect(view.draft).toEqual({ usd: 0.01, tokensIn: 7, tokensOut: 7, sessionCount: 1 }); // round2(0.007)
  });


  it('migrates a pre-WO-0052 DB: the new columns + table exist, old rows stay honestly NULL/empty', () => {
    const p = freshDb();
    // Hand-build the pre-WO-0052 vintage: a session table with the owner pair + 'stopped' (so no
    // earlier rebuild clause claims it) but without the usage columns; no session_usage table.
    const raw = new DatabaseSync(p);
    raw.exec(
      `CREATE TABLE session (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_session_id TEXT, workspace_id TEXT NOT NULL,
       work_order_id TEXT, role TEXT NOT NULL, scope_track_id TEXT, status TEXT NOT NULL, transcript TEXT NOT NULL,
       stop_and_ask TEXT, pending_notes TEXT, cost_tokens_in INTEGER, cost_tokens_out INTEGER, cost_usd REAL,
       started_at TEXT, ended_at TEXT, step_idx INTEGER)`,
    );
    raw
      .prepare("INSERT INTO session (provider_session_id, workspace_id, work_order_id, role, status, transcript) VALUES (?,?,?,?,?,'[]')")
      .run('old-1', 'ws-x', null, 'architect', 'idle');
    raw.close();

    const store = createStore(p); // SCHEMA_SQL no-ops the legacy session, then migrate
    const cols = (store.db.prepare('PRAGMA table_info(session)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['ctx_used_tokens', 'ctx_max_tokens', 'final_model_usage']));
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM session_usage').get() as { n: number }).n).toBe(0);
    const old = store.db.prepare('SELECT ctx_used_tokens, ctx_max_tokens, final_model_usage FROM session WHERE provider_session_id = ?').get('old-1') as {
      ctx_used_tokens: number | null;
      ctx_max_tokens: number | null;
      final_model_usage: string | null;
    };
    expect(old.ctx_used_tokens).toBeNull(); // pre-WO-0052 rows: honestly absent, never backfilled
    expect(old.ctx_max_tokens).toBeNull();
    expect(old.final_model_usage).toBeNull();
    // the row still hydrates (through the extended SESSION_REBUILD_COPY when the vintage triggers it)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM session').get()).toMatchObject({ n: 1 });
  });
});

describe('WO-0053 — the limit stamp on the session row (set · keep · clear)', () => {
  const wsIn = async (store: ReturnType<typeof createStore>, label: string) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label, repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: label, description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    return { ws, wo };
  };
  const STAMP = '2026-08-29T14:32:00.000Z';

  it('a string SETS, undefined KEEPS, null CLEARS — and hydration carries the honest fact', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Limit stamp');
    const owner = { kind: 'wo', workOrderId: wo.id } as const;
    // SET — the terminal record of a limit death
    store.recordSession({ providerSessionId: 'sess-l1', owner, role: 'implementer', status: 'idle', limitResetAt: STAMP });
    let s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect(s.limitResetAt).toBe(STAMP);
    // KEEP — an ordinary record from a notes-blind path must not erase it
    store.recordSession({ providerSessionId: 'sess-l1', owner, role: 'implementer', status: 'idle', cost: { tokensIn: 1, tokensOut: 1, usd: 0.01 } });
    s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect(s.limitResetAt).toBe(STAMP);
    // CLEAR — a later CLEAN leg (a stale stamp is a lie)
    store.recordSession({ providerSessionId: 'sess-l1', owner, role: 'implementer', status: 'idle', cost: { tokensIn: 2, tokensOut: 2, usd: 0.02 }, limitResetAt: null });
    s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect('limitResetAt' in s).toBe(false);
  });

  it('a null CLEAR on an UNstamped row leaves it absent — no churn, never a phantom write', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsIn(store, 'Limit bare clear');
    store.recordSession({ providerSessionId: 'sess-l2', owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'idle', limitResetAt: null });
    const s = (await store.getWorkOrder(wo.id))!.sessions[0]!;
    expect('limitResetAt' in s).toBe(false);
    const raw = store.db.prepare('SELECT limit_reset_at FROM session WHERE provider_session_id = ?').get('sess-l2') as { limit_reset_at: string | null };
    expect(raw.limit_reset_at).toBeNull();
  });

  it('migrates a pre-WO-0053 DB: the column arrives, old rows stay NULL, and a stamp round-trips through the migrated row', () => {
    const p = freshDb();
    // Hand-build the pre-WO-0053 vintage: the owner pair + usage columns present, no 'stopped'
    // CHECK (so the SESSION_REBUILD_COPY vintage triggers — the copy must carry the new column),
    // and no limit_reset_at.
    const raw = new DatabaseSync(p);
    raw.exec(
      `CREATE TABLE session (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_session_id TEXT, workspace_id TEXT NOT NULL,
       work_order_id TEXT, role TEXT NOT NULL, scope_track_id TEXT, status TEXT NOT NULL, transcript TEXT NOT NULL,
       stop_and_ask TEXT, pending_notes TEXT, cost_tokens_in INTEGER, cost_tokens_out INTEGER, cost_usd REAL,
       started_at TEXT, ended_at TEXT, step_idx INTEGER, ctx_used_tokens INTEGER, ctx_max_tokens INTEGER, final_model_usage TEXT)`,
    );
    raw
      .prepare("INSERT INTO session (provider_session_id, workspace_id, work_order_id, role, status, transcript) VALUES (?,?,?,?,?,'[]')")
      .run('old-53', 'ws-x', null, 'architect', 'idle');
    raw.close();

    const store = createStore(p); // SCHEMA_SQL no-ops the legacy session, then migrate: ALTER + rebuild
    const cols = (store.db.prepare('PRAGMA table_info(session)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['limit_reset_at']));
    const old = store.db.prepare('SELECT limit_reset_at FROM session WHERE provider_session_id = ?').get('old-53') as { limit_reset_at: string | null };
    expect(old.limit_reset_at).toBeNull(); // pre-WO-0053 rows: honestly absent, never backfilled
    // the rebuilt table accepts the three-state write (the copy left it a full SCHEMA_SQL table).
    // The rebuild backfilled the orphan's workspace_id to '' (the WO-0052 fixture's COALESCE rule)
    // — the write must scope to THAT owner, or the upsert opens a sibling row.
    store.recordSession({ providerSessionId: 'old-53', owner: { kind: 'draft', workspaceId: '' as never }, role: 'architect', status: 'idle', limitResetAt: STAMP });
    const stamped = store.db.prepare("SELECT limit_reset_at FROM session WHERE provider_session_id = ? AND workspace_id = '' AND work_order_id IS NULL").get('old-53') as { limit_reset_at: string | null };
    expect(stamped.limit_reset_at).toBe(STAMP);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n).toBe(1); // one row, upserted
  });
});

// ===== WO-0054 — the usage screen's store read (workspaceUsage) + the cascade completion =====
// The read is the ledger's ONE workspace-scoped shape: flat rows only (SQL never aggregates —
// TD-058), windowed on the CURRENT UTC calendar month by `at`, joined in core to the session
// facts (role/cost/started_at/ctx). The cascade completion makes a deleted owner's spend die
// with the owner — the ledger is append-only against the UPSERT, not against the OWNER.
describe('WO-0054 — workspaceUsage (the pure view over the usage ledger) + the delete cascades', () => {
  const wsIn = async (store: ReturnType<typeof createStore>, label: string) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label, repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: label, description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    return { ws, wo };
  };
  // The read's own window (core's UTC calendar month) — the fixtures must land inside it.
  const month = monthWindow(new Date());
  const inMonth = (day: number, hour = 10): string =>
    new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), Math.min(day, 27), hour)).toISOString();
  const lastMonthIso = (): string =>
    new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15, 12)).toISOString();
  const expectInsideMonth = (): void => {
    const probe = inMonth(3);
    if (probe < month.startIso || probe >= month.endIso) throw new Error('fixture drifted out of the read window');
  };

  it('scopes to ONE workspace — another workspace’s rows and sessions never appear', async () => {
    expectInsideMonth();
    const store = createStore(freshDb());
    // WO numbering is per decision-store ROOT, so two roots both mint WO-0001 and collide on the
    // global work_order PK (the WO-0047 block's note) — the two-workspace rows go in directly.
    const wsOnly = async (label: string) => {
      const root = freshRoot();
      return store.createWorkspace({ label, repos: [{ path: root }] });
    };
    const wsa = await wsOnly('Kullanım A');
    const wsb = await wsOnly('Kullanım B');
    const woRow = (id: string, wsId: WorkspaceId, title: string): WorkOrderId => {
      store.db
        .prepare(
          `INSERT INTO work_order (id, workspace_id, title, mode, gate_plan_approved, gate_verifier_resolvable,
           gate_closure_docs_sha, cost_tokens_in, cost_tokens_out, cost_usd, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(id, wsId, title, 'plan', 1, null, null, 0, 0, 0, SEED_OBSERVED_AT);
      return woid(id);
    };
    const woA = woRow('WO-9101', wsa.id, 'Kullanım A işi');
    const woB = woRow('WO-9102', wsb.id, 'Kullanım B işi');
    store.recordSession({ providerSessionId: 'sa', owner: { kind: 'wo', workOrderId: woA }, role: 'implementer', status: 'idle', startedAt: inMonth(3), endedAt: inMonth(3) });
    store.recordSession({ providerSessionId: 'sb', owner: { kind: 'wo', workOrderId: woB }, role: 'architect', status: 'idle', startedAt: inMonth(4), endedAt: inMonth(4) });
    store.recordTurnUsage({ kind: 'wo', workOrderId: woA }, 'sa', { at: inMonth(3), delta: { tokensIn: 10, tokensOut: 1, usd: 0.5 } });
    store.recordTurnUsage({ kind: 'wo', workOrderId: woB }, 'sb', { at: inMonth(4), delta: { tokensIn: 20, tokensOut: 2, usd: 9.99 } });
    const va = await store.workspaceUsage(wsa.id);
    expect(va.empty).toBe(false);
    expect(va.totals).toEqual({ usd: 0.5, tokensIn: 10, tokensOut: 1 });
    expect(va.byRole.map((x) => x.role)).toEqual(['implementer']);
    expect(va.workOrders).toEqual([{ id: woA, title: 'Kullanım A işi', usd: 0.5, sessionCount: 1 }]);
    expect(va.roleUnknownCount).toBe(0);
    const vb = await store.workspaceUsage(wsb.id);
    expect(vb.totals.usd).toBe(9.99);
    expect(vb.workOrders).toEqual([{ id: woB, title: 'Kullanım B işi', usd: 9.99, sessionCount: 1 }]);
  });

  it('windows on `at`: an out-of-month row is excluded; an in-month row of a last-month-STARTED session counts (the basis divergence, store-level)', async () => {
    expectInsideMonth();
    const store = createStore(freshDb());
    const { ws, wo } = await wsIn(store, 'Kullanım pencere');
    // the session STARTED last month; its cost_usd covers both months; one row lands this month
    store.recordSession({
      providerSessionId: 'sold',
      owner: { kind: 'wo', workOrderId: wo.id },
      role: 'implementer',
      status: 'idle',
      cost: { tokensIn: 100, tokensOut: 10, usd: 0.75 },
      startedAt: lastMonthIso(),
      endedAt: inMonth(5),
    });
    store.recordTurnUsage({ kind: 'wo', workOrderId: wo.id }, 'sold', { at: lastMonthIso(), delta: { tokensIn: 50, tokensOut: 5, usd: 0.5 } });
    store.recordTurnUsage({ kind: 'wo', workOrderId: wo.id }, 'sold', { at: inMonth(5), delta: { tokensIn: 25, tokensOut: 2, usd: 0.25 } });
    const v = await store.workspaceUsage(ws.id);
    expect(v.totals).toEqual({ usd: 0.25, tokensIn: 25, tokensOut: 2 }); // the July row is out
    expect(v.workOrders[0]!.usd).toBe(0.25);
    // the HEAD's basis (cost_usd over started_at) reads 0.75 — the divergence is real, narrated
    // by the head's qualifier line, never reconciled (basisDiverges is core-pinned)
    expect(v.unledgeredCount).toBe(0); // the session HAS an in-month row
  });

  it('joins the role and the ctx checkpoint through the session row — the ctx reading is the LATEST one', async () => {
    expectInsideMonth();
    const store = createStore(freshDb());
    const { ws, wo } = await wsIn(store, 'Kullanım rol');
    store.recordSession({
      providerSessionId: 'sr',
      owner: { kind: 'wo', workOrderId: wo.id },
      role: 'architect',
      status: 'idle',
      ctx: { usedTokens: 124_000, maxTokens: 200_000 },
      startedAt: inMonth(6),
      endedAt: inMonth(6),
    });
    store.recordTurnUsage({ kind: 'wo', workOrderId: wo.id }, 'sr', { at: inMonth(6, 9), delta: { tokensIn: 100, tokensOut: 10, usd: 0.3 } });
    store.recordTurnUsage({ kind: 'wo', workOrderId: wo.id }, 'sr', { at: inMonth(6, 11), delta: { tokensIn: 50, tokensOut: 5, usd: 0.2 } });
    const v = await store.workspaceUsage(ws.id);
    expect(v.byRole).toEqual([{ role: 'architect', usd: 0.5, tokensIn: 150, tokensOut: 15, sessionCount: 1, pct: 100 }]);
    const s = v.sessions[0]!;
    expect(s.role).toBe('architect');
    expect(s.turnCount).toBe(2); // the observed-result COUNT — num_turns is not even in the fact
    expect(s.lastAt).toBe(inMonth(6, 11));
    expect(s.ctxPct).toBe(62); // round(124000/200000·100)
  });

  it('a row whose session row is gone paints no role bucket and raises roleUnknownCount (the legacy vintage)', async () => {
    expectInsideMonth();
    const store = createStore(freshDb());
    const { ws, wo } = await wsIn(store, 'Kullanım yetim');
    store.recordSession({ providerSessionId: 'kept', owner: { kind: 'wo', workOrderId: wo.id }, role: 'verifier', status: 'idle', startedAt: inMonth(7), endedAt: inMonth(7) });
    store.recordTurnUsage({ kind: 'wo', workOrderId: wo.id }, 'kept', { at: inMonth(7), delta: { tokensIn: 10, tokensOut: 1, usd: 0.1 } });
    store.recordTurnUsage({ kind: 'wo', workOrderId: wo.id }, 'ghost', { at: inMonth(7), delta: { tokensIn: 20, tokensOut: 2, usd: 0.2 } });
    const v = await store.workspaceUsage(ws.id);
    expect(v.totals.usd).toBe(0.3); // both rows count
    expect(v.byRole.map((x) => x.role)).toEqual(['verifier']);
    expect(v.roleUnknownCount).toBe(1);
  });

  it('a corrupt model_usage blob hydrates ABSENT (fail-open) — the read is not bricked', async () => {
    expectInsideMonth();
    const store = createStore(freshDb());
    const { ws, wo } = await wsIn(store, 'Kullanım bozuk');
    store.recordTurnUsage({ kind: 'wo', workOrderId: wo.id }, 'bad', { at: inMonth(8), delta: { tokensIn: 10, tokensOut: 1, usd: 0.1 } });
    store.db.prepare('UPDATE session_usage SET model_usage = ? WHERE provider_session_id = ?').run('[]', 'bad');
    const v = await store.workspaceUsage(ws.id);
    expect(v.hasModelSplit).toBe(false);
    expect(v.byModel).toEqual([{ model: undefined, usd: 0.1, tokensIn: 10, tokensOut: 1 }]); // the row scalars land
  });

  it('unledgeredCount — a costed in-month session with an empty ledger counts; a session WITH rows does not', async () => {
    expectInsideMonth();
    const store = createStore(freshDb());
    const { ws, wo } = await wsIn(store, 'Kullanım deftersiz');
    store.recordSession({ providerSessionId: 'vintage', owner: { kind: 'wo', workOrderId: wo.id }, role: 'architect', status: 'idle', cost: { tokensIn: 1, tokensOut: 1, usd: 2.08 }, startedAt: inMonth(2), endedAt: inMonth(2) });
    store.recordSession({ providerSessionId: 'ledgered', owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'idle', cost: { tokensIn: 1, tokensOut: 1, usd: 1.0 }, startedAt: inMonth(3), endedAt: inMonth(3) });
    store.recordTurnUsage({ kind: 'wo', workOrderId: wo.id }, 'ledgered', { at: inMonth(3), delta: { tokensIn: 5, tokensOut: 1, usd: 0.4 } });
    const v = await store.workspaceUsage(ws.id);
    expect(v.unledgeredCount).toBe(1); // 'vintage' only — 'ledgered' has a per-turn row
    // the pre-WO-0052 session's cost stays OUT of the breakdown — the head's basis carries it
    expect(v.totals.usd).toBe(0.4);
  });

  it('zero rows → the empty face (no figures, no buckets, no draft)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsIn(store, 'Kullanım boş');
    const v = await store.workspaceUsage(ws.id);
    expect(v.empty).toBe(true);
    expect(v.totals.usd).toBe(0);
    expect('draft' in v).toBe(false);
    expect(v.unledgeredCount).toBe(0);
    expect(v.roleUnknownCount).toBe(0);
  });

  it('deleteWorkOrder removes the work order’s usage rows (the cascade completion, WO-0054)', async () => {
    expectInsideMonth();
    const store = createStore(freshDb());
    const { ws, wo } = await wsIn(store, 'Kullanım sil');
    store.recordTurnUsage({ kind: 'wo', workOrderId: wo.id }, 'gone', { at: inMonth(9), delta: { tokensIn: 10, tokensOut: 1, usd: 0.7 } });
    expect((await store.workspaceUsage(ws.id)).totals.usd).toBe(0.7);
    await store.deleteWorkOrder(wo.id);
    const after = await store.workspaceUsage(ws.id);
    expect(after.empty).toBe(true); // the spend did not outlive its owner
    expect(after.roleUnknownCount).toBe(0); // not even as an orphan — the rows went WITH the owner
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM session_usage').get() as { n: number }).n).toBe(0);
  });

  it('deleteWorkspace removes the workspace’s usage rows — the ✦ draft rows included', async () => {
    expectInsideMonth();
    const store = createStore(freshDb());
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Kullanım ws-sil', repos: [{ path: root }] });
    store.recordTurnUsage({ kind: 'draft', workspaceId: ws.id }, 'draft-sess', { at: inMonth(9), delta: { tokensIn: 10, tokensOut: 1, usd: 1.41 } });
    expect((await store.workspaceUsage(ws.id)).draft!.usd).toBe(1.41);
    await store.deleteWorkspace(ws.id);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM session_usage').get() as { n: number }).n).toBe(0); // the draft spend died with the workspace
  });
});

// ===== WO-0055 — the agent-task rows ride the schema-free transcript (no migration needed) =====
describe('WO-0055 — agent rows persist through the transcript round-trip', () => {
  it('agent rows round-trip byte-for-byte; a shorter later write does not drop them', async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Agent rows', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Agent rows', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    const agentRows: TranscriptLine[] = [
      { speaker: 'agent_task', phase: 'started', taskId: 'a5ce', callId: 'call_T', description: 'Tara', subagentType: 'general-purpose' },
      { speaker: 'agent_task', phase: 'ended', taskId: 'a5ce', status: 'completed', summary: 'bitti' },
    ];
    store.recordSession({ providerSessionId: 's-agent', owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'idle', transcript: [...agentRows] });
    // a later SHORTER record cannot wipe the fuller checkpoint (the longer-row-wins rule, döküm kaybı)
    store.recordSession({ providerSessionId: 's-agent', owner: { kind: 'wo', workOrderId: wo.id }, role: 'implementer', status: 'stopped', transcript: [{ speaker: 'note', kind: 'interrupted' }] });
    const hydrated = await store.getWorkOrder(wo.id);
    expect(hydrated!.sessions[0]!.transcript).toEqual([...agentRows]);
  });
});

// ===== WO-0064 — the observed forge cache (ADR-0010's forge half) =====
describe('WO-0064 — the forge cache: scan records, degraded keeps, view joins', () => {
  const remote = 'https://github.com/eneskaradeniz/docket.git';
  const other = 'https://github.com/antreo-app/api.git';
  const at = '2026-09-19T12:00:00Z';
  const pr = (n: number, sha: string) => ({
    number: n,
    state: 'open' as const,
    title: `PR ${n}`,
    headSha: sha,
    headBranch: `b-${n}`,
    baseBranch: 'main',
    url: `https://github.com/eneskaradeniz/docket/pull/${n}`,
  });

  it('an ok scan records meta + the PR page + checks in one transaction; repeat is idempotent', () => {
    const store = createStore(freshDb());
    const ws = wid('ws-forge-1');
    store.db.prepare('INSERT INTO connection (workspace_id, repo_remote, local_path) VALUES (?,?,?)').run(ws, remote, '/tmp/r1');
    const scan = { at, prs: [pr(1, 'sha-1'), pr(2, 'sha-2')], checks: [{ sha: 'sha-1', check: { name: 'check', status: 'completed', conclusion: 'success' } }, { sha: 'sha-2', check: { name: 'typecheck', status: 'completed' } }] };
    store.recordForgeScan(ws, remote, scan);
    store.recordForgeScan(ws, remote, scan); // the reconciler fires repeatedly — no duplicate rows
    const view = store.forgeView(ws);
    expect(view.repos).toHaveLength(1);
    const repo = view.repos[0]!;
    expect(repo.repoRemote).toBe(remote);
    expect(repo.path).toBe('/tmp/r1');
    expect(repo.health).toBe('ok');
    expect(repo.scannedAt).toBe(at);
    expect(repo.prs).toHaveLength(2);
    expect(repo.prs[0]!.checks).toEqual([{ name: 'check', status: 'completed', conclusion: 'success' }]);
    expect(repo.prs[1]!.checks).toEqual([{ name: 'typecheck', status: 'completed' }]); // conclusion absent, not null
  });

  it('the replace rule: a PR fallen off the open page (and its checks) is absent after the next scan', () => {
    const store = createStore(freshDb());
    const ws = wid('ws-forge-2');
    store.db.prepare('INSERT INTO connection (workspace_id, repo_remote, local_path) VALUES (?,?,?)').run(ws, remote, '/tmp/r1');
    store.recordForgeScan(ws, remote, { at, prs: [pr(1, 'sha-1'), pr(2, 'sha-2')], checks: [{ sha: 'sha-2', check: { name: 'check', status: 'completed', conclusion: 'success' } }] });
    store.recordForgeScan(ws, remote, { at: '2026-09-19T13:00:00Z', prs: [pr(1, 'sha-1')], checks: [] });
    const repo = store.forgeView(ws).repos[0]!;
    expect(repo.prs.map((p) => p.number)).toEqual([1]);
    expect(repo.prs[0]!.checks).toEqual([]); // the fallen PR's checks went with it
    expect(repo.scannedAt).toBe('2026-09-19T13:00:00Z');
  });

  it('a degraded record touches the meta ONLY — prior facts stay, and the reason renders', () => {
    const store = createStore(freshDb());
    const ws = wid('ws-forge-3');
    store.db.prepare('INSERT INTO connection (workspace_id, repo_remote, local_path) VALUES (?,?,?)').run(ws, remote, '/tmp/r1');
    store.recordForgeScan(ws, remote, { at, prs: [pr(1, 'sha-1')], checks: [] });
    store.recordForgeDegraded(ws, remote, '2026-09-19T14:00:00Z', 'gh: Could not resolve to a Repository');
    const repo = store.forgeView(ws).repos[0]!;
    expect(repo.health).toEqual({ degraded: 'gh: Could not resolve to a Repository' });
    expect(repo.scannedAt).toBe('2026-09-19T14:00:00Z'); // the «son gözlem» stamp is the LAST attempt
    expect(repo.prs).toHaveLength(1); // the wipe would be the lie
  });

  it('per-workspace and per-repo isolation; never-scanned connections are absent from the view', () => {
    const store = createStore(freshDb());
    const ws = wid('ws-forge-4');
    store.db.prepare('INSERT INTO connection (workspace_id, repo_remote, local_path) VALUES (?,?,?)').run(ws, remote, '/tmp/r1');
    store.db.prepare('INSERT INTO connection (workspace_id, repo_remote, local_path) VALUES (?,?,?)').run(ws, other, '/tmp/r2');
    store.db.prepare('INSERT INTO connection (workspace_id, repo_remote, local_path) VALUES (?,?,?)').run(wid('ws-forge-5'), remote, '/tmp/r3');
    store.recordForgeScan(ws, remote, { at, prs: [pr(1, 'sha-1')], checks: [] });
    const view = store.forgeView(ws);
    expect(view.repos.map((r) => r.repoRemote)).toEqual([remote]); // the unscanned sibling is absent
    expect(store.forgeView(wid('ws-forge-5')).repos).toEqual([]); // another workspace never leaks
    expect(store.forgeScanTargets(ws)).toEqual([
      { repoRemote: remote, path: '/tmp/r1' },
      { repoRemote: other, path: '/tmp/r2' },
    ]);
  });

  it('the tables are OBSERVED: reseedObserved drops them and a re-scan rebuilds', () => {
    const store = createStore(freshDb());
    const ws = wid('ws-forge-6');
    store.db.prepare('INSERT INTO connection (workspace_id, repo_remote, local_path) VALUES (?,?,?)').run(ws, remote, '/tmp/r1');
    store.recordForgeScan(ws, remote, { at, prs: [pr(1, 'sha-1')], checks: [] });
    expect(OBSERVED_TABLES).toContain('forge_scan');
    expect(OBSERVED_TABLES).toContain('forge_pr');
    expect(OBSERVED_TABLES).toContain('forge_check');
    store.reseedObserved();
    expect(store.forgeView(ws).repos).toEqual([]); // discardable by definition — nothing owned lost
    store.recordForgeScan(ws, remote, { at, prs: [pr(1, 'sha-1')], checks: [] });
    expect(store.forgeView(ws).repos).toHaveLength(1); // a re-scan rebuilds it
  });
});

// ===== WO-0065 — the closure's observed fact (forge_merge) =====
describe('WO-0065 — closeWorkOrder records the forge_merge evidence', () => {
  const closeableWo = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Evidence close', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Evidence', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```');
    store.recordStep(wo.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
    store.recordStepVerdict(wo.id, 1, 'proceed', 'ok');
    return wo;
  };

  it('a close WITH evidence appends exactly one forge_merge event carrying the JSON basis', async () => {
    const store = createStore(freshDb());
    const wo = await closeableWo(store);
    await store.closeWorkOrder(wo.id, 'kapandı', { basis: 'observed', prNumber: 69, mergeSha: 'merge-sha', url: 'https://github.com/o/pull/69', mergedAt: '2026-09-19T12:00:00Z' });
    const events = await store.getWorkOrderEvents(wo.id);
    const merges = events.filter((e) => e.kind === 'forge_merge');
    expect(merges).toHaveLength(1);
    expect(JSON.parse(merges[0]!.detail)).toMatchObject({ basis: 'observed', prNumber: 69, mergeSha: 'merge-sha' });
    const closed = events.find((e) => e.kind === 'closed');
    expect(closed).toBeTruthy(); // the legacy closed event is untouched
  });

  it('the unknown basis records the reason; the legacy two-arg close writes NO forge_merge', async () => {
    const store = createStore(freshDb());
    const wo = await closeableWo(store);
    await store.closeWorkOrder(wo.id, 'kapandı', { basis: 'unknown', reason: 'gh: Not logged in' });
    expect(JSON.parse((await store.getWorkOrderEvents(wo.id)).find((e) => e.kind === 'forge_merge')!.detail)).toEqual({
      basis: 'unknown', reason: 'gh: Not logged in',
    });

    const store2 = createStore(freshDb());
    const wo2 = await closeableWo(store2);
    await store2.closeWorkOrder(wo2.id, 'kapandı'); // the CLI/test path — byte-for-byte the old floor
    expect((await store2.getWorkOrderEvents(wo2.id)).some((e) => e.kind === 'forge_merge')).toBe(false);
  });

  it('the CHECK migration upgrades a pre-forge_merge wo_event table in place (rows preserved)', () => {
    const p = freshDb();
    // Hand-build the legacy vintage: a wo_event whose CHECK predates forge_merge, with one row.
    const raw = new DatabaseSync(p);
    raw.exec(
      "CREATE TABLE wo_event (id INTEGER PRIMARY KEY AUTOINCREMENT, work_order_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('created','closed')), detail TEXT NOT NULL DEFAULT '', at TEXT NOT NULL)",
    );
    raw
      .prepare("INSERT INTO wo_event (work_order_id, kind, detail, at) VALUES ('WO-1', 'closed', 'sha', '2026-09-19T00:00:00Z')")
      .run();
    raw.close();

    const store = createStore(p); // the widened SCHEMA_SQL + the transactional rebuild in migrate()
    const sql = (store.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wo_event'").get() as { sql: string }).sql;
    expect(sql).toContain("'forge_merge'");
    const row = store.db.prepare("SELECT * FROM wo_event WHERE kind = 'closed'").get() as { work_order_id: string; detail: string };
    expect(row.work_order_id).toBe('WO-1'); // the audit survives the rebuild, append order intact
    expect(row.detail).toBe('sha');
  });
});

// ===== WO-0067 — the observed WO→PR link (ADR-0017's title rule) =====
describe('WO-0067 — recordForgeScan writes the observed track link', () => {
  const setup = async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Link', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Link me', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    const remote = (store.db.prepare('SELECT repo_remote FROM connection WHERE workspace_id = ?').get(ws.id) as { repo_remote: string }).repo_remote;
    return { store, ws, wo, remote };
  };
  const scanWith = (title: string) => ({
    at: '2026-09-19T12:00:00Z',
    prs: [{ number: 5, state: 'open' as const, title, headSha: 'sha-abc', headBranch: 'b', baseBranch: 'main', url: 'https://github.com/o/r/pull/5' }],
    checks: [],
  });

  it('a scanned PR titled with the WO id fills that WO track row (url + head sha + stamp)', async () => {
    const { store, ws, wo, remote } = await setup();
    store.recordForgeScan(ws.id, remote, scanWith(`${wo.id} — the real link`));
    const track = store.db.prepare('SELECT pr_url, pr_head_sha, observed_at FROM track WHERE work_order_id = ?').get(wo.id) as { pr_url: string; pr_head_sha: string; observed_at: string };
    expect(track.pr_url).toBe('https://github.com/o/r/pull/5');
    expect(track.pr_head_sha).toBe('sha-abc');
    expect(track.observed_at).toBe('2026-09-19T12:00:00Z');
  });

  it('the word boundary holds: another WO id that is a SUBSTRING does not match', async () => {
    const { store, ws, wo, remote } = await setup();
    const longer = `${wo.id}7`; // e.g. WO-00017 contains WO-0001 as a substring — not as a word
    store.recordForgeScan(ws.id, remote, scanWith(`${longer} — someone else's PR`));
    const track = store.db.prepare('SELECT pr_url FROM track WHERE work_order_id = ?').get(wo.id) as { pr_url: string | null };
    expect(track.pr_url).toBeNull();
  });

  it('a closed work order never matches; a no-hit scan keeps the prior link (latest-wins)', async () => {
    const { store, ws, wo, remote } = await setup();
    store.recordForgeScan(ws.id, remote, scanWith(`${wo.id} — first link`));
    store.db.prepare('UPDATE work_order SET gate_closure_docs_sha = ? WHERE id = ?').run('closed-sha', wo.id);
    store.recordForgeScan(ws.id, remote, scanWith(`${wo.id} — reopened? no: the WO is closed`));
    const track = store.db.prepare('SELECT pr_url FROM track WHERE work_order_id = ?').get(wo.id) as { pr_url: string };
    expect(track.pr_url).toBe('https://github.com/o/r/pull/5'); // the closed WO's link keeps its last observation
  });
});

// ===== WO-0069 — the gates observe: computed verification + the track CI unknown =====
describe('WO-0069 — the verification gate is COMPUTED at record time (no closure attestation)', () => {
  // A root whose src/a.ts EXISTS, so a `src/a.ts:NN` pointer resolves against the WO's repo root.
  const resolvableRoot = (): string => {
    const root = freshRoot();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export {};\n');
    return root;
  };
  const observedWo = async (store: ReturnType<typeof createStore>) => {
    const root = resolvableRoot();
    const ws = await store.createWorkspace({ label: 'Observe', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Observe', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"verifier","aim":"v","scope":"all"}]\n```');
    return { ws, wo };
  };
  const columnOf = (store: ReturnType<typeof createStore>, woId: WorkOrderId): number | null =>
    (store.db.prepare('SELECT gate_verifier_resolvable AS v FROM work_order WHERE id = ?').get(woId) as { v: number | null }).v;

  it('a verifier report whose pointers all resolve writes 1 at RECORD time (hydrates satisfied)', async () => {
    const store = createStore(freshDb());
    const { wo } = await observedWo(store);
    store.recordStepReport(wo.id, 1, 'verifier', 'read `src/a.ts:1` then src/a.ts:2 — both hold');
    expect(columnOf(store, wo.id)).toBe(1);
    expect((await store.getWorkOrder(wo.id))!.gateInputs.verifierReport).toEqual({ resolvablePointers: true });
  });

  it('any UNRESOLVABLE pointer writes 0 (we looked and it missed — unsatisfied, not unknown)', async () => {
    const store = createStore(freshDb());
    const { wo } = await observedWo(store);
    store.recordStepReport(wo.id, 1, 'verifier', 'src/a.ts:1 holds; src/missing.ts:9 does not');
    expect(columnOf(store, wo.id)).toBe(0);
    expect((await store.getWorkOrder(wo.id))!.gateInputs.verifierReport).toEqual({ resolvablePointers: false });
  });

  it('a verifier report with NOTHING extractable leaves the column untouched — NULL stays the unknown', async () => {
    const store = createStore(freshDb());
    const { wo } = await observedWo(store);
    store.recordStepReport(wo.id, 1, 'verifier', 'all good, no file references in this prose: 12:30, step 3: 4');
    expect(columnOf(store, wo.id)).toBeNull();
    expect((await store.getWorkOrder(wo.id))!.gateInputs.verifierReport).toBeUndefined();
  });

  it('a non-verifier report never speaks for the gate', async () => {
    const store = createStore(freshDb());
    const root = resolvableRoot();
    const ws = await store.createWorkspace({ label: 'Not verifier', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'NV', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    await store.approvePlan(wo.id, '# p\n\n```steps\n[{"role":"implementer","aim":"i","scope":"all"}]\n```');
    store.recordStepReport(wo.id, 1, 'implementer', 'touched src/a.ts:1');
    expect(columnOf(store, wo.id)).toBeNull();
  });

  it('closeWorkOrder no longer attests the gate: a computed 0 KEEPS 0 through closure, and closure does not derive closed over it', async () => {
    const store = createStore(freshDb());
    const { wo } = await observedWo(store);
    store.recordStepReport(wo.id, 1, 'verifier', 'src/missing.ts:9 is gone');
    store.recordStepVerdict(wo.id, 1, 'proceed', 'ok');
    await store.closeWorkOrder(wo.id, 'n');
    expect(columnOf(store, wo.id)).toBe(0); // the = 1 write is gone — the computation owns the column
    expect((await store.getWorkOrder(wo.id))!.gateInputs.closureDocsSha).toBeTruthy(); // closure still writes ITS fact
    expect((await store.getWorkOrder(wo.id))!.stage).toBe('implementation'); // a gate never passes on a failed look
  });

  it('a LEGACY row keeps its stored value through hydration and reads — no backfill, either direction', async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Legacy', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Legacy', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    store.db.prepare('UPDATE work_order SET gate_plan_approved = 1, gate_verifier_resolvable = 0, gate_closure_docs_sha = ? WHERE id = ?').run('legacy-sha', wo.id);
    store.db.prepare('UPDATE track SET merged_at = ? WHERE work_order_id = ?').run('2026-09-01T00:00:00Z', wo.id);
    const hydrated = await store.getWorkOrder(wo.id);
    expect(hydrated!.gateInputs.verifierReport).toEqual({ resolvablePointers: false });
    expect(hydrated!.stage).toBe('implementation'); // a legacy 0 is a legacy 0 — closure never derives closed over it
    void store.getWorkOrders; // reads never rewrite the column
    expect(columnOf(store, wo.id)).toBe(0);
  });
});

describe('WO-0069 — the track CI learns unknown from the forge scan degraded meta', () => {
  const observedWo = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Scan', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Scan', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    // createWorkspace in a non-git tmp dir stores the basename as the remote fallback (WO-0064 fixture idiom)
    const remote = (store.db.prepare('SELECT repo_remote FROM connection WHERE workspace_id = ?').get(ws.id) as { repo_remote: string }).repo_remote;
    return { ws, wo, remote };
  };

  it('a DEGRADED scan for the track repo hydrates run/unknown with the scan reason verbatim', async () => {
    const store = createStore(freshDb());
    const { ws, wo, remote } = await observedWo(store);
    store.recordForgeScan(ws.id, remote, { at: '2026-09-19T12:00:00Z', prs: [], checks: [] });
    store.recordForgeDegraded(ws.id, remote, '2026-09-19T14:00:00Z', 'gh: Could not resolve to a Repository');
    const track = (await store.getWorkOrder(wo.id))!.tracks[0]!;
    expect(track.ci).toEqual({ kind: 'run', state: 'unknown', checks: [], reason: 'gh: Could not resolve to a Repository' });
  });

  it('an ok or missing scan stays byte-stable (the seeded blob, no override)', async () => {
    const store = createStore(freshDb());
    const { ws, wo, remote } = await observedWo(store);
    const before = (await store.getWorkOrder(wo.id))!.tracks[0]!.ci;
    expect(before).toEqual({ kind: 'run', state: 'running', checks: [] }); // never scanned
    store.recordForgeScan(ws.id, remote, { at: '2026-09-19T15:00:00Z', prs: [], checks: [] });
    expect((await store.getWorkOrder(wo.id))!.tracks[0]!.ci).toEqual({ kind: 'run', state: 'running', checks: [] }); // ok
  });

  it('a degraded scan AFTER an ok one still overrides — the last look is the one that failed', async () => {
    const store = createStore(freshDb());
    const { ws, wo, remote } = await observedWo(store);
    store.db.prepare('UPDATE track SET ci_blob = ? WHERE work_order_id = ?').run(JSON.stringify({ state: 'success', checks: [{ name: 'build', conclusion: 'success' }] }), wo.id);
    store.recordForgeScan(ws.id, remote, { at: '2026-09-19T12:00:00Z', prs: [], checks: [] });
    const afterOk = (await store.getWorkOrder(wo.id))!.tracks[0]!.ci;
    expect(afterOk.kind === 'run' && afterOk.state).toBe('success'); // ok scan: the blob speaks
    store.recordForgeDegraded(ws.id, remote, '2026-09-19T16:00:00Z', 'gh: rate limited');
    const afterDegraded = (await store.getWorkOrder(wo.id))!.tracks[0]!.ci;
    expect(afterDegraded.kind === 'run' && afterDegraded.state).toBe('unknown'); // degraded: we could not look
  });

  it('an exempt track stays exempt under a degraded scan — an exemption is a decision, not an observation', async () => {
    const store = createStore(freshDb());
    const { ws, wo, remote } = await observedWo(store);
    store.db.prepare('UPDATE track SET ci_kind = ?, ci_blob = ? WHERE work_order_id = ?').run('exempt', JSON.stringify({ reason: 'No CI configured' }), wo.id);
    store.recordForgeDegraded(ws.id, remote, '2026-09-19T16:00:00Z', 'gh: rate limited');
    expect((await store.getWorkOrder(wo.id))!.tracks[0]!.ci).toEqual({ kind: 'exempt', reason: 'No CI configured' });
  });

  it('a degraded scan carrying no reason hydrates unknown WITHOUT one — never invented', async () => {
    const store = createStore(freshDb());
    const { ws, wo, remote } = await observedWo(store);
    store.recordForgeDegraded(ws.id, remote, '2026-09-19T16:00:00Z', '');
    expect((await store.getWorkOrder(wo.id))!.tracks[0]!.ci).toEqual({ kind: 'run', state: 'unknown', checks: [] });
  });
});

// ===== WO-0070 — prompt overrides: ONE app_setting row + the override-first assembly =====
// An override flows: Settings → setPromptOverrides → the `prompt_overrides` row → read at
// prompt-ASSEMBLY time in the four assembly fns → the agent. Absent → byte-identical built-in
// (the existing prompt tests are the fallback proof; the EXISTING tests are unmodified).
describe('WO-0070 — prompt overrides (row round-trip + override-first assembly)', () => {
  const wsWithWo = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'İstem WS', repos: [{ path: root }] });
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'İstem', description: 'amaç metni', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    return { ws, wo };
  };
  const plan = '# p\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"},{"role":"verifier","aim":"v","scope":"all"}]\n```';
  const IMPL_OVERRIDE = 'You are the implementer. Follow the operator note EXACTLY: run the ladder, stop at red.';

  it('the row round-trips; unknown keys and whitespace-only values never persist; garbage JSON reads undefined; clear leaves no row', async () => {
    const store = createStore(freshDb());
    expect(await store.getPromptOverrides()).toBeUndefined(); // no row → nothing stored
    await store.setPromptOverrides({ implementer: 'A', roadmapDraft: 'B' });
    expect(await store.getPromptOverrides()).toEqual({ implementer: 'A', roadmapDraft: 'B' });
    // shape only — unknown keys and whitespace-only values drop; a body rides verbatim
    await store.setPromptOverrides({ implementer: '  kept verbatim  ', ghost: 'x' } as unknown as PromptOverrides);
    expect(await store.getPromptOverrides()).toEqual({ implementer: '  kept verbatim  ' });
    // a garbage row reads undefined (the settingModels posture): a corrupt map never blocks a drive
    store.db.prepare("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('prompt_overrides', 'not-json')").run();
    expect(await store.getPromptOverrides()).toBeUndefined();
    // undefined clears ALL; no row survives
    await store.setPromptOverrides({ implementer: 'A' });
    await store.setPromptOverrides(undefined);
    expect(await store.getPromptOverrides()).toBeUndefined();
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM app_setting WHERE key = 'prompt_overrides'").get()).toEqual({ n: 0 });
  });

  it('a per-key clear = the object MINUS the key; the other keys survive', async () => {
    const store = createStore(freshDb());
    await store.setPromptOverrides({ implementer: 'A', architect: 'B' });
    await store.setPromptOverrides({ architect: 'B' }); // the modal sends the map minus implementer
    expect(await store.getPromptOverrides()).toEqual({ architect: 'B' });
  });

  it('assembly is override-first: an overridden implementer prompt carries the override VERBATIM', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsWithWo(store);
    await store.approvePlan(wo.id, plan);
    const before = await store.stepPromptFor(wo.id, 1);
    expect(before?.prompt).toContain('You are the implementer for step 1'); // the built-in, pre-override
    await store.setPromptOverrides({ implementer: IMPL_OVERRIDE });
    expect((await store.stepPromptFor(wo.id, 1))?.prompt).toBe(IMPL_OVERRIDE); // whole template, no merge
    // the verifier leg rides ITS key — untouched by the implementer override
    expect((await store.stepPromptFor(wo.id, 2))?.prompt).toContain('You are the verifier for step 2');
  });

  it('clear → byte-identical built-in for architect, step and review assembly (the fallback proof)', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsWithWo(store);
    await store.approvePlan(wo.id, plan);
    const architectBefore = await store.architectPromptFor(wo.id);
    const stepBefore = await store.stepPromptFor(wo.id, 1);
    const reviewBefore = await store.stepReviewPromptFor(wo.id, 1);
    await store.setPromptOverrides({ architect: 'OA', implementer: 'OI', architectReview: 'OR' });
    expect(await store.architectPromptFor(wo.id)).toBe('OA');
    expect((await store.stepPromptFor(wo.id, 1))?.prompt).toBe('OI');
    expect(await store.stepReviewPromptFor(wo.id, 1)).toBe('OR');
    await store.setPromptOverrides(undefined);
    expect(await store.architectPromptFor(wo.id)).toBe(architectBefore);
    expect(await store.stepPromptFor(wo.id, 1)).toEqual(stepBefore);
    expect(await store.stepReviewPromptFor(wo.id, 1)).toBe(reviewBefore);
  });

  it('the ✦ draft prompt is override-first too (roadmapDraftPromptForRow)', async () => {
    const store = createStore(freshDb());
    const ws = await store.createWorkspace({ label: 'Taslak WS', repos: [{ path: freshRoot() }] });
    const before = store.roadmapDraftPromptFor(ws.id, 'not', []);
    expect(before).toContain('roadmap.md'); // the built-in composes from the workspace facts
    await store.setPromptOverrides({ roadmapDraft: 'DRAFT OVERRIDE' });
    expect(store.roadmapDraftPromptFor(ws.id, 'not', [])).toBe('DRAFT OVERRIDE');
    await store.setPromptOverrides(undefined);
    expect(store.roadmapDraftPromptFor(ws.id, 'not', [])).toBe(before);
  });

  it('a whitespace-only override is ignored at assembly — the built-in stands', async () => {
    const store = createStore(freshDb());
    const { wo } = await wsWithWo(store);
    await store.approvePlan(wo.id, plan);
    const before = await store.stepPromptFor(wo.id, 1);
    await store.setPromptOverrides({ implementer: '   \n\t  ' });
    expect(await store.getPromptOverrides()).toBeUndefined(); // the write normalized it away
    expect((await store.stepPromptFor(wo.id, 1))?.prompt).toBe(before?.prompt);
  });
});

// ===== WO-0071 — track depends_on: the write path, the fence round-trip, the briefing bundle =====
describe('WO-0071 — track depends_on: the write path (createWorkOrder)', () => {
  // Two repos under one throwaway root; the decision store defaults to repos[0] ('app'), so the
  // structure root is <root>/app/docs and the WO dir lands there.
  const wsTwoRepos = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Makine', repos: [{ path: join(root, 'app') }, { path: join(root, 'api') }] });
    return { ws, root };
  };

  it('with trackDependencies → the rows land with the track id formula and hydrate back as Track.dependsOn', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsTwoRepos(store);
    const wo = await store.createWorkOrder({
      workspaceId: ws.id, title: 'Makine', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [],
      trackDependencies: [{ repo: ws.repos[1]!, dependsOn: [ws.repos[0]!] }], // api → app
    });
    const tracks = (await store.getWorkOrder(wo.id))!.tracks;
    expect(tracks.find((t) => t.repo === ws.repos[1])!.dependsOn).toEqual(['WO-0001-app']);
    expect(tracks.find((t) => t.repo === ws.repos[0])!.dependsOn).toEqual([]);
    expect(store.db.prepare('SELECT track_id, depends_on_track_id FROM track_depends_on').all()).toEqual([
      { track_id: 'WO-0001-api', depends_on_track_id: 'WO-0001-app' },
    ]);
  });

  it('absent input → zero rows and empty dependsOn arrays (byte-stable with pre-WO-0071)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsTwoRepos(store);
    const wo = await store.createWorkOrder({ workspaceId: ws.id, title: 'Sade', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [] });
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM track_depends_on').all()).toEqual([{ n: 0 }]);
    for (const t of (await store.getWorkOrder(wo.id))!.tracks) expect(t.dependsOn).toEqual([]);
  });

  it('self-dependence is refused before anything is written', async () => {
    const store = createStore(freshDb());
    const { ws, root } = await wsTwoRepos(store);
    await assert.rejects(
      () =>
        store.createWorkOrder({
          workspaceId: ws.id, title: 'Self', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [],
          trackDependencies: [{ repo: ws.repos[0]!, dependsOn: [ws.repos[0]!] }],
        }),
      /cannot depend on itself/,
    );
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM work_order').all()).toEqual([{ n: 0 }]);
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM track').all()).toEqual([{ n: 0 }]);
    expect(existsSync(join(root, 'app', 'docs', 'work-orders', 'WO-0001-self'))).toBe(false);
  });

  it('a dependency outside the WO trackRepos is refused (track_depends_on is intra-WO)', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsTwoRepos(store);
    await assert.rejects(
      () =>
        store.createWorkOrder({
          workspaceId: ws.id, title: 'Foreign', description: 'x', trackRepos: [ws.repos[0]!], reviewMode: 'gates', contextFiles: [],
          trackDependencies: [{ repo: ws.repos[0]!, dependsOn: [ws.repos[1]! as RepoId] }], // api is a ws repo but NOT a track here
        }),
      /not one of this work order's tracks/,
    );
  });

  it('a duplicate pair is refused', async () => {
    const store = createStore(freshDb());
    const { ws } = await wsTwoRepos(store);
    await assert.rejects(
      () =>
        store.createWorkOrder({
          workspaceId: ws.id, title: 'Dup', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [],
          trackDependencies: [
            { repo: ws.repos[1]!, dependsOn: [ws.repos[0]!] },
            { repo: ws.repos[1]!, dependsOn: [ws.repos[0]!] },
          ],
        }),
      /duplicate dependency/,
    );
  });

  it('order.md round-trips the fence: write → re-read from disk carries the pairs', async () => {
    const store = createStore(freshDb());
    const { ws, root } = await wsTwoRepos(store);
    await store.createWorkOrder({
      workspaceId: ws.id, title: 'Fence', description: 'x', trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [],
      trackDependencies: [{ repo: ws.repos[1]!, dependsOn: [ws.repos[0]!] }],
    });
    const md = readFileSync(join(root, 'app', 'docs', 'work-orders', 'WO-0001-fence', 'order.md'), 'utf8');
    expect(md).toContain('tracks:\n  - repo: app\n    depends_on: []\n  - repo: api\n    depends_on: [app]\n');
  });
});

describe('WO-0071 — the briefing bundle (stepPromptFor carries the dependency report PATH)', () => {
  const plan =
    '# p\n\n```steps\n[\n' +
    '  {"role":"implementer","aim":"app iskelet","scope":"app"},\n' +
    '  {"role":"implementer","aim":"api bagla","scope":"api"},\n' +
    '  {"role":"verifier","aim":"api dogrulama","scope":"api"},\n' +
    '  {"role":"implementer","aim":"app revizyon","scope":"app"}\n' +
    ']\n```';
  const OBJECTIVE = 'baglantili makine';
  // The api track depends on app; the WO dir is <root>/app/docs/work-orders/WO-0001-briefed.
  const briefedWo = async (store: ReturnType<typeof createStore>) => {
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Makine', repos: [{ path: join(root, 'app') }, { path: join(root, 'api') }] });
    const wo = await store.createWorkOrder({
      workspaceId: ws.id, title: 'Briefed', description: OBJECTIVE, trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [],
      trackDependencies: [{ repo: ws.repos[1]!, dependsOn: [ws.repos[0]!] }],
    });
    await store.approvePlan(wo.id, plan);
    return { wo, woDir: join(root, 'app', 'docs', 'work-orders', 'WO-0001-briefed') };
  };
  const expectBuiltin = (opts: { idx: number; role: 'implementer' | 'verifier'; aim: string; ref: string; woDir: string; planText?: string; briefing?: Array<{ repo: string; path: string }> }): string => {
    const input = {
      objective: OBJECTIVE,
      step: { idx: opts.idx, role: opts.role, aim: opts.aim, scope: { kind: 'track' as const, ref: opts.ref } },
      planText: opts.planText ?? plan,
      orderMdPath: join(opts.woDir, 'order.md'),
      ...(opts.briefing ? { briefing: opts.briefing } : {}),
    };
    return opts.role === 'verifier' ? verifierPrompt(input) : implementerPrompt(input);
  };

  it('the dependent step\u2019s prompt carries the dependency\u2019s report path \u2014 one section, after the plan', async () => {
    const store = createStore(freshDb());
    const { wo, woDir } = await briefedWo(store);
    store.recordStepReport(wo.id, 1, 'implementer', '# app raporu');
    const got = await store.stepPromptFor(wo.id, 2);
    expect(got?.scope).toBe(tid('WO-0001-api'));
    const reportPath = join(woDir, 'reports', 'step-01-implementer.md');
    expect(got!.prompt).toContain('Briefing — your track depends on:');
    expect(got!.prompt).toContain(`- app: ${reportPath}`);
    expect(got!.prompt).toContain("(read these at your fence; they are the dependency's latest contract)");
    // the section sits after the plan block and before the work line
    expect(got!.prompt.indexOf('Briefing — your track depends on:')).toBeGreaterThan(got!.prompt.indexOf('# p'));
    expect(got!.prompt.indexOf('Work autonomously to implement')).toBeGreaterThan(got!.prompt.indexOf('Briefing — your track depends on:'));
    // the assembled prompt is exactly core's template with the found briefing
    expect(got!.prompt).toBe(expectBuiltin({ idx: 2, role: 'implementer', aim: 'api bagla', ref: 'api', woDir, briefing: [{ repo: 'app', path: reportPath }] }));
  });

  it('an independent track\u2019s prompt is byte-identical to the pre-WO-0071 template', async () => {
    const store = createStore(freshDb());
    const { wo, woDir } = await briefedWo(store);
    store.recordStepReport(wo.id, 1, 'implementer', '# app raporu');
    const got = await store.stepPromptFor(wo.id, 1); // app depends on nothing
    expect(got!.prompt).toBe(expectBuiltin({ idx: 1, role: 'implementer', aim: 'app iskelet', ref: 'app', woDir }));
    expect(got!.prompt).not.toContain('Briefing');
  });

  it('no report on disk → the section is absent (byte-identical)', async () => {
    const store = createStore(freshDb());
    const { wo, woDir } = await briefedWo(store);
    const got = await store.stepPromptFor(wo.id, 2);
    expect(got!.prompt).toBe(expectBuiltin({ idx: 2, role: 'implementer', aim: 'api bagla', ref: 'api', woDir }));
    expect(got!.prompt).not.toContain('Briefing');
  });

  it('latest idx wins, a deleted file falls back to the latest EXISTING one, none left → absent', async () => {
    const store = createStore(freshDb());
    const { wo, woDir } = await briefedWo(store);
    store.recordStepReport(wo.id, 1, 'implementer', '# app v1');
    store.recordStepReport(wo.id, 4, 'implementer', '# app v2');
    const got = await store.stepPromptFor(wo.id, 2);
    expect(got!.prompt).toContain(`- app: ${join(woDir, 'reports', 'step-04-implementer.md')}`);
    rmSync(join(woDir, 'reports', 'step-04-implementer.md'));
    const fell = await store.stepPromptFor(wo.id, 2);
    expect(fell!.prompt).toContain(`- app: ${join(woDir, 'reports', 'step-01-implementer.md')}`);
    rmSync(join(woDir, 'reports', 'step-01-implementer.md'));
    const gone = await store.stepPromptFor(wo.id, 2);
    expect(gone!.prompt).toBe(expectBuiltin({ idx: 2, role: 'implementer', aim: 'api bagla', ref: 'api', woDir }));
  });

  it('the verifier template never carries the bundle — even on a dependent track', async () => {
    const store = createStore(freshDb());
    const { wo, woDir } = await briefedWo(store);
    store.recordStepReport(wo.id, 1, 'implementer', '# app raporu');
    const got = await store.stepPromptFor(wo.id, 3); // verifier scoped api (the dependent track)
    expect(got!.prompt).toBe(expectBuiltin({ idx: 3, role: 'verifier', aim: 'api dogrulama', ref: 'api', woDir }));
    expect(got!.prompt).not.toContain('Briefing');
  });

  it('an all-scoped step report is the work order\u2019s, never a dependency\u2019s \u2014 it does not brief', async () => {
    const store = createStore(freshDb());
    const root = freshRoot();
    const ws = await store.createWorkspace({ label: 'Makine', repos: [{ path: join(root, 'app') }, { path: join(root, 'api') }] });
    const wo = await store.createWorkOrder({
      workspaceId: ws.id, title: 'Allscope', description: OBJECTIVE, trackRepos: ws.repos, reviewMode: 'gates', contextFiles: [],
      trackDependencies: [{ repo: ws.repos[1]!, dependsOn: [ws.repos[0]!] }],
    });
    const allPlan = '# p\n\n```steps\n[{"role":"implementer","aim":"hepsine dokun","scope":"all"},{"role":"implementer","aim":"api bagla","scope":"api"}]\n```';
    await store.approvePlan(wo.id, allPlan);
    store.recordStepReport(wo.id, 1, 'implementer', '# tum is');
    const woDir = join(root, 'app', 'docs', 'work-orders', 'WO-0001-allscope');
    const got = await store.stepPromptFor(wo.id, 2);
    expect(got!.prompt).toBe(expectBuiltin({ idx: 2, role: 'implementer', aim: 'api bagla', ref: 'api', woDir, planText: allPlan }));
    expect(got!.prompt).not.toContain('Briefing');
  });
});

describe('WO-0072 — the workspace overview: whose turn, the debt match, ready tasks', () => {
  // One workspace, one decision store, the four debt shapes the projection must tell apart: a
  // debt on an OPEN work order (linked, branded), one on a CLOSED work order (dropped — a closed
  // WO's debts are not open borçlar), an unlinked one (kept, chipless), and a ragged row (a named
  // diagnostic the projection does not carry). The roadmap supplies the ready tasks: a planli task
  // in an unblocked faz, a kosuyor task (its linked WO is open), and a planli task behind a
  // blocked faz. Written with the freshRoot + writeFileSync idiom (the WO-0048 block's shape).
  const overviewWorld = async () => {
    const root = freshRoot();
    for (const r of ['docs', 'api']) mkdirSync(join(root, r), { recursive: true });
    const store = createStore(freshDb());
    const ws = await store.createWorkspace({
      label: 'genel',
      repos: [{ path: join(root, 'docs') }, { path: join(root, 'api') }],
      decisionStorePath: join(root, 'docs'),
    });
    const openWo = await store.createWorkOrder({
      workspaceId: ws.id, title: 'Açık iş', description: 'x', trackRepos: [rid('api')], reviewMode: 'gates', contextFiles: [],
    });
    const closedWo = await store.createWorkOrder({
      workspaceId: ws.id, title: 'Kapalı iş', description: 'x', trackRepos: [rid('api')], reviewMode: 'gates', contextFiles: [],
    });
    // The closure chain is deriveStage's own rule: an approved plan + a merged track + a
    // resolvable verifier report + the closure sha (the WO-0047 direct-row idiom — observed
    // facts, written as the store writes them).
    store.db.prepare('UPDATE track SET merged_at = ? WHERE id = ?').run('2026-09-01T00:00:00Z', `${closedWo.id as string}-api`);
    store.db.prepare('UPDATE work_order SET gate_plan_approved = 1, gate_verifier_resolvable = 1, gate_closure_docs_sha = ? WHERE id = ?').run('sha-closed', closedWo.id);
    // The EFFECTIVE structure root: <decision store> + the docs_root setting (default `docs`) —
    // the same doubling the WO-0048 block's `docs/docs` assertions pin. The debt ledger lives there.
    writeFileSync(
      join(root, 'docs', 'docs', 'tech-debt.md'),
      [
        '| id | opened by | description | risk | status |',
        '| --- | --- | --- | --- | --- |',
        `| TD-201 | ${closedWo.id as string} | **Kapalı işin borcu.** Uzun açıklama. | low | open |`,
        `| TD-202 | ${openWo.id as string} rev 2 | **Açık işin borcu.** Uzun açıklama. | medium | open |`,
        '| TD-203 | design | **Bağlantısız borç.** Uzun açıklama. | low | open |',
        `| TD-204 | ${openWo.id as string} | **Eksik satır.** |`,
        '',
      ].join('\n'),
      'utf8',
    );
    // f0-t2 rides the OPEN work order through order.md's `task:` key — document text, never a column.
    await store.updateWorkOrder(openWo.id, { taskRef: 'f0-t2' });
    await store.saveRoadmap(ws.id, buildRoadmapMd({
      workspaceSlug: ws.id as string,
      title: 'Genel',
      fazlar: [
        { id: 'f0', title: 'Birinci faz', blockedBy: [], tasks: [{ id: 'f0-t1', title: 'Hazır görev' }, { id: 'f0-t2', title: 'Koşan görev' }] },
        { id: 'f1', title: 'İkinci faz', blockedBy: ['f0'], tasks: [{ id: 'f1-t1', title: 'Bloke görev' }] },
      ],
    }));
    return { store, ws, openWo, closedWo, root };
  };

  it('assembles the projection: the turn group, the debt match, the ready tasks', async () => {
    const { store, ws, openWo, closedWo } = await overviewWorld();
    const v = await store.workspaceOverview(ws.id);
    // Sıra: the open WO sits at 'written' → the operator's turn; the closed WO is nobody's.
    expect(v.turns).toEqual([{ turn: 'operator', wos: [{ id: openWo.id, title: 'Açık iş', stage: 'written' }] }]);
    expect(JSON.stringify(v)).not.toContain(closedWo.id as string);
    // Borçlar: open → linked (branded); closed → GONE; unlinked → kept chipless; ragged → gone.
    expect(v.debts).toEqual([
      { id: 'TD-202', title: 'Açık işin borcu', wo: openWo.id },
      { id: 'TD-203', title: 'Bağlantısız borç' },
    ]);
    // Hazır (WO-0080): the planli task in the unblocked faz ONLY — the written WO's startability
    // is its turn group's content; the WO arm is gone (f0-t2 kosuyor, f1-t1 behind the blocked faz).
    expect(v.ready).toEqual({ tasks: [{ id: 'f0-t1', title: 'Hazır görev' }] });
  });

  it('a missing tech-debt.md is the empty-honest debt face, never a throw', async () => {
    const root = freshRoot();
    const store = createStore(freshDb());
    const ws = await store.createWorkspace({ label: 'boscuk', repos: [{ path: root }], decisionStorePath: root });
    await store.createWorkOrder({ workspaceId: ws.id, title: 'Tek iş', description: 'x', trackRepos: [], reviewMode: 'gates', contextFiles: [] });
    const v = await store.workspaceOverview(ws.id);
    expect(v.debts).toEqual([]);
    expect(v.turns.map((g) => g.turn)).toEqual(['operator']);
  });

  it('the plan-gate fact rides: an approved plan moves the turn to the implementer', async () => {
    const { store, ws, openWo } = await overviewWorld();
    store.db.prepare('UPDATE work_order SET gate_plan_approved = 1 WHERE id = ?').run(openWo.id);
    const v = await store.workspaceOverview(ws.id);
    // deriveStage moved (approved plan, no session yet → implementation) and the turn map followed.
    expect(v.turns.map((g) => g.turn)).toEqual(['implementer']);
    expect(v.turns[0]!.wos[0]!.stage).toBe('implementation');
  });
});

// ===== WO-0088 — the per-WO cwd override wins over the connection table =====
describe('WO-0088 — driveCwd honors the order.md cwd override (the wave worktree)', () => {
  it('a WO with cwd: spawns there — scoped and unscoped alike; dropping the key restores the fallback', async () => {
    const store = createStore(freshDb());
    const rootApi = freshRoot();
    const rootDocs = freshRoot();
    const apiSlug = rootApi.split('/').pop()!;
    const ws = await store.createWorkspace({
      label: 'Wave WS',
      repos: [{ path: rootApi }, { path: rootDocs }],
      decisionStorePath: rootDocs,
    });
    const worktree = freshRoot(); // a real dir path (the operator's worktree stand-in)
    const wo = await store.createWorkOrder({
      workspaceId: ws.id,
      title: 'Dalga işi',
      description: 'x',
      trackRepos: [rid(apiSlug)],
      reviewMode: 'gates',
      contextFiles: [],
      cwd: worktree,
    });
    const hydrated = await store.getWorkOrder(wo.id);
    const track = hydrated!.tracks[0]!;
    // the override wins for BOTH shapes of drive
    expect(store.driveCwd({ role: 'implementer', workOrderId: wo.id, scope: track.id, mode: 'direct', prompt: '' })).toBe(worktree);
    expect(store.driveCwd({ role: 'architect', workOrderId: wo.id, mode: 'plan', prompt: '' })).toBe(worktree);
    // the authored order.md carries the key
    const docs = await store.getWorkOrderDocs(wo.id);
    expect(docs.order).toContain(`cwd: ${worktree}`);
    // dropping the key (the edit idiom) restores the connection-table fallback
    await store.updateWorkOrder(wo.id, { cwd: null });
    expect(store.driveCwd({ role: 'architect', workOrderId: wo.id, mode: 'plan', prompt: '' })).toBe(rootDocs);
    // and setting it again through the edit wins once more
    await store.updateWorkOrder(wo.id, { cwd: rootApi });
    expect(store.driveCwd({ role: 'architect', workOrderId: wo.id, mode: 'plan', prompt: '' })).toBe(rootApi);
  });
});
