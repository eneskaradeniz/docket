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
import { deriveStage } from '../../core/derive';
import type { WorkOrderSource } from '../../core/source';
import { rid, tid, wid, woid } from '../ids';
import { workOrderDocs, workOrders, workspaces } from '../fixtures';
import type {
  Ci,
  CiCheck,
  CostSummary,
  SessionRef,
  SourceLink,
  Track,
  WorkOrder,
  WorkOrderId,
  Workspace,
} from '../../core/types';

export interface Store extends WorkOrderSource {
  /** Drop every observed table and re-seed it; owned tables are untouched (ADR-0010). */
  reseedObserved(): void;
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
  stage: Track['stage'];
  pr_url: string | null;
  pr_head_sha: string | null;
  ci_kind: 'run' | 'exempt';
  ci_blob: string;
  merged_at: string | null;
};
type SessionRow = {
  id: number;
  work_order_id: string;
  role: SessionRef['role'];
  scope_track_id: string | null;
  status: SessionRef['status'];
  transcript: string;
  stop_and_ask: string | null;
};

// ===== Hydration (rows → domain; stage derived; ids re-branded) =====
function hydrateTracks(db: DatabaseSync, woId: string): Track[] {
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
    return {
      id: tid(r.id),
      repo: rid(r.repo),
      dependsOn,
      stage: r.stage,
      ci: trackCi,
      ...(r.pr_url ? { pr: { url: r.pr_url, headSha: r.pr_head_sha ?? '' } } : {}),
      ...(r.merged_at ? { merge: { at: r.merged_at } } : {}),
    };
  });
}

function hydrateSessions(db: DatabaseSync, woId: string): SessionRef[] {
  const rows = db.prepare('SELECT * FROM session WHERE work_order_id = ? ORDER BY id').all(woId) as SessionRow[];
  return rows.map((r): SessionRef => {
    const transcript = JSON.parse(r.transcript) as SessionRef['transcript'];
    const scope = r.scope_track_id ? tid(r.scope_track_id) : undefined;
    switch (r.status) {
      case 'stopped_asking':
        return { role: r.role, status: 'stopped_asking', transcript, stopAndAsk: JSON.parse(r.stop_and_ask ?? '{}'), scope };
      case 'running':
        return { role: r.role, status: 'running', transcript, scope };
      case 'idle':
        return { role: r.role, status: 'idle', transcript, scope };
      case 'none':
        return { role: r.role, status: 'none', transcript, scope };
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
  const tracks = hydrateTracks(db, id);
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
    sessions: hydrateSessions(db, id),
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
        `INSERT INTO track (id, work_order_id, repo, stage, pr_url, pr_head_sha, ci_kind, ci_blob, merged_at, observed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(t.id, wo.id, t.repo, t.stage, t.pr?.url ?? null, t.pr?.headSha ?? null, t.ci.kind, ciBlob, t.merge?.at ?? null, SEED_OBSERVED_AT);
      for (const dep of t.dependsOn) {
        db.prepare('INSERT INTO track_depends_on (track_id, depends_on_track_id) VALUES (?, ?)').run(t.id, dep);
      }
    }
  }
}

function seedOwned(db: DatabaseSync): void {
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

export function createStore(dbPath: string): Store {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  const populated = (db.prepare('SELECT COUNT(*) AS n FROM work_order').get() as { n: number }).n > 0;
  if (!populated) {
    seedObserved(db);
    seedOwned(db);
  }
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
    reseedObserved() {
      for (const t of OBSERVED_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
      db.exec(SCHEMA_SQL);
      seedObserved(db);
    },
  };
}
