import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DocketDb } from './database';
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

const MIGRATION_1_INDEXES = [
  'work_orders_by_workspace',
  'runs_by_work_order',
  'runs_active',
  'audit_by_subject',
  'pools_by_account',
  'meters_by_pool',
  'spend_by_time',
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
    .prepare('INSERT INTO work_orders (id, workspace, created_at, data) VALUES (?, ?, ?, ?)')
    .run(id, 'ws-a', 1, '{}');
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
    expect(tables).toStrictEqual([...MIGRATION_1_TABLES].sort());
    expect(indexes).toStrictEqual([...MIGRATION_1_INDEXES].sort());
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
