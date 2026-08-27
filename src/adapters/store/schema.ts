// SQLite schema (WO-0009). The split is the schema's shape, not a comment (ADR-0010
// "schema encodes ownership"):
// - OBSERVED tables cache what git and the forge said; every row carries observed_at.
//   Discardable by definition — dropping them all and re-scanning loses only time.
// - OWNED tables hold Docket's decisions (session ids/role/scope, connections); the only
//   thing a backup is for.
// No document text is stored (read at view time). No observed table has a `stage` column
// (stage is derived — src/core/derive.ts deriveStage).

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  decision_store TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_repo (
  workspace_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, repo_id)
);
CREATE TABLE IF NOT EXISTS work_order (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('plan','direct')),
  gate_plan_approved INTEGER NOT NULL,
  gate_verifier_resolvable INTEGER,
  gate_closure_docs_sha TEXT,
  -- cost_* are inert (TD-023): a work order's cost is DERIVED from its session rows at hydrate
  -- (ADR-0010 rule 2, same as stage), not stored here. Kept and seeded 0 because SQLite cannot
  -- drop NOT NULL columns without a table rebuild.
  cost_tokens_in INTEGER NOT NULL,
  cost_tokens_out INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_order_source (
  work_order_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  ref TEXT NOT NULL,
  PRIMARY KEY (work_order_id, idx)
);
CREATE TABLE IF NOT EXISTS track (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  pr_url TEXT,
  pr_head_sha TEXT,
  ci_kind TEXT NOT NULL CHECK (ci_kind IN ('run','exempt')),
  ci_blob TEXT NOT NULL,
  merged_at TEXT,
  observed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS track_depends_on (
  track_id TEXT NOT NULL,
  depends_on_track_id TEXT NOT NULL,
  PRIMARY KEY (track_id, depends_on_track_id)
);
CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_session_id TEXT,
  -- WO-0050: every session belongs to exactly one OWNER — a work order or (the roadmap draft
  -- drive) a workspace. workspace_id is backfilled through the WO join on migration (sessions
  -- cascade-delete before their work order, so the subselect resolves for every legacy row);
  -- work_order_id goes NULL for a draft session. Draft rows are invisible to every WO hydrate
  -- (WHERE work_order_id = ?) and COUNT in the workspace month-spend sum (WHERE workspace_id = ?).
  workspace_id TEXT NOT NULL,
  work_order_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('implementer','architect','verifier')),
  scope_track_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','stopped_asking','idle','stopped','none')),
  transcript TEXT NOT NULL,
  stop_and_ask TEXT,
  pending_notes TEXT,    -- queued steer notes JSON (WO-0045) — LATEST-WINS unlike transcript/cost: the live
                         -- fold overwrites it (deliveries shrink it); the SDK queue is truth while running,
                         -- this row is the truth across a stop (mirror-is-truth, probe raw/s4b)
  cost_tokens_in INTEGER,
  cost_tokens_out INTEGER,
  cost_usd REAL,
  started_at TEXT,          -- ISO drive start (WO-0027 / İstek 7)
  ended_at TEXT,            -- ISO terminal end; NULL while live
  step_idx INTEGER -- the plan step this session runs (WO-0017); NULL for the architect plan session + free-form runs
);
-- A plan step's RUN OUTCOME (WO-0017). Observed + discardable: the specs (role/aim/scope) are parsed from
-- plan.md at view time (ADR-0010 rules 1 & 2 — no document text / no derived data stored), so this table
-- holds only what isn't re-derivable — the status + report pointer. A row exists only for steps that have
-- run; 'pending' is the absence of a row and 'blocked' is derived from an unresolvable scope.
CREATE TABLE IF NOT EXISTS work_order_step (
  work_order_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','done')),
  report_path TEXT,
  verdict TEXT,          -- 'proceed' | 'revise' | NULL (the architect's review outcome; WO-0020)
  verdict_path TEXT,     -- 'verdicts/step-NN.md' | NULL
  observed_at TEXT NOT NULL,
  PRIMARY KEY (work_order_id, idx)
);
-- The AGENT's original proposed plan (2026-08-23, "ilk öneriye dön"): snapshotted the first time
-- an operator edit is about to overwrite plan.md, cleared whenever the architect re-proposes.
-- Document text in the DB is ADR-0010's line — this is not the live document (plan.md stays the
-- truth); it is the one historical fact the restore action needs and git cannot give mid-flight.
CREATE TABLE IF NOT EXISTS plan_original (
  work_order_id TEXT PRIMARY KEY,
  plan_text TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS connection (
  workspace_id TEXT NOT NULL,
  repo_remote TEXT NOT NULL,
  local_path TEXT NOT NULL,
  PRIMARY KEY (workspace_id, repo_remote)
);
-- Operator app preferences (WO-0025): a third ADR-0010 category — neither a git-observed fact nor a
-- decision about work; machine-local app configuration (e.g. the provider API key). Key-value rows.
-- WO lifecycle event log (WO-0030 / İstek 8): append-only audit of the operator/system actions —
-- created/plan/step/verdict/closure + the WO-0031c edit/permission kinds (wo_edited, rule_changed,
-- permission_decision). OWNED: it is Docket's own record of its decisions (ADR-0010), never mutated,
-- never derived. M3's forge events (pr/ci/merge) join this table.
CREATE TABLE IF NOT EXISTS wo_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created','plan_saved','plan_save_refused','plan_approved','step_started','step_done','step_verdict','verdict_overridden','closed','wo_edited','rule_changed','permission_decision','steer_queued','steer_delivered','steer_retracted','flow_mode_changed')),
  detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- The workspace's PENDING roadmap draft (WO-0050, ADR-0016): the ✦ architect session's proposal,
-- held until the operator decides (Onayla writes roadmap.md and deletes the row; İtiraz resumes
-- the session named by provider_session_id; a fresh draft supersedes). ONE row per workspace.
-- Document text in the DB under the plan_original carve-out: a PENDING proposal, never the live
-- document — roadmap.md stays the truth, written only by the parse-guarded save at approval.
CREATE TABLE IF NOT EXISTS roadmap_draft (
  workspace_id TEXT PRIMARY KEY,
  md TEXT NOT NULL,
  provider_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// Drop order respects dependencies (children first). Foreign keys are documented, not
// enforced (SQLite default), so this is belt-and-braces.
export const OBSERVED_TABLES = [
  'track_depends_on',
  'track',
  'work_order_source',
  'work_order_step',
  'work_order',
  'workspace_repo',
  'workspace',
] as const;

// Synthetic, for the fixture-era seed. M3 writes the real observation time.
export const SEED_OBSERVED_AT = '2026-08-05T00:00:00Z';
