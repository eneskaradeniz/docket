// src/adapters/store — the SQLite state store (WO-0009). Implements the async
// `WorkOrderSource` port over node:sqlite (DatabaseSync, built into Electron's Node
// 24.18.1 — no native dependency). This is the only data source the composition root
// wires; ui reaches it only through the port.
//
// Per ADR-0010 the schema encodes ownership (schema.ts): observed tables cache git/forge
// facts with observed_at and are discardable; owned tables (session, connection) hold
// Docket's decisions. No document text is stored (getWorkOrderDocs reads fixtures in M2,
// git in M3). No stage is stored — hydrate sets WorkOrder.stage via core's deriveStage.
//
// Seeded from the fixture constants on first run (empty DB). M3 replaces the seed with
// live git/forge observation feeding reseedObserved().
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { OBSERVED_TABLES, SCHEMA_SQL, SEED_OBSERVED_AT } from './schema';
import { deriveStage, deriveTrackStage, deriveWorkOrderCost } from '../../core/derive';
import type { CreateWorkOrderInput, CreateWorkspaceInput, RepoConnectionInput, WorkOrderSource } from '../../core/source';
import { buildOrderMd, findWorkOrderDir, nextWorkOrderNumber, readWoDocs, writeOrderMd, writePlanMdById } from '../decision-store/decision-store';
import { architectPrompt, parseOrderMd } from '../../core/order-md';
import { rid, tid, wid, woid } from '../ids';
import { workOrders, workspaces } from '../fixtures';
import type {
  Ci,
  CiCheck,
  CostSummary,
  SessionRef,
  SessionRole,
  SourceLink,
  Track,
  TrackId,
  WorkOrder,
  WorkOrderId,
  Workspace,
  WorkspaceId,
} from '../../core/types';

export interface RecordSessionInput {
  providerSessionId: string;
  workOrderId: WorkOrderId;
  role: SessionRole;
  scope?: TrackId;
  status: SessionRef['status'];
  cost?: CostSummary;
}

export interface Store extends WorkOrderSource {
  /** Drop every observed table and re-seed it; owned tables are untouched (ADR-0010). */
  reseedObserved(): void;
  /** Persist (upsert) a live session row keyed by provider session id — main side-effect (WO-0010). */
  recordSession(input: RecordSessionInput): void;
  /** The architect session's first prompt, assembled from the work order's order.md (WO-0016). */
  architectPromptFor(workOrderId: WorkOrderId): string | undefined;
  /** The underlying handle (tests / future migration tooling). */
  readonly db: DatabaseSync;
}

// --- row shapes (node:sqlite returns untyped rows) ---
type WoRow = {
  id: string;
  workspace_id: string;
  title: string;
  mode: 'plan' | 'direct';
  gate_plan_approved: number;
  gate_verifier_resolvable: number | null;
  gate_closure_docs_sha: string | null;
  cost_tokens_in: number;
  cost_tokens_out: number;
  cost_usd: number;
};
type TrackRow = {
  id: string;
  work_order_id: string;
  repo: string;
  pr_url: string | null;
  pr_head_sha: string | null;
  ci_kind: 'run' | 'exempt';
  ci_blob: string;
  merged_at: string | null;
};
type SessionRow = {
  id: number;
  provider_session_id: string | null;
  work_order_id: string;
  role: SessionRef['role'];
  scope_track_id: string | null;
  status: SessionRef['status'];
  transcript: string;
  stop_and_ask: string | null;
  cost_tokens_in: number | null;
  cost_tokens_out: number | null;
  cost_usd: number | null;
};

