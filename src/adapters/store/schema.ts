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
-- The OBSERVED local-gate measurement (WO-0089): ONE latest-wins row per track — what DOCKET
-- itself measured running the workspace's declared gate commands (never the session). The
-- DECLARATION is not here (it lives in the decision store's .workflow/workspace.yaml, read at
-- view time — ADR-0010 rule 1); this row is only the measurement, keyed to the sha it ran at.
-- Discardable with the rest of the observed tables (a re-run rewrites it).
CREATE TABLE IF NOT EXISTS local_gate_run (
  track_id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  results TEXT NOT NULL,      -- JSON GateCommandResult[] (exit + bounded tail, verbatim data)
  observed_at TEXT NOT NULL   -- the measurement's ISO stamp
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
  step_idx INTEGER,         -- the plan step this session runs (WO-0017); NULL for the architect plan session + free-form runs
  -- WO-0052 usage checkpoints, BOTH latest-wins and NULL = honestly absent (pre-WO-0052 rows and
  -- drives that never observed a reading/usage — never backfilled, never zeroed):
  ctx_used_tokens INTEGER,  -- the LATEST context-window reading (written at each record)
  ctx_max_tokens INTEGER,   -- the window the latest reading reports against
  final_model_usage TEXT,   -- the last observed rich usage detail (JSON TurnUsage; legs overwrite)
  limit_reset_at TEXT,      -- WO-0053: when this session died on the provider's usage limit, the neutral ISO
                            -- stamp of when the window opens (the card re-derives after a restart). CLEARED
                            -- by a later clean leg — a stale stamp is a lie (unlike the ctx pair above,
                            -- which keeps: it is the last observation). NULL = no limit stop.
  backend_profile TEXT,     -- WO-0098: the backend profile NAME that drove the latest leg (NULL = the built-in
                            -- passthrough); CLEARED by a passthrough leg — never a stale claim
  driver_vendor TEXT,       -- WO-0104: the resolved driver route's VENDOR id (adapter-minted DATA; NULL = the
                            -- built-in adapter); CLEARED by a built-in leg — the backend_profile rule
  reported_model TEXT       -- WO-0098: the model the session itself REPORTED at open (DATA, verbatim) — the
                            -- evidence of which backend the spawn reached, never a config echo
);
-- WO-0052: ONE row per OBSERVED provider result (a turn_complete, including the HELD intermediates
-- of a steered drive). OWNED half (not in OBSERVED_TABLES): provider-observed but NOT re-derivable —
-- a reseed never drops it. Append-only (never updated, never deleted by the session upsert); a
-- resume leg appends to the SAME session, its deltas being that leg's own spend under the per-leg
-- applyResultCost baseline (no double-count). usd_delta is the per-turn delta — NOT the cumulative
-- figure session.cost_usd carries. cache_*/num_turns/duration_*/model/model_usage are
-- NULL when the result did not report them (honest absent); model is set only for a single-model
-- result, the verbatim multi-model split lives in model_usage (JSON). Metrics only (CLAUDE.md
-- Records rule): token counts, durations, model-id strings as data.
CREATE TABLE IF NOT EXISTS session_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  work_order_id TEXT,             -- NULL for a draft session (the owner pair) — invisible to every WO read
  provider_session_id TEXT NOT NULL,
  at TEXT NOT NULL,               -- the result's ISO receive stamp
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  usd_delta REAL NOT NULL,
  cache_read INTEGER,
  cache_creation INTEGER,
  num_turns INTEGER,              -- leg-cumulative-so-far; persisted verbatim, never summed by Docket
  duration_ms INTEGER,            -- leg-cumulative-so-far; never summed (wall time lives on the session row)
  duration_api_ms INTEGER,
  model TEXT,                     -- the single-model shortcut; NULL for 0-or-multi-model results
  model_usage TEXT                -- the verbatim per-model split (JSON ModelUsageLine[])
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
-- The OBSERVED forge cache (WO-0064, ADR-0010's forge half): one scan row per connected repo
-- (health + the last-looked stamp), the scan's open-PR page (REPLACED each ok scan — a PR fallen
-- off the open page is absent: observation wins), and the open heads' check runs. A DEGRADED scan
-- touches forge_scan ONLY — prior facts stay (the wipe would be the lie). Discardable: dropping
-- all three and re-scanning loses nothing but time (OBSERVED_TABLES).
CREATE TABLE IF NOT EXISTS forge_scan (
  workspace_id TEXT NOT NULL,
  repo_remote TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','degraded')),
  reason TEXT,                -- the degraded reason verbatim (stderr line / JSON message); NULL on ok
  observed_at TEXT NOT NULL,  -- the LAST attempt, ok or degraded — the «son gözlem» stamp
  issue_reason TEXT,          -- WO-0092 m4: the ISOLATED issue-look failure (status stays ok; prior
                              -- forge_issue rows stay); NULL = the issue page is scan-fresh
  PRIMARY KEY (workspace_id, repo_remote)
);
CREATE TABLE IF NOT EXISTS forge_pr (
  workspace_id TEXT NOT NULL,
  repo_remote TEXT NOT NULL,
  number INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open','closed','merged')),
  title TEXT,
  head_sha TEXT NOT NULL,
  head_branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  review_decision TEXT,
  merged_at TEXT,
  merge_sha TEXT,
  url TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, repo_remote, number)
);
CREATE TABLE IF NOT EXISTS forge_check (
  workspace_id TEXT NOT NULL,
  repo_remote TEXT NOT NULL,
  sha TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT,            -- NULL while the run has no conclusion yet (honest absent)
  observed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, repo_remote, sha, name)
);
-- The observed ISSUE cache (WO-0092): forge_pr's discipline mirrored — the scan's open-issue page
-- (REPLACED each ok scan; an issue fallen off the open page is absent), one row per issue, the
-- row's DISPLAY facts + the 'owner/repo#N' ref text (the view-time join key; byte-identical to
-- the order.md issue: front-matter value). A body NEVER enters this table (the WO-0081 report
-- §3 ruling — the body is the spawn-time drill-down's single fetch). Fields no v1 view reads
-- (state_reason, timestamps beyond updated_at, closedByPrs) stay port-only. Discardable with
-- forge_scan/forge_pr/forge_check (OBSERVED_TABLES); a degraded scan touches forge_scan ONLY.
CREATE TABLE IF NOT EXISTS forge_issue (
  workspace_id TEXT NOT NULL,
  repo_remote TEXT NOT NULL,
  number INTEGER NOT NULL,
  ref TEXT NOT NULL,          -- 'owner/repo#N' — the join key the front-matter carries verbatim
  state TEXT NOT NULL CHECK (state IN ('open','closed')),
  title TEXT,
  url TEXT NOT NULL,
  labels TEXT NOT NULL,       -- JSON array of names (colors never leave the adapter)
  milestone_title TEXT,
  updated_at TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, repo_remote, number)
);
-- Operator app preferences (WO-0025): a third ADR-0010 category — neither a git-observed fact nor a
-- decision about work; machine-local app configuration (e.g. the provider API key). Key-value rows.
-- WO lifecycle event log (WO-0030 / İstek 8): append-only audit of the operator/system actions —
-- created/plan/step/verdict/closure + the WO-0031c edit/permission kinds (wo_edited, rule_changed,
-- permission_decision). OWNED: it is Docket's own record of its decisions (ADR-0010), never mutated,
-- never derived. M3's forge events (pr/ci/merge) join this table: forge_merge (WO-0065) records
-- what the closure SAW on the forge — the observed merge, the honest absence, or the unknown.
CREATE TABLE IF NOT EXISTS wo_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created','plan_saved','plan_save_refused','plan_approved','step_started','step_done','step_verdict','verdict_overridden','closed','wo_edited','rule_changed','permission_decision','steer_queued','steer_delivered','steer_retracted','flow_mode_changed','forge_merge','finding_dismissed')),
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
  -- WO-0051 / D2: the source composition's memory — COUNTS + the explore flag (JSON), never a
  -- path (mockup karar 5). Nullable: pre-WO-0051 rows and an İtiraz resume's summary-less write
  -- keep NULL/prior; the card's kaynak line omits honestly. Dies with the row at approval.
  source_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- WO-0099: Findings parsed from step reports (the bulgular fence). Consumed (into WOs) or
