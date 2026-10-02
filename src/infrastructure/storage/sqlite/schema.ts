// Ordered schema migrations; openDatabase applies them against PRAGMA user_version.
export interface Migration {
  readonly version: number;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `CREATE TABLE work_orders (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX work_orders_by_workspace ON work_orders (workspace, created_at, id);
CREATE TABLE work_order_events (work_order_id TEXT NOT NULL REFERENCES work_orders (id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (work_order_id, seq));
CREATE TABLE runs (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_orders (id), started_at INTEGER NOT NULL, ended_at INTEGER, data TEXT NOT NULL);
CREATE INDEX runs_by_work_order ON runs (work_order_id, started_at, id);
CREATE INDEX runs_active ON runs (started_at, id) WHERE ended_at IS NULL;
CREATE TABLE run_events (run_id TEXT NOT NULL REFERENCES runs (id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, seq));
CREATE TABLE audit (id TEXT PRIMARY KEY, at INTEGER NOT NULL, subject_kind TEXT NOT NULL, subject_key TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX audit_by_subject ON audit (subject_kind, subject_key, at DESC, id DESC);
CREATE TABLE accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE pools (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX pools_by_account ON pools (account_id);
CREATE TABLE meters (id TEXT PRIMARY KEY, pool_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX meters_by_pool ON meters (pool_id);
CREATE TABLE spend (seq INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, workspace TEXT NOT NULL, work_order_id TEXT NOT NULL, at INTEGER NOT NULL, usd REAL NOT NULL);
CREATE INDEX spend_by_time ON spend (at);
CREATE TABLE bindings (level TEXT NOT NULL, scope_key TEXT NOT NULL, role TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (level, scope_key, role));
CREATE TABLE queue_items (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE proposals (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE secrets (ref TEXT PRIMARY KEY, blob BLOB NOT NULL);
CREATE TABLE workspaces (slug TEXT PRIMARY KEY, path TEXT NOT NULL);`,
  },
  {
    version: 2,
    sql: `ALTER TABLE workspaces RENAME TO repos;
ALTER TABLE work_orders RENAME COLUMN workspace TO repo;
ALTER TABLE work_orders ADD COLUMN project TEXT NOT NULL DEFAULT '';
ALTER TABLE spend RENAME COLUMN workspace TO repo;
ALTER TABLE spend ADD COLUMN project TEXT NOT NULL DEFAULT '';
CREATE TABLE projects (slug TEXT PRIMARY KEY, name TEXT NOT NULL, main_repo TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE project_repos (project TEXT NOT NULL REFERENCES projects (slug), repo TEXT NOT NULL, PRIMARY KEY (project, repo));
INSERT INTO projects (slug, name, main_repo, data)
  SELECT slug, slug, slug, json_object('id', slug, 'name', slug, 'mainRepo', slug, 'repos', json_array(slug)) FROM repos;
INSERT INTO project_repos (project, repo) SELECT slug, slug FROM repos;
UPDATE work_orders SET project = repo;
UPDATE work_orders SET data = json_set(json_remove(data, '$.workspace'), '$.project', repo, '$.repo', repo);
UPDATE spend SET project = repo;
UPDATE bindings SET level = 'repo' WHERE level = 'workspace';
CREATE INDEX work_orders_by_project ON work_orders (project, created_at, id);
CREATE INDEX project_repos_by_repo ON project_repos (repo);`,
  },
  {
    // The run-scoped handoff state (P-38): the rolling note as JSON and the stage-base sha, one
    // nullable column each so saving one never clobbers the other. definitionsRev rides runs.data.
    version: 3,
    sql: `CREATE TABLE run_handoff (run_id TEXT PRIMARY KEY REFERENCES runs (id), note TEXT, stage_base TEXT);`,
  },
];