// ===== Hydration (rows → domain; stage derived; ids re-branded) =====
function hydrateTracks(db: DatabaseSync, woId: string, sessions: SessionRef[]): Track[] {
  const rows = db.prepare('SELECT * FROM track WHERE work_order_id = ?').all(woId) as TrackRow[];
  return rows.map((r): Track => {
    const ci = JSON.parse(r.ci_blob) as { state?: 'running' | 'success' | 'failed'; checks?: CiCheck[]; reason?: string };
    const dependsOn = (
      db.prepare('SELECT depends_on_track_id FROM track_depends_on WHERE track_id = ?').all(r.id) as {
        depends_on_track_id: string;
      }[]
    ).map((x) => tid(x.depends_on_track_id));
    const trackCi: Ci =
      r.ci_kind === 'exempt'
        ? { kind: 'exempt', reason: ci.reason ?? '' }
        : { kind: 'run', state: ci.state ?? 'running', checks: ci.checks ?? [] };
    const pr = r.pr_url ? { url: r.pr_url, headSha: r.pr_head_sha ?? '' } : undefined;
    const merge = r.merged_at ? { at: r.merged_at } : undefined;
    const hasActiveSession = sessions.some((s) => s.scope === tid(r.id) && s.status !== 'none');
    return {
      id: tid(r.id),
      repo: rid(r.repo),
      dependsOn,
      stage: deriveTrackStage({ ...(pr ? { pr } : {}), ...(merge ? { merge } : {}) }, hasActiveSession),
      ci: trackCi,
      ...(pr ? { pr } : {}),
      ...(merge ? { merge } : {}),
    };
  });
}

function hydrateSessions(db: DatabaseSync, woId: string): SessionRef[] {
  const rows = db.prepare('SELECT * FROM session WHERE work_order_id = ? ORDER BY id').all(woId) as SessionRow[];
  return rows.map((r): SessionRef => {
    const transcript = JSON.parse(r.transcript) as SessionRef['transcript'];
    const scope = r.scope_track_id ? tid(r.scope_track_id) : undefined;
    const providerSessionId = r.provider_session_id ?? undefined;
    // Per-session cost is observed — WO-0010 wrote it on turn_complete; undefined until then.
    const cost = r.cost_usd == null ? undefined : { tokensIn: r.cost_tokens_in ?? 0, tokensOut: r.cost_tokens_out ?? 0, usd: r.cost_usd };
    switch (r.status) {
      case 'stopped_asking':
        return { role: r.role, status: 'stopped_asking', transcript, stopAndAsk: JSON.parse(r.stop_and_ask ?? '{}'), scope, providerSessionId, ...(cost ? { cost } : {}) };
      case 'running':
        return { role: r.role, status: 'running', transcript, scope, providerSessionId, ...(cost ? { cost } : {}) };
      case 'idle':
        return { role: r.role, status: 'idle', transcript, scope, providerSessionId, ...(cost ? { cost } : {}) };
      case 'none':
        return { role: r.role, status: 'none', transcript, scope, providerSessionId, ...(cost ? { cost } : {}) };
    }
  });
}

function hydrateSources(db: DatabaseSync, woId: string): SourceLink[] {
  const rows = db.prepare('SELECT kind, label, ref FROM work_order_source WHERE work_order_id = ? ORDER BY idx').all(woId) as Array<{
    kind: string;
    label: string;
    ref: string;
  }>;
  return rows.map((r) => ({ kind: r.kind as SourceLink['kind'], label: r.label, ref: r.ref }));
}

function hydrateWorkOrder(db: DatabaseSync, id: string): WorkOrder | undefined {
  const r = db.prepare('SELECT * FROM work_order WHERE id = ?').get(id) as WoRow | undefined;
  if (!r) return undefined;
  const sessions = hydrateSessions(db, id);
  const tracks = hydrateTracks(db, id, sessions);
  const gateInputs = {
    planApproved: !!r.gate_plan_approved,
    verifierReport: r.gate_verifier_resolvable == null ? undefined : { resolvablePointers: !!r.gate_verifier_resolvable },
    closureDocsSha: r.gate_closure_docs_sha ?? undefined,
  };
  // Cost is DERIVED from the WO's session rows (ADR-0010 rule 2 — same as `stage`); the
  // work_order.cost_* columns are inert (TD-023). `sessions` is hydrated just above.
  const cost = deriveWorkOrderCost(sessions);
  return {
    id: woid(r.id),
    title: r.title,
    workspace: wid(r.workspace_id),
    mode: r.mode,
    stage: deriveStage({ gateInputs, tracks, sessions }),
    tracks,
    sessions,
    gateInputs,
    cost,
    sources: hydrateSources(db, id),
  };
}

