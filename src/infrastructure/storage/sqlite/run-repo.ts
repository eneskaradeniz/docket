// SQLite-backed run repository; index columns keep `listActive` cheap via a partial index.
import type { RunRepo } from '../../../application/index';
import type { DocketDb } from './database';

export function createSqliteRunRepo(db: DocketDb): RunRepo {
  void db;
  throw new Error('not implemented');
}
