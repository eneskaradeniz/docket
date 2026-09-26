// SQLite-backed account repository; cascades to pools/meters on remove, spend history survives.
import type { AccountRepo } from '../../../application/index';
import type { DocketDb } from './database';

export function createSqliteAccountRepo(db: DocketDb): AccountRepo {
  void db;
  throw new Error('not implemented');
}