function readWorkspaces(db: DatabaseSync): Workspace[] {
  const rows = db.prepare('SELECT * FROM workspace').all() as { id: string; label: string; decision_store: string }[];
  return rows.map((r) => {
    const repos = (
      db.prepare('SELECT repo_id FROM workspace_repo WHERE workspace_id = ?').all(r.id) as { repo_id: string }[]
    ).map((x) => rid(x.repo_id));
    return { id: wid(r.id), label: r.label, repos, decisionStore: rid(r.decision_store) };
  });
}

// ===== Seed (observed | owned) from fixture constants =====
function seedObserved(db: DatabaseSync): void {
  // Clear observed first so seeding is idempotent and survives a partially-seeded
  // observed half (a crash mid-seed, or observed dropped while owned survived).
  for (const t of OBSERVED_TABLES) db.exec(`DELETE FROM ${t}`);
  for (const ws of workspaces) {
    db.prepare('INSERT INTO workspace (id, label, decision_store, observed_at) VALUES (?, ?, ?, ?)').run(
      ws.id, ws.label, ws.decisionStore, SEED_OBSERVED_AT,
    );
    for (const repo of ws.repos) {
      db.prepare('INSERT INTO workspace_repo (workspace_id, repo_id) VALUES (?, ?)').run(ws.id, repo);
    }
  }
}

