// src/adapters/store — the SQLite state store (WO-0009). Implements the async
// `WorkOrderSource` port over node:sqlite (DatabaseSync, built into Electron's Node
// 24.18.1 — no native dependency). This is the only data source the composition root
// wires; ui reaches it only through the port.
//
// Per ADR-0010 the schema encodes ownership (schema.ts): observed tables cache git/forge
// facts with observed_at and are discardable; owned tables (session, connection) hold
// Docket's decisions. No document text is stored — getWorkOrderDocs reads the authored
// order.md/plan.md from the working tree (WO-0016; git/forge facts arrive with M3).
// No stage is stored — hydrate sets WorkOrder.stage via core's deriveStage.
//
// The workspace rows seed `reseedObserved()` from the fixture constants on first run (empty DB);
// the work-order fixture constants are core-test contract data — their seed helper lives in
// store.test.ts (WO-0043 took it out of the production module). M3 replaces the seed with live
// git/forge observation.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { OBSERVED_TABLES, SCHEMA_SQL, SEED_OBSERVED_AT } from './schema';
import { deriveStage, deriveSteps, deriveTrackStage, deriveWorkOrderCost, extractPointers, canClose, validateTrackDependencies, type ObservedStep } from '../../core/derive';
import type { Locale, PromptOverrides, RoleModels } from '../../core/app-settings';
import type { CreateWorkOrderInput, CreateWorkspaceInput, PermissionRule, RepoConnectionInput, RepoConnectionView, RoadmapDraft, UpdateWorkOrderInput, WorkOrderSource } from '../../core/source';
import type { RecordSessionInput, SessionOwner, SessionStore } from '../../core/session-store';
import { buildOrderMd, findWorkOrderDir, nextWorkOrderNumber, readRoadmapMd, readStepReport, readStepVerdict, readTechDebtMd, readWoDocs, readWorkspaceYaml, removeWorkOrderDir, scanDecisionDocs, scanIssueRefs, scanTaskRefs, writeOrderMd, writeOrderMdById, writePlanMdById, writeRoadmapMd, writeStepReport, writeStepVerdict } from '../decision-store/decision-store';
import { applyOrderMdEdits, architectPrompt, architectReviewPrompt, cwdOverrideIsAbsolute, implementerPrompt, orderMdCarriesRule, parseOrderMd, verifierPrompt, withOverride } from '../../core/order-md';
import { parsePlanSteps } from '../../core/plan-steps';
import type { ClosureEvidence, ForgeIssueRow, ForgeObservations, ForgePr, ForgePrRow, ForgeRepoView, ForgeScan, ForgeView } from '../../core/forge';
import { titleCarriesWoId } from '../../core/forge';
import { budgetStatus, monthWindow, type BudgetThreshold } from '../../core/budget';
import { DEFAULT_DOCS_ROOT, normalizeDocsRoot, parseRoadmapMd } from '../../core/roadmap-md';
import { parseGateConfig, type GateCommandSpec, type GateConfig } from '../../core/gate-config';
import { deriveRoadmapView, type RoadmapView } from '../../core/roadmap';
import { deriveOverview, parseTechDebt, type DebtLine, type WorkspaceOverview } from '../../core/overview';
import { deriveUsageView, type UsageFactRow, type UsageOrderFact, type UsageSessionFact, type WorkspaceUsageView } from '../../core/usage';
import type { BudgetRefusal, DriveInput } from '../../core/runner';
import { isDraftDrive } from '../../core/runner';
import { roadmapDraftPrompt, type DraftSourceSummary } from '../../core/roadmap-draft';
import { rid, tid, wid, woid } from '../ids';
import { workspaces } from '../fixtures';
import type {
  Ci,
  CiCheck,
  CostSummary,
  GateCommandResult,
  LocalGate,
  RepoId,
  SessionRef,
  SessionRole,
  WoEvent,
  WoEventKind,
  SourceLink,
  StepRole,
  StepSpec,
  StepView,
  Track,
  TrackId,
  WorkOrder,
  WorkOrderId,
  Workspace,
  WorkspaceId,
  ModelUsageLine,
  TurnUsage,
} from '../../core/types';

// RecordSessionInput + the eight drive-loop methods (record*/savePendingPlan/*PromptFor) live on the core
// `SessionStore` port (src/core/session-store.ts); `Store` implements it. The drive loop (src/core/pipeline.ts)
// depends on that port, not on this adapter (WO-0023).

export interface Store extends WorkOrderSource, SessionStore, AppSettingsData, ForgeObservations {
  /** Drop every observed table and re-seed it; owned tables are untouched (ADR-0010). */
  reseedObserved(): void;
  /** The work order's REPO ROOT PATHS (its tracks' connected local paths, decision store included) —
   *  the jail the diff-peek read stays inside (WO-0031c: the root is the WO's repos, never cwd). */
  woRepoPaths(workOrderId: WorkOrderId): string[];
  /** The drive's WORKING DIRECTORY, resolved from the connection table (WO-0050 / D8 — the cwd fix):
   *  a scoped WO drive runs in its track repo's connected `local_path`; a draft or unscoped WO drive
   *  in the decision-store repo's path; `process.cwd()` only when no connection matches (fixture and
   *  unconnected workspaces keep today's behavior byte-for-byte). cwd is a host concern — this lives
   *  on the concrete store, not a core port; the composition root calls it while wiring DriveInput. */
  driveCwd(input: DriveInput): string;
  /** The ✦ dialog's DEPO channel read (WO-0051 / D3): the docs-root setting + the recursive
   *  `.md` scan under the structure root, paths structure-root-RELATIVE — the absolute root
   *  never crosses to the renderer (ADR-0001). Concrete-store concern, like driveCwd. */
  decisionDocs(workspaceId: WorkspaceId): { docsRoot: string; files: string[] };
  /** The architect write fence's decision-store ROOT (WO-0051 / D9, TD-056): the workspace's
   *  absolute structure root, docs_root-aligned — undefined when the drive's workspace does not
   *  resolve (the adapter keeps its cwd-relative default). Concrete-store concern, like driveCwd. */
  decisionStoreRootFor(input: DriveInput): string | undefined;
  /** WO-0089 — the work order's workspace's DECLARED gate commands, read from the decision
   *  store's `.workflow/workspace.yaml` at call time (never stored — ADR-0010 rule 1). [] when
   *  nothing is declared or the declaration is unreadable (the runner only runs what parses).
   *  Concrete-store concern, like driveCwd: the composition root's gate channel reads it. */
  gateCommandsFor(workOrderId: WorkOrderId): GateCommandSpec[];
  /** WO-0089 — record what DOCKET measured running the declared gate commands in a track's repo
   *  (never the session — independence is the point). Latest-wins per track (INSERT OR REPLACE),
   *  keyed to the sha the run measured at. Throws when no track row matches the repo. */
  recordLocalGateRun(workOrderId: WorkOrderId, repo: RepoId, run: { sha: string; at: string; results: GateCommandResult[] }): void;
  /** The underlying handle (tests / future migration tooling). */
  readonly db: DatabaseSync;
  /** The connection rows' raw (repo_remote, local_path) pairs (WO-0064) — the composition
   *  root's scan input. The adapter-side `RepoRef` parse happens THERE (main owns the forge
   *  adapter); the store never names the forge product. */
  forgeScanTargets(id: WorkspaceId): { repoRemote: string; path: string }[];
  /** WO-0065: the same read for a WORK ORDER's workspace — the closure look's input. */
  forgeScanTargetsForWorkOrder(workOrderId: WorkOrderId): { repoRemote: string; path: string }[];
}

/** The DB-backed half of the AppSettings port (WO-0025). WO-0059 rev 4: the stored provider key
 *  RETIRED (its port methods, its row swept at open); checkProvider lives in the runner adapter —
 *  only it may touch the provider. */
export interface AppSettingsData {
  getPermissionRule(): Promise<PermissionRule>;
  setPermissionRule(rule: PermissionRule): Promise<void>;
  /** The operator's explicit UI-locale choice (WO-0035): undefined = none stored — the renderer
   *  detects the system language; only a deliberate pick reaches this row. */
  getLocale(): Promise<Locale | undefined>;
  setLocale(locale: Locale): Promise<void>;
  /** The operator's per-role model preference (WO-0059 rev 2): ONE JSON row `models` — the three
   *  session roles, an absent role = the provider's own default. Ids ride VERBATIM; the store
   *  normalizes SHAPE only (unknown role keys and blank values drop), never names or validates a
   *  value (ADR-0006: ids are data). undefined = nothing stored. */
  getModels(): Promise<RoleModels | undefined>;
  setModels(models: RoleModels | undefined): Promise<void>;
  /** The whole-text prompt-template overrides (WO-0070) — the AppSettings port's methods; the
   *  shape + semantics live on the port (src/core/app-settings.ts). ONE JSON row
   *  `prompt_overrides` (the models row's posture); the ASSEMBLY fns below read it. */
  getPromptOverrides(): Promise<PromptOverrides | undefined>;
  setPromptOverrides(overrides: PromptOverrides | undefined): Promise<void>;
  /** The workspace's month-spend threshold (WO-0047) — the AppSettings port's scoped half; the
   *  shape + semantics live on the port (src/core/app-settings.ts). */
  getBudget(workspaceId: WorkspaceId): Promise<BudgetThreshold | undefined>;
  setBudget(workspaceId: WorkspaceId, threshold: BudgetThreshold | undefined): Promise<void>;
  /** The workspace's structure root (WO-0048) — the AppSettings port's scoped half; the shape +
   *  semantics live on the port (src/core/app-settings.ts). */
  getDocsRoot(workspaceId: WorkspaceId): Promise<string>;
  setDocsRoot(workspaceId: WorkspaceId, root: string | undefined): Promise<void>;
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
  workspace_id: string;
  work_order_id: string | null;
  role: SessionRef['role'];
  scope_track_id: string | null;
  status: SessionRef['status'];
  transcript: string;
  stop_and_ask: string | null;
  pending_notes: string | null;
  started_at: string | null;
  ended_at: string | null;
  cost_tokens_in: number | null;
  cost_tokens_out: number | null;
  cost_usd: number | null;
  step_idx: number | null;
  ctx_used_tokens: number | null; // WO-0052
  ctx_max_tokens: number | null; // WO-0052
  final_model_usage: string | null; // WO-0052
  limit_reset_at: string | null; // WO-0053
};

// ===== Hydration (rows → domain; stage derived; ids re-branded) =====

// WO-0069: the forge scan's degraded meta for ONE workspace, keyed by the repos' basename (the
// RepoId invariant, WO-0033 — the track's repo joins its connection by basename, the connection's
// remote joins the scan). Only degraded scans land here; an ok or never-scanned repo is absent,
// which is exactly the byte-stable hydration arm.
function degradedScansByRepo(db: DatabaseSync, workspaceId: string | undefined): Map<string, string> {
  const degraded = new Map<string, string>();
  if (!workspaceId) return degraded;
  const connections = db
    .prepare('SELECT repo_remote, local_path FROM connection WHERE workspace_id = ?')
    .all(workspaceId) as { repo_remote: string; local_path: string }[];
  for (const c of connections) {
    const scan = db
      .prepare('SELECT status, reason FROM forge_scan WHERE workspace_id = ? AND repo_remote = ?')
      .get(workspaceId, c.repo_remote) as { status: string; reason: string | null } | undefined;
    if (scan?.status === 'degraded') degraded.set(repoBase(c.local_path), scan.reason ?? '');
  }
  return degraded;
}

function hydrateTracks(db: DatabaseSync, woId: string, sessions: SessionRef[]): Track[] {
  const wsId = (db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(woId) as
    | { workspace_id: string }
    | undefined)?.workspace_id;
  const degraded = degradedScansByRepo(db, wsId);
  // WO-0089: the local gate's declaration (one workspace.yaml read per hydrate) composes with the
  // latest measured run row into Track.localGate. Undeclared → the field stays ABSENT (today's
  // shape, byte-identical — no evidence item, no new blocking).
  const gateConfig = gateConfigFor(db, wsId === undefined ? undefined : wid(wsId));
  const rows = db.prepare('SELECT * FROM track WHERE work_order_id = ?').all(woId) as TrackRow[];
  return rows.map((r): Track => {
    const ci = JSON.parse(r.ci_blob) as { state?: 'running' | 'success' | 'failed'; checks?: CiCheck[]; reason?: string };
    const dependsOn = (
      db.prepare('SELECT depends_on_track_id FROM track_depends_on WHERE track_id = ?').all(r.id) as {
        depends_on_track_id: string;
      }[]
    ).map((x) => tid(x.depends_on_track_id));
    // WO-0069: a DEGRADED scan for this track's repo means the last forge look failed — the CI
    // state hydrates `unknown` (checks empty: nothing observed), the scan's verbatim reason riding
    // the run arm. Ok or missing scan → today's blob, byte-stable. An exempt stays exempt: an
    // exemption is a decision, not an observation (no schema change — the ci_blob JSON is untouched;
    // the override is a hydration-time read of the forge_scan row).
    const scanReason = degraded.get(r.repo);
    const trackCi: Ci =
      r.ci_kind === 'exempt'
        ? { kind: 'exempt', reason: ci.reason ?? '' }
        : scanReason !== undefined
          ? { kind: 'run', state: 'unknown', checks: [], ...(scanReason ? { reason: scanReason } : {}) }
          : { kind: 'run', state: ci.state ?? 'running', checks: ci.checks ?? [] };
    const pr = r.pr_url ? { url: r.pr_url, headSha: r.pr_head_sha ?? '' } : undefined;
    const merge = r.merged_at ? { at: r.merged_at } : undefined;
    const hasActiveSession = sessions.some((s) => s.scope === tid(r.id) && s.status !== 'none');
    // WO-0089: declared → the latest measured row (a corrupt blob fail-opens to pending — the
    // pending_notes precedent: a corrupt row never bricks hydration); declared with no row yet →
    // pending; invalid → the parser's reason rides; undeclared → absent.
    let localGate: LocalGate | undefined;
    if (gateConfig.kind === 'invalid') localGate = { kind: 'invalid', reason: gateConfig.reason };
    else if (gateConfig.kind === 'declared') {
      const run = db
        .prepare('SELECT sha, results, observed_at FROM local_gate_run WHERE track_id = ?')
        .get(r.id) as { sha: string; results: string; observed_at: string } | undefined;
      if (run) {
        try {
          localGate = { kind: 'declared', sha: run.sha, at: run.observed_at, results: JSON.parse(run.results) as GateCommandResult[] };
        } catch {
          localGate = { kind: 'pending' };
        }
      } else {
        localGate = { kind: 'pending' };
      }
    }
    return {
      id: tid(r.id),
      repo: rid(r.repo),
      dependsOn,
      stage: deriveTrackStage({ ...(pr ? { pr } : {}), ...(merge ? { merge } : {}) }, hasActiveSession),
      ci: trackCi,
      ...(localGate !== undefined ? { localGate } : {}),
      ...(pr ? { pr } : {}),
      ...(merge ? { merge } : {}),
    };
  });
}

