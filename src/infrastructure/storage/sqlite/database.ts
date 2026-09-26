// SQLite connection wrapper: pragmas, migration application and nesting-aware transactions.
import type { DatabaseSync } from 'node:sqlite';
import type { Result } from '../../../domain/index';

export interface DocketDb {
  readonly raw: DatabaseSync;
  /** BEGIN IMMEDIATE ... COMMIT; on a throw: ROLLBACK and rethrow. A nested call joins the outer transaction. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

export type OpenDbError = { readonly code: 'too_new'; readonly found: number; readonly supported: number };

export function openDatabase(path: string): Result<DocketDb, OpenDbError> {
  void path;
  throw new Error('not implemented');
}
