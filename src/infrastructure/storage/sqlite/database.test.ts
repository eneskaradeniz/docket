import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectDef, RepoSlug } from '../../../domain/index';
import { createSqliteProjectRepo } from './project-repo';
import { createSqliteRepoRegistry } from './repo-registry';
import { openDatabase, type DocketDb } from './database';
import { createSqliteRunRepo } from './run-repo';
import { MIGRATIONS } from './schema';

const SUPPORTED_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);

const MIGRATION_1_SQL = [
  'CREATE TABLE work_orders (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);',
  'CREATE INDEX work_orders_by_workspace ON work_orders (workspace, created_at, id);',
  'CREATE TABLE work_order_events (work_order_id TEXT NOT NULL REFERENCES work_orders (id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (work_order_id, seq));',
  'CREATE TABLE runs (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_orders (id), started_at INTEGER NOT NULL, ended_at INTEGER, data TEXT NOT NULL);',
  'CREATE INDEX runs_by_work_order ON runs (work_order_id, started_at, id);',
  'CREATE INDEX runs_active ON runs (started_at, id) WHERE ended_at IS NULL;',
  'CREATE TABLE run_events (run_id TEXT NOT NULL REFERENCES runs (id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, seq));',
  'CREATE TABLE audit (id TEXT PRIMARY KEY, at INTEGER NOT NULL, subject_kind TEXT NOT NULL, subject_key TEXT NOT NULL, data TEXT NOT NULL);',
  'CREATE INDEX audit_by_subject ON audit (subject_kind, subject_key, at DESC, id DESC);',
  'CREATE TABLE accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);',
  'CREATE TABLE pools (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, data TEXT NOT NULL);',
  'CREATE INDEX pools_by_account ON pools (account_id);',
  'CREATE TABLE meters (id TEXT PRIMARY KEY, pool_id TEXT NOT NULL, data TEXT NOT NULL);',
  'CREATE INDEX meters_by_pool ON meters (pool_id);',
  'CREATE TABLE spend (seq INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, workspace TEXT NOT NULL, work_order_id TEXT NOT NULL, at INTEGER NOT NULL, usd REAL NOT NULL);',
  'CREATE INDEX spend_by_time ON spend (at);',
  'CREATE TABLE bindings (level TEXT NOT NULL, scope_key TEXT NOT NULL, role TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (level, scope_key, role));',
  'CREATE TABLE queue_items (id TEXT PRIMARY KEY, data TEXT NOT NULL);',
  'CREATE TABLE proposals (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);',
  'CREATE TABLE secrets (ref TEXT PRIMARY KEY, blob BLOB NOT NULL);',
  'CREATE TABLE workspaces (slug TEXT PRIMARY KEY, path TEXT NOT NULL);',
].join('\n');

const MIGRATION_2_SQL = [
  'ALTER TABLE workspaces RENAME TO repos;',
  'ALTER TABLE work_orders RENAME COLUMN workspace TO repo;',
  'ALTER TABLE work_orders ADD COLUMN project TEXT NOT NULL DEFAULT \'\';',
  'ALTER TABLE spend RENAME COLUMN workspace TO repo;',
  'ALTER TABLE spend ADD COLUMN project TEXT NOT NULL DEFAULT \'\';',
  'CREATE TABLE projects (slug TEXT PRIMARY KEY, name TEXT NOT NULL, main_repo TEXT NOT NULL, data TEXT NOT NULL);',
  'CREATE TABLE project_repos (project TEXT NOT NULL REFERENCES projects (slug), repo TEXT NOT NULL, PRIMARY KEY (project, repo));',
  "INSERT INTO projects (slug, name, main_repo, data)\n  SELECT slug, slug, slug, json_object('id', slug, 'name', slug, 'mainRepo', slug, 'repos', json_array(slug)) FROM repos;",
  'INSERT INTO project_repos (project, repo) SELECT slug, slug FROM repos;',
  'UPDATE work_orders SET project = repo;',
  "UPDATE work_orders SET data = json_set(json_remove(data, '$.workspace'), '$.project', repo, '$.repo', repo);",
  'UPDATE spend SET project = repo;',
  "UPDATE bindings SET level = 'repo' WHERE level = 'workspace';",
  'CREATE INDEX work_orders_by_project ON work_orders (project, created_at, id);',
  'CREATE INDEX project_repos_by_repo ON project_repos (repo);',
].join('\n');

const MIGRATION_3_SQL = 'CREATE TABLE run_handoff (run_id TEXT PRIMARY KEY REFERENCES runs (id), note TEXT, stage_base TEXT);';