// One session row → SessionRef. WO-0050: extracted so the WO hydrate AND the draft session read
// (the İtiraz seed) share one hydration; WO rows are still read per-WO (`WHERE work_order_id = ?`)
// — draft rows are structurally invisible to every WO ledger.
function hydrateSessionRow(r: SessionRow): SessionRef {
  const transcript = JSON.parse(r.transcript) as SessionRef['transcript'];
  const scope = r.scope_track_id ? tid(r.scope_track_id) : undefined;
  const providerSessionId = r.provider_session_id ?? undefined;
  const stepIdx = r.step_idx ?? undefined;
  const startedAt = r.started_at ?? undefined;
  const endedAt = r.ended_at ?? undefined;
  // Per-session cost is observed — WO-0010 wrote it on turn_complete; undefined until then.
  const cost = r.cost_usd == null ? undefined : { tokensIn: r.cost_tokens_in ?? 0, tokensOut: r.cost_tokens_out ?? 0, usd: r.cost_usd };
  // The steer mirror (WO-0045): undelivered notes riding the row. parse-fail → [] (a corrupt blob must
  // not brick hydration); empty list is dropped so the field stays absent when nothing queues.
  const pendingNotes = (() => {
    if (!r.pending_notes) return undefined;
    try {
      const parsed = JSON.parse(r.pending_notes) as { id: string; text: string }[];
      return Array.isArray(parsed) && parsed.length > 0 ? (parsed as SessionRef['pendingNotes']) : undefined;
    } catch {
      return undefined;
    }
  })();
  const notesField = pendingNotes ? { pendingNotes } : {};
  // The WO-0052 usage checkpoints: NULL = honestly absent (pre-WO-0052 rows, or a drive that never
  // observed a reading/usage) — never zeros. The final usage blob parses fail-open (the
  // pending_notes precedent: a corrupt blob must not brick hydration).
  const finalUsage = (() => {
    if (!r.final_model_usage) return undefined;
    try {
      const parsed = JSON.parse(r.final_model_usage) as TurnUsage;
      // A TurnUsage is an OBJECT with optional fields — a JSON array is also `typeof 'object'`,
      // so the guard must reject it explicitly (review minor): an array blob hydrates ABSENT,
      // never `finalUsage: []` (the pending_notes fail-open: corrupt stays absent, no crash).
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  })();
  const usageField = {
    ...(r.ctx_used_tokens == null || r.ctx_max_tokens == null ? {} : { ctx: { usedTokens: r.ctx_used_tokens, maxTokens: r.ctx_max_tokens } }),
    ...(finalUsage ? { finalUsage } : {}),
    // WO-0053: NULL = no limit stop (or a pre-WO-0053 row) — the seed's boundary decides what
    // the UI does with it; hydration only carries the honest fact.
    ...(r.limit_reset_at ? { limitResetAt: r.limit_reset_at } : {}),
  };
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
        ...notesField,
        ...usageField,
      };
    case 'running':
      return { role: r.role, status: 'running', transcript, scope, providerSessionId, stepIdx, startedAt, endedAt, ...(cost ? { cost } : {}), ...notesField, ...usageField };
    case 'stopped':
      return { role: r.role, status: 'stopped', transcript, scope, providerSessionId, stepIdx, startedAt, endedAt, ...(cost ? { cost } : {}), ...notesField, ...usageField };
    case 'idle':
      return { role: r.role, status: 'idle', transcript, scope, providerSessionId, stepIdx, startedAt, endedAt, ...(cost ? { cost } : {}), ...notesField, ...usageField };
    case 'none':
      return { role: r.role, status: 'none', transcript, scope, providerSessionId, stepIdx, startedAt, endedAt, ...(cost ? { cost } : {}), ...notesField, ...usageField };
  }
}

function hydrateSessions(db: DatabaseSync, woId: string): SessionRef[] {
  const rows = db.prepare('SELECT * FROM session WHERE work_order_id = ? ORDER BY id').all(woId) as SessionRow[];
  return rows.map(hydrateSessionRow);
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

// Upsert a live session row keyed by provider session id (WO-0010). The transcript is the
// provider's (kept on disk by id); Docket stores the pointer + status + cost. For a
// stopped_asking live session a placeholder gate is stored so deriveCardReason never reads a
// missing field — the real question resurfaces on resume. Idempotent via DELETE+INSERT.
// WO-0030 / İstek 8: append-only lifecycle audit. Written by the store's own mutations; never updated.
function appendEvent(db: DatabaseSync, woId: string, kind: WoEventKind, detail = ''): void {
  db.prepare('INSERT INTO wo_event (work_order_id, kind, detail, at) VALUES (?,?,?,?)').run(woId, kind, detail, new Date().toISOString());
}

// WO-0050 / D3: the row's owner pair, resolved store-side. A WO owner resolves its workspace
// through the work_order row (the source of truth — DriveInput carries no workspace id for WO
// drives); a draft owner IS the workspace, with work_order_id NULL.
function ownerPair(db: DatabaseSync, owner: SessionOwner): { wsId: string; woId: string | null } {
  if (owner.kind === 'draft') return { wsId: owner.workspaceId, woId: null };
  const ws = (db.prepare('SELECT workspace_id AS ws FROM work_order WHERE id = ?').get(owner.workOrderId) as { ws: string } | undefined)?.ws;
  return { wsId: ws ?? '', woId: owner.workOrderId };
}

function recordSessionRow(db: DatabaseSync, input: RecordSessionInput): void {
  // WO-0029 / B17: a RESUMED session is the same row — accumulate the cost across its turns and keep the
  // EARLIEST start (the old DELETE+INSERT kept only the last turn's cost, so a resumed plan session's
  // earlier $2.15 vanished from the WO aggregate).
  // 2026-08-23 (döküm kaybı): the transcript joins the monotonic columns — the LONGER row wins. The
  // upsert is DELETE+INSERT, so a late record carrying a SHORTER fold (a post-restart stop whose
  // re-seed was empty, a fresh-reset turn) used to overwrite a fuller checkpoint with []. Like
  // started_at/ended_at, the row may only GROW.
  const { wsId, woId } = ownerPair(db, input.owner);
  // Reviewer round (2026-08-24), kept through the WO-0050 owner widening: the upsert is scoped to
  // THIS owner — a provider id is only ever unique within its session's owner as far as the schema
  // can promise (the e2e fake's once-shared per-role ids proved the hole by moving a row between
  // WOs); a foreign row survives instead of being stolen. `IS ?` is SQLite's NULL-safe equality —
  // a draft row's NULL work_order_id must match its own row (and only it).
  const prior = db
    .prepare('SELECT cost_tokens_in, cost_tokens_out, cost_usd, started_at, ended_at, transcript, pending_notes, ctx_used_tokens, ctx_max_tokens, final_model_usage, limit_reset_at FROM session WHERE provider_session_id = ? AND workspace_id = ? AND work_order_id IS ?')
    .get(input.providerSessionId, wsId, woId) as
    | { cost_tokens_in: number | null; cost_tokens_out: number | null; cost_usd: number | null; started_at: string | null; ended_at: string | null; transcript: string | null; pending_notes: string | null; ctx_used_tokens: number | null; ctx_max_tokens: number | null; final_model_usage: string | null; limit_reset_at: string | null }
    | undefined;
  const priorTranscript = (() => {
    if (!prior?.transcript) return undefined;
    try {
      const parsed = JSON.parse(prior.transcript) as unknown[];
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  })();
  const transcript =
    input.transcript && priorTranscript && priorTranscript.length > input.transcript.length ? priorTranscript : (input.transcript ?? []);
  // Reviewer round (2026-08-24): the upsert is scoped to THIS work order — a provider id is only
  // ever unique within its session's work order as far as the schema can promise (the e2e fake's
  // once-shared per-role ids proved the hole by moving a row between WOs); a foreign row survives
  // instead of being stolen.
  db.prepare('DELETE FROM session WHERE provider_session_id = ? AND workspace_id = ? AND work_order_id IS ?').run(input.providerSessionId, wsId, woId);
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
  // WO-0045: the steer mirror is LATEST-WINS (a delivery legitimately shrinks it). Undefined = the
  // record comes from a notes-blind path — keep the prior row's notes; a silent drop loses notes the
  // operator still believes are queued (the plan's Risk 5).
  const pendingNotesJson =
    input.pendingNotes !== undefined ? JSON.stringify(input.pendingNotes) : (prior?.pending_notes ?? null);
  // WO-0052: the usage checkpoints are latest-wins with the SAME undefined-keeps-prior rule — a
  // record from a path whose fold holds no reading must not erase the latest known one. The two
  // ctx columns move as ONE pair (a reading is used/max together).
  const ctxPair =
    input.ctx !== undefined
      ? { used: input.ctx.usedTokens, max: input.ctx.maxTokens }
      : { used: prior?.ctx_used_tokens ?? null, max: prior?.ctx_max_tokens ?? null };
  const finalUsageJson =
    input.finalUsage !== undefined ? JSON.stringify(input.finalUsage) : (prior?.final_model_usage ?? null);
  // WO-0053: the limit stamp's THREE states — a string SETS, null CLEARS (a clean leg; a stale
  // stamp is a lie), undefined KEEPS the prior row's (the pendingNotes rule). Unlike the ctx pair
  // above, this is NOT latest-wins: only the pipeline's terminal records ever speak.
  const limitResetAt =
    input.limitResetAt !== undefined ? input.limitResetAt : (prior?.limit_reset_at ?? null);
  db.prepare(
    `INSERT INTO session (provider_session_id, workspace_id, work_order_id, role, scope_track_id, status, transcript, stop_and_ask, pending_notes, cost_tokens_in, cost_tokens_out, cost_usd, started_at, ended_at, step_idx, ctx_used_tokens, ctx_max_tokens, final_model_usage, limit_reset_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.providerSessionId,
    wsId,
    woId,
    input.role,
    input.scope ?? null,
    input.status,
    JSON.stringify(transcript),
    stopAndAsk,
    pendingNotesJson,
    acc?.tokensIn ?? null,
    acc?.tokensOut ?? null,
    acc?.usd ?? null,
    (prior?.started_at && input.startedAt && prior.started_at < input.startedAt ? prior.started_at : input.startedAt) ?? prior?.started_at ?? null,
    (prior?.ended_at && input.endedAt && prior.ended_at > input.endedAt ? prior.ended_at : input.endedAt) ?? prior?.ended_at ?? null,
    input.stepIdx ?? null,
    ctxPair.used,
    ctxPair.max,
    finalUsageJson,
    limitResetAt,
  );
}

// WO-0052: append ONE per-turn usage row. Append-only (the appendEvent discipline): the session
// upsert's DELETE+INSERT never touches these rows; a resume leg appends to the SAME session — its
// delta is that leg's own spend under the per-leg applyResultCost baseline, so the session total
// lands right with no double-count. The rich fields persist verbatim; absent = NULL, never 0.
// `model` is the single-model shortcut (NULL for 0-or-multi-model results — the verbatim split
// lives in model_usage JSON).
function recordTurnUsageRow(db: DatabaseSync, owner: SessionOwner, providerSessionId: string, row: { at: string; delta: CostSummary; usage?: TurnUsage }): void {
  const { wsId, woId } = ownerPair(db, owner);
  const u = row.usage;
  const models = u?.modelUsage;
  db.prepare(
    `INSERT INTO session_usage (workspace_id, work_order_id, provider_session_id, at, tokens_in, tokens_out, usd_delta,
       cache_read, cache_creation, num_turns, duration_ms, duration_api_ms, model, model_usage)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    wsId,
    woId,
    providerSessionId,
    row.at,
    row.delta.tokensIn,
    row.delta.tokensOut,
    row.delta.usd,
    u?.cacheRead ?? null,
    u?.cacheCreation ?? null,
    u?.numTurns ?? null,
    u?.durationMs ?? null,
    u?.durationApiMs ?? null,
    models?.length === 1 ? (models[0]!.model) : null,
    models?.length ? JSON.stringify(models) : null,
  );
}

// WO-0052: the per-turn usage rows of ONE work order, in insertion order — the CLI `show` tail and
// the usage screen's coarse curve. Draft rows (work_order_id NULL) are structurally invisible here,
// like every WO-scoped session read. NULL rich fields hydrate absent, never zeros.
type SessionUsageRow = {
  providerSessionId: string;
  at: string;
  tokensIn: number;
  tokensOut: number;
  usd: number;
  cacheRead?: number;
  cacheCreation?: number;
  numTurns?: number;
  durationMs?: number;
  durationApiMs?: number;
  model?: string;
  modelUsage?: ModelUsageLine[];
};

// The raw shape `SELECT *` returns for one session_usage row (shared by the WO-scoped CLI read and
// the WO-0054 workspace read below).
type SessionUsageRowRaw = {
  work_order_id: string | null;
  provider_session_id: string;
  at: string;
  tokens_in: number;
  tokens_out: number;
  usd_delta: number;
  cache_read: number | null;
  cache_creation: number | null;
  num_turns: number | null;
  duration_ms: number | null;
  duration_api_ms: number | null;
  model: string | null;
  model_usage: string | null;
};

// The row hydrator (minted by WO-0052, carried over byte-identical): NULL rich fields hydrate
// ABSENT, never zeros, and a corrupt model_usage blob fails open (the pending_notes precedent)
// instead of bricking the read. The usage facts read below is its only consumer; the persistence
// semantics stay witnessed column-level in store.test.ts.
function hydrateUsageRow(r: SessionUsageRowRaw): SessionUsageRow {
  return {
    providerSessionId: r.provider_session_id,
    at: r.at,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    usd: r.usd_delta,
    ...(r.cache_read == null ? {} : { cacheRead: r.cache_read }),
    ...(r.cache_creation == null ? {} : { cacheCreation: r.cache_creation }),
    ...(r.num_turns == null ? {} : { numTurns: r.num_turns }),
    ...(r.duration_ms == null ? {} : { durationMs: r.duration_ms }),
    ...(r.duration_api_ms == null ? {} : { durationApiMs: r.duration_api_ms }),
    ...(r.model == null ? {} : { model: r.model }),
    ...(() => {
      if (!r.model_usage) return {};
      try {
        const parsed = JSON.parse(r.model_usage) as ModelUsageLine[];
        return Array.isArray(parsed) && parsed.length > 0 ? { modelUsage: parsed } : {};
      } catch {
        return {}; // a corrupt blob must not brick the read (the pending_notes precedent)
      }
    })(),
  };
}

// WO-0054: the workspace's month-windowed usage FACTS for the pure derivation (core/usage.ts) —
// flat rows only, hydrated MINUS num_turns/duration_*: the leg-cumulative legs are not even
// selected into the fact, so AC6's never-sum guarantee is structural, not conventional.
// work_order_id NULL stays NULL (the ✦ draft arm) — this is the ledger's ONE workspace-scoped read.
function usageFactRowsForWs(db: DatabaseSync, wsId: WorkspaceId, window: { startIso: string; endIso: string }): UsageFactRow[] {
  const rows = db
    .prepare('SELECT * FROM session_usage WHERE workspace_id = ? AND at >= ? AND at < ? ORDER BY id')
    .all(wsId, window.startIso, window.endIso) as SessionUsageRowRaw[];
  return rows.map((r) => {
    const h = hydrateUsageRow(r);
    return {
      workOrderId: r.work_order_id == null ? null : woid(r.work_order_id),
      providerSessionId: h.providerSessionId,
      at: h.at,
      tokensIn: h.tokensIn,
      tokensOut: h.tokensOut,
      usdDelta: h.usd,
      ...(h.cacheRead === undefined ? {} : { cacheRead: h.cacheRead }),
      ...(h.cacheCreation === undefined ? {} : { cacheCreation: h.cacheCreation }),
      ...(h.model === undefined ? {} : { model: h.model }),
      ...(h.modelUsage === undefined ? {} : { modelUsage: h.modelUsage }),
    };
  });
}

// WO-0054: the workspace's session facts (BOTH arms — a draft session row's work_order_id is NULL
// and rides too): the join side + the honesty probes, UNWINDOWED. `woid` only on non-NULL
// (ADR-0003). No transcript, no pendingNotes — this read lifts nothing it does not render.
function usageSessionFacts(db: DatabaseSync, wsId: WorkspaceId): UsageSessionFact[] {
  const rows = db
    .prepare(
      'SELECT provider_session_id, work_order_id, role, cost_usd, started_at, ctx_used_tokens, ctx_max_tokens FROM session WHERE workspace_id = ?',
    )
    .all(wsId) as Array<{
    provider_session_id: string | null;
    work_order_id: string | null;
    role: string;
    cost_usd: number | null;
    started_at: string | null;
    ctx_used_tokens: number | null;
    ctx_max_tokens: number | null;
  }>;
  return rows
    .filter((r): r is typeof r & { provider_session_id: string } => r.provider_session_id != null) // an
    // identity-less session can join nothing — a '' sentinel would MERGE such rows into one map
    // entry (the review round's fix; unreachable via recordSession, which always carries the
    // provider handle)
    .map((r) => ({
      providerSessionId: r.provider_session_id,
      workOrderId: r.work_order_id == null ? null : woid(r.work_order_id),
      ...(r.role ? { role: r.role as SessionRole } : {}),
      ...(r.cost_usd == null ? {} : { costUsd: r.cost_usd }),
      ...(r.started_at == null ? {} : { startedAt: r.started_at }),
      ...(r.ctx_used_tokens != null && r.ctx_max_tokens != null
        ? { ctx: { usedTokens: r.ctx_used_tokens, maxTokens: r.ctx_max_tokens } }
        : {}),
    }));
}

// WO-0054: the work-order titles the spend list renders — the only order fields the view needs.
function usageOrderFacts(db: DatabaseSync, wsId: WorkspaceId): UsageOrderFact[] {
  return (
    db.prepare('SELECT id, title FROM work_order WHERE workspace_id = ?').all(wsId) as Array<{ id: string; title: string }>
  ).map((r) => ({ id: woid(r.id), title: r.title }));
}

// WO-0054: the workspace's usage month — monthWindow ONCE, the three flat readers, then the PURE
// derivation (core/usage.ts). SQL selects flat rows only; every aggregation is core TS (TD-058
// stays closed — the model_usage JSON never enters SQL).
function workspaceUsageRow(db: DatabaseSync, wsId: WorkspaceId): WorkspaceUsageView {
  const win = monthWindow(new Date());
  return deriveUsageView({
    window: win,
    rows: usageFactRowsForWs(db, wsId, win),
    sessions: usageSessionFacts(db, wsId),
    orders: usageOrderFacts(db, wsId),
  });
}

// The roadmap view's assembly, lifted OUT of the getRoadmap port method (WO-0072) so the overview
// read reuses it verbatim — reuse, never a second derivation to keep honest. Same facts, same
// order: roadmap.md from the working tree, the per-WO facts from ONE query (closed ⇔ closure sha —
// deriveStage's own rule; cost summed from session rows — work_order.cost_* is inert, TD-023), the
// task link by re-parsing each order.md's `task:` key AT VIEW TIME (no DB column — ADR-0010 rule 1;
// the N-file scan is TD-055). '' file → absent; parse error or any error diagnostic → invalid.
function roadmapViewRow(db: DatabaseSync, wsId: WorkspaceId): RoadmapView {
  const root = structureRoot(db, wsId);
  const md = readRoadmapMd(root);
  if (md === '') return { kind: 'absent' };
  const knownRepos = (
    db.prepare('SELECT repo_id FROM workspace_repo WHERE workspace_id = ?').all(wsId) as { repo_id: string }[]
  ).map((r) => r.repo_id);
  const rows = db
    .prepare(
      `SELECT w.id AS id, w.gate_closure_docs_sha AS closedSha,
              (SELECT COALESCE(SUM(s.cost_usd), 0) FROM session s WHERE s.work_order_id = w.id) AS usd,
              (SELECT COUNT(*) FROM session s WHERE s.work_order_id = w.id AND s.cost_usd IS NULL) AS unknownCount
       FROM work_order w WHERE w.workspace_id = ?`,
    )
    .all(wsId) as Array<{ id: string; closedSha: string | null; usd: number; unknownCount: number }>;
  const taskRefs = scanTaskRefs(root);
  return deriveRoadmapView({
    roadmapMd: md,
    workspaceSlug: wsId as string,
    knownRepos,
    orders: rows.map((r) => ({
      id: r.id as WorkOrderId, // the adapter is the one place a row id re-brands (ADR-0003)
      closed: r.closedSha != null,
      costUsd: r.usd,
      ...(r.unknownCount > 0 ? { costUnknown: true } : {}),
      ...(taskRefs.get(r.id) !== undefined ? { taskRef: taskRefs.get(r.id)! } : {}),
    })),
  });
}

// WO-0072: the workspace overview — the third consumer of the gate model (after the board and the
// detail), assembled read-side from the facts the workspace already carries (ADR-0008's
// derived-read discipline), never stored, never cached. The work orders ride the EXISTING hydrate
// path (stage/closeable/gate inputs — the same rows getWorkOrders lifts; a lighter projection
// would be a second hydrate to keep honest), the roadmap view rides roadmapViewRow, and
// tech-debt.md is read at the structure root (missing file → empty parse, never a throw). The
// DEBT MATCH lives here, store-side: a line whose WO column resolves to an OPEN work order stays
// linked (branded here — core never constructs an identity, ADR-0003); one that resolves to a
// CLOSED work order is DROPPED (a closed WO's debts are not open borçlar — the order's stop-and-ask
// gate); one naming nothing resolvable in this workspace keeps UNLINKED (the debt is still open in
// the file; only the chip is honestly absent). Core only carries.
function workspaceOverviewRow(db: DatabaseSync, wsId: WorkspaceId): WorkspaceOverview {
  const ids = db.prepare('SELECT id FROM work_order WHERE workspace_id = ?').all(wsId) as { id: string }[];
  const wos = ids.flatMap(({ id }) => {
    const w = hydrateWorkOrder(db, id);
    return w ? [w] : [];
  });
  const open = wos.filter((w) => w.stage !== 'closed');
  const view = roadmapViewRow(db, wsId);
  const roadmapTasks =
    view.kind === 'ready'
      ? view.fazlar.flatMap((f) =>
          f.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, fazBlocked: f.status === 'bekliyor' })),
        )
      : [];
  const parsed = parseTechDebt(readTechDebtMd(structureRoot(db, wsId)));
  const openById = new Map(open.map((w) => [w.id as string, w]));
  const debts = parsed.lines.flatMap((line): DebtLine[] => {
    if (line.wo === undefined) return [{ id: line.id, title: line.title }];
    const target = openById.get(line.wo);
    if (target !== undefined) return [{ id: line.id, title: line.title, wo: target.id }];
    return wos.some((w) => (w.id as string) === line.wo) ? [] : [{ id: line.id, title: line.title }];
  });
  return deriveOverview({
    // WO-0080: the WO rows feed only the turn grouping now — the ready arm is the tasks' alone.
    wos: open.map((w) => ({ id: w.id, title: w.title, stage: w.stage })),
    debts,
    roadmapTasks,
  });
}

