// SQLite-backed binding repository; one row per (level, scope_key, role).
import type { BindingRepo } from '../../../application/index';
import type { DocketDb } from './database';

export function createSqliteBindingRepo(db: DocketDb): BindingRepo {
  void db;
  throw new Error('not implemented');
}