// The fixture work orders + their sessions are TEST DATA, not production seed (WO-0015: the board
// starts empty — the operator creates work orders). Kept here as an explicit helper so the six-state
// store coverage survives the un-seeding of the production path. Clears observed WO tables + session
// first so it is safe to call on an already-seeded DB. Production createStore never calls this.
export function seedFixtureWorkOrders(db: DatabaseSync): void {
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

// Upsert a live session row keyed by provider session id (WO-0010). The transcript is the
// provider's (kept on disk by id); Docket stores the pointer + status + cost. For a
// stopped_asking live session a placeholder gate is stored so deriveCardReason never reads a
// missing field — the real question resurfaces on resume. Idempotent via DELETE+INSERT.
function recordSessionRow(db: DatabaseSync, input: RecordSessionInput): void {
  db.prepare('DELETE FROM session WHERE provider_session_id = ?').run(input.providerSessionId);
  const stopAndAsk = input.status === 'stopped_asking' ? JSON.stringify({ question: '', gate: 'tool-permission' }) : null;
  db.prepare(
    `INSERT INTO session (provider_session_id, work_order_id, role, scope_track_id, status, transcript, stop_and_ask, cost_tokens_in, cost_tokens_out, cost_usd)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.providerSessionId,
    input.workOrderId,
    input.role,
    input.scope ?? null,
    input.status,
    '[]',
    stopAndAsk,
    input.cost?.tokensIn ?? null,
    input.cost?.tokensOut ?? null,
    input.cost?.usd ?? null,
  );
}

// Additive migration for DBs created before WO-0010. No UNIQUE constraint is added —
// recordSessionRow upserts via DELETE+INSERT, so provider_session_id need not be UNIQUE.
function migrate(db: DatabaseSync): void {
  const cols = new Set((db.prepare('PRAGMA table_info(session)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('provider_session_id')) db.exec('ALTER TABLE session ADD COLUMN provider_session_id TEXT');
  if (!cols.has('cost_tokens_in')) db.exec('ALTER TABLE session ADD COLUMN cost_tokens_in INTEGER');
  if (!cols.has('cost_tokens_out')) db.exec('ALTER TABLE session ADD COLUMN cost_tokens_out INTEGER');
  if (!cols.has('cost_usd')) db.exec('ALTER TABLE session ADD COLUMN cost_usd REAL');
}

// --- Workspace + repo-connection CRUD (WO-0014) ---
// Pragmatic M2 (ADR-0009 addendum): the UI authors definitions (observed workspace/workspace_repo) +
// connections (owned connection table). M3 git scanner reconciles definitions from yaml; owned
// connections persist.
function gitRemote(path: string): string {
  try {
    return execFileSync('git', ['-C', path, 'remote', 'get-url', 'origin'], { encoding: 'utf-8', timeout: 2000 }).trim();
  } catch {
    return '';
  }
}
function repoBase(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'repo';
}
function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
}

function createWorkspaceRow(db: DatabaseSync, input: CreateWorkspaceInput): Workspace {
  const id = wid(slugify(input.label));
  const repos = input.repos.map((r) => {
    const remote = r.remote ?? gitRemote(r.path);
    return { id: rid(repoBase(r.path)), path: r.path, remote };
  });
  const decisionStore = input.decisionStorePath ? rid(repoBase(input.decisionStorePath)) : (repos[0]?.id ?? rid('repo'));
  const now = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO workspace (id, label, decision_store, observed_at) VALUES (?,?,?,?)').run(
    id, input.label, decisionStore, now,
  );
  db.prepare('DELETE FROM workspace_repo WHERE workspace_id = ?').run(id);
  for (const r of repos) {
    db.prepare('INSERT OR REPLACE INTO workspace_repo (workspace_id, repo_id) VALUES (?,?)').run(id, r.id);
    db.prepare('INSERT OR REPLACE INTO connection (workspace_id, repo_remote, local_path) VALUES (?,?,?)').run(
      id, r.remote || r.id, r.path,
    );
  }
  return { id, label: input.label, repos: repos.map((r) => r.id), decisionStore };
}

function updateWorkspaceRow(db: DatabaseSync, id: WorkspaceId, patch: { label?: string; decisionStorePath?: string }): void {
  if (patch.label !== undefined) db.prepare('UPDATE workspace SET label = ? WHERE id = ?').run(patch.label, id);
  if (patch.decisionStorePath !== undefined) {
    const ds = patch.decisionStorePath
      ? rid(repoBase(patch.decisionStorePath))
      : ((db.prepare('SELECT repo_id FROM workspace_repo WHERE workspace_id = ? LIMIT 1').get(id) as { repo_id: string } | undefined)?.repo_id ?? 'repo');
    db.prepare('UPDATE workspace SET decision_store = ? WHERE id = ?').run(ds, id);
  }
}

function deleteWorkspaceRow(db: DatabaseSync, id: WorkspaceId): void {
  db.prepare('DELETE FROM connection WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM workspace_repo WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM workspace WHERE id = ?').run(id);
}

function addRepoConnectionRow(db: DatabaseSync, id: WorkspaceId, repo: RepoConnectionInput): void {
  const remote = repo.remote ?? gitRemote(repo.path);
  const repoId = rid(repoBase(repo.path));
  db.prepare('INSERT OR REPLACE INTO workspace_repo (workspace_id, repo_id) VALUES (?,?)').run(id, repoId);
  db.prepare('INSERT OR REPLACE INTO connection (workspace_id, repo_remote, local_path) VALUES (?,?,?)').run(
    id, remote || repoId, repo.path,
  );
}

function removeRepoConnectionRow(db: DatabaseSync, id: WorkspaceId, path: string): void {
  const repoId = rid(repoBase(path));
  db.prepare('DELETE FROM workspace_repo WHERE workspace_id = ? AND repo_id = ?').run(id, repoId);
  db.prepare('DELETE FROM connection WHERE workspace_id = ? AND local_path = ?').run(id, path);
}

// --- Work-order creation (WO-0015) ---
// Resolve the decision store's local working-tree path for a workspace. Workspace.decisionStore is a
// RepoId slug; the real path lives in the owned connection table. Fixture workspaces have no
// connection row, so fall back to process.cwd() (Docket manages itself from its own working tree).
// The path never crosses to the renderer (ADR-0001). M3 reads workspace.yaml + connection instead.
function resolveDecisionStorePath(db: DatabaseSync, workspaceId: WorkspaceId): string {
  const ws = db.prepare('SELECT decision_store FROM workspace WHERE id = ?').get(workspaceId) as
    | { decision_store: string }
    | undefined;
  const dsSlug = ws?.decision_store ?? '';
  const rows = db.prepare('SELECT local_path FROM connection WHERE workspace_id = ?').all(workspaceId) as {
    local_path: string;
  }[];
  for (const r of rows) {
    if (repoBase(r.local_path) === dsSlug) return r.local_path;
  }
  return process.cwd();
}

function createWorkOrderRow(db: DatabaseSync, input: CreateWorkOrderInput & { id: string }): WorkOrder {
  const now = new Date().toISOString();
  // A created work order sits at the start of the pipeline: plan not approved, no sessions → deriveStage
  // yields 'written'. mode is 'plan' (the plan-driven flow). description/reviewMode/contextFiles are NOT
  // stored (ADR-0010 rule 1) — they were written to order.md above by the orchestrator.
  db.prepare(
    `INSERT INTO work_order (id, workspace_id, title, mode, gate_plan_approved, gate_verifier_resolvable,
     gate_closure_docs_sha, cost_tokens_in, cost_tokens_out, cost_usd, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(input.id, input.workspaceId, input.title, 'plan', 0, null, null, 0, 0, 0, now);
  for (const repo of input.trackRepos) {
    const repoSlug = repo as string;
    // ci run/running/[] mirrors the fixture convention for an unobserved track (M3 forge observation
    // replaces it; the Ci type has no 'unknown' state yet — TD-008). Inert at stage 'written'.
    db.prepare(
      `INSERT INTO track (id, work_order_id, repo, pr_url, pr_head_sha, ci_kind, ci_blob, merged_at, observed_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(`${input.id}-${repoSlug}`, input.id, repoSlug, null, null, 'run', JSON.stringify({ state: 'running', checks: [] }), null, now);
  }
  const wo = hydrateWorkOrder(db, input.id);
  if (!wo) throw new Error(`createWorkOrder: failed to hydrate ${input.id}`);
  return wo;
}

export function createStore(dbPath: string): Store {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  migrate(db);
  // Seed the observed half when empty. Work orders are NOT seeded (WO-0015: the board starts empty —
  // the operator creates them); only the workspace fixtures are. Counting workspace (not work_order)
  // gates the seed once and never again. Owned sessions are live rows (WO-0010), never fixture-seeded.
  const observedEmpty = (db.prepare('SELECT COUNT(*) AS n FROM workspace').get() as { n: number }).n === 0;
  if (observedEmpty) seedObserved(db);
  return {
    db,
    getWorkspaces: () => Promise.resolve(readWorkspaces(db)),
    getWorkOrders: async () => {
      const ids = db.prepare('SELECT id FROM work_order').all() as { id: string }[];
      const out: WorkOrder[] = [];
      for (const x of ids) {
        const w = hydrateWorkOrder(db, x.id);
        if (w) out.push(w);
      }
      return out;
    },
    getWorkOrder: (id: WorkOrderId) => Promise.resolve(hydrateWorkOrder(db, id)),
    // Real working-tree reads (WO-0016): resolve the WO's decision-store path and read order.md/plan.md
    // from disk at view time (ADR-0010 — no document text cached in the DB). Missing dir/file → ''.
    getWorkOrderDocs: (id: WorkOrderId) => {
      const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(id) as
        | { workspace_id: string }
        | undefined;
      if (!wo) return Promise.resolve({ order: '', plan: '' });
      const dir = resolveDecisionStorePath(db, wid(wo.workspace_id));
      return Promise.resolve(readWoDocs(dir, id));
    },
    recordSession: (input: RecordSessionInput) => recordSessionRow(db, input),
    // The architect's first prompt, assembled server-side from order.md (WO-0016). The composition root
    // fills DriveInput.prompt with this when role==='architect' and the renderer sent none (mirrors the
    // cwd fill). Returns undefined when there is no order.md yet (caller leaves the prompt untouched).
    architectPromptFor: (workOrderId: WorkOrderId) => {
      const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string }
        | undefined;
      if (!wo) return undefined;
      const dir = resolveDecisionStorePath(db, wid(wo.workspace_id));
      const { order } = readWoDocs(dir, workOrderId);
      if (!order) return undefined;
      const parsed = parseOrderMd(order);
      const woDir = findWorkOrderDir(dir, workOrderId);
      const orderMdPath = woDir ? `${woDir}/order.md` : '';
      return architectPrompt({ ...parsed, orderMdPath });
    },
    createWorkspace: (input: CreateWorkspaceInput) => Promise.resolve(createWorkspaceRow(db, input)),
    updateWorkspace: (id: WorkspaceId, patch: { label?: string; decisionStorePath?: string }) =>
      Promise.resolve(updateWorkspaceRow(db, id, patch)),
    deleteWorkspace: (id: WorkspaceId) => Promise.resolve(deleteWorkspaceRow(db, id)),
    addRepoConnection: (id: WorkspaceId, repo: RepoConnectionInput) =>
      Promise.resolve(addRepoConnectionRow(db, id, repo)),
    removeRepoConnection: (id: WorkspaceId, path: string) =>
      Promise.resolve(removeRepoConnectionRow(db, id, path)),
    // Orchestrates creation (WO-0015): resolve the decision-store path → allocate the next WO number →
    // author order.md into the working tree (no commit) → insert the observed row + tracks. The async
    // wrapper turns fs/DB errors into a rejected promise the UI can surface (modal stays open).
    createWorkOrder: async (input: CreateWorkOrderInput) => {
      const dir = resolveDecisionStorePath(db, input.workspaceId);
      const id = nextWorkOrderNumber(dir);
      const slug = slugify(input.title);
      const ws = db.prepare('SELECT id FROM workspace WHERE id = ?').get(input.workspaceId) as
        | { id: string }
        | undefined;
      writeOrderMd(
        dir,
        id,
        slug,
        buildOrderMd({
          id,
          title: input.title,
          workspaceSlug: ws?.id ?? 'workspace',
          description: input.description,
          trackRepos: input.trackRepos.map((r) => r as string),
          reviewMode: input.reviewMode,
          contextFiles: input.contextFiles,
        }),
      );
      return createWorkOrderRow(db, { ...input, id });
    },
    // Approve the architect's proposed plan (WO-0016): write plan.md into the working tree (no commit)
    // and flip the plan_approval gate. Errors (missing WO dir / fs failure) → rejected promise the UI surfaces.
    approvePlan: async (workOrderId: WorkOrderId, planText: string) => {
      const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string }
        | undefined;
      if (!wo) throw new Error(`approvePlan: work order ${workOrderId} not found`);
      const dir = resolveDecisionStorePath(db, wid(wo.workspace_id));
      writePlanMdById(dir, workOrderId, planText);
      db.prepare('UPDATE work_order SET gate_plan_approved = 1 WHERE id = ?').run(workOrderId);
    },
    reseedObserved() {
      for (const t of OBSERVED_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
      db.exec(SCHEMA_SQL);
      seedObserved(db);
    },
  };
}
