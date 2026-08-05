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
  work_order_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('implementer','architect','verifier')),
  scope_track_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','stopped_asking','idle','none')),
  transcript TEXT NOT NULL,
  stop_and_ask TEXT,
  cost_tokens_in INTEGER,
  cost_tokens_out INTEGER,
  cost_usd REAL
);
CREATE TABLE IF NOT EXISTS connection (
  workspace_id TEXT NOT NULL,
  repo_remote TEXT NOT NULL,
  local_path TEXT NOT NULL,
  PRIMARY KEY (workspace_id, repo_remote)
);
`;

// Drop order respects dependencies (children first). Foreign keys are documented, not
// enforced (SQLite default), so this is belt-and-braces.
export const OBSERVED_TABLES = [
  'track_depends_on',
  'track',
  'work_order_source',
  'work_order',
  'workspace_repo',
  'workspace',
] as const;

export const OWNED_TABLES = ['session', 'connection'] as const;

// Synthetic, for the fixture-era seed. M3 writes the real observation time.
export const SEED_OBSERVED_AT = '2026-08-05T00:00:00Z';
