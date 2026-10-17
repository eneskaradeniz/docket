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

export type OpenDbError =
  | { readonly code: 'old_schema'; readonly found: number; readonly supported: number }
  | { readonly code: 'too_new'; readonly found: number; readonly supported: number };

/**
 * Highest `user_version` the pre-squash migration chain ever wrote (#1058). Pre-squash databases
 * also lack the application-id stamp; the stamp, not this ceiling, tells the two families apart
 * when a version above supported is found.
 */
export const LEGACY_USER_VERSION_MAX = 11;

/**
 * Stamp written into `PRAGMA application_id` of every post-squash database. The post-squash chain
 * restarts `user_version` at 1, so its future versions overlap the legacy range; the stamp says
 * which numbering a database belongs to.
 */
export const APPLICATION_ID = 0x444f434b; // "DOCK" as four ASCII bytes

const SUPPORTED_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);

const versionMismatchError = (found: number, supported: number, applicationId: number): OpenDbError =>
  // An unstamped database above supported carries the pre-squash numbering; a stamped one was
  // made by a newer app, whatever its version.
  applicationId === 0
    ? { code: 'old_schema', found, supported }
    : { code: 'too_new', found, supported };

function readUserVersion(raw: DatabaseSync): number {
  const row = raw.prepare('PRAGMA user_version').get();
  const value = row === undefined ? undefined : row.user_version;
  if (typeof value !== 'number') throw new Error('PRAGMA user_version did not return a number');
  return value;
}

function readApplicationId(raw: DatabaseSync): number {
  const row = raw.prepare('PRAGMA application_id').get();
  const value = row === undefined ? undefined : row.application_id;
  if (typeof value !== 'number') throw new Error('PRAGMA application_id did not return a number');
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
      const applicationId = readApplicationId(raw);
      raw.close();
      return err(versionMismatchError(found, SUPPORTED_VERSION, applicationId));
    }
    for (const migration of MIGRATIONS) {
      if (migration.version > found) applyMigration(raw, migration);
    }
    if (readApplicationId(raw) === 0) {
      // Stamps fresh databases and adopts ones created before the stamp existed, so a future
      // open by an older app reads too_new instead of old numbering. The value is a constant
      // from this module, never user input.
      raw.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
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
