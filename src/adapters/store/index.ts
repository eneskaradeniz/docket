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
import { deriveStage, deriveSteps, deriveTrackStage, deriveWorkOrderCost, canClose, type ObservedStep } from '../../core/derive';
import type { CreateWorkOrderInput, CreateWorkspaceInput, PermissionRule, RepoConnectionInput, RepoConnectionView, UpdateWorkOrderInput, WorkOrderSource } from '../../core/source';
import type { RecordSessionInput, SessionStore } from '../../core/session-store';
import { buildOrderMd, findWorkOrderDir, nextWorkOrderNumber, readStepReport, readStepVerdict, readWoDocs, removeWorkOrderDir, writeOrderMd, writeOrderMdById, writePlanMdById, writeStepReport, writeStepVerdict } from '../decision-store/decision-store';
import { applyOrderMdEdits, architectPrompt, architectReviewPrompt, implementerPrompt, orderMdCarriesRule, parseOrderMd, verifierPrompt } from '../../core/order-md';
import { parsePlanSteps } from '../../core/plan-steps';
import { rid, tid, wid, woid } from '../ids';
import { workOrders, workspaces } from '../fixtures';
import type {
  Ci,
  CiCheck,
  RepoId,
  SessionRef,
  WoEvent,
  WoEventKind,
  SourceLink,
  StepRole,
  StepView,
  Track,
  TrackId,
  WorkOrder,
  WorkOrderId,
  Workspace,
  WorkspaceId,
} from '../../core/types';

// RecordSessionInput + the eight drive-loop methods (record*/savePendingPlan/*PromptFor) live on the core
// `SessionStore` port (src/core/session-store.ts); `Store` implements it. The drive loop (src/core/pipeline.ts)
// depends on that port, not on this adapter (WO-0023).

export interface Store extends WorkOrderSource, SessionStore, AppSettingsData {
  /** Drop every observed table and re-seed it; owned tables are untouched (ADR-0010). */
  reseedObserved(): void;
  /** The work order's REPO ROOT PATHS (its tracks' connected local paths, decision store included) —
   *  the jail the diff-peek read stays inside (WO-0031c: the root is the WO's repos, never cwd). */
  woRepoPaths(workOrderId: WorkOrderId): string[];
  /** The underlying handle (tests / future migration tooling). */
  readonly db: DatabaseSync;
}

/** The DB-backed half of the AppSettings port (WO-0025): the provider key in the `app_setting` table. The
 *  check-half (checkProvider) lives in the runner adapter — only it may touch the provider. */
