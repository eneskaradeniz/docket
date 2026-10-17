import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APPLICATION_ID, openDatabase, type DocketDb } from './database';
import { MIGRATIONS } from './schema';

const SUPPORTED_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);

const SCHEMA_TABLES = [
  'work_orders',
  'work_order_events',
  'runs',
  'run_events',
  'run_handoff',
  'audit',
  'accounts',
  'pools',
  'meters',
  'spend',
  'bindings',
  'queue_items',
  'proposals',
  'secrets',
  'repo_registry',
  'projects',
  'project_repos',
  'app_settings',
  'phase_auto_runs',
  'pages',
  'page_comments',
  'conversations',
  'drafts',
  'actions',
  'memory_proposals',
  'memory_note_ids',
];

const SCHEMA_INDEXES = [
  'work_orders_by_project',
  'work_orders_by_repo',
  'runs_by_work_order',
  'runs_active',
  'audit_by_subject',
  'pools_by_account',
  'meters_by_pool',
  'spend_by_time',
  'repo_registry_by_slug',
  'project_repos_by_repo',
  'pages_by_work_order',
  'pages_by_project',
  'page_comments_by_page',
  'conversations_by_scope',
  'conversations_by_updated',
  'drafts_by_conversation',
  'actions_by_conversation',
];

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
    expect(tables).toStrictEqual([...SCHEMA_TABLES].sort());
    expect(indexes).toStrictEqual([...SCHEMA_INDEXES].sort());
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

  it('I-3: a pre-squash user_version (10) returns err old_schema with found and supported (#1168)', () => {
    const path = join(tmp, 'legacy.db');
    const setup = new DatabaseSync(path);
    setup.exec('PRAGMA user_version = 10');
    setup.close();
    expect(openDatabase(path)).toStrictEqual({
      ok: false,
      error: { code: 'old_schema', found: 10, supported: SUPPORTED_VERSION },
    });
  });

  it('I-3: a pre-squash user_version without the application-id stamp stays old_schema even below the legacy ceiling (#1173)', () => {
    const path = join(tmp, 'legacy-partial.db');
    const setup = new DatabaseSync(path);
    setup.exec('PRAGMA user_version = 2');
    setup.close();
    expect(openDatabase(path)).toStrictEqual({
      ok: false,
      error: { code: 'old_schema', found: 2, supported: SUPPORTED_VERSION },
    });
  });

  it('I-3: an application-id-stamped user_version above supported returns err too_new, not old_schema (#1173)', () => {
    const path = join(tmp, 'newer.db');
    const setup = new DatabaseSync(path);
    setup.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
    setup.exec('PRAGMA user_version = 5');
    setup.close();
    expect(openDatabase(path)).toStrictEqual({
      ok: false,
      error: { code: 'too_new', found: 5, supported: SUPPORTED_VERSION },
    });
  });

  it('I-3: a fresh database is stamped with the application id (#1173)', () => {
    const db = openOk(join(tmp, 'docket.db'));
    expect(pragmaValue(db, 'application_id')).toBe(APPLICATION_ID);
  });

  it('I-3: an unstamped database at the supported version is adopted and stamped (#1173)', () => {
    const path = join(tmp, 'docket.db');
    const setup = new DatabaseSync(path);
    setup.exec(`PRAGMA user_version = ${SUPPORTED_VERSION}`);
    setup.close();
    const db = openOk(path);
    expect(pragmaValue(db, 'user_version')).toBe(SUPPORTED_VERSION);
    expect(pragmaValue(db, 'application_id')).toBe(APPLICATION_ID);
  });

  it('I-3: a file whose user_version is greater than the last migration returns err too_new with found and supported', () => {
    const path = join(tmp, 'docket.db');
    const setup = new DatabaseSync(path);
    setup.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
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
    setup.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
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
  it('holds the single version-1 schema', () => {
    expect(MIGRATIONS).toHaveLength(1);
    expect(MIGRATIONS[0]?.version).toBe(1);
    expect(typeof MIGRATIONS[0]?.sql).toBe('string');
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