// Additive migration for DBs created before WO-0010. No UNIQUE constraint is added —
// recordSessionRow upserts via DELETE+INSERT, so provider_session_id need not be UNIQUE.
// Also rebuilds the observed half if it predates the derive-at-hydrate model (a stored `track.stage`
// column — the M2 dev schema drifted before TD-008 finalised; CREATE TABLE IF NOT EXISTS does not migrate
// an existing table). Observed is discardable (ADR-0010), so drop + recreate + re-seed.

// The session table's rebuild COPY (WO-0050): one statement, shared by every session rebuild —
// whichever clause triggers ('stopped' pre-WO-0039, the owner pair pre-WO-0050), the recreated
// table is the full SCHEMA_SQL, so the copy must fill EVERY column including the backfilled
// workspace_id (through the WO join; `''` for an orphan row — joins to nothing, hydrates nowhere).
const SESSION_REBUILD_COPY =
  'INSERT INTO session (provider_session_id, workspace_id, work_order_id, role, scope_track_id, status, transcript, stop_and_ask, ' +
  'pending_notes, cost_tokens_in, cost_tokens_out, cost_usd, started_at, ended_at, step_idx, ctx_used_tokens, ctx_max_tokens, final_model_usage, limit_reset_at) ' +
  'SELECT provider_session_id, ' +
  "COALESCE((SELECT w.workspace_id FROM work_order w WHERE w.id = session_legacy.work_order_id), ''), work_order_id, " +
  'role, scope_track_id, status, transcript, stop_and_ask, pending_notes, cost_tokens_in, cost_tokens_out, cost_usd, started_at, ended_at, step_idx, ' +
  // WO-0052: the usage columns ride every rebuild — the ALTERs above ran first, so session_legacy
  // always carries them (NULL for a pre-WO-0052 row: honestly absent through the copy).
  'ctx_used_tokens, ctx_max_tokens, final_model_usage, ' +
  // WO-0053: the limit stamp rides the same way (NULL for pre-WO-0053 rows).
  'limit_reset_at FROM session_legacy';

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
  // WO-0045: the steer-note mirror rides the session row (the stop_and_ask precedent).
  if (!cols.has('pending_notes')) db.exec('ALTER TABLE session ADD COLUMN pending_notes TEXT');
  // WO-0052: the usage checkpoints ride the session row (the pending_notes precedent). All nullable
  // — NULL is the honest pre-WO-0052 vintage, never backfilled. The session_usage TABLE itself needs
  // no ALTER: SCHEMA_SQL's CREATE TABLE IF NOT EXISTS ran before migrate() on every open.
  if (!cols.has('ctx_used_tokens')) db.exec('ALTER TABLE session ADD COLUMN ctx_used_tokens INTEGER');
  if (!cols.has('ctx_max_tokens')) db.exec('ALTER TABLE session ADD COLUMN ctx_max_tokens INTEGER');
  if (!cols.has('final_model_usage')) db.exec('ALTER TABLE session ADD COLUMN final_model_usage TEXT');
  // WO-0053: the limit stamp (the same additive, PRAGMA-guarded discipline — NULL is the honest
  // pre-WO-0053 vintage, never backfilled; the three-state write rule lives in recordSessionRow).
  if (!cols.has('limit_reset_at')) db.exec('ALTER TABLE session ADD COLUMN limit_reset_at TEXT');

  // WO-0092 fix round (m4): the ISOLATED issue-look failure rides forge_scan (additive, the same
  // PRAGMA-guarded discipline — NULL is the honest pre-m4 vintage: the issue page is scan-fresh).
  const forgeScanCols = new Set((db.prepare('PRAGMA table_info(forge_scan)').all() as { name: string }[]).map((c) => c.name));
  if (!forgeScanCols.has('issue_reason')) db.exec('ALTER TABLE forge_scan ADD COLUMN issue_reason TEXT');

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

  // WO-0051 / D2: roadmap_draft gains the counts-only source summary (additive ALTER — no CHECK;
  // NULL is the honest pre-WO-0051 vintage, the read fails open).
  const draftCols = new Set((db.prepare('PRAGMA table_info(roadmap_draft)').all() as { name: string }[]).map((c) => c.name));
  if (draftCols.size > 0 && !draftCols.has('source_summary')) db.exec('ALTER TABLE roadmap_draft ADD COLUMN source_summary TEXT');

  // 2026-08-24: session.status gains 'stopped' (the durable interrupted fact — WO-0039 round 4). A
  // CHECK lives in the table definition, so — the established rebuild: rename → recreate (the
  // widened SCHEMA_SQL) → id-preserving copy → drop. Runs AFTER the column ALTERs above (the copy
  // then sees every column on every vintage; a fresh rebuild supersedes them anyway). Reviewer
  // round: the rebuild is TRANSACTIONAL — a crash mid-sequence would otherwise leave the recreated
  // empty table (whose fresh SQL already carries 'stopped', failing the rebuild condition) plus an
  // orphaned *_legacy, silently losing every session row.
  // WO-0050: the copy is the shared SESSION_REBUILD_COPY below — every recreate backfills
  // `workspace_id` (SCHEMA_SQL carries it NOT NULL, whichever clause triggers the rebuild).
  const sessionSql =
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session'").get() as { sql: string } | undefined)?.sql ?? '';
  if (sessionSql && !sessionSql.includes("'stopped'")) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('ALTER TABLE session RENAME TO session_legacy');
      db.exec(SCHEMA_SQL);
      db.exec(SESSION_REBUILD_COPY);
      db.exec('DROP TABLE session_legacy');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // WO-0050 / D2: the session gains its OWNER pair — `workspace_id TEXT NOT NULL` (backfilled
  // through the WO join) and `work_order_id` going NULLable (the roadmap draft drive). For dbs
  // that already carry 'stopped' but predate the owner pair — the same transactional rebuild with
  // the same copy. An ORPHAN legacy row (its work_order row gone — the migration fixtures prove
  // the vintage exists) backfills `''`: a workspace that joins to nothing, keeps the row, and
  // never hydrates anywhere — honest, total, never a startup brick.
  const sessionOwnerSql =
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session'").get() as { sql: string } | undefined)?.sql ?? '';
  if (sessionOwnerSql && !sessionOwnerSql.includes('workspace_id')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('ALTER TABLE session RENAME TO session_legacy');
      db.exec(SCHEMA_SQL);
      db.exec(SESSION_REBUILD_COPY);
      db.exec('DROP TABLE session_legacy');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // WO-0031c: wo_event's kind CHECK widens (wo_edited/rule_changed/permission_decision; WO-0039
  // stabilization adds plan_save_refused; WO-0065 adds forge_merge — the closure's observed
  // fact). A CHECK lives in the table definition, so — like the legacy track.stage rebuild
  // above — rename → recreate (the widened SCHEMA_SQL) → id-preserving copy (append order is
  // the audit's meaning) → drop.
  const woEventSql =
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wo_event'").get() as { sql: string } | undefined)?.sql ?? '';
  if (woEventSql && (!woEventSql.includes("'wo_edited'") || !woEventSql.includes("'plan_save_refused'") || !woEventSql.includes("'steer_queued'") || !woEventSql.includes("'forge_merge'"))) {
    // Reviewer round (WO-0045): transactional, like the session rebuild above — a crash between
    // COPY and DROP otherwise leaves an empty (fresh-CHECK) wo_event plus an orphaned *_legacy,
    // silently erasing the audit; the satisfied condition would never re-run.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('ALTER TABLE wo_event RENAME TO wo_event_legacy');
      db.exec(SCHEMA_SQL);
      db.exec(
        'INSERT INTO wo_event (id, work_order_id, kind, detail, at) ' +
          'SELECT id, work_order_id, kind, detail, at FROM wo_event_legacy ORDER BY id',
      );
      db.exec('DROP TABLE wo_event_legacy');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
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
    // WO-0092 fix round (M1): the target must be a CONNECTED repo — a store slug naming a
    // definition row without a connection is the cwd-fallback hazard (the reviewed chain).
    // Zero-connection workspaces keep the fixture contract (D8) untouched.
    const hasConnections = db.prepare('SELECT 1 FROM connection WHERE workspace_id = ? LIMIT 1').get(id);
    if (hasConnections !== undefined) {
      const rows = db.prepare('SELECT local_path FROM connection WHERE workspace_id = ?').all(id) as { local_path: string }[];
      if (!rows.some((r) => repoBase(r.local_path) === (ds as string)))
        throw new Error(`decision store re-point refused: no connected repo named ${ds as string} — connect it first`);
    }
    db.prepare('UPDATE workspace SET decision_store = ? WHERE id = ?').run(ds, id);
  }
}