export interface AppSettingsData {
  getProviderKey(): Promise<string | undefined>;
  setProviderKey(key: string | undefined): Promise<void>;
  getPermissionRule(): Promise<PermissionRule>;
  setPermissionRule(rule: PermissionRule): Promise<void>;
  /** Resolve the EFFECTIVE rule for a drive (WO-0031c): the work order's own order.md rule when it
   *  carries one, else the Settings default (a pre-c2 work order has no key — its behavior follows the
   *  operator's default, with the legacy ask/auto values mapped). */
  getPermissionRuleFor(workOrderId: WorkOrderId): Promise<PermissionRule>;
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
  started_at: string | null;
  ended_at: string | null;
  cost_tokens_in: number | null;
  cost_tokens_out: number | null;
  cost_usd: number | null;
  step_idx: number | null;
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
    const stepIdx = r.step_idx ?? undefined;
    const startedAt = r.started_at ?? undefined;
    const endedAt = r.ended_at ?? undefined;
    // Per-session cost is observed — WO-0010 wrote it on turn_complete; undefined until then.
    const cost = r.cost_usd == null ? undefined : { tokensIn: r.cost_tokens_in ?? 0, tokensOut: r.cost_tokens_out ?? 0, usd: r.cost_usd };
    switch (r.status) {
      case 'stopped_asking':
        return {
          role: r.role,
          status: 'stopped_asking',
          transcript,
          stopAndAsk: JSON.parse(r.stop_and_ask ?? '{}') as SessionRef extends never ? never : import('../../core/types').StopAndAsk,
          scope,
          providerSessionId,
          stepIdx,
          startedAt,
          endedAt,
          ...(cost ? { cost } : {}),
        };
      case 'running':
        return { role: r.role, status: 'running', transcript, scope, providerSessionId, stepIdx, startedAt, endedAt, ...(cost ? { cost } : {}) };
      case 'idle':
        return { role: r.role, status: 'idle', transcript, scope, providerSessionId, stepIdx, startedAt, endedAt, ...(cost ? { cost } : {}) };
      case 'none':
        return { role: r.role, status: 'none', transcript, scope, providerSessionId, stepIdx, startedAt, endedAt, ...(cost ? { cost } : {}) };
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
  // WO-0031e tur-3: `closeable` is the canClose predicate over the step rows (the same projection
  // closeWorkOrder re-checks server-side), derived at hydrate and never stored — the board's
  // honest "the Kapat card is live" signal. Pre-merge guard: a closed WO satisfies canClose
  // forever after (closeWorkOrder refuses a second close, B21) — never flag it closable.
  const stepRows = db.prepare('SELECT status, verdict FROM work_order_step WHERE work_order_id = ?').all(id) as Array<
    { status: string; verdict: string | null }
  >;
  const closeable =
    r.gate_closure_docs_sha == null &&
    canClose({
      planApproved: !!r.gate_plan_approved,
      steps: stepRows.map((s) => ({
        status: s.status as 'pending' | 'active' | 'done' | 'blocked',
        verdict: (s.verdict ?? undefined) as 'proceed' | 'revise' | undefined,
      })),
    }).ok;
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
    ...(closeable ? { closeable: true } : {}),
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
// WO-0030 / İstek 8: append-only lifecycle audit. Written by the store's own mutations; never updated.
function appendEvent(db: DatabaseSync, woId: string, kind: WoEventKind, detail = ''): void {
  db.prepare('INSERT INTO wo_event (work_order_id, kind, detail, at) VALUES (?,?,?,?)').run(woId, kind, detail, new Date().toISOString());
}

function recordSessionRow(db: DatabaseSync, input: RecordSessionInput): void {
  // WO-0029 / B17: a RESUMED session is the same row — accumulate the cost across its turns and keep the
  // EARLIEST start (the old DELETE+INSERT kept only the last turn's cost, so a resumed plan session's
  // earlier $2.15 vanished from the WO aggregate).
  const prior = db
    .prepare('SELECT cost_tokens_in, cost_tokens_out, cost_usd, started_at, ended_at FROM session WHERE provider_session_id = ?')
    .get(input.providerSessionId) as
    | { cost_tokens_in: number | null; cost_tokens_out: number | null; cost_usd: number | null; started_at: string | null; ended_at: string | null }
    | undefined;
  db.prepare('DELETE FROM session WHERE provider_session_id = ?').run(input.providerSessionId);
  const acc = (() => {
    if (!input.cost) return prior?.cost_usd == null ? undefined : { tokensIn: prior.cost_tokens_in ?? 0, tokensOut: prior.cost_tokens_out ?? 0, usd: prior.cost_usd };
    if (prior?.cost_usd == null) return input.cost;
    return {
      tokensIn: input.cost.tokensIn + (prior.cost_tokens_in ?? 0),
      tokensOut: input.cost.tokensOut + (prior.cost_tokens_out ?? 0),
      usd: input.cost.usd + prior.cost_usd,
    };
  })();
  // The asks ride the stopped_asking row (WO-0027 / Bulgu 9) — persisted for re-attach, replacing the
  // old `{question:'',gate:'tool-permission'}` placeholder that told the board nothing (F7).
  const stopAndAsk =
    input.status === 'stopped_asking'
      ? JSON.stringify({ question: '', gate: 'tool-permission', asks: input.asks ?? [] })
      : null;
  db.prepare(
    `INSERT INTO session (provider_session_id, work_order_id, role, scope_track_id, status, transcript, stop_and_ask, cost_tokens_in, cost_tokens_out, cost_usd, started_at, ended_at, step_idx)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.providerSessionId,
    input.workOrderId,
    input.role,
    input.scope ?? null,
    input.status,
    JSON.stringify(input.transcript ?? []),
    stopAndAsk,
    acc?.tokensIn ?? null,
    acc?.tokensOut ?? null,
    acc?.usd ?? null,
    (prior?.started_at && input.startedAt && prior.started_at < input.startedAt ? prior.started_at : input.startedAt) ?? prior?.started_at ?? null,
    (prior?.ended_at && input.endedAt && prior.ended_at > input.endedAt ? prior.ended_at : input.endedAt) ?? prior?.ended_at ?? null,
    input.stepIdx ?? null,
  );
}

// Additive migration for DBs created before WO-0010. No UNIQUE constraint is added —
// recordSessionRow upserts via DELETE+INSERT, so provider_session_id need not be UNIQUE.
// Also rebuilds the observed half if it predates the derive-at-hydrate model (a stored `track.stage`
// column — the M2 dev schema drifted before TD-008 finalised; CREATE TABLE IF NOT EXISTS does not migrate
// an existing table). Observed is discardable (ADR-0010), so drop + recreate + re-seed.
function migrate(db: DatabaseSync): void {
  const cols = new Set((db.prepare('PRAGMA table_info(session)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('provider_session_id')) db.exec('ALTER TABLE session ADD COLUMN provider_session_id TEXT');
  if (!cols.has('cost_tokens_in')) db.exec('ALTER TABLE session ADD COLUMN cost_tokens_in INTEGER');
  if (!cols.has('cost_tokens_out')) db.exec('ALTER TABLE session ADD COLUMN cost_tokens_out INTEGER');
  if (!cols.has('cost_usd')) db.exec('ALTER TABLE session ADD COLUMN cost_usd REAL');
  if (!cols.has('step_idx')) db.exec('ALTER TABLE session ADD COLUMN step_idx INTEGER');
  // WO-0027 / İstek 7: session durations (additive; CREATE TABLE covers fresh dbs).
  if (!cols.has('started_at')) db.exec('ALTER TABLE session ADD COLUMN started_at TEXT');
  if (!cols.has('ended_at')) db.exec('ALTER TABLE session ADD COLUMN ended_at TEXT');

  const trackCols = new Set((db.prepare('PRAGMA table_info(track)').all() as { name: string }[]).map((c) => c.name));
  if (trackCols.has('stage')) {
    // Legacy pre-TD-008 dev schema: `track` carried a stored `stage` column (now derived at hydrate).
    // SQLite cannot DROP a NOT NULL column directly, so rename → recreate (SCHEMA_SQL, no stage) → copy
    // the other columns → drop the legacy table. Workspaces/work_orders are preserved.
    db.exec('ALTER TABLE track RENAME TO track_legacy');
    db.exec(SCHEMA_SQL);
    db.exec(
      'INSERT INTO track (id, work_order_id, repo, pr_url, pr_head_sha, ci_kind, ci_blob, merged_at, observed_at) ' +
        'SELECT id, work_order_id, repo, pr_url, pr_head_sha, ci_kind, ci_blob, merged_at, observed_at FROM track_legacy',
    );
    db.exec('DROP TABLE track_legacy');
  }
  // WO-0020: work_order_step gains the verdict columns on pre-existing DBs (additive ALTER — no CHECK needed;
  // the store validates in TS, and observed tables are discardable so a reseed rebuilds any CHECK).
  const stepCols = new Set((db.prepare('PRAGMA table_info(work_order_step)').all() as { name: string }[]).map((c) => c.name));
  if (!stepCols.has('verdict')) db.exec('ALTER TABLE work_order_step ADD COLUMN verdict TEXT');
  if (!stepCols.has('verdict_path')) db.exec('ALTER TABLE work_order_step ADD COLUMN verdict_path TEXT');

  // WO-0031c: wo_event's kind CHECK widens (wo_edited/rule_changed/permission_decision). A CHECK lives in
  // the table definition, so — like the legacy track.stage rebuild above — rename → recreate (the widened
  // SCHEMA_SQL) → id-preserving copy (append order is the audit's meaning) → drop.
  const woEventSql =
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wo_event'").get() as { sql: string } | undefined)?.sql ?? '';
  if (woEventSql && !woEventSql.includes("'wo_edited'")) {
    db.exec('ALTER TABLE wo_event RENAME TO wo_event_legacy');
    db.exec(SCHEMA_SQL);
    db.exec(
      'INSERT INTO wo_event (id, work_order_id, kind, detail, at) ' +
        'SELECT id, work_order_id, kind, detail, at FROM wo_event_legacy ORDER BY id',
    );
    db.exec('DROP TABLE wo_event_legacy');
  }
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

// WO-0033: a repo's identity is its basename (the RepoId invariant every writer follows). Adding a
// second repo with the same basename used to collapse silently — INSERT OR REPLACE over
// workspace_repo's PK swallowed the first and the connection row overwrote. Refuse before any write.
function assertNoRepoCollision(db: DatabaseSync, id: WorkspaceId, repoId: string): void {
  const hit = db.prepare('SELECT 1 FROM workspace_repo WHERE workspace_id = ? AND repo_id = ?').get(id, repoId);
  if (hit) throw new Error(`duplicate repo: ${repoId}`);
}

function createWorkspaceRow(db: DatabaseSync, input: CreateWorkspaceInput): Workspace {
  const id = wid(slugify(input.label));
  const seen = new Set<string>();
  const repos = input.repos.map((r) => {
    const baseName = repoBase(r.path);
    // Intra-list check before any write (WO-0033): a duplicate basename rejects the whole create —
    // the workspace row is not left half-written (the non-atomic-write class stays TD-021's).
    if (seen.has(baseName)) throw new Error(`duplicate repo: ${baseName}`);
    seen.add(baseName);
    const remote = r.remote ?? gitRemote(r.path);
    return { id: rid(baseName), path: r.path, remote };
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

// Delete a workspace WITH everything Docket recorded under it (WO-0032): guard first — a live drive
// blocks the delete and an error must delete nothing — then the per-WO cascade for each of its work
// orders (rows + the Docket-authored decision-store dirs), then the definition + connection rows.
// Repo code and git history are never touched; the dir resolves STRICTLY from connection rows (a
// workspace without a matching connection deletes DB rows only, never a folder under cwd). Global
// app_setting rows are untouched.
function deleteWorkspaceRow(db: DatabaseSync, id: WorkspaceId): void {
  const live = db
    .prepare(
      "SELECT COUNT(*) AS n FROM session WHERE status = 'running' AND work_order_id IN (SELECT id FROM work_order WHERE workspace_id = ?)",
    )
    .get(id) as { n: number };
  if (live.n > 0) throw new Error(`deleteWorkspace: ${live.n} running session(s) in ${id}`);
  const dir = connectedDecisionStorePath(db, id); // before the connection rows go
  const woIds = db.prepare('SELECT id FROM work_order WHERE workspace_id = ?').all(id) as { id: string }[];
  for (const x of woIds) deleteWorkOrderRows(db, woid(x.id), dir);
  db.prepare('DELETE FROM connection WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM workspace_repo WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM workspace WHERE id = ?').run(id);
}

function addRepoConnectionRow(db: DatabaseSync, id: WorkspaceId, repo: RepoConnectionInput): void {
  const remote = repo.remote ?? gitRemote(repo.path);
  const repoId = rid(repoBase(repo.path));
  assertNoRepoCollision(db, id, repoId as string);
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

// The ledger read (WO-0033): the connection table's rows as {id, path}. Order is insert order
// (rowid) — the UI merges onto the workspace's definition order and shows only these paths.
function repoConnectionsRow(db: DatabaseSync, id: WorkspaceId): RepoConnectionView[] {
  const rows = db.prepare('SELECT local_path FROM connection WHERE workspace_id = ?').all(id) as {
    local_path: string;
  }[];
  return rows.map((r) => ({ id: rid(repoBase(r.local_path)), path: r.local_path }));
}

// Move a repo's local path (WO-0033): basename-is-identity first (a path naming a different
// basename is a different repo — refuse, change nothing), then rewrite local_path on the ONE
// matching connection row. repo_remote and the definition row are untouched.
function updateRepoPathRow(db: DatabaseSync, id: WorkspaceId, repoId: RepoId, newPath: string): void {
  if (repoBase(newPath) !== (repoId as string)) {
    throw new Error(`updateRepoPath: ${newPath} is not repo ${repoId} (basename is the identity)`);
  }
  const row = (
    db.prepare('SELECT repo_remote, local_path FROM connection WHERE workspace_id = ?').all(id) as {
      repo_remote: string;
      local_path: string;
    }[]
  ).find((r) => repoBase(r.local_path) === (repoId as string));
  if (!row) throw new Error(`updateRepoPath: no connection for ${repoId} in ${id}`);
  db.prepare('UPDATE connection SET local_path = ? WHERE workspace_id = ? AND repo_remote = ?').run(
    newPath, id, row.repo_remote,
  );
}

// --- Work-order creation (WO-0015) ---
// The workspace's decision-store path resolved STRICTLY from its connection rows (WO-0032): the same
// slug match resolveDecisionStorePath applies, but undefined when no connection matches. DELETES
// resolve through this only — a deletion must never operate on the process.cwd() fallback (fixture
// workspaces resolve there, and under vitest cwd IS the operator's real repo).
function connectedDecisionStorePath(db: DatabaseSync, workspaceId: WorkspaceId): string | undefined {
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
  return undefined;
}

// Resolve the decision store's local working-tree path for a workspace. Workspace.decisionStore is a
// RepoId slug; the real path lives in the owned connection table. Fixture workspaces have no
// connection row, so fall back to process.cwd() (Docket manages itself from its own working tree).
// The path never crosses to the renderer (ADR-0001). M3 reads workspace.yaml + connection instead.
function resolveDecisionStorePath(db: DatabaseSync, workspaceId: WorkspaceId): string {
  return connectedDecisionStorePath(db, workspaceId) ?? process.cwd();
}

/** The work order's repo root paths: its tracks' connected local paths (decision store included). The
 *  diff-peek read (WO-0031c) is jailed to THESE — never process.cwd(), which is the app's own repo. */
function woRepoPaths(db: DatabaseSync, workOrderId: WorkOrderId): string[] {
  const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(workOrderId) as { workspace_id: string } | undefined;
  if (!wo) return [];
  const tracks = db.prepare('SELECT repo FROM track WHERE work_order_id = ?').all(workOrderId) as { repo: string }[];
  const rows = db.prepare('SELECT local_path FROM connection WHERE workspace_id = ?').all(wid(wo.workspace_id)) as { local_path: string }[];
  const paths = new Set<string>();
  for (const t of tracks) {
    for (const r of rows) {
      if (repoBase(r.local_path) === t.repo || r.local_path.endsWith(t.repo)) paths.add(r.local_path);
    }
  }
  return [...paths];
}

// ===== Plan steps (WO-0017) =====
//
// Steps are detail-only: the board never asks for them. The specs (role/aim/scope) are parsed from plan.md's
// ```steps fence at view time (ADR-0010 — document text is never stored); only the run OUTCOME is persisted
// (work_order_step). These helpers resolve the WO's decision-store dir server-side, parse the fence, resolve
// each step's track scope (the adapter's branded construction — ADR-0003), and drive core's deriveSteps.

// The decision-store working-tree dir for a work order. Resolves the workspace's path server-side; undefined
// when the WO or its workspace is gone. The path never crosses to the renderer (ADR-0001).
function woDir(db: DatabaseSync, id: WorkOrderId): string | undefined {
  const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(id) as { workspace_id: string } | undefined;
  return wo ? resolveDecisionStorePath(db, wid(wo.workspace_id)) : undefined;
}

// The Settings DEFAULT permission rule (WO-0031c): the new `permission_rule` key, falling back to the
// legacy `permission_mode` value ('ask'→ask_every, 'auto'→risky_excluded) so a pre-c2 operator's stored
// choice keeps its meaning. Absent both → ask_every — the operator's ruling: a fresh install never
// silently auto-approves; the operator OPTS IN to Riskli hariç / Tam otomatik.
function settingPermissionRule(db: DatabaseSync): PermissionRule {
  const rule = (db.prepare('SELECT value FROM app_setting WHERE key = ?').get('permission_rule') as { value: string } | undefined)?.value;
  if (rule === 'ask_every' || rule === 'risky_excluded' || rule === 'full_auto') return rule;
  const legacy = (db.prepare('SELECT value FROM app_setting WHERE key = ?').get('permission_mode') as { value: string } | undefined)?.value;
  return legacy === 'auto' ? 'risky_excluded' : 'ask_every';
}

// The EFFECTIVE rule for a work order: its own order.md rule when the front-matter carries one, else the
// Settings default. A pre-c2 work order (no key) follows the operator's default — behavior never jumps
// just because the app learned about rules.
function effectivePermissionRule(db: DatabaseSync, id: WorkOrderId): PermissionRule {
  const dir = woDir(db, id);
  if (dir) {
    const { order } = readWoDocs(dir, id);
    if (order && orderMdCarriesRule(order)) return parseOrderMd(order).permissionRule;
  }
  return settingPermissionRule(db);
}

// Resolve a step's scope.ref to a branded TrackId by matching it against the WO's tracks (repo slug, then id).
// 'all'-scoped steps need no resolution. Unresolved → undefined → deriveSteps marks the step 'blocked'.
function resolveStepScope(db: DatabaseSync, woId: WorkOrderId, ref: string): TrackId | undefined {
  const rows = db.prepare('SELECT id, repo FROM track WHERE work_order_id = ?').all(woId) as { id: string; repo: string }[];
  const t = rows.find((r) => r.repo === ref || r.id === ref);
  return t ? tid(t.id) : undefined;
}

// Build the plan's StepView[] for the detail: parse plan.md's ```steps fence + zip with observed run rows +
// resolve each track scope. [] when there is no plan or no fence (honest degradation).
function buildWorkOrderSteps(db: DatabaseSync, id: WorkOrderId): StepView[] {
  const dir = woDir(db, id);
  if (!dir) return [];
  const { plan } = readWoDocs(dir, id);
  const specs = parsePlanSteps(plan);
  if (specs.length === 0) return [];
  const runRows = db.prepare('SELECT idx, status, report_path, verdict, verdict_path FROM work_order_step WHERE work_order_id = ?').all(id) as
    { idx: number; status: 'active' | 'done'; report_path: string | null; verdict: 'proceed' | 'revise' | null; verdict_path: string | null }[];
  const run = new Map(runRows.map((r) => [r.idx, r]));
  const observed = new Map<number, ObservedStep>();
  for (const s of specs) {
    observed.set(s.idx, {
      scopeTrackId: s.scope.kind === 'track' ? resolveStepScope(db, id, s.scope.ref) : undefined,
      status: run.get(s.idx)?.status,
      reportPath: run.get(s.idx)?.report_path ?? undefined,
      verdict: run.get(s.idx)?.verdict ?? undefined,
      verdictPath: run.get(s.idx)?.verdict_path ?? undefined,
    });
  }
  return deriveSteps(specs, observed);
}

// Upsert a step's run outcome. Idempotent via DELETE+INSERT on (work_order_id, idx), mirroring recordSessionRow.
// status is 'active' (on started) or 'done' (on turn_complete, with the report pointer).
function recordStepRow(db: DatabaseSync, workOrderId: WorkOrderId, idx: number, patch: { status: 'active' | 'done'; reportPath?: string }): void {
  db.prepare('DELETE FROM work_order_step WHERE work_order_id = ? AND idx = ?').run(workOrderId, idx);
  db.prepare(
    'INSERT INTO work_order_step (work_order_id, idx, status, report_path, observed_at) VALUES (?, ?, ?, ?, ?)',
  ).run(workOrderId, idx, patch.status, patch.reportPath ?? null, new Date().toISOString());
  appendEvent(db, workOrderId as string, patch.status === 'active' ? 'step_started' : 'step_done', `adım ${idx}`);
}

// Record the architect's verdict for a step (WO-0020): UPDATE verdict + verdict_path on the existing row
// (preserves status/report_path; idempotent — a re-review overwrites). No-op if the row is absent (step must be
// done first; main guarantees the ordering).
function recordStepVerdictRow(db: DatabaseSync, workOrderId: WorkOrderId, idx: number, verdict: 'proceed' | 'revise', verdictPath: string): void {
  db.prepare('UPDATE work_order_step SET verdict = ?, verdict_path = ?, observed_at = ? WHERE work_order_id = ? AND idx = ?')
    .run(verdict, verdictPath, new Date().toISOString(), workOrderId, idx);
  appendEvent(db, workOrderId as string, 'step_verdict', `adım ${idx} · ${verdict}`);
}

// Reset a step to pending (the revise re-run path, WO-0020): DELETE its observed row (absence of a row IS
// pending, per the schema comment). The report/verdict files are overwritten on re-run/re-review — no fs cleanup.
function resetStepRow(db: DatabaseSync, workOrderId: WorkOrderId, idx: number): void {
  db.prepare('DELETE FROM work_order_step WHERE work_order_id = ? AND idx = ?').run(workOrderId, idx);
}

// Write a step's report to the decision store (reports/step-NN-<role>.md) and mark the step done with the
// pointer. Mirrors approvePlan: path resolution + the working-tree write stay store-internal (ADR-0001), and
// the agent never writes its own report. Throws if the WO dir is missing (order.md must exist first).
function recordStepReportRow(db: DatabaseSync, workOrderId: WorkOrderId, idx: number, role: StepRole, body: string): void {
  const dir = woDir(db, workOrderId);
  if (!dir) throw new Error(`recordStepReport: no decision-store dir for ${workOrderId}`);
  const reportPath = writeStepReport(dir, workOrderId, idx, role, body);
  recordStepRow(db, workOrderId, idx, { status: 'done', reportPath });
}

// The per-WO cascade, shared by deleteWorkOrder and deleteWorkspace (WO-0032): children-first DB
// deletes, the work_order row, then the decision-store folder (order.md/plan.md/reports). `dir` must
// be resolved BEFORE the deletes — the work_order DELETE orphans the resolver (the WO-0032 fix: the
// old order resolved woDir after the DELETE, so dir was always undefined and the folder survived).
function deleteWorkOrderRows(db: DatabaseSync, id: WorkOrderId, dir: string | undefined): void {
  db.prepare('DELETE FROM wo_event WHERE work_order_id = ?').run(id);
  db.prepare('DELETE FROM work_order_step WHERE work_order_id = ?').run(id);
  db.prepare('DELETE FROM session WHERE work_order_id = ?').run(id);
  db.prepare('DELETE FROM track_depends_on WHERE track_id IN (SELECT id FROM track WHERE work_order_id = ?)').run(id);
  db.prepare('DELETE FROM track WHERE work_order_id = ?').run(id);
  db.prepare('DELETE FROM work_order_source WHERE work_order_id = ?').run(id);
  db.prepare('DELETE FROM work_order WHERE id = ?').run(id);
  if (dir) removeWorkOrderDir(dir, id);
}

// The WO's decision-store dir resolved STRICTLY for deletion (WO-0032): the workspace must exist and
// carry a matching connection row, else undefined — a fixture workspace deletes DB rows only, never
// a folder under the cwd fallback.
function woConnectedDir(db: DatabaseSync, id: WorkOrderId): string | undefined {
  const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(id) as { workspace_id: string } | undefined;
  return wo ? connectedDecisionStorePath(db, wid(wo.workspace_id)) : undefined;
}

// Cascade-delete a work order (WO-0020): children-first DB deletes, then the work_order row, then remove the
// decision-store folder (order.md/plan.md/reports). Workspace + repo definitions are untouched.
function deleteWorkOrderRow(db: DatabaseSync, id: WorkOrderId): void {
  deleteWorkOrderRows(db, id, woConnectedDir(db, id));
}

// Assemble a step session's prompt + resolved scope server-side, symmetric to architectPromptFor. Reads
// order.md (objective) + plan.md (planText + the step's spec); resolves the step's track scope. Returns
// undefined when the plan/step is missing — main then leaves the prompt untouched (no accidental free-form run).
function buildStepPrompt(db: DatabaseSync, id: WorkOrderId, idx: number): { prompt: string; scope?: TrackId } | undefined {
  const dir = woDir(db, id);
  if (!dir) return undefined;
  const { order, plan } = readWoDocs(dir, id);
  if (!plan) return undefined;
  const parsed = parseOrderMd(order);
  const spec = parsePlanSteps(plan).find((s) => s.idx === idx);
  if (!spec) return undefined;
  const scope = spec.scope.kind === 'track' ? resolveStepScope(db, id, spec.scope.ref) : undefined;
  const woDirOnDisk = findWorkOrderDir(dir, id);
  const orderMdPath = woDirOnDisk ? `${woDirOnDisk}/order.md` : '';
  const input = { objective: parsed.objective, step: spec, planText: plan, orderMdPath };
  const prompt = spec.role === 'verifier' ? verifierPrompt(input) : implementerPrompt(input);
  const out: { prompt: string; scope?: TrackId } = { prompt };
  if (scope) out.scope = scope;
  return out;
}

// Assemble the architect's REVIEW prompt for a step (WO-0020), symmetric to buildStepPrompt. Reads order.md
// (objective) + plan.md (planText + the step's spec) + the step's report body, and builds architectReviewPrompt.
// Returns undefined when the plan/step/report is missing — main then leaves the prompt untouched.
function buildStepReviewPrompt(db: DatabaseSync, id: WorkOrderId, idx: number): string | undefined {
  const dir = woDir(db, id);
  if (!dir) return undefined;
  const { order, plan } = readWoDocs(dir, id);
  if (!plan) return undefined;
  const parsed = parseOrderMd(order);
  const spec = parsePlanSteps(plan).find((s) => s.idx === idx);
  if (!spec) return undefined;
  const reportBody = readStepReport(dir, id, idx, spec.role);
  const reportPath = `reports/step-${String(idx).padStart(2, '0')}-${spec.role}.md`;
  const woDirOnDisk = findWorkOrderDir(dir, id);
  const orderMdPath = woDirOnDisk ? `${woDirOnDisk}/order.md` : '';
  return architectReviewPrompt({ objective: parsed.objective, step: spec, reportBody, planText: plan, orderMdPath, reportPath });
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
  // Startup sweep (WO-0026 / F5, the process-kill path): no session survives a process restart, so any row
  // still claiming `running` is a leftover from a dead drive — make it idle. `stopped_asking` rows stay
  // (their provider session is resumable and the ask is still the operator's to answer). Caveat: a second
  // host starting while one drives would mislabel that live row until its next record — rare, accepted (TD-031).
  db.prepare("UPDATE session SET status = 'idle' WHERE status = 'running'").run();
  // No fixture seeding: the app starts empty and the operator creates their own workspace(s) via the
  // onboarding screen (ADR-0009 onboarding path). seedObserved remains a dev/test helper (reseedObserved).
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
    // WO-0033: async so the duplicate-basename refusal REJECTS (the deleteWorkspace/addRepoConnection
    // ruling — a sync escape is not a promise the caller can await).
    createWorkspace: async (input: CreateWorkspaceInput): Promise<Workspace> => createWorkspaceRow(db, input),
    updateWorkspace: (id: WorkspaceId, patch: { label?: string; decisionStorePath?: string }) =>
      Promise.resolve(updateWorkspaceRow(db, id, patch)),
    // WO-0032: async so the running-session guard's throw REJECTS — the port is async, and the UI's
    // try/catch (the dialog's error line) depends on the await contract, not a sync escape.
    deleteWorkspace: async (id: WorkspaceId) => {
      deleteWorkspaceRow(db, id);
    },
    // WO-0033: async wrappers so a refusal REJECTS (the deleteWorkspace ruling — the UI's try/catch
    // depends on the await contract, not a sync escape out of invoke).
    addRepoConnection: async (id: WorkspaceId, repo: RepoConnectionInput) => {
      addRepoConnectionRow(db, id, repo);
    },
    removeRepoConnection: (id: WorkspaceId, path: string) =>
      Promise.resolve(removeRepoConnectionRow(db, id, path)),
    repoConnections: (id: WorkspaceId) => Promise.resolve(repoConnectionsRow(db, id)),
    updateRepoPath: async (id: WorkspaceId, repoId: RepoId, newPath: string) => {
      updateRepoPathRow(db, id, repoId, newPath);
    },
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
          ...(input.permissionRule ? { permissionRule: input.permissionRule } : {}),
        }),
      );
      const created = createWorkOrderRow(db, { ...input, id });
      appendEvent(db, id as string, 'created', input.title);
      return created;
    },
    // Approve the architect's proposed plan (WO-0016): write plan.md into the working tree (no commit)
    // and flip the plan_approval gate. Errors (missing WO dir / fs failure) → rejected promise the UI surfaces.
    approvePlan: async (workOrderId: WorkOrderId, planText: string, opts?: { editedCount?: number }) => {
      const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string }
        | undefined;
      if (!wo) throw new Error(`approvePlan: work order ${workOrderId} not found`);
      const dir = resolveDecisionStorePath(db, wid(wo.workspace_id));
      writePlanMdById(dir, workOrderId, planText);
      db.prepare('UPDATE work_order SET gate_plan_approved = 1 WHERE id = ?').run(workOrderId);
      appendEvent(db, workOrderId as string, 'plan_approved', opts?.editedCount !== undefined ? `edited:${opts.editedCount}` : '');
    },
    // Edit a work order after creation (WO-0031c): surgical order.md rewrite (applyOrderMdEdits preserves
    // everything else — Closure notes included), the DB title follows, and the timeline records what
    // changed (wo_edited, plus rule_changed when the permission rule moved).
    updateWorkOrder: async (workOrderId: WorkOrderId, patch: UpdateWorkOrderInput) => {
      const wo = db.prepare('SELECT workspace_id, gate_closure_docs_sha FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string; gate_closure_docs_sha: string | null }
        | undefined;
      if (!wo) throw new Error(`updateWorkOrder: work order ${workOrderId} not found`);
      // WO-0031f K1 — a closed work order is immutable (closed ⟺ gate_closure_docs_sha set, deriveStage's
      // own test; the closeWorkOrder precedent one screen down). The UI keeps the pencil absent with the
      // "Kapalı iş emri değişmez" reason; the store is the second layer. deleteWorkOrder stays open —
      // archive cleanup is legitimate.
      if (wo.gate_closure_docs_sha != null) throw new Error(`updateWorkOrder: ${workOrderId} is closed`);
      const dir = resolveDecisionStorePath(db, wid(wo.workspace_id));
      const { order } = readWoDocs(dir, workOrderId);
      if (!order) throw new Error(`updateWorkOrder: order.md not found for ${workOrderId}`);
      const next = applyOrderMdEdits(order, patch);
      if (next !== order) writeOrderMdById(dir, workOrderId, next);
      if (patch.title !== undefined) db.prepare('UPDATE work_order SET title = ? WHERE id = ?').run(patch.title, workOrderId);
      const fields = [
        patch.title !== undefined ? 'title' : null,
        patch.description !== undefined ? 'description' : null,
        patch.reviewMode !== undefined ? 'review_mode' : null,
      ].filter((f): f is string => f !== null);
      if (fields.length > 0) appendEvent(db, workOrderId as string, 'wo_edited', fields.join(' · '));
      if (patch.permissionRule !== undefined) appendEvent(db, workOrderId as string, 'rule_changed', patch.permissionRule);
    },
    // The operator's answer on an ask card, into the timeline (WO-0031c). The pipeline knows the
    // requestId, not the work order — the UI, which knows both, writes this as it resolves the ask.
    recordPermissionDecision: (workOrderId: WorkOrderId, input: { allowed: boolean; tool: string; target: string }) => {
      appendEvent(db, workOrderId as string, 'permission_decision', `${input.allowed ? 'allowed' : 'denied'} · ${input.target}`);
      return Promise.resolve();
    },
    // Close a finished work order (WO-0025 / P1-2). The M2 floor is OPERATOR-ATTESTED closure — the mirror of
    // the plan gate's M2 ruling (observed flag, not a sha; TD-005): the operator confirms merges are done and
    // Docket records the three facts deriveStage needs (track merged_at, verifier gate, closure sha = the
    // decision-store HEAD at close time). order.md gains a `## Closure` note. M3's forge observation replaces
    // the attestations with observed PR/CI/merge + a docs-commit sha.
    closeWorkOrder: async (workOrderId: WorkOrderId, note: string) => {
      const wo = db.prepare('SELECT workspace_id, gate_plan_approved, gate_closure_docs_sha FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string; gate_plan_approved: number; gate_closure_docs_sha: string | null }
        | undefined;
      if (!wo) throw new Error(`closeWorkOrder: work order ${workOrderId} not found`);
      // WO-0029 / B21: closing twice appended duplicate ## Closure notes — refuse when already closed.
      if (wo.gate_closure_docs_sha != null) throw new Error(`closeWorkOrder: ${workOrderId} is already closed`);
      const stepRows = db.prepare('SELECT status, verdict FROM work_order_step WHERE work_order_id = ?').all(workOrderId) as Array<
        { status: string; verdict: string | null }
      >;
      const check = canClose({
        planApproved: !!wo.gate_plan_approved,
        steps: stepRows.map((r) => ({ status: r.status as 'pending' | 'active' | 'done' | 'blocked', verdict: (r.verdict ?? undefined) as 'proceed' | 'revise' | undefined })),
      });
      if (!check.ok) throw new Error(`closeWorkOrder: preconditions unmet (${check.reason})`);
      const dir = resolveDecisionStorePath(db, wid(wo.workspace_id));
      // The closure sha = the decision-store HEAD at close time ("closed at this commit" — an attestation of
      // WHERE the work stands, not yet the M3 docs-commit gate).
      let sha = '';
      try {
        sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8', timeout: 2000 }).trim();
      } catch {
        sha = 'uncommitted'; // decision store not a git repo — honest placeholder, M3 observe replaces it
      }
      const { order } = readWoDocs(dir, workOrderId);
      if (!order) throw new Error(`closeWorkOrder: order.md not found for ${workOrderId}`);
      const closedAt = new Date().toISOString();
      const withClosure = `${order.trimEnd()}\n\n## Closure\n\n${note}\n\n_Closed ${closedAt} at ${sha}_\n`;
      writeOrderMdById(dir, workOrderId, withClosure);
      const now = closedAt;
      db.prepare('UPDATE track SET merged_at = ? WHERE work_order_id = ?').run(now, workOrderId);
      db.prepare('UPDATE work_order SET gate_verifier_resolvable = 1, gate_closure_docs_sha = ? WHERE id = ?').run(sha, workOrderId);
      appendEvent(db, workOrderId as string, 'closed', sha);
    },
    // The plan's steps (WO-0017) — specs parsed from plan.md + zipped with the observed run state. Detail-only.
    getWorkOrderSteps: (id: WorkOrderId) => Promise.resolve(buildWorkOrderSteps(db, id)),
    // A step report body, read from the decision store at view time (ADR-0010). '' when the report is absent.
    getStepReport: (id: WorkOrderId, idx: number, role: StepRole) => {
      const dir = woDir(db, id);
      return Promise.resolve(dir ? readStepReport(dir, id, idx, role) : '');
    },
    // WO-0029 / B19: the operator's transparent "Devam et" — flips a revise verdict to proceed. The
    // architect's original words stay in verdicts/step-NN.md (the file is the evidence; the row is loop state).
    // WO-0030 / İstek 8: the lifecycle audit (append-only). [] for legacy WOs — no backfill by design.
    getWorkOrderEvents: (id: WorkOrderId) =>
      Promise.resolve(
        (db.prepare('SELECT kind, detail, at FROM wo_event WHERE work_order_id = ? ORDER BY at, id').all(id) as Array<{
          kind: WoEventKind;
          detail: string;
          at: string;
        }>).map((r): WoEvent => ({ kind: r.kind, detail: r.detail, at: r.at })),
      ),

    overrideStepVerdict: (id: WorkOrderId, idx: number) => {
      db.prepare("UPDATE work_order_step SET verdict = 'proceed' WHERE work_order_id = ? AND idx = ? AND verdict = 'revise'").run(id, idx);
      appendEvent(db, id as string, 'verdict_overridden', `adım ${idx}`);
      return Promise.resolve();
    },

    // Operator app preferences (WO-0025) — the provider key lives in the shared DB so BOTH hosts (GUI + CLI)
    // see it; never returned to the renderer except through this port's get. undefined clears it.
    getProviderKey: () =>
      Promise.resolve(
        (db.prepare('SELECT value FROM app_setting WHERE key = ?').get('provider_key') as { value: string } | undefined)?.value,
      ),
    setProviderKey: (key: string | undefined) => {
      if (key === undefined) db.prepare('DELETE FROM app_setting WHERE key = ?').run('provider_key');
      else db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run('provider_key', key);
      return Promise.resolve();
    },
    getPermissionRule: () => Promise.resolve(settingPermissionRule(db)),
    setPermissionRule: (rule: PermissionRule) => {
      db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run('permission_rule', rule);
      return Promise.resolve();
    },
    getPermissionRuleFor: (workOrderId: WorkOrderId) => Promise.resolve(effectivePermissionRule(db, workOrderId)),
    woRepoPaths: (workOrderId: WorkOrderId) => woRepoPaths(db, workOrderId),
    // Upsert a step's run outcome — main side-effect on started (active) / turn_complete (done + report).
    recordStep: (workOrderId: WorkOrderId, idx: number, patch: { status: 'active' | 'done'; reportPath?: string }) =>
      recordStepRow(db, workOrderId, idx, patch),
    // Write a step's report + mark the step done — main side-effect at turn_complete (WO-0017).
    recordStepReport: (workOrderId: WorkOrderId, idx: number, role: StepRole, body: string) =>
      recordStepReportRow(db, workOrderId, idx, role, body),
    // Record the architect's verdict (WO-0020) — write verdicts/step-NN.md + UPDATE the verdict columns.
    recordStepVerdict: (workOrderId: WorkOrderId, idx: number, verdict: 'proceed' | 'revise', body: string) => {
      const dir = woDir(db, workOrderId);
      if (!dir) return;
      const verdictPath = writeStepVerdict(dir, workOrderId, idx, body);
      recordStepVerdictRow(db, workOrderId, idx, verdict, verdictPath);
    },
    // The architect's review prompt for a step — assembled server-side (WO-0020). Undefined → main leaves prompt.
    stepReviewPromptFor: (workOrderId: WorkOrderId, idx: number) => buildStepReviewPrompt(db, workOrderId, idx),
    // A step verdict body, read at view time (WO-0020). '' when the verdict is absent.
    getStepVerdict: (id: WorkOrderId, idx: number) => {
      const dir = woDir(db, id);
      return Promise.resolve(dir ? readStepVerdict(dir, id, idx) : '');
    },
    // Reset a step to pending (WO-0020 revise path) — deletes the observed row; files are overwritten on re-run.
    resetStep: (id: WorkOrderId, idx: number) => Promise.resolve(resetStepRow(db, id, idx)),
    // Persist the proposed plan to plan.md as PENDING (gate 0) on plan_ready — survives restart (WO-0020/TD-025).
    // approvePlan re-writes + flips the gate; idempotent if called again with the same text.
    savePendingPlan: (workOrderId: WorkOrderId, planText: string) => {
      // (event appended after the write below)
      const dir = woDir(db, workOrderId);
      if (!dir) return; // no WO dir yet — nothing to persist to
      writePlanMdById(dir, workOrderId, planText);
      appendEvent(db, workOrderId as string, 'plan_saved');
    },
    // Delete a work order — cascade DB rows + remove the decision-store folder (WO-0020).
    deleteWorkOrder: (id: WorkOrderId) => Promise.resolve(deleteWorkOrderRow(db, id)),
    // A step session's prompt + resolved scope, assembled server-side from order.md + plan.md (WO-0017).
    // Undefined when the plan/step is missing → main leaves the prompt untouched.
    stepPromptFor: (workOrderId: WorkOrderId, idx: number) => buildStepPrompt(db, workOrderId, idx),
    reseedObserved() {
      for (const t of OBSERVED_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
      db.exec(SCHEMA_SQL);
      seedObserved(db);
    },
  };
}