const MIGRATION_1_TABLES = [
  'work_orders',
  'work_order_events',
  'runs',
  'run_events',
  'audit',
  'accounts',
  'pools',
  'meters',
  'spend',
  'bindings',
  'queue_items',
  'proposals',
  'secrets',
  'workspaces',
];

// What the schema holds once every migration has run: migration 2 renames workspaces to repos
// and adds the project tables; migration 3 adds the run handoff state.
const MIGRATED_TABLES = [
  ...MIGRATION_1_TABLES.filter((table) => table !== 'workspaces'),
  'repos',
  'projects',
  'project_repos',
  'run_handoff',
  'app_settings',
];

const MIGRATION_1_INDEXES = [
  'work_orders_by_workspace', // SQLite keeps index names across the migration-2 renames
  'runs_by_work_order',
  'runs_active',
  'audit_by_subject',
  'pools_by_account',
  'meters_by_pool',
  'spend_by_time',
];

const MIGRATED_INDEXES = [...MIGRATION_1_INDEXES, 'work_orders_by_project', 'project_repos_by_repo'];

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-'));
  openHandles = [];
});

afterEach(() => {
  for (const db of openHandles.splice(0)) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function openOk(path: string): DocketDb {
  const result = openDatabase(path);
  if (!result.ok) throw new Error(`expected openDatabase(${path}) to succeed`);
  openHandles.push(result.value);
  return result.value;
}

function closeDb(db: DocketDb): void {
  db.close();
  const index = openHandles.indexOf(db);
  if (index >= 0) openHandles.splice(index, 1);
}

function pragmaValue(db: DocketDb, name: string): unknown {
  const row = db.raw.prepare(`PRAGMA ${name}`).get();
  return row === undefined ? undefined : row[name];
}

function workOrderCount(db: DocketDb): number {
  const row = db.raw.prepare('SELECT COUNT(*) AS n FROM work_orders').get();
  return Number(row === undefined ? undefined : row.n);
}

function insertWorkOrder(db: DocketDb, id: string): void {
  db.raw
    .prepare('INSERT INTO work_orders (id, project, repo, created_at, data) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'ws-a', 'ws-a', 1, '{}');
}

describe('openDatabase', () => {
  it('I-3: creates the parent folder of a file path', () => {
    const path = join(tmp, 'nested', 'deeper', 'docket.db');
    expect(existsSync(dirname(path))).toBe(false);
    const db = openOk(path);
    expect(existsSync(dirname(path))).toBe(true);
    expect(workOrderCount(db)).toBe(0);
  });

  it('I-3: sets foreign_keys = ON and busy_timeout = 5000', () => {
    const db = openOk(':memory:');
    expect(pragmaValue(db, 'foreign_keys')).toBe(1);
    // SQLite names the result column of PRAGMA busy_timeout "timeout".
    const row = db.raw.prepare('PRAGMA busy_timeout').get();
    expect(row === undefined ? undefined : row.timeout).toBe(5000);
  });

  it('I-3: sets journal_mode = WAL and synchronous = NORMAL for file databases', () => {
    const db = openOk(join(tmp, 'docket.db'));
    expect(pragmaValue(db, 'journal_mode')).toBe('wal');
    // SQLite synchronous values: 0 = OFF, 1 = NORMAL, 2 = FULL.
    expect(pragmaValue(db, 'synchronous')).toBe(1);
  });

  it('I-3: leaves an in-memory database on the memory journal (no WAL pragmas)', () => {
    const db = openOk(':memory:');
    expect(pragmaValue(db, 'journal_mode')).toBe('memory');
  });

  it('I-3: applies every migration whose version is greater than PRAGMA user_version and sets user_version', () => {
    const db = openOk(join(tmp, 'docket.db'));
    expect(db.raw instanceof DatabaseSync).toBe(true);
    expect(pragmaValue(db, 'user_version')).toBe(SUPPORTED_VERSION);
    const objects = db.raw
      .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all();
    const tables = objects.filter((o) => o.type === 'table').map((o) => String(o.name)).sort();
    const indexes = objects.filter((o) => o.type === 'index').map((o) => String(o.name)).sort();
    expect(tables).toStrictEqual([...MIGRATED_TABLES].sort());
    expect(indexes).toStrictEqual([...MIGRATED_INDEXES].sort());
  });

  it('I-3: opening again is a no-op — migration 1 does not re-run', () => {
    const path = join(tmp, 'docket.db');
    const first = openOk(path);
    insertWorkOrder(first, 'wo-1');
    closeDb(first);
    // Re-running migration 1 would fail on CREATE TABLE work_orders.
    const second = openOk(path);
    expect(pragmaValue(second, 'user_version')).toBe(SUPPORTED_VERSION);
    expect(workOrderCount(second)).toBe(1);
  });

  it('I-3: a file whose user_version is greater than the last migration returns err too_new with found and supported', () => {
    const path = join(tmp, 'docket.db');
    const setup = new DatabaseSync(path);
    setup.exec('PRAGMA user_version = 99');
    setup.close();
    const result = openDatabase(path);
    expect(result).toStrictEqual({
      ok: false,
      error: { code: 'too_new', found: 99, supported: SUPPORTED_VERSION },
    });
  });

  it('I-3: the too-new database file stays usable after the rejected open', () => {
    const path = join(tmp, 'docket.db');
    const setup = new DatabaseSync(path);
    setup.exec('PRAGMA user_version = 99');
    setup.close();
    expect(openDatabase(path).ok).toBe(false);
    expect(openDatabase(path)).toStrictEqual({
      ok: false,
      error: { code: 'too_new', found: 99, supported: SUPPORTED_VERSION },
    });
  });
});

describe('MIGRATIONS', () => {
  it('holds migration 1 exactly as contracted', () => {
    expect(MIGRATIONS[0]).toStrictEqual({ version: 1, sql: MIGRATION_1_SQL });
  });

  it('holds migration 2 exactly as contracted', () => {
    expect(MIGRATIONS[1]).toStrictEqual({ version: 2, sql: MIGRATION_2_SQL });
  });

  it('holds migration 3 exactly as contracted', () => {
    expect(MIGRATIONS[2]).toStrictEqual({ version: 3, sql: MIGRATION_3_SQL });
  });

  it('has unique, increasing versions starting at 1', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions[0]).toBe(1);
    for (let i = 1; i < versions.length; i += 1) {
      expect(versions[i]).toBeGreaterThan(versions[i - 1] as number);
    }
  });
});

describe('transaction', () => {
  it('I-4: BEGIN IMMEDIATE … COMMIT commits the writes made in fn and returns its value', () => {
    const db = openOk(':memory:');
    const returned = db.transaction(() => {
      insertWorkOrder(db, 'wo-1');
      return 42;
    });
    expect(returned).toBe(42);
    expect(workOrderCount(db)).toBe(1);
  });

  it('I-4: a throw inside fn rolls back every write made in it and rethrows', () => {
    const db = openOk(':memory:');
    expect(() =>
      db.transaction(() => {
        insertWorkOrder(db, 'wo-1');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(workOrderCount(db)).toBe(0);
  });

  it('I-4: a nested call does not open a second transaction — it joins the outer one', () => {
    const db = openOk(':memory:');
    db.transaction(() => {
      insertWorkOrder(db, 'wo-1');
      // A second BEGIN here would throw "cannot start a transaction within a transaction".
      db.transaction(() => {
        insertWorkOrder(db, 'wo-2');
      });
      insertWorkOrder(db, 'wo-3');
    });
    expect(workOrderCount(db)).toBe(3);
  });

  it('I-4: a throw inside a nested transaction leaves no row behind', () => {
    const db = openOk(':memory:');
    expect(() =>
      db.transaction(() => {
        insertWorkOrder(db, 'wo-1');
        db.transaction(() => {
          insertWorkOrder(db, 'wo-2');
          throw new Error('inner boom');
        });
      }),
    ).toThrow('inner boom');
    expect(workOrderCount(db)).toBe(0);
  });

  it('I-4: a throw after a nested call returns also rolls the nested writes back', () => {
    const db = openOk(':memory:');
    expect(() =>
      db.transaction(() => {
        insertWorkOrder(db, 'wo-1');
        db.transaction(() => {
          insertWorkOrder(db, 'wo-2');
        });
        throw new Error('outer boom');
      }),
    ).toThrow('outer boom');
    expect(workOrderCount(db)).toBe(0);
  });

  it('I-4: a rollback leaves writes made before the transaction untouched', () => {
    const db = openOk(':memory:');
    insertWorkOrder(db, 'wo-before');
    expect(() =>
      db.transaction(() => {
        insertWorkOrder(db, 'wo-inside');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(workOrderCount(db)).toBe(1);
  });
});

// --- Migration 2 (I-33): the project layer over a version-1 database --------------------------------

const OLD_ACTOR = { kind: 'user', id: 'u1', label: 'opener' } as const;

/** A database left at version 1: migration 1 applied by hand, user_version pinned, and rows in
 *  the pre-project shapes — including a pre-rename work order (data carries $.workspace) and a
 *  post-rename one (data carries $.repo, column still `workspace`). */
const makeVersion1Database = (path: string): void => {
  const setup = new DatabaseSync(path);
  setup.exec(MIGRATIONS[0]?.sql ?? '');
  setup.exec('PRAGMA user_version = 1');
  setup
    .prepare("INSERT INTO workspaces (slug, path) VALUES ('acme', '/x/acme'), ('zulu', '/x/zulu')")
    .run();
  setup
    .prepare("INSERT INTO work_orders (id, workspace, created_at, data) VALUES (?, ?, ?, ?)")
    .run('01ARZ3NDEKTSV4RRFFQ69G5F101', 'acme', 5, JSON.stringify({
      id: '01ARZ3NDEKTSV4RRFFQ69G5F101',
      workspace: 'acme',
      flow: 'standard',
      title: 'Truly old',
      createdAt: 5,
      createdBy: OLD_ACTOR,
    }));
  setup
    .prepare("INSERT INTO work_orders (id, workspace, created_at, data) VALUES (?, ?, ?, ?)")
    .run('01ARZ3NDEKTSV4RRFFQ69G5F102', 'acme', 6, JSON.stringify({
      id: '01ARZ3NDEKTSV4RRFFQ69G5F102',
      repo: 'acme',
      flow: 'standard',
      title: 'Renamed era',
      task: 'setup-auth',
      createdAt: 6,
      createdBy: OLD_ACTOR,
    }));
  setup
    .prepare("INSERT INTO spend (account_id, workspace, work_order_id, at, usd) VALUES (?, ?, ?, ?, ?)")
    .run('01ARZ3NDEKTSV4RRFFQ69G5FAA1', 'acme', '01ARZ3NDEKTSV4RRFFQ69G5F101', 10, 1.5);
  setup
    .prepare("INSERT INTO bindings (level, scope_key, role, data) VALUES (?, ?, ?, ?)")
    .run('workspace', 'acme', 'worker', JSON.stringify({ role: 'worker', accounts: [] }));
  setup
    .prepare("INSERT INTO bindings (level, scope_key, role, data) VALUES (?, ?, ?, ?)")
    .run('global', '', 'worker', JSON.stringify({ role: 'worker', accounts: [] }));
  setup.close();
};

describe('Migration 2', () => {
  it('I-33: a version-1 database migrates exactly once; every old workspace becomes a project≡repo and the records read back in the new shapes', async () => {
    const path = join(tmp, 'old.db');
    makeVersion1Database(path);

    const migrated = openOk(path);
    expect(pragmaValue(migrated, 'user_version')).toBe(SUPPORTED_VERSION);

    // The registry reads the renamed table.
    const registry = createSqliteRepoRegistry(migrated);
    expect(await registry.list()).toEqual([
      { slug: 'acme' as RepoSlug, path: '/x/acme' },
      { slug: 'zulu' as RepoSlug, path: '/x/zulu' },
    ]);

    // Every workspace became a project≡repo: name and main repo are the slug itself.
    const projects = createSqliteProjectRepo(migrated);
    const listed: readonly ProjectDef[] = await projects.list();
    expect(listed).toEqual([
      { id: 'acme' as never, name: 'acme', mainRepo: 'acme' as never, repos: ['acme' as never] },
      { id: 'zulu' as never, name: 'zulu', mainRepo: 'zulu' as never, repos: ['zulu' as never] },
    ]);
    expect((await projects.projectOfRepo('acme' as never))?.id).toBe('acme');

    // Work orders carry project and repo pointing at the owning workspace, and the rewritten
    // data deep-equals the new record shape — the renamed-era row keeps its task, the truly old
    // one loses $.workspace.
    const rows = migrated.raw.prepare('SELECT data FROM work_orders ORDER BY created_at ASC').all() as unknown as readonly { readonly data: string }[];
    expect(JSON.parse(rows[0]?.data ?? '{}')).toStrictEqual({
      id: '01ARZ3NDEKTSV4RRFFQ69G5F101',
      project: 'acme',
      repo: 'acme',
      flow: 'standard',
      title: 'Truly old',
      createdAt: 5,
      createdBy: OLD_ACTOR,
    });
    expect(JSON.parse(rows[1]?.data ?? '{}')).toStrictEqual({
      id: '01ARZ3NDEKTSV4RRFFQ69G5F102',
      project: 'acme',
      repo: 'acme',
      flow: 'standard',
      title: 'Renamed era',
      task: 'setup-auth',
      createdAt: 6,
      createdBy: OLD_ACTOR,
    });
    const columns = migrated.raw
      .prepare("SELECT project, repo FROM work_orders WHERE id = '01ARZ3NDEKTSV4RRFFQ69G5F101'")
      .get() as { readonly project: string; readonly repo: string };
    expect(columns).toEqual({ project: 'acme', repo: 'acme' });

    // Spend history survived with its project and repo attributed.
    const spend = migrated.raw
      .prepare('SELECT project, repo, usd FROM spend')
      .all() as unknown as readonly { readonly project: string; readonly repo: string; readonly usd: number }[];
    expect(spend).toEqual([{ project: 'acme', repo: 'acme', usd: 1.5 }]);

    // The binding level rewrite: only the workspace-level row moved to repo.
    const levels = migrated.raw
      .prepare('SELECT level, scope_key FROM bindings ORDER BY level')
      .all() as unknown as readonly { readonly level: string; readonly scope_key: string }[];
    expect(levels).toEqual([
      { level: 'global', scope_key: '' },
      { level: 'repo', scope_key: 'acme' },
    ]);

    closeDb(migrated);

    // Opening again is a no-op: migration 2 does not re-run (the project rows stay unique).
    const again = openOk(path);
    expect(pragmaValue(again, 'user_version')).toBe(SUPPORTED_VERSION);
    expect(await createSqliteProjectRepo(again).list()).toHaveLength(2);
    closeDb(again);
  });

  it('I-33: a database already at version 2 is a no-op, and too_new is unchanged', async () => {
    const path = join(tmp, 'fresh.db');
    const first = openOk(path);
    expect(pragmaValue(first, 'user_version')).toBe(SUPPORTED_VERSION);
    closeDb(first);

    const second = openOk(path);
    expect(pragmaValue(second, 'user_version')).toBe(SUPPORTED_VERSION);
    closeDb(second);

    const newer = join(tmp, 'newer.db');
    const setup = new DatabaseSync(newer);
    setup.exec(`PRAGMA user_version = ${SUPPORTED_VERSION + 1}`);
    setup.close();
    expect(openDatabase(newer)).toStrictEqual({
      ok: false,
      error: { code: 'too_new', found: SUPPORTED_VERSION + 1, supported: SUPPORTED_VERSION },
    });
  });
});

// --- Migration 3: the run handoff state over a version-2 database -------------------------------------

/** A database left at version 2: migrations 1 and 2 applied by hand, user_version pinned, one work
 *  order and one run in place so the run_handoff foreign key has something to point at. */
const makeVersion2Database = (path: string): void => {
  const setup = new DatabaseSync(path);
  setup.exec(MIGRATIONS[0]?.sql ?? '');
  setup.exec(MIGRATIONS[1]?.sql ?? '');
  setup.exec('PRAGMA user_version = 2');
  setup
    .prepare("INSERT INTO work_orders (id, project, repo, created_at, data) VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FB4', 'acme', 'acme', 1, '{}')")
    .run();
  setup
    .prepare("INSERT INTO runs (id, work_order_id, started_at, data) VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FB5', '01ARZ3NDEKTSV4RRFFQ69G5FB4', 2, '{}')")
    .run();
  setup.close();
};

describe('Migration 3', () => {
  it('a version-2 database gains run_handoff at version 3, exactly once, and the run repo uses it', async () => {
    const path = join(tmp, 'v2.db');
    makeVersion2Database(path);

    const migrated = openOk(path);
    expect(pragmaValue(migrated, 'user_version')).toBe(SUPPORTED_VERSION);
    const table = migrated.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_handoff'")
      .get();
    expect(table === undefined ? undefined : table.name).toBe('run_handoff');

    // The repository reads and writes through the new table on the migrated database.
    const runs = createSqliteRunRepo(migrated);
    const runId = '01ARZ3NDEKTSV4RRFFQ69G5FB5' as never;
    expect(await runs.handoffNote(runId)).toBeUndefined();
    expect(await runs.stageBase(runId)).toBeUndefined();
    await runs.saveStageBase(runId, 'sha-base-1');
    await runs.saveHandoffNote(runId, { text: 'ozet', capped: false });
    expect(await runs.stageBase(runId)).toBe('sha-base-1');
    expect(await runs.handoffNote(runId)).toStrictEqual({ text: 'ozet', capped: false });
    closeDb(migrated);

    // Opening again is a no-op: migration 3 does not re-run.
    const again = openOk(path);
    expect(pragmaValue(again, 'user_version')).toBe(SUPPORTED_VERSION);
    expect(await createSqliteRunRepo(again).stageBase(runId)).toBe('sha-base-1');
    closeDb(again);
  });
});
