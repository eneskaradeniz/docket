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
  {
    // Operator settings as key → JSON text (I-46); one generic table, so a new setting is a new
    // key, never a new migration.
    version: 4,
    sql: `CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT);`,
  },
  {
    // The phases the operator started and let advance unattended (I-49): one row per
    // (project, phase), the attention work-order ids as JSON text.
    version: 5,
    sql: `CREATE TABLE phase_auto_runs (project TEXT NOT NULL, phase TEXT NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, attention_json TEXT NOT NULL, PRIMARY KEY (project, phase));`,
  },
  {
    // Pages and their comments (I-55): JSON `data` like proposals, with the columns the lists
    // filter on (link, page, version, delivery) beside it. Page files live on disk, not here.
    version: 6,
    sql: `CREATE TABLE pages (id TEXT PRIMARY KEY, work_order TEXT, project TEXT, data TEXT NOT NULL);
CREATE INDEX pages_by_work_order ON pages (work_order, id);
CREATE INDEX pages_by_project ON pages (project, id);
CREATE TABLE page_comments (id TEXT PRIMARY KEY, page TEXT NOT NULL, version INTEGER NOT NULL, delivered_at INTEGER, data TEXT NOT NULL);
CREATE INDEX page_comments_by_page ON page_comments (page, id);`,
  },
  {
    // Conversations (I-73): the record as JSON `data`, with the columns the history lists filter and
    // order on beside it, and a lower-cased `search_text` rebuilt on every save for the substring
    // query. Drafts of a conversation are their own table. Attachment bytes live on disk, not here.
    version: 7,
    sql: `CREATE TABLE conversations (id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL, scope_ref TEXT NOT NULL, updated_at INTEGER NOT NULL, pinned INTEGER NOT NULL, search_text TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX conversations_by_scope ON conversations (scope_kind, scope_ref);
CREATE INDEX conversations_by_updated ON conversations (updated_at);
CREATE TABLE drafts (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX drafts_by_conversation ON drafts (conversation, id);`,
  },
  {
    // Assistant actions (I-77): the record as JSON `data`, with the columns one conversation's list,
    // pending filter and count read beside it. Grants are deliberately not here: they live in memory.
    version: 8,
    sql: `CREATE TABLE actions (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, status TEXT NOT NULL, proposed_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX actions_by_conversation ON actions (conversation, status);`,
  },
  {
    // Chat-page provenance (I-84): the conversation a chat turn's page belongs to, nullable so a
    // run-made or operator page — and every row written before this migration — reads as absent.
    version: 9,
    sql: `ALTER TABLE pages ADD COLUMN conversation TEXT;`,
  },
  {
    // Chat spend provenance (I-85): the conversation a chat turn's cost belongs to, nullable so a
    // run or account-test entry — and every row written before this migration — reads as absent.
    version: 10,
    sql: `ALTER TABLE spend ADD COLUMN conversation TEXT;`,
  },
  {
    // The repoId registry (I-93): the slug-keyed repos table becomes repo_registry, every row
    // gaining a ULID minted by the SQL itself and a fingerprint record whose rootCommit stays ''
    // until the app reads git; the projects table loses the main-repo shape.
    version: 11,
    sql: `CREATE TABLE repo_registry (repo_id TEXT PRIMARY KEY, slug TEXT NOT NULL, path TEXT NOT NULL, legacy_imported INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE UNIQUE INDEX repo_registry_by_slug ON repo_registry (slug);
WITH seeds AS (
  SELECT slug, path, unixepoch('now') * 1000 AS t, random() & 1099511627775 AS a, random() & 1099511627775 AS b FROM repos
)
INSERT INTO repo_registry (repo_id, slug, path, legacy_imported, data)
  SELECT
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((t >> 45) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((t >> 40) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((t >> 35) & 31) + 1, 1) ||
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((t >> 30) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((t >> 25) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((t >> 20) & 31) + 1, 1) ||
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((t >> 15) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((t >> 10) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((t >> 5) & 31) + 1, 1) ||
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((t >> 0) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((a >> 35) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((a >> 30) & 31) + 1, 1) ||
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((a >> 25) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((a >> 20) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((a >> 15) & 31) + 1, 1) ||
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((a >> 10) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((a >> 5) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((a >> 0) & 31) + 1, 1) ||
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((b >> 35) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((b >> 30) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((b >> 25) & 31) + 1, 1) ||
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((b >> 20) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((b >> 15) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((b >> 10) & 31) + 1, 1) ||
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((b >> 5) & 31) + 1, 1) || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((b >> 0) & 31) + 1, 1),
    slug, path, 0, ''
  FROM seeds;
UPDATE repo_registry SET data = json_object('repoId', repo_id, 'slug', slug, 'path', path, 'fingerprint', json_object('rootCommit', ''));
DROP TABLE repos;
ALTER TABLE projects DROP COLUMN main_repo;
UPDATE projects SET data = json_remove(data, '$.mainRepo');`,
  },
];