-- dismissed rows die. The pointer is the path:line pair. The source is the session ID that
-- reported it. The uniqueness constraint prevents proposing the SAME finding twice across re-runs.
CREATE TABLE IF NOT EXISTS pending_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  pointer TEXT NOT NULL,
  problem TEXT NOT NULL,
  source_session_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (work_order_id, repo, pointer)
);
-- WO-0102 (ADR-0020 #3): the paired-device registry. OWNED rows in the app-home db — Docket's
-- own record of which devices it trusts. key_hash is SHA-256(deviceKey) hex: the plaintext key
-- exists only in the /pair response and on the phone (Records & PRs, extended by ADR-0020 #3);
-- no key, token or hash ever enters an event or a log line.
CREATE TABLE IF NOT EXISTS device (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
-- WO-0102: the ONE live pairing grant (minting supersedes — mint deletes prior rows). The
-- single-use/TTL/attempt-cap state machine is core's pairingVerdict; this row is its persisted
-- state. A crashed-stale row is inert (an expired read is dead) and dies at the next mint.
CREATE TABLE IF NOT EXISTS pairing_token (
  code TEXT PRIMARY KEY,
  attempts_left INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`;

// Drop order respects dependencies (children first). Foreign keys are documented, not
// enforced (SQLite default), so this is belt-and-braces.
export const OBSERVED_TABLES = [
  'forge_check',
  'forge_issue',
  'forge_pr',
  'forge_scan',
  'local_gate_run',
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
