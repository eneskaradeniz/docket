// SQLite connection wrapper: pragmas, migration application and nesting-aware transactions.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { err, ok, type Result } from '../../../domain/index';
import { MIGRATIONS, type Migration } from './schema';

export interface DocketDb {
  readonly raw: DatabaseSync;
  /** BEGIN IMMEDIATE ... COMMIT; on a throw: ROLLBACK and rethrow. A nested call joins the outer transaction. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

export type OpenDbError = { readonly code: 'too_new'; readonly found: number; readonly supported: number };

const SUPPORTED_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);

function readUserVersion(raw: DatabaseSync): number {
  const row = raw.prepare('PRAGMA user_version').get();
  const value = row === undefined ? undefined : row.user_version;
  if (typeof value !== 'number') throw new Error('PRAGMA user_version did not return a number');
  return value;
}

function applyMigration(raw: DatabaseSync, migration: Migration): void {
  raw.exec('BEGIN IMMEDIATE');
  try {
    raw.exec(migration.sql);
    // The version is a number from our own MIGRATIONS list, never user input.
    raw.exec(`PRAGMA user_version = ${migration.version}`);
    raw.exec('COMMIT');
  } catch (error) {
    raw.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(path: string): Result<DocketDb, OpenDbError> {
  const isMemory = path === ':memory:';
  if (!isMemory) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const raw = new DatabaseSync(path);
  try {
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec('PRAGMA busy_timeout = 5000');
    if (!isMemory) {
      raw.exec('PRAGMA journal_mode = WAL');
      raw.exec('PRAGMA synchronous = NORMAL');
    }
    const found = readUserVersion(raw);
    if (found > SUPPORTED_VERSION) {
      raw.close();
      return err({ code: 'too_new', found, supported: SUPPORTED_VERSION });
    }
    for (const migration of MIGRATIONS) {
      if (migration.version > found) applyMigration(raw, migration);
    }
  } catch (error) {
    raw.close();
    throw error;
  }
  // Nesting depth of transaction(); a depth above zero means an outer call owns BEGIN/COMMIT.
  let depth = 0;
  const db: DocketDb = {
    raw,
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      raw.exec('BEGIN IMMEDIATE');
      depth += 1;
      try {
        const value = fn();
        raw.exec('COMMIT');
        return value;
      } catch (error) {
        try {
          raw.exec('ROLLBACK');
        } catch {
          // The original failure outranks a rollback that cannot run anymore.
        }
        throw error;
      } finally {
        depth -= 1;
      }
    },
    close(): void {
      raw.close();
    },
  };
  return ok(db);
}
