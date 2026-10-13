// Ordered schema migrations; openDatabase applies them against PRAGMA user_version.
export interface Migration {
  readonly version: number;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `CREATE TABLE work_orders (id TEXT PRIMARY KEY, project TEXT NOT NULL DEFAULT '', repo TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX work_orders_by_project ON work_orders (project, created_at, id);
CREATE INDEX work_orders_by_repo ON work_orders (repo, created_at, id);
CREATE TABLE work_order_events (work_order_id TEXT NOT NULL REFERENCES work_orders (id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (work_order_id, seq));
CREATE TABLE runs (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_orders (id), started_at INTEGER NOT NULL, ended_at INTEGER, data TEXT NOT NULL);
CREATE INDEX runs_by_work_order ON runs (work_order_id, started_at, id);
CREATE INDEX runs_active ON runs (started_at, id) WHERE ended_at IS NULL;
CREATE TABLE run_events (run_id TEXT NOT NULL REFERENCES runs (id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, seq));
CREATE TABLE run_handoff (run_id TEXT PRIMARY KEY REFERENCES runs (id), note TEXT, stage_base TEXT);
CREATE TABLE audit (id TEXT PRIMARY KEY, at INTEGER NOT NULL, subject_kind TEXT NOT NULL, subject_key TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX audit_by_subject ON audit (subject_kind, subject_key, at DESC, id DESC);
CREATE TABLE accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE pools (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX pools_by_account ON pools (account_id);
CREATE TABLE meters (id TEXT PRIMARY KEY, pool_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX meters_by_pool ON meters (pool_id);
CREATE TABLE spend (seq INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', repo TEXT NOT NULL, work_order_id TEXT NOT NULL, at INTEGER NOT NULL, usd REAL NOT NULL, conversation TEXT);
CREATE INDEX spend_by_time ON spend (at);
CREATE TABLE bindings (level TEXT NOT NULL, scope_key TEXT NOT NULL, role TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (level, scope_key, role));
CREATE TABLE queue_items (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE proposals (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE secrets (ref TEXT PRIMARY KEY, blob BLOB NOT NULL);
CREATE TABLE repo_registry (repo_id TEXT PRIMARY KEY, slug TEXT NOT NULL, path TEXT NOT NULL, data TEXT NOT NULL);
CREATE UNIQUE INDEX repo_registry_by_slug ON repo_registry (slug);
CREATE TABLE projects (slug TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE project_repos (project TEXT NOT NULL REFERENCES projects (slug), repo TEXT NOT NULL, PRIMARY KEY (project, repo));
CREATE INDEX project_repos_by_repo ON project_repos (repo);
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT);
CREATE TABLE phase_auto_runs (project TEXT NOT NULL, phase TEXT NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, attention_json TEXT NOT NULL, PRIMARY KEY (project, phase));
CREATE TABLE pages (id TEXT PRIMARY KEY, work_order TEXT, project TEXT, conversation TEXT, data TEXT NOT NULL);
CREATE INDEX pages_by_work_order ON pages (work_order, id);
CREATE INDEX pages_by_project ON pages (project, id);
CREATE TABLE page_comments (id TEXT PRIMARY KEY, page TEXT NOT NULL, version INTEGER NOT NULL, delivered_at INTEGER, data TEXT NOT NULL);
CREATE INDEX page_comments_by_page ON page_comments (page, id);
CREATE TABLE conversations (id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL, scope_ref TEXT NOT NULL, updated_at INTEGER NOT NULL, pinned INTEGER NOT NULL, search_text TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX conversations_by_scope ON conversations (scope_kind, scope_ref);
CREATE INDEX conversations_by_updated ON conversations (updated_at);
CREATE TABLE drafts (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX drafts_by_conversation ON drafts (conversation, id);
CREATE TABLE actions (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, status TEXT NOT NULL, proposed_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX actions_by_conversation ON actions (conversation, status);`,
  },
];