// Delete a workspace WITH everything Docket recorded under it (WO-0032): guard first — a live drive
// blocks the delete and an error must delete nothing — then the per-WO cascade for each of its work
// orders (rows + the Docket-authored decision-store dirs), then the definition + connection rows.
// Repo code and git history are never touched; the dir resolves STRICTLY from connection rows (a
// workspace without a matching connection deletes DB rows only, never a folder under cwd). Global
// app_setting rows are untouched — except the workspace's OWN budget threshold (WO-0047) and
// structure root (WO-0048): a recycled workspace id must not inherit a dead cap or a foreign root.
function deleteWorkspaceRow(db: DatabaseSync, id: WorkspaceId): void {
  // WO-0050: the live guard also sees the workspace's WO-LESS rows (a running draft blocks the
  // delete like any live drive).
  const live = db
    .prepare(
      "SELECT COUNT(*) AS n FROM session WHERE status = 'running' AND (work_order_id IN (SELECT id FROM work_order WHERE workspace_id = ?) OR (workspace_id = ? AND work_order_id IS NULL))",
    )
    .get(id, id) as { n: number };
  if (live.n > 0) throw new Error(`deleteWorkspace: ${live.n} running session(s) in ${id}`);
  const dir = connectedStructureRoot(db, id); // before the connection rows go
  const woIds = db.prepare('SELECT id FROM work_order WHERE workspace_id = ?').all(id) as { id: string }[];
  for (const x of woIds) deleteWorkOrderRows(db, woid(x.id), dir);
  db.prepare('DELETE FROM session WHERE workspace_id = ? AND work_order_id IS NULL').run(id);
  // WO-0054 cascade completion: one workspace-scoped statement covers BOTH arms — the WO rows
  // (already gone via the per-WO cascade above) and the work_order_id IS NULL ✦ draft rows. The
  // usage ledger is append-only against the UPSERT, not against the OWNER (WO-0052's schema note);
  // a deleted owner's spend must not outlive the month head's basis (the mockup's frame-03 note:
  // «dördüncü tür önlendi»).
  db.prepare('DELETE FROM session_usage WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM roadmap_draft WHERE workspace_id = ?').run(id);
  db.prepare('DELETE FROM app_setting WHERE key = ?').run(`budget:${id}`);
  db.prepare('DELETE FROM app_setting WHERE key = ?').run(`docs_root:${id}`);
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
  // WO-0092 fix round (M1): the decision-store connection is the workspace's document root —
  // removing it orphans the store slug and (pre-guard) aimed every write at the app's own repo
  // via the cwd fallback. A workspace without a decision store is not a valid state: re-point
  // first (the settings' select), then remove.
  const ws = db.prepare('SELECT decision_store FROM workspace WHERE id = ?').get(id) as
    | { decision_store: string }
    | undefined;
  if (ws && ws.decision_store === (repoId as string))
    throw new Error(`cannot remove the decision-store connection (${repoId as string}) — re-point the decision store first`);
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

// --- The observed forge cache (WO-0064, ADR-0010's forge half) ---
// Written by the reconciler (core/forge.ts) through the composition root; a successful scan is
// ONE transaction that REPLACES the repo's PR page + checks (observation wins — a PR fallen off
// the open page is absent after the scan); a degraded record touches forge_scan ONLY (prior
// facts stay — the wipe would be the lie). Discardable with the rest of OBSERVED_TABLES.

function forgeScanTargetsRow(db: DatabaseSync, id: WorkspaceId): { repoRemote: string; path: string }[] {
  return (
    db.prepare('SELECT repo_remote, local_path FROM connection WHERE workspace_id = ? ORDER BY rowid').all(id) as {
      repo_remote: string;
      local_path: string;
    }[]
  ).map((r) => ({ repoRemote: r.repo_remote, path: r.local_path }));
}

function recordForgeScanRow(db: DatabaseSync, workspaceId: WorkspaceId, repoRemote: string, scan: ForgeScan): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO forge_scan (workspace_id, repo_remote, status, reason, observed_at, issue_reason) VALUES (?,?,'ok',NULL,?,?)
       ON CONFLICT(workspace_id, repo_remote) DO UPDATE SET status='ok', reason=NULL, observed_at=excluded.observed_at, issue_reason=excluded.issue_reason`,
    ).run(workspaceId, repoRemote, scan.at, scan.issueError ?? null);
    db.prepare('DELETE FROM forge_pr WHERE workspace_id = ? AND repo_remote = ?').run(workspaceId, repoRemote);
    db.prepare('DELETE FROM forge_check WHERE workspace_id = ? AND repo_remote = ?').run(workspaceId, repoRemote);
    const insPr = db.prepare(
      `INSERT INTO forge_pr (workspace_id, repo_remote, number, state, title, head_sha, head_branch, base_branch,
       review_decision, merged_at, merge_sha, url, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const pr of scan.prs) {
      insPr.run(
        workspaceId, repoRemote, pr.number, pr.state, pr.title ?? null, pr.headSha, pr.headBranch, pr.baseBranch,
        pr.reviewDecision ?? null, pr.mergedAt ?? null, pr.mergeSha ?? null, pr.url, scan.at,
      );
    }
    const insCheck = db.prepare(
      'INSERT INTO forge_check (workspace_id, repo_remote, sha, name, status, conclusion, observed_at) VALUES (?,?,?,?,?,?,?)',
    );
    for (const { sha, check } of scan.checks) {
      insCheck.run(workspaceId, repoRemote, sha, check.name, check.status, check.conclusion ?? null, scan.at);
    }
    // WO-0092: the issue page replaces in the SAME transaction — an issue fallen off the open
    // page is absent after the scan (observation wins). No body ever enters a row. Fix round
    // (m4): a scan carrying issueError touches NO issue row — the failed look keeps the prior
    // page (the degraded rule: a failed look never wipes); the reason rides forge_scan.
    if (scan.issueError === undefined) {
      db.prepare('DELETE FROM forge_issue WHERE workspace_id = ? AND repo_remote = ?').run(workspaceId, repoRemote);
      const insIssue = db.prepare(
        `INSERT INTO forge_issue (workspace_id, repo_remote, number, ref, state, title, url, labels, milestone_title, updated_at, observed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const issue of scan.issues) {
        insIssue.run(
          workspaceId, repoRemote, issue.number, `${issue.repo.owner}/${issue.repo.name}#${issue.number}`,
          issue.state, issue.title ?? null, issue.url, JSON.stringify(issue.labels),
          issue.milestone?.title ?? null, issue.updatedAt ?? null, scan.at,
        );
      }
    }
    // ADR-0017: the OBSERVED WO→PR link — the scanned open PRs matched to the workspace's OPEN
    // work orders by the title rule (titleCarriesWoId). Latest-wins: this scan's match
    // overwrites; no hit keeps the prior link (the last observation stands — a page replace is
    // not a wipe of what was last seen true).
    const conn = db
      .prepare('SELECT local_path FROM connection WHERE workspace_id = ? AND repo_remote = ?')
      .get(workspaceId, repoRemote) as { local_path: string } | undefined;
    if (conn !== undefined && scan.prs.length > 0) {
      const repo = repoBase(conn.local_path);
      const openWos = db
        .prepare('SELECT id FROM work_order WHERE workspace_id = ? AND gate_closure_docs_sha IS NULL')
        .all(workspaceId) as { id: string }[];
      for (const { id } of openWos) {
        const pr = scan.prs.find((p) => p.title !== undefined && titleCarriesWoId(p.title, id));
        if (pr) {
          db.prepare('UPDATE track SET pr_url = ?, pr_head_sha = ?, observed_at = ? WHERE work_order_id = ? AND repo = ?').run(
            pr.url, pr.headSha, scan.at, id, repo,
          );
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function recordForgeDegradedRow(
  db: DatabaseSync, workspaceId: WorkspaceId, repoRemote: string, at: string, reason: string,
): void {
  db.prepare(
    `INSERT INTO forge_scan (workspace_id, repo_remote, status, reason, observed_at) VALUES (?,?,'degraded',?,?)
     ON CONFLICT(workspace_id, repo_remote) DO UPDATE SET status='degraded', reason=excluded.reason, observed_at=excluded.observed_at`,
  ).run(workspaceId, repoRemote, reason, at);
}

function forgeViewRow(db: DatabaseSync, id: WorkspaceId): ForgeView {
  const connections = db
    .prepare('SELECT repo_remote, local_path FROM connection WHERE workspace_id = ? ORDER BY rowid')
    .all(id) as { repo_remote: string; local_path: string }[];
  const repos: ForgeRepoView[] = [];
  for (const conn of connections) {
    const scan = db
      .prepare('SELECT status, reason, observed_at, issue_reason FROM forge_scan WHERE workspace_id = ? AND repo_remote = ?')
      .get(id, conn.repo_remote) as { status: string; reason: string | null; observed_at: string; issue_reason: string | null } | undefined;
    if (!scan) continue; // never scanned — absent from the view (the section's absent grammar)
    const prRows = db
      .prepare(
        'SELECT number, state, title, head_sha, head_branch, base_branch, review_decision, merged_at, merge_sha, url FROM forge_pr WHERE workspace_id = ? AND repo_remote = ? ORDER BY number',
      )
      .all(id, conn.repo_remote) as {
      number: number;
      state: string;
      title: string | null;
      head_sha: string;
      head_branch: string;
      base_branch: string;
      review_decision: string | null;
      merged_at: string | null;
      merge_sha: string | null;
      url: string;
    }[];
    const checkRows = db
      .prepare('SELECT sha, name, status, conclusion FROM forge_check WHERE workspace_id = ? AND repo_remote = ? ORDER BY name')
      .all(id, conn.repo_remote) as { sha: string; name: string; status: string; conclusion: string | null }[];
    // WO-0092: the cached issue rows — the display facts + the ref text; the labels ride JSON
    // (an array of names), the milestone as its display title only.
    const issueRows = db
      .prepare(
        'SELECT number, ref, state, title, url, labels, milestone_title, updated_at FROM forge_issue WHERE workspace_id = ? AND repo_remote = ? ORDER BY number',
      )
      .all(id, conn.repo_remote) as {
      number: number;
      ref: string;
      state: string;
      title: string | null;
      url: string;
      labels: string;
      milestone_title: string | null;
      updated_at: string | null;
    }[];
    repos.push({
      repoRemote: conn.repo_remote,
      path: conn.local_path,
      scannedAt: scan.observed_at,
      health: scan.status === 'ok' ? 'ok' : { degraded: scan.reason ?? 'unknown failure' },
      // WO-0092 fix round (m4): the issue look's own health, isolated from the repo's — the
      // carried reason means the rows below are the PRIOR page, kept (never wiped).
      ...(scan.status === 'ok' && scan.issue_reason != null
        ? { issueHealth: { degraded: scan.issue_reason } as ForgeRepoView['issueHealth'] }
        : { issueHealth: 'ok' as ForgeRepoView['issueHealth'] }),
      issues: issueRows.map((issue) => {
        const row: ForgeIssueRow = {
          ref: issue.ref as ForgeIssueRow['ref'],
          number: issue.number,
          state: issue.state as 'open' | 'closed',
          url: issue.url,
          labels: JSON.parse(issue.labels) as string[],
        };
        if (issue.title != null) row.title = issue.title;
        if (issue.updated_at != null) row.updatedAt = issue.updated_at;
        if (issue.milestone_title != null) row.milestoneTitle = issue.milestone_title;
        return row;
      }),
      prs: prRows.map((pr) => {
        const row: ForgePrRow = {
          number: pr.number,
          state: pr.state as ForgePr['state'],
          headSha: pr.head_sha,
          headBranch: pr.head_branch,
          baseBranch: pr.base_branch,
          url: pr.url,
          checks: checkRows
            .filter((c) => c.sha === pr.head_sha)
            .map((c) => {
              const check = { name: c.name, status: c.status };
              return c.conclusion != null ? { ...check, conclusion: c.conclusion } : check;
            }),
        };
        if (pr.title != null) row.title = pr.title;
        if (pr.review_decision != null) row.reviewDecision = pr.review_decision;
        if (pr.merged_at != null) row.mergedAt = pr.merged_at;
        if (pr.merge_sha != null) row.mergeSha = pr.merge_sha;
        return row;
      }),
    });
  }
  return { repos };
}

// --- Work-order creation (WO-0015) ---
// The workspace's STRUCTURE ROOT resolved STRICTLY from its connection rows (WO-0032 + WO-0048):
// the connected decision-store path plus the workspace's docs_root setting. Undefined when no
// connection matches. DELETES resolve through this only — a deletion must never operate on the
// process.cwd() fallback (fixture workspaces resolve there, and under vitest cwd IS the operator's
// real repo).
function connectedStructureRoot(db: DatabaseSync, workspaceId: WorkspaceId): string | undefined {
  const dsRoot = decisionStoreRepoRoot(db, workspaceId);
  return dsRoot === undefined ? undefined : join(dsRoot, settingDocsRoot(db, workspaceId));
}

// WO-0089 — the decision store's REPO root (the connected local_path whose basename matches the
// workspace's decision_store slug; connectedStructureRoot minus the docs_root join): the home of
// `.workflow/workspace.yaml`, the local gate's declaration. Strict, no process.cwd() fallback —
// a fixture workspace declares nothing.
function decisionStoreRepoRoot(db: DatabaseSync, workspaceId: WorkspaceId): string | undefined {
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

// WO-0089 — the workspace's local-gate DECLARATION, read from the decision store at view time
// (ADR-0010 rule 1 — the definition is a document). Undeclared when the store has no
// workspace.yaml or no `gate:` section; INVALID when a declaration exists but cannot be read or
// parsed — never silently undeclared (an unread declaration must not open the hole WO-0089
// closes). Per-hydrate read; the N-file cost is TD-055's accepted shape.
function gateConfigFor(db: DatabaseSync, workspaceId: WorkspaceId | undefined): GateConfig {
  if (!workspaceId) return { kind: 'undeclared' };
  const root = decisionStoreRepoRoot(db, workspaceId);
  if (root === undefined) return { kind: 'undeclared' };
  let text: string | undefined;
  try {
    text = readWorkspaceYaml(root);
  } catch (e) {
    return { kind: 'invalid', reason: `workspace.yaml unreadable (${(e as Error).message})` };
  }
  if (text === undefined) return { kind: 'undeclared' };
  return parseGateConfig(text);
}

// WO-0092 fix round (M1): the cwd fallback under structureRoot is a fixture-world courtesy (D8 —
// "Docket manages itself"); for a REAL workspace whose store slug matches no connection it aimed
// every document WRITE into the app's own repo (the reviewed incident chain). A workspace with
// connections but no resolvable store is a broken state: every document write refuses with
// operator words, and the settings cannot produce the state anymore (the removal/re-point guards
// below) — this store-side refusal is the second layer.
function decisionStoreDisconnected(db: DatabaseSync, workspaceId: WorkspaceId): boolean {
  const anyConnection = db.prepare('SELECT 1 FROM connection WHERE workspace_id = ? LIMIT 1').get(workspaceId);
  if (anyConnection === undefined) return false; // zero connections = the fixture contract stands (D8)
  return connectedStructureRoot(db, workspaceId) === undefined;
}
function refuseDisconnectedStore(db: DatabaseSync, workspaceId: WorkspaceId): void {
  if (decisionStoreDisconnected(db, workspaceId))
    throw new Error(
      'decision store disconnected — no connected repo carries this workspace\'s decision store; re-point it in the workspace settings',
    );
}

// The workspace's STRUCTURE ROOT (WO-0048, ADR-0016): the decision store's local working-tree path
// plus the workspace's docs_root setting (default docs/, .docket/ one setting away). Every document
// path — work-orders/, roadmap.md — resolves through this, so one setting moves every read/write at
// once; switching never moves files (ADR-0016). Workspace.decisionStore is a RepoId slug; the real
// path lives in the owned connection table. Fixture workspaces have no connection row, so fall back
// to process.cwd() + the root (Docket manages itself from its own working tree). The path never
// crosses to the renderer (ADR-0001). M3 reads workspace.yaml + connection instead.
function structureRoot(db: DatabaseSync, workspaceId: WorkspaceId): string {
  return connectedStructureRoot(db, workspaceId) ?? join(process.cwd(), settingDocsRoot(db, workspaceId));
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
  return wo ? structureRoot(db, wid(wo.workspace_id)) : undefined;
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

// The operator's explicit UI locale (WO-0035): only a deliberate choice is stored — an absent or garbage
// row reads undefined and the renderer falls back to system-language detection. No legacy mapping.
function settingLocale(db: DatabaseSync): Locale | undefined {
  const value = (db.prepare('SELECT value FROM app_setting WHERE key = ?').get('locale') as { value: string } | undefined)?.value;
  return value === 'tr' || value === 'en' ? value : undefined;
}

// The operator's per-role model preference (WO-0059 rev 2): ONE JSON row `models`. The store
// normalizes SHAPE only — unknown role keys and blank values drop; a map with no usable role row
// is nothing. Any id is legal (the provider validates), so unlike locale there is no value
// enumeration to check — ids ride verbatim, trimmed.
const MODEL_ROLES: ReadonlySet<string> = new Set(['architect', 'implementer', 'verifier']);
function settingModels(db: DatabaseSync): RoleModels | undefined {
  const value = (db.prepare('SELECT value FROM app_setting WHERE key = ?').get('models') as { value: string } | undefined)?.value;
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const out: RoleModels = {};
    for (const [role, id] of Object.entries(parsed)) {
      if (!MODEL_ROLES.has(role) || typeof id !== 'string') continue;
      const trimmed = id.trim();
      if (trimmed) out[role as keyof RoleModels] = trimmed;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

// The whole-text prompt-template overrides (WO-0070): ONE JSON row `prompt_overrides` (the
// models row's posture). The store normalizes SHAPE only — unknown keys and whitespace-only
// values drop; a map with no usable key is nothing. Bodies ride VERBATIM (the operator's text is
// the operator's text — the assembly fns decide whether it is used). Garbage reads undefined
// (the settingModels posture): a corrupt row falls back to every built-in, never a crash.
const PROMPT_OVERRIDE_KEYS: ReadonlySet<string> = new Set(['architect', 'implementer', 'verifier', 'architectReview', 'roadmapDraft']);
function settingPromptOverrides(db: DatabaseSync): PromptOverrides | undefined {
  const value = (db.prepare('SELECT value FROM app_setting WHERE key = ?').get('prompt_overrides') as { value: string } | undefined)?.value;
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const out: PromptOverrides = {};
    for (const [key, body] of Object.entries(parsed)) {
      if (!PROMPT_OVERRIDE_KEYS.has(key) || typeof body !== 'string') continue;
      if (body.trim() === '') continue;
      out[key as keyof PromptOverrides] = body;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

// The workspace's structure root setting (WO-0048, ADR-0016): a RAW string row `docs_root:<wsId>`
// (no JSON — one value). The read FAILS OPEN (the settingBudget posture): an absent or invalid row
// reads as the `docs` default — a corrupt row must not hide the workspace's documents. The WRITE
// (setDocsRoot, below) refuses loudly on an invalid value: a read may degrade, an operator act may not.
function settingDocsRoot(db: DatabaseSync, wsId: WorkspaceId): string {
  const value = (
    db.prepare('SELECT value FROM app_setting WHERE key = ?').get(`docs_root:${wsId}`) as { value: string } | undefined
  )?.value;
  if (value === undefined) return DEFAULT_DOCS_ROOT;
  return normalizeDocsRoot(value) ?? DEFAULT_DOCS_ROOT;
}

// The workspace's budget threshold (WO-0047): ONE JSON row `budget:<wsId>` — the atomic
// {capUsd, warnPercent} pair. Garbage or a partial row reads undefined (the settingLocale
// pattern): a corrupt threshold opens the gate rather than inventing a number. Both fields are
// required because writers persist them as one pair.
function settingBudget(db: DatabaseSync, wsId: WorkspaceId): BudgetThreshold | undefined {
  const value = (
    db.prepare('SELECT value FROM app_setting WHERE key = ?').get(`budget:${wsId}`) as { value: string } | undefined
  )?.value;
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { capUsd?: unknown; warnPercent?: unknown };
    if (typeof parsed.capUsd !== 'number' || !Number.isFinite(parsed.capUsd)) return undefined;
    if (typeof parsed.warnPercent !== 'number' || !Number.isFinite(parsed.warnPercent)) return undefined;
    return { capUsd: parsed.capUsd, warnPercent: parsed.warnPercent };
  } catch {
    return undefined;
  }
}

// The workspace's current-month observed spend (WO-0047): SUM over the workspace's session rows,
// windowed on started_at (ISO strings compare lexicographically — the range is core's UTC
// calendar month). WO-0050 / D4: keyed on `workspace_id` DIRECTLY, not through the WO join — a
// draft session's row (work_order_id NULL) counts like every other; before the widening such a
// row was invisible to the sum, which is exactly the bypass the draft must never have. NULL
// cost_usd rows never count toward the sum; the companion count flags them so the surfaces can
// state the known-spend basis instead of silently undercounting toward the cap. All three budget
// reads (gate, source, settings readout) go through this one row.
function monthSpendRow(db: DatabaseSync, wsId: WorkspaceId): { usd: number; hasUnknown: boolean } {
  const { startIso, endIso } = monthWindow(new Date());
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS usd,
              COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unknownCount
       FROM session
       WHERE workspace_id = ?
         AND started_at >= ? AND started_at < ?`,
    )
    .get(wsId, startIso, endIso) as { usd: number; unknownCount: number };
  return { usd: row.usd, hasUnknown: row.unknownCount > 0 };
}

// The BUDGET gate's verdict for a drive (WO-0047): the workspace is resolved through the work
// order (DriveInput carries no workspace id — the store-side join is the only honest keying), the
// threshold read, the month sum compared. A payload ONLY at hard_stop: warn is a line, never a
// block. A missing work order passes here — the plan gate ahead of it already fails closed, and
// this gate must not invent a workspace for an id that has none.
function budgetBlockForWo(db: DatabaseSync, woId: WorkOrderId): BudgetRefusal | undefined {
  const ws = (
    db.prepare('SELECT workspace_id AS ws FROM work_order WHERE id = ?').get(woId) as { ws: string } | undefined
  )?.ws;
  if (!ws) return undefined;
  const wsId = wid(ws);
  const threshold = settingBudget(db, wsId);
  if (!threshold || !(threshold.capUsd > 0)) return undefined;
  const { usd } = monthSpendRow(db, wsId);
  return budgetStatus(usd, threshold) === 'hard_stop' ? { observedUsd: usd, capUsd: threshold.capUsd } : undefined;
}

// WO-0050 / D4: the SAME gate keyed directly by workspace — the WO-less draft drive's read. The
// draft's own spend already rides the widened monthSpendRow, so a draft at the cap is refused
// exactly like a WO drive, pre-spawn.
function budgetBlockForDraftRow(db: DatabaseSync, wsId: WorkspaceId): BudgetRefusal | undefined {
  const threshold = settingBudget(db, wsId);
  if (!threshold || !(threshold.capUsd > 0)) return undefined;
  const { usd } = monthSpendRow(db, wsId);
  return budgetStatus(usd, threshold) === 'hard_stop' ? { observedUsd: usd, capUsd: threshold.capUsd } : undefined;
}

// ===== The pending roadmap draft (WO-0050, ADR-0016) =====
//
// ONE row per workspace: the ✦ architect session's proposal, held until the operator decides.
// Document text in the DB under the plan_original carve-out (a PENDING proposal, never the live
// document). Written at plan_ready; cleared by approve and by a fresh draft's supersede.

// The named reason a roadmap document cannot be re-read — the one parse-guard voice for every
// draft write (saveRoadmap's own message stays verbatim; this is the draft paths' shared helper).
function roadmapParseWhy(md: string): string | undefined {
  const e = parseRoadmapMd(md).parseError;
  if (!e) return undefined;
  return e.reason === 'bad_json' ? `bad JSON (${e.message})`
    : e.reason === 'bad_element' ? `malformed element [${e.index}] — ${e.problem}`
    : 'no fazlar fence';
}

type DraftRow = { workspace_id: string; md: string; provider_session_id: string | null; source_summary: string | null; created_at: string; updated_at: string };

// WO-0051 / D2: parse the composition's COUNTS — fail-open like every settings read (garbage or
// a pre-WO-0051 NULL reads undefined; the card's kaynak line omits honestly, never a crash).
function parseSourceSummary(raw: string | null | undefined): DraftSourceSummary | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as { store?: unknown; external?: unknown; freeExplore?: unknown };
    if (typeof v.store !== 'number' || typeof v.external !== 'number' || typeof v.freeExplore !== 'boolean') return undefined;
    return { store: v.store, external: v.external, freeExplore: v.freeExplore };
  } catch {
    return undefined;
  }
}

function saveRoadmapDraftRow(db: DatabaseSync, wsId: WorkspaceId, md: string, opts?: { providerSessionId?: string; sourceSummary?: DraftSourceSummary }): void {
  const prior = db.prepare('SELECT md, provider_session_id, source_summary FROM roadmap_draft WHERE workspace_id = ?').get(wsId) as
    | { md: string; provider_session_id: string | null; source_summary: string | null }
    | undefined;
  // Supersede guard (D6): a row whose md PARSES is never overwritten by one that does not. The
  // refusal KEEPS the prior valid proposal — a refusal, not a crash: the drive itself succeeded,
  // and the card still has the good md to approve or object to.
  if (prior && !roadmapParseWhy(prior.md) && roadmapParseWhy(md)) return;
  const now = new Date().toISOString();
  const providerSessionId = opts?.providerSessionId ?? prior?.provider_session_id ?? null;
  // Keep-prior (WO-0051 / D2), the providerSessionId discipline: an İtiraz resume's write
  // carries no composition (the renderer never re-sends it) — the ORIGINAL figures survive.
  const sourceSummary = opts?.sourceSummary !== undefined ? JSON.stringify(opts.sourceSummary) : prior?.source_summary ?? null;
  if (prior) {
    db.prepare('UPDATE roadmap_draft SET md = ?, provider_session_id = ?, source_summary = ?, updated_at = ? WHERE workspace_id = ?').run(md, providerSessionId, sourceSummary, now, wsId);
  } else {
    db.prepare('INSERT INTO roadmap_draft (workspace_id, md, provider_session_id, source_summary, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(wsId, md, providerSessionId, sourceSummary, now, now);
  }
}

// The Düzenle write (the structured editor's Bitti): an OPERATOR act — refuse loudly on a
// document that cannot be re-read (a read may degrade; an operator act may not), and on a
// missing row (the editor opens only from the card, which opens only from a row).
function updateRoadmapDraftRow(db: DatabaseSync, wsId: WorkspaceId, md: string): void {
  const prior = db.prepare('SELECT 1 AS x FROM roadmap_draft WHERE workspace_id = ?').get(wsId);
  if (!prior) throw new Error('updateRoadmapDraft: no pending draft');
  const why = roadmapParseWhy(md);
  if (why) throw new Error(`updateRoadmapDraft: refusing to write a draft that cannot be re-read — ${why}`);
  db.prepare('UPDATE roadmap_draft SET md = ?, updated_at = ? WHERE workspace_id = ?').run(md, new Date().toISOString(), wsId);
}

// Onayla ⏎ — the atomic decision: parse-guard (write nothing on a draft that cannot re-read),
// write roadmap.md under the structure root, byte-identical re-read, DELETE the row. One call —
// no half state (a saved file with a lingering card).
async function approveRoadmapDraftRow(db: DatabaseSync, wsId: WorkspaceId): Promise<void> {
  const row = db.prepare('SELECT md FROM roadmap_draft WHERE workspace_id = ?').get(wsId) as { md: string } | undefined;
  if (!row) throw new Error('approveRoadmapDraft: no pending draft');
  // M1: the disconnect refusal precedes the parse guard (the saveRoadmap ruling).
  refuseDisconnectedStore(db, wsId);
  const why = roadmapParseWhy(row.md);
  if (why) throw new Error(`approveRoadmapDraft: refusing to write a document that cannot be re-read — ${why}`);
  const root = structureRoot(db, wsId);
  writeRoadmapMd(root, row.md);
  if (readRoadmapMd(root) !== row.md) throw new Error('approveRoadmapDraft: written roadmap.md does not re-read byte-identical');
  db.prepare('DELETE FROM roadmap_draft WHERE workspace_id = ?').run(wsId);
}

// The workspace's draft drive session row (latest), hydrated — the İtiraz resume's seed.
function draftSessionRow(db: DatabaseSync, wsId: WorkspaceId): SessionRef | undefined {
  const r = db
    .prepare('SELECT * FROM session WHERE workspace_id = ? AND work_order_id IS NULL ORDER BY id DESC LIMIT 1')
    .get(wsId) as SessionRow | undefined;
  return r ? hydrateSessionRow(r) : undefined;
}

function getRoadmapDraftRow(db: DatabaseSync, wsId: WorkspaceId): RoadmapDraft | null {
  const row = db.prepare('SELECT * FROM roadmap_draft WHERE workspace_id = ?').get(wsId) as DraftRow | undefined;
  if (!row) return null;
  const session = draftSessionRow(db, wsId);
  const sourceSummary = parseSourceSummary(row.source_summary);
  return {
    md: row.md,
    ...(row.provider_session_id ? { providerSessionId: row.provider_session_id } : {}),
    updatedAt: row.updated_at,
    ...(sourceSummary ? { sourceSummary } : {}),
    ...(session ? { session } : {}),
  };
}

// The ✦ dialog's DEPO channel read (WO-0051 / D3): the docs-root setting (the countline's
// label) + the recursive .md scan under the structure root, paths structure-root-RELATIVE —
// the ABSOLUTE root never crosses to the renderer (ADR-0001); the dialog prefixes and groups.
function decisionDocsRow(db: DatabaseSync, wsId: WorkspaceId): { docsRoot: string; files: string[] } {
  return { docsRoot: settingDocsRoot(db, wsId), files: scanDecisionDocs(structureRoot(db, wsId)) };
}

// The draft drive's first prompt (D5): the workspace's facts (slug, known repos, the roadmap
// file's path) feed core's roadmapDraftPrompt — the ONE mechanism, paths never contents.
// undefined when the workspace does not resolve (the pipeline refuses pre-spawn). WO-0051 /
// D5: `freeExplore` adds the ONE exploration sentence iff true.
function roadmapDraftPromptForRow(db: DatabaseSync, wsId: WorkspaceId, goalNote: string, docPaths: string[], freeExplore?: boolean): string | undefined {
  const ws = db.prepare('SELECT 1 AS x FROM workspace WHERE id = ?').get(wsId);
  if (!ws) return undefined;
  const knownRepos = (
    db.prepare('SELECT repo_id FROM workspace_repo WHERE workspace_id = ?').all(wsId) as { repo_id: string }[]
  ).map((r) => r.repo_id);
  // WO-0070: the override is consulted FIRST, once per assembly call; absent → the built-in.
  const overrides = settingPromptOverrides(db);
  return withOverride(
    roadmapDraftPrompt({
      goalNote,
      docPaths,
      workspaceSlug: wsId as string,
      knownRepos,
      roadmapMdPath: join(structureRoot(db, wsId), 'roadmap.md'),
      ...(freeExplore === true ? { freeExplore: true } : {}),
    }),
    overrides?.roadmapDraft,
  );
}

// ===== The cwd fix from the connection table (WO-0050 / D8) =====

// The decision-store repo's connected local path — connectedStructureRoot minus the docs suffix.
function decisionStoreRepoPath(db: DatabaseSync, wsId: WorkspaceId): string | undefined {
  const ws = db.prepare('SELECT decision_store FROM workspace WHERE id = ?').get(wsId) as { decision_store: string } | undefined;
  const dsSlug = ws?.decision_store ?? '';
  const rows = db.prepare('SELECT local_path FROM connection WHERE workspace_id = ?').all(wsId) as { local_path: string }[];
  for (const r of rows) {
    if (repoBase(r.local_path) === dsSlug) return r.local_path;
  }
  return undefined;
}

// Every GUI drive's working directory, resolved from the owned connection table (D8): a scoped
// WO drive runs in its track repo's connected path; a draft or unscoped WO drive in the
// decision-store repo's path (the architect fence then lands at <repo>/docs = the structure root
// at the default docs_root — TD-056 names the non-default residue). process.cwd() only when
// nothing matches — fixture and unconnected workspaces keep today's behavior byte-for-byte.
// Accepted residue (review f9): a scoped drive whose track repo has NO connection row falls to
// the decision-store repo rather than cwd — strictly safer than the old blanket process.cwd()
// (the write fence stays inside a workspace-owned repo), and the case is unreachable while the
// GUI only scopes drives to tracks of connected workspaces.
function driveCwdRow(db: DatabaseSync, input: DriveInput): string {
  if (isDraftDrive(input)) return decisionStoreRepoPath(db, input.workspaceId) ?? process.cwd();
  const wo = db.prepare('SELECT workspace_id AS ws FROM work_order WHERE id = ?').get(input.workOrderId) as { ws: string } | undefined;
  if (!wo) return process.cwd();
  const wsId = wid(wo.ws);
  // WO-0088: the wave worktree — the WO's OWN working copy wins over the connection table (the
  // operator aimed this work order at a per-WO checkout; the write fence jails to it because the
  // adapter's repoRoot IS this cwd). Read from order.md front-matter at spawn time (the
  // effectivePermissionRule pattern — no cache, no column). Absent → the table below stands.
  const dir = woDir(db, input.workOrderId);
  if (dir) {
    const { order } = readWoDocs(dir, input.workOrderId);
    if (order) {
      const override = parseOrderMd(order).cwd;
      if (override) return override;
    }
  }
  if (input.scope !== undefined) {
    const t = db
      .prepare('SELECT repo FROM track WHERE id = ? AND work_order_id = ?')
      .get(input.scope, input.workOrderId) as { repo: string } | undefined;
    if (t) {
      const rows = db.prepare('SELECT local_path FROM connection WHERE workspace_id = ?').all(wsId) as { local_path: string }[];
      for (const r of rows) {
        if (repoBase(r.local_path) === t.repo || r.local_path.endsWith(t.repo)) return r.local_path;
      }
    }
  }
  return decisionStoreRepoPath(db, wsId) ?? process.cwd();
}

// WO-0088 rev: the cwd override's SAFE gate — a working copy must be an absolute path that EXISTS,
// or the drive (and its write fence) would aim at the wrong root or a nonexistent dir. The dialogs
// pre-check the shape (core's cwdOverrideIsAbsolute) for the under-field error; the store is the
// second layer and refuses the write. `null` (the drop) is always legal.
function cwdOverrideRefusal(cwd: string): string | undefined {
  if (!cwdOverrideIsAbsolute(cwd)) return 'cwd override must be an absolute path';
  if (!existsSync(cwd)) return 'cwd override path does not exist';
  return undefined;
}

// WO-0051 / D9 (TD-056): the architect write fence's decision-store ROOT, aligned with the
// workspace's docs_root setting — the composition root fills DriveInput.decisionStoreRoot from
// this one call (the renderer never carries a path), and the adapter's fence then lands exactly
// on the structure root instead of the cwd-relative `docs/` default. undefined only when the
// drive's workspace does not resolve (the adapter keeps its default — never a startup brick).
function decisionStoreRootRow(db: DatabaseSync, input: DriveInput): string | undefined {
  if (isDraftDrive(input)) return structureRoot(db, input.workspaceId);
  const wo = db.prepare('SELECT workspace_id AS ws FROM work_order WHERE id = ?').get(input.workOrderId) as { ws: string } | undefined;
  return wo ? structureRoot(db, wid(wo.ws)) : undefined;
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

// WO-0069: one extracted pointer RESOLVES when its path (the `:line` suffix stripped) exists under
// ANY of the work order's repo roots at record time — the working tree the report was just written
// against (the v1 cut: recorded-sha resolution needs a per-report sha and stays out, WO-0069 Notes).
// An absolute pointer is checked as itself; a `./`-prefixed one is normalized away.
function pointerResolvable(pointer: string, roots: string[]): boolean {
  const path = pointer.replace(/:\d+$/, '').replace(/^\.\//, '');
  const candidates = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) ? [path] : roots.map((r) => join(r, path));
  return candidates.some((c) => existsSync(c));
}

// Write a step's report to the decision store (reports/step-NN-<role>.md) and mark the step done with the
// pointer. Mirrors approvePlan: path resolution + the working-tree write stay store-internal (ADR-0001), and
// the agent never writes its own report. Throws if the WO dir is missing (order.md must exist first).
function recordStepReportRow(db: DatabaseSync, workOrderId: WorkOrderId, idx: number, role: StepRole, body: string): void {
  const dir = woDir(db, workOrderId);
  if (!dir) throw new Error(`recordStepReport: no decision-store dir for ${workOrderId}`);
  const reportPath = writeStepReport(dir, workOrderId, idx, role, body);
  recordStepRow(db, workOrderId, idx, { status: 'done', reportPath });
  // WO-0069: the verification gate is a COMPUTATION at record time, not a closure-time `= 1`
  // attestation. The verifier report's `path:line` pointers are extracted (core's extractPointers)
  // and resolved against the WO's repo roots: every pointer resolvable → 1, any miss → 0.
  // Nothing extractable leaves the column UNTOUCHED — NULL stays the honest unknown ("nothing was
  // claimed"). A non-verifier report never speaks for this gate.
  if (role !== 'verifier') return;
  const pointers = extractPointers(body);
  if (pointers.length === 0) return;
  const roots = woRepoPaths(db, workOrderId);
  const resolvable = pointers.every((p) => pointerResolvable(p, roots));
  db.prepare('UPDATE work_order SET gate_verifier_resolvable = ? WHERE id = ?').run(resolvable ? 1 : 0, workOrderId);
}

// The per-WO cascade, shared by deleteWorkOrder and deleteWorkspace (WO-0032): children-first DB
// deletes, the work_order row, then the decision-store folder (order.md/plan.md/reports). `dir` must
// be resolved BEFORE the deletes — the work_order DELETE orphans the resolver (the WO-0032 fix: the
// old order resolved woDir after the DELETE, so dir was always undefined and the folder survived).
function deleteWorkOrderRows(db: DatabaseSync, id: WorkOrderId, dir: string | undefined): void {
  db.prepare('DELETE FROM wo_event WHERE work_order_id = ?').run(id);
  db.prepare('DELETE FROM work_order_step WHERE work_order_id = ?').run(id);
  db.prepare('DELETE FROM session WHERE work_order_id = ?').run(id);
  // WO-0054 cascade completion: the usage ledger is append-only against the UPSERT, not against
  // the OWNER (WO-0052's schema note promised "never deleted by the session upsert" — the upsert,
  // not the owner). A deleted owner's usd_delta must not outlive the month head's basis.
  db.prepare('DELETE FROM session_usage WHERE work_order_id = ?').run(id);
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
  return wo ? connectedStructureRoot(db, wid(wo.workspace_id)) : undefined;
}

// Cascade-delete a work order (WO-0020): children-first DB deletes, then the work_order row, then remove the
// decision-store folder (order.md/plan.md/reports). Workspace + repo definitions are untouched.
function deleteWorkOrderRow(db: DatabaseSync, id: WorkOrderId): void {
  deleteWorkOrderRows(db, id, woConnectedDir(db, id));
}

// WO-0071 — the briefing bundle: for the step's track, each dependency track's LATEST step report
// that still EXISTS on disk, as {repo, absolute path}. The dependency's contract is the report its
// own implementer/verifier already wrote (WO-0020's artifact); the prompt names the PATH and the
// agent reads it at its own fence — never contents (the WO-0050 ruling). A step scoped 'all'
// belongs to the whole work order, not to one track, so it never briefs a dependency; architect-role
// steps are outside the bundle for the same reason the WO names implementer/verifier reports.
// Latest idx first, first existing file wins; a dependency whose reports are all gone from disk
// contributes no line — all gone → [] → the prompt stays byte-identical to the pre-WO-0071 template.
function trackBriefing(
  db: DatabaseSync,
  workOrderId: WorkOrderId,
  woDirOnDisk: string, // the WO's own dir — report_path is WO-dir-relative (writeStepReport's pointer)
  specs: StepSpec[],
  scope: TrackId,
): Array<{ repo: string; path: string }> {
  const deps = db.prepare('SELECT depends_on_track_id FROM track_depends_on WHERE track_id = ?').all(scope) as {
    depends_on_track_id: string;
  }[];
  if (deps.length === 0) return [];
  const runRows = db
    .prepare('SELECT idx, report_path FROM work_order_step WHERE work_order_id = ?')
    .all(workOrderId) as { idx: number; report_path: string | null }[];
  const reportByStep = new Map(
    runRows.filter((r) => r.report_path != null).map((r) => [r.idx, r.report_path as string]),
  );
  const out: Array<{ repo: string; path: string }> = [];
  for (const dep of deps) {
    const depId = tid(dep.depends_on_track_id);
    const row = db.prepare('SELECT repo FROM track WHERE id = ? AND work_order_id = ?').get(depId, workOrderId) as
      | { repo: string }
      | undefined;
    if (!row) continue; // a row outside this WO cannot be written; skip, never invent a line
    const path = specs
      .filter(
        (s) =>
          (s.role === 'implementer' || s.role === 'verifier') &&
          s.scope.kind === 'track' &&
          resolveStepScope(db, workOrderId, s.scope.ref) === depId,
      )
      .sort((a, b) => b.idx - a.idx)
      .map((s) => reportByStep.get(s.idx))
      .find((p): p is string => p !== undefined && existsSync(join(woDirOnDisk, p)));
    if (path) out.push({ repo: row.repo, path: join(woDirOnDisk, path) });
  }
  return out;
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
  const specs = parsePlanSteps(plan);
  const spec = specs.find((s) => s.idx === idx);
  if (!spec) return undefined;
  const scope = spec.scope.kind === 'track' ? resolveStepScope(db, id, spec.scope.ref) : undefined;
  const woDirOnDisk = findWorkOrderDir(dir, id);
  const orderMdPath = woDirOnDisk ? `${woDirOnDisk}/order.md` : '';
  // WO-0071: the briefing rides only when the scope resolved AND at least one dependency still has
  // a report on disk — otherwise the key is absent and the prompt is byte-identical to today's.
  // Resolution runs against the WO DIR (report_path is WO-dir-relative — writeStepReport's pointer).
  const briefing = scope && woDirOnDisk ? trackBriefing(db, id, woDirOnDisk, specs, scope) : [];
  const input = {
    objective: parsed.objective,
    step: spec,
    planText: plan,
    orderMdPath,
    ...(briefing.length > 0 ? { briefing } : {}),
  };
  // WO-0070: the override is read ONCE per assembly call, keyed to the step's role; absent → built-in.
  const overrides = settingPromptOverrides(db);
  const prompt = withOverride(
    spec.role === 'verifier' ? verifierPrompt(input) : implementerPrompt(input),
    spec.role === 'verifier' ? overrides?.verifier : overrides?.implementer,
  );
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
  // WO-0070: the override is consulted FIRST, once per assembly call; absent → the built-in.
  const overrides = settingPromptOverrides(db);
  return withOverride(
    architectReviewPrompt({ objective: parsed.objective, step: spec, reportBody, planText: plan, orderMdPath, reportPath }),
    overrides?.architectReview,
  );
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
    // replaces it; WO-0069 gives the type its 'unknown' state — hydrated from a degraded scan, which
    // is why the SEED stays the inert running placeholder rather than a claim of its own).
    db.prepare(
      `INSERT INTO track (id, work_order_id, repo, pr_url, pr_head_sha, ci_kind, ci_blob, merged_at, observed_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(`${input.id}-${repoSlug}`, input.id, repoSlug, null, null, 'run', JSON.stringify({ state: 'running', checks: [] }), null, now);
  }
  // WO-0071 — the table's first runtime write path: one row per (track → dependency) pair, both ids
  // the SAME `${woId}-${repoSlug}` formula the track insert above uses. Absent input → zero rows
  // (byte-stable with every pre-WO-0071 creation). Validation already ran in the orchestrator.
  for (const dep of input.trackDependencies ?? []) {
    const trackId = `${input.id}-${dep.repo as string}`;
    for (const d of dep.dependsOn) {
      db.prepare('INSERT INTO track_depends_on (track_id, depends_on_track_id) VALUES (?, ?)').run(
        trackId,
        `${input.id}-${d as string}`,
      );
    }
  }
  const wo = hydrateWorkOrder(db, input.id);
  if (!wo) throw new Error(`createWorkOrder: failed to hydrate ${input.id}`);
  return wo;
}

export function createStore(dbPath: string): Store {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  migrate(db);
  // WO-0059 rev 4: the stored provider key RETIRED — a leftover row would be an invisible stale
  // credential (nothing reads it anymore, nothing could clear it). One-time idempotent sweep.
  db.prepare("DELETE FROM app_setting WHERE key = 'provider_key'").run();
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
      const dir = structureRoot(db, wid(wo.workspace_id));
      return Promise.resolve(readWoDocs(dir, id));
    },
    // The roadmap layer (WO-0048, ADR-0016). The view is DERIVED per read — the assembly lives in
    // roadmapViewRow (lifted there in WO-0072 so the overview read reuses it verbatim): roadmap.md
    // from the working tree, per-WO facts from ONE query, the task link re-parsed from order.md at
    // view time. '' file → absent; parse error or any error diagnostic → invalid carrying the
    // named reasons — never a silent empty (the order's stop-and-ask gate).
    getRoadmap: (id: WorkspaceId): Promise<RoadmapView> => Promise.resolve(roadmapViewRow(db, id)),
    getRoadmapMd: (id: WorkspaceId) => Promise.resolve(readRoadmapMd(structureRoot(db, id))),
    // Write roadmap.md under the structure root (creating the root). The guard is the point: a
    // document that fails to parse is refused BEFORE any byte is written — Docket's write path
    // never destroys the machine fence, prose-only saves included — and what is written must
    // re-read byte-identical. No commit: the operator commits (ADR-0010).
    saveRoadmap: async (id: WorkspaceId, md: string): Promise<void> => {
      // M1: the disconnect refusal precedes the parse guard — a store that resolves nowhere is
      // the more fundamental refusal, whatever the incoming text.
      refuseDisconnectedStore(db, id);
      const parsed = parseRoadmapMd(md);
      if (parsed.parseError) {
        const e = parsed.parseError;
        const why =
          e.reason === 'bad_json' ? `bad JSON (${e.message})`
          : e.reason === 'bad_element' ? `malformed element [${e.index}] — ${e.problem}`
          : 'no fazlar fence';
        throw new Error(`saveRoadmap: refusing to write a document that cannot be re-read — ${why}`);
      }
      const root = structureRoot(db, id);
      writeRoadmapMd(root, md);
      if (readRoadmapMd(root) !== md) throw new Error('saveRoadmap: written roadmap.md does not re-read byte-identical');
    },
    // The pending roadmap draft trio (WO-0050): the card's read, the Düzenle write, Onayla's
    // atomic decision (parse-guard + write + byte-identical re-read + row DELETE).
    getRoadmapDraft: (id: WorkspaceId) => Promise.resolve(getRoadmapDraftRow(db, id)),
    updateRoadmapDraft: async (id: WorkspaceId, md: string): Promise<void> => {
      updateRoadmapDraftRow(db, id, md);
    },
    approveRoadmapDraft: (id: WorkspaceId) => approveRoadmapDraftRow(db, id),
    // the card's Sil (dogfood 2026-08-29): the SessionStore's clear over the async port — the
    // pending row drops, roadmap.md untouched, the session row stays
    discardRoadmapDraft: async (id: WorkspaceId): Promise<void> => {
      db.prepare('DELETE FROM roadmap_draft WHERE workspace_id = ?').run(id);
    },
    recordSession: (input: RecordSessionInput) => recordSessionRow(db, input),
    recordTurnUsage: (owner: SessionOwner, providerSessionId: string, row: { at: string; delta: CostSummary; usage?: TurnUsage }) =>
      recordTurnUsageRow(db, owner, providerSessionId, row),
    // WO-0050 — the draft drive's gate + prompt + pending row (D3–D6). The budget method is the
    // draft arm of the unconditional gate; the prompt row feeds core's ONE-mechanism builder;
    // the draft row is plan_ready's landing. WO-0051: freeExplore rides the prompt, the
    // composition's counts ride the row (D2/D5) — and the DEPO channel reads through
    // decisionDocs (D3), the dialog's scan at open.
    budgetBlockForDraft: (workspaceId: WorkspaceId) => budgetBlockForDraftRow(db, workspaceId),
    roadmapDraftPromptFor: (workspaceId: WorkspaceId, goalNote: string, docPaths: string[], freeExplore?: boolean) =>
      roadmapDraftPromptForRow(db, workspaceId, goalNote, docPaths, freeExplore),
    saveRoadmapDraft: (workspaceId: WorkspaceId, md: string, opts?: { providerSessionId?: string; sourceSummary?: DraftSourceSummary }) =>
      saveRoadmapDraftRow(db, workspaceId, md, opts),
    clearRoadmapDraft: (workspaceId: WorkspaceId) => {
      db.prepare('DELETE FROM roadmap_draft WHERE workspace_id = ?').run(workspaceId);
    },
    decisionDocs: (workspaceId: WorkspaceId) => decisionDocsRow(db, workspaceId),
    // WO-0050 / D8 — the cwd fix: the composition root fills DriveInput.cwd from the connection
    // table through this one call (process.cwd() only when nothing matches). WO-0051 / D9: the
    // same root fills the fence's decision-store root (TD-056's alignment).
    driveCwd: (input: DriveInput) => driveCwdRow(db, input),
    decisionStoreRootFor: (input: DriveInput) => decisionStoreRootRow(db, input),
    // WO-0045 — the flow-mode gate's read (order.md front-matter at spawn time; 'auto' for absent
    // docs/keys — behavior never jumps because the app learned about tempo).
    flowModeFor: (workOrderId: WorkOrderId): 'auto' | 'manual' => {
      const dir = woDir(db, workOrderId);
      if (!dir) return 'auto';
      const { order } = readWoDocs(dir, workOrderId);
      return order ? parseOrderMd(order).flowMode : 'auto';
    },
    // WO-0045 — Sürdür's delivery source: the notes persisted on the stopped row (the SDK queue died
    // with the process — mirror is truth, probe raw/s4b-abort-pending.log). WO-0050: keyed by the
    // owner pair (an İtiraz resume re-queues carry notes like any resume).
    pendingNotesFor: (owner: SessionOwner, providerSessionId: string) => {
      const { wsId, woId } = ownerPair(db, owner);
      const r = db
        .prepare('SELECT pending_notes FROM session WHERE provider_session_id = ? AND workspace_id = ? AND work_order_id IS ?')
        .get(providerSessionId, wsId, woId) as { pending_notes: string | null } | undefined;
      if (!r?.pending_notes) return [];
      try {
        const parsed = JSON.parse(r.pending_notes) as { id: string; text: string }[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    // WO-0045 — the steer lifecycle's timeline entries (pipeline writes them beside the row records).
    recordAuditEvent: (workOrderId: WorkOrderId, kind: 'steer_queued' | 'steer_delivered' | 'steer_retracted', detail: string) => {
      appendEvent(db, workOrderId as string, kind, detail);
    },
    // WO-0045 — retract from a STOPPED drive's mirror: the row is the only queue (no runner holds the
    // note). Targeted UPDATE — never the recordSessionRow upsert, which would rewrite the whole row.
    retractSteerNote: async (workOrderId: WorkOrderId, providerSessionId: string, noteId: string): Promise<boolean> => {
      const r = db
        .prepare('SELECT pending_notes FROM session WHERE work_order_id = ? AND provider_session_id = ?')
        .get(workOrderId, providerSessionId) as { pending_notes: string | null } | undefined;
      if (!r?.pending_notes) return false;
      let notes: { id: string; text: string }[] = [];
      try {
        notes = JSON.parse(r.pending_notes);
      } catch {
        return false;
      }
      if (!Array.isArray(notes) || !notes.some((n) => n.id === noteId)) return false;
      db.prepare('UPDATE session SET pending_notes = ? WHERE work_order_id = ? AND provider_session_id = ?')
        .run(JSON.stringify(notes.filter((n) => n.id !== noteId)), workOrderId, providerSessionId);
      appendEvent(db, workOrderId as string, 'steer_retracted', `not: ${noteId}`);
      return true;
    },
    // The architect's first prompt, assembled server-side from order.md (WO-0016). The composition root
    // fills DriveInput.prompt with this when role==='architect' and the renderer sent none (mirrors the
    // cwd fill). Returns undefined when there is no order.md yet (caller leaves the prompt untouched).
    architectPromptFor: (workOrderId: WorkOrderId) => {
      const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string }
        | undefined;
      if (!wo) return undefined;
      const dir = structureRoot(db, wid(wo.workspace_id));
      const { order } = readWoDocs(dir, workOrderId);
      if (!order) return undefined;
      const parsed = parseOrderMd(order);
      const woDir = findWorkOrderDir(dir, workOrderId);
      const orderMdPath = woDir ? `${woDir}/order.md` : '';
      // WO-0070: the override is consulted FIRST, once per assembly call; absent → the built-in.
      const overrides = settingPromptOverrides(db);
      return withOverride(architectPrompt({ ...parsed, orderMdPath }), overrides?.architect);
    },
    // WO-0033: async so the duplicate-basename refusal REJECTS (the deleteWorkspace/addRepoConnection
    // ruling — a sync escape is not a promise the caller can await).
    createWorkspace: async (input: CreateWorkspaceInput): Promise<Workspace> => createWorkspaceRow(db, input),
    // M1: async so the re-point refusal REJECTS — the sync escape is not a promise the caller can
    // await (the deleteWorkspace ruling, verbatim).
    updateWorkspace: async (id: WorkspaceId, patch: { label?: string; decisionStorePath?: string }) => {
      await updateWorkspaceRow(db, id, patch);
    },
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
    // M1: async so the decision-store refusal REJECTS (the updateWorkspace ruling above).
    removeRepoConnection: async (id: WorkspaceId, path: string) => {
      await removeRepoConnectionRow(db, id, path);
    },
    repoConnections: (id: WorkspaceId) => Promise.resolve(repoConnectionsRow(db, id)),
    // The observed forge cache (WO-0064): sync writes/reads like the SessionStore half — quick
    // SQLite, no I/O beyond it; the forge itself is reached by the composition root's reconciler.
    recordForgeScan: (workspaceId, repoRemote, scan) => recordForgeScanRow(db, workspaceId, repoRemote, scan),
    recordForgeDegraded: (workspaceId, repoRemote, at, reason) =>
      recordForgeDegradedRow(db, workspaceId, repoRemote, at, reason),
    forgeView: (workspaceId) => forgeViewRow(db, workspaceId),
    forgeScanTargets: (workspaceId) => forgeScanTargetsRow(db, workspaceId),
    // The workspace's calendar-month observed spend (WO-0047) — the board/band warn line's and
    // the settings readout's figure, from the same row the gate reads.
    workspaceMonthSpend: (id: WorkspaceId) => Promise.resolve(monthSpendRow(db, id)),
    // WO-0054: the usage month — the pure derivation over the flat readers (workspaceUsageRow).
    workspaceUsage: (id: WorkspaceId) => Promise.resolve(workspaceUsageRow(db, id)),
    // WO-0072: the workspace overview — the projection assembled over the hydrate path, the
    // roadmap view and the parsed debt ledger (workspaceOverviewRow).
    workspaceOverview: (id: WorkspaceId) => Promise.resolve(workspaceOverviewRow(db, id)),
    updateRepoPath: async (id: WorkspaceId, repoId: RepoId, newPath: string) => {
      updateRepoPathRow(db, id, repoId, newPath);
    },
    // Orchestrates creation (WO-0015): resolve the decision-store path → allocate the next WO number →
    // author order.md into the working tree (no commit) → insert the observed row + tracks. The async
    // wrapper turns fs/DB errors into a rejected promise the UI can surface (modal stays open).
    createWorkOrder: async (input: CreateWorkOrderInput) => {
      // WO-0071: the dependency facts are validated BEFORE anything is written — a refusal leaves
      // no WO row, no track_depends_on rows, no order.md. The store throws the FIRST message
      // (the createWorkOrder throw style; the full list stays the validator's).
      const problems = validateTrackDependencies(input.trackDependencies, input.trackRepos);
      if (problems.length > 0) throw new Error(`createWorkOrder: ${problems[0]}`);
      // WO-0088 rev: the cwd override is refused BEFORE any write — a bad path must not author an
      // order.md pointing the drive (and its fence) at nothing.
      if (input.cwd !== undefined) {
        const why = cwdOverrideRefusal(input.cwd);
        if (why) throw new Error(`createWorkOrder: ${why}`);
      }
      refuseDisconnectedStore(db, input.workspaceId);
      const dir = structureRoot(db, input.workspaceId);
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
          ...(input.flowMode === 'manual' ? { flowMode: input.flowMode } : {}),
          ...(input.permissionRule ? { permissionRule: input.permissionRule } : {}),
          ...(input.taskRef ? { taskRef: input.taskRef } : {}),
          ...(input.issueRef ? { issueRef: input.issueRef } : {}),
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.trackDependencies
            ? {
                trackDependencies: input.trackDependencies.map((d) => ({
                  repo: d.repo as string,
                  dependsOn: d.dependsOn.map((x) => x as string),
                })),
              }
            : {}),
        }),
      );
      const created = createWorkOrderRow(db, { ...input, id });
      appendEvent(db, id as string, 'created', input.title);
      return created;
    },
    // WO-0092: the issue-link join read — the workspace's own structure root only (one readdir +
    // one order.md read per WO, the TD-055 shape). Keyed by woId; unlinked WOs are absent.
    woIssueRefs: (id: WorkspaceId) => {
      const refs = scanIssueRefs(structureRoot(db, id));
      const out: Record<string, string> = {};
      for (const [woId, ref] of refs) out[woId] = ref;
      return Promise.resolve(out);
    },
    // Approve the architect's proposed plan (WO-0016): write plan.md into the working tree (no commit)
    // and flip the plan_approval gate. Errors (missing WO dir / fs failure) → rejected promise the UI surfaces.
    approvePlan: async (workOrderId: WorkOrderId, planText: string, opts?: { editedCount?: number }) => {
      const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string }
        | undefined;
      if (!wo) throw new Error(`approvePlan: work order ${workOrderId} not found`);
      refuseDisconnectedStore(db, wid(wo.workspace_id));
      const dir = structureRoot(db, wid(wo.workspace_id));
      writePlanMdById(dir, workOrderId, planText);
      db.prepare('UPDATE work_order SET gate_plan_approved = 1 WHERE id = ?').run(workOrderId);
      appendEvent(db, workOrderId as string, 'plan_approved', opts?.editedCount !== undefined ? `edited:${opts.editedCount}` : '');
    },
    // "Bitti = kaydet" (2026-08-23): persist the operator's edited steps as the PENDING plan —
    // the same write the pipeline's plan_ready fold makes (plan.md + plan_saved), no gate flip.
    // The memory-only editor stage died with navigation, silently discarding "saved" edits.
    // The FIRST operator overwrite snapshots the agent's proposal (plan_original) — the restore
    // action's source ("ilk öneriye dön").
    savePlanDraft: async (workOrderId: WorkOrderId, planText: string) => {
      const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string }
        | undefined;
      if (!wo) throw new Error(`savePlanDraft: work order ${workOrderId} not found`);
      refuseDisconnectedStore(db, wid(wo.workspace_id));
      const dir = structureRoot(db, wid(wo.workspace_id));
      const current = readWoDocs(dir, workOrderId).plan;
      if (current) {
        db.prepare('INSERT OR IGNORE INTO plan_original (work_order_id, plan_text, at) VALUES (?,?,?)').run(
          workOrderId,
          current,
          new Date().toISOString(),
        );
      }
      writePlanMdById(dir, workOrderId, planText);
      appendEvent(db, workOrderId as string, 'plan_saved', 'operator-edit');
    },
    // "İlk öneriye dön" (2026-08-23): the agent's snapshotted original, if one exists.
    getOriginalPlan: (workOrderId: WorkOrderId) => {
      const row = db.prepare('SELECT plan_text FROM plan_original WHERE work_order_id = ?').get(workOrderId) as
        | { plan_text: string }
        | undefined;
      return Promise.resolve(row?.plan_text ?? null);
    },
    // Restore writes the original back as the pending plan (plan.md + plan_saved) — the operator's
    // saved edits are discarded, the approval gate is untouched.
    restoreOriginalPlan: async (workOrderId: WorkOrderId) => {
      const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string }
        | undefined;
      if (!wo) throw new Error(`restoreOriginalPlan: work order ${workOrderId} not found`);
      const row = db.prepare('SELECT plan_text FROM plan_original WHERE work_order_id = ?').get(workOrderId) as
        | { plan_text: string }
        | undefined;
      if (!row) throw new Error(`restoreOriginalPlan: no original plan for ${workOrderId}`);
      refuseDisconnectedStore(db, wid(wo.workspace_id));
      const dir = structureRoot(db, wid(wo.workspace_id));
      writePlanMdById(dir, workOrderId, row.plan_text);
      appendEvent(db, workOrderId as string, 'plan_saved', 'restored-original');
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
      refuseDisconnectedStore(db, wid(wo.workspace_id));
      const dir = structureRoot(db, wid(wo.workspace_id));
      const { order } = readWoDocs(dir, workOrderId);
      if (!order) throw new Error(`updateWorkOrder: order.md not found for ${workOrderId}`);
      // WO-0088 rev: the same safe gate on the edit path — a string sets (validated), null drops.
      if (typeof patch.cwd === 'string') {
        const why = cwdOverrideRefusal(patch.cwd);
        if (why) throw new Error(`updateWorkOrder: ${why}`);
      }
      const next = applyOrderMdEdits(order, patch);
      if (next !== order) writeOrderMdById(dir, workOrderId, next);
      if (patch.title !== undefined) db.prepare('UPDATE work_order SET title = ? WHERE id = ?').run(patch.title, workOrderId);
      const fields = [
        patch.title !== undefined ? 'title' : null,
        patch.description !== undefined ? 'description' : null,
        patch.reviewMode !== undefined ? 'review_mode' : null,
        patch.flowMode !== undefined ? 'flow_mode' : null,
        patch.taskRef !== undefined ? 'task' : null,
        patch.cwd !== undefined ? 'cwd' : null,
      ].filter((f): f is string => f !== null);
      if (fields.length > 0) appendEvent(db, workOrderId as string, 'wo_edited', fields.join(' · '));
      if (patch.permissionRule !== undefined) appendEvent(db, workOrderId as string, 'rule_changed', patch.permissionRule);
      // WO-0045: the tempo switch is its own auditable fact (the rule_changed pattern), not a mere edit —
      // the operator reads the mode history in the timeline.
      if (patch.flowMode !== undefined) appendEvent(db, workOrderId as string, 'flow_mode_changed', patch.flowMode);
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
    closeWorkOrder: async (workOrderId: WorkOrderId, note: string, evidence?: ClosureEvidence) => {
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
      refuseDisconnectedStore(db, wid(wo.workspace_id));
      const dir = structureRoot(db, wid(wo.workspace_id));
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
      // WO-0069: the `= 1` attestation is GONE — gate_verifier_resolvable is the record-time
      // computation's (recordStepReportRow); closure writes only the docs sha. A legacy row keeps
      // whatever value it closed with — no backfill, either direction.
      db.prepare('UPDATE work_order SET gate_closure_docs_sha = ? WHERE id = ?').run(sha, workOrderId);
      appendEvent(db, workOrderId as string, 'closed', sha);
      // WO-0065: the closure's OBSERVED fact — what the forge SAW, handed in by the composition
      // root (the only place that owns the forge). Absent input = the legacy attested close
      // (the CLI/test path): no event, nothing claimed. The detail carries targets and
      // messages only — never auth output (the Records line).
      if (evidence) appendEvent(db, workOrderId as string, 'forge_merge', JSON.stringify(evidence));
    },

    // WO-0065: the composition root's closure-look input — the WO's workspace connection rows
    // (remote + path), resolved to ForgeTargets main-side (the adapter parse lives there).
    forgeScanTargetsForWorkOrder: (workOrderId: WorkOrderId) => {
      const wo = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string }
        | undefined;
      return wo ? forgeScanTargetsRow(db, wid(wo.workspace_id)) : [];
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

    getPermissionRule: () => Promise.resolve(settingPermissionRule(db)),
    setPermissionRule: (rule: PermissionRule) => {
      db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run('permission_rule', rule);
      return Promise.resolve();
    },
    getLocale: () => Promise.resolve(settingLocale(db)),
    setLocale: (locale: Locale) => {
      db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run('locale', locale);
      return Promise.resolve();
    },
    // WO-0059 rev 2: the per-role model preference — ONE atomic JSON row (the budget posture);
    // undefined or a map with no usable role clears the row entirely.
    getModels: () => Promise.resolve(settingModels(db)),
    setModels: (models: RoleModels | undefined) => {
      const clean: RoleModels = {};
      if (models) {
        for (const [role, id] of Object.entries(models)) {
          if (!MODEL_ROLES.has(role) || typeof id !== 'string') continue;
          const trimmed = id.trim();
          if (trimmed) clean[role as keyof RoleModels] = trimmed;
        }
      }
      if (Object.keys(clean).length === 0) db.prepare('DELETE FROM app_setting WHERE key = ?').run('models');
      else db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run('models', JSON.stringify(clean));
      return Promise.resolve();
    },
    // WO-0070: the whole-text prompt overrides — ONE atomic JSON row (the models posture); a map
    // with no usable key clears the row entirely, undefined clears all, a per-key clear sends the
    // object minus that key. Bodies ride verbatim; only shape is normalized.
    getPromptOverrides: () => Promise.resolve(settingPromptOverrides(db)),
    setPromptOverrides: (overrides: PromptOverrides | undefined) => {
      const clean: PromptOverrides = {};
      if (overrides) {
        for (const [key, body] of Object.entries(overrides)) {
          if (!PROMPT_OVERRIDE_KEYS.has(key) || typeof body !== 'string') continue;
          if (body.trim() === '') continue;
          clean[key as keyof PromptOverrides] = body;
        }
      }
      if (Object.keys(clean).length === 0) db.prepare('DELETE FROM app_setting WHERE key = ?').run('prompt_overrides');
      else db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run('prompt_overrides', JSON.stringify(clean));
      return Promise.resolve();
    },
    // The workspace's month-spend threshold (WO-0047): one atomic JSON pair per workspace; a
    // permanent write (raise-and-re-run is a settings action, operator ruling 2026-08-26).
    getBudget: (workspaceId: WorkspaceId) => Promise.resolve(settingBudget(db, workspaceId)),
    setBudget: (workspaceId: WorkspaceId, threshold: BudgetThreshold | undefined) => {
      const key = `budget:${workspaceId}`;
      if (threshold === undefined) db.prepare('DELETE FROM app_setting WHERE key = ?').run(key);
      else db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run(key, JSON.stringify(threshold));
      return Promise.resolve();
    },
    getDocsRoot: (workspaceId: WorkspaceId) => Promise.resolve(settingDocsRoot(db, workspaceId)),
    setDocsRoot: async (workspaceId: WorkspaceId, root: string | undefined): Promise<void> => {
      const key = `docs_root:${workspaceId}`;
      if (root === undefined) db.prepare('DELETE FROM app_setting WHERE key = ?').run(key);
      else {
        const normalized = normalizeDocsRoot(root);
        if (normalized === undefined) {
          throw new Error(`setDocsRoot: '${root}' is not a safe relative root — no '..', no absolutes, no empty`);
        }
        db.prepare('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)').run(key, normalized);
      }
    },
    getPermissionRuleFor: (workOrderId: WorkOrderId) => Promise.resolve(effectivePermissionRule(db, workOrderId)),
    woRepoPaths: (workOrderId: WorkOrderId) => woRepoPaths(db, workOrderId),
    // WO-0089 — the declared gate commands for the gate runner. [] when nothing (or nothing
    // readable) is declared: Docket only runs what parsed — an invalid declaration never spawns
    // commands, it refuses through the evidence face instead.
    gateCommandsFor: (workOrderId: WorkOrderId) => {
      const ws = db.prepare('SELECT workspace_id FROM work_order WHERE id = ?').get(workOrderId) as
        | { workspace_id: string }
        | undefined;
      if (!ws) return [];
      const config = gateConfigFor(db, wid(ws.workspace_id));
      return config.kind === 'declared' ? config.commands : [];
    },
    // WO-0089 — record DOCKET'S OWN measurement of the declared gate commands (latest-wins per
    // track). The row resolves the track by (work order, repo slug) — never invents one.
    recordLocalGateRun: (workOrderId: WorkOrderId, repo: RepoId, run: { sha: string; at: string; results: GateCommandResult[] }) => {
      const track = db.prepare('SELECT id FROM track WHERE work_order_id = ? AND repo = ?').get(workOrderId, repo) as
        | { id: string }
        | undefined;
      if (!track) throw new Error(`recordLocalGateRun: no track for ${workOrderId} repo ${repo}`);
      db.prepare(
        'INSERT OR REPLACE INTO local_gate_run (track_id, work_order_id, repo, sha, results, observed_at) VALUES (?,?,?,?,?,?)',
      ).run(track.id, workOrderId, repo, run.sha, JSON.stringify(run.results), run.at);
    },
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
    // WO-0038 incident guard: the pipeline refuses step/review drives while the plan gate is closed.
    // A missing work order reads as closed (never approved) — fail closed.
    planApprovedFor: (workOrderId: WorkOrderId) =>
      (db.prepare('SELECT gate_plan_approved AS g FROM work_order WHERE id = ?').get(workOrderId) as { g: number } | undefined)?.g === 1,
    // The BUDGET gate (WO-0047) — the pipeline's FIRST gate, ahead of the plan gate: month spend
    // at the workspace cap refuses every drive before the runner spawns. Warn never blocks.
    budgetBlockFor: (workOrderId: WorkOrderId) => budgetBlockForWo(db, workOrderId),
    // A step verdict body, read at view time (WO-0020). '' when the verdict is absent.
    getStepVerdict: (id: WorkOrderId, idx: number) => {
      const dir = woDir(db, id);
      return Promise.resolve(dir ? readStepVerdict(dir, id, idx) : '');
    },
    // Reset a step to pending (WO-0020 revise path) — deletes the observed row; files are overwritten on re-run.
    resetStep: (id: WorkOrderId, idx: number) => Promise.resolve(resetStepRow(db, id, idx)),
    // Persist the proposed plan to plan.md as PENDING (gate 0) on plan_ready — survives restart (WO-0020/TD-025).
    // approvePlan re-writes + flips the gate; idempotent if called again with the same text.
    // 2026-08-23 ("ilk öneriye dön"): a fresh AGENT proposal is the new original — any operator-edit
    // snapshot is cleared so restore always means "the agent's latest proposal".
    // WO-0039 stabilization (2026-08-23, the overwrite incident): a plan that PARSES never falls to a
    // plan that does NOT. A post-stop resume once re-submitted ExitPlanMode with "bekliyorum" and
    // clobbered the real plan.md; this mechanical guard (no judgment — parsePlanSteps both sides)
    // is the store's own layer under the prompt rule and the question-card gate.
    savePendingPlan: (workOrderId: WorkOrderId, planText: string) => {
      // (event appended after the write below)
      const dir = woDir(db, workOrderId);
      if (!dir) return; // no WO dir yet — nothing to persist to
      const current = readWoDocs(dir, workOrderId).plan;
      if (current && parsePlanSteps(current).length > 0 && parsePlanSteps(planText).length === 0) {
        appendEvent(db, workOrderId as string, 'plan_save_refused');
        return; // disk keeps the real plan; the original snapshot stays too
      }
      db.prepare('DELETE FROM plan_original WHERE work_order_id = ?').run(workOrderId);
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
