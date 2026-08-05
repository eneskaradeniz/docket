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
import { OBSERVED_TABLES, SCHEMA_SQL, SEED_OBSERVED_AT } from './schema';
import { deriveStage, deriveTrackStage } from '../../core/derive';
import type { WorkOrderSource } from '../../core/source';
import { rid, tid, wid, woid } from '../ids';
import { workOrderDocs, workOrders, workspaces } from '../fixtures';
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
    switch (r.status) {
      case 'stopped_asking':
        return { role: r.role, status: 'stopped_asking', transcript, stopAndAsk: JSON.parse(r.stop_and_ask ?? '{}'), scope, providerSessionId };
      case 'running':
        return { role: r.role, status: 'running', transcript, scope, providerSessionId };
      case 'idle':
        return { role: r.role, status: 'idle', transcript, scope, providerSessionId };
      case 'none':
        return { role: r.role, status: 'none', transcript, scope, providerSessionId };
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
  const cost: CostSummary = { tokensIn: r.cost_tokens_in, tokensOut: r.cost_tokens_out, usd: r.cost_usd };
  return {
    id: woid(r.id),
    title: r.title,
    workspace: wid(r.workspace_id),
    mode: r.mode,
    stage: deriveStage({ gateInputs, tracks }),
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
  for (const wo of workOrders) {
    db.prepare(
      `INSERT INTO work_order (id, workspace_id, title, mode, gate_plan_approved, gate_verifier_resolvable,
       gate_closure_docs_sha, cost_tokens_in, cost_tokens_out, cost_usd, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      wo.id, wo.workspace, wo.title, wo.mode,
      wo.gateInputs.planApproved ? 1 : 0,
      wo.gateInputs.verifierReport?.resolvablePointers ? 1 : null,
      wo.gateInputs.closureDocsSha ?? null,
      wo.cost.tokensIn, wo.cost.tokensOut, wo.cost.usd, SEED_OBSERVED_AT,
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
}

function seedOwned(db: DatabaseSync): void {
  db.exec('DELETE FROM session'); // idempotent: safe to re-run on an empty owned half
  for (const wo of workOrders) {
    for (const s of wo.sessions) {
      db.prepare(
        'INSERT INTO session (work_order_id, role, scope_track_id, status, transcript, stop_and_ask) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        wo.id, s.role, s.scope ?? null, s.status, JSON.stringify(s.transcript),
        s.status === 'stopped_asking' ? JSON.stringify(s.stopAndAsk) : null,
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

export function createStore(dbPath: string): Store {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  migrate(db);
  // Seed each half independently — the split's whole point (observed may be empty while
  // owned survives). Checking only work_order conflated the two and either crashed on a
  // partial observed half (UNIQUE workspace.id) or duplicated owned rows.
  const observedEmpty = (db.prepare('SELECT COUNT(*) AS n FROM work_order').get() as { n: number }).n === 0;
  const ownedEmpty = (db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n === 0;
  if (observedEmpty) seedObserved(db);
  if (ownedEmpty) seedOwned(db);
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
    getWorkOrderDocs: (id: WorkOrderId) => Promise.resolve(workOrderDocs[id] ?? { order: '', plan: '' }),
    recordSession: (input: RecordSessionInput) => recordSessionRow(db, input),
    reseedObserved() {
      for (const t of OBSERVED_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
      db.exec(SCHEMA_SQL);
      seedObserved(db);
    },
  };
}
