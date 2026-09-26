// SQLite-backed audit event log; newest-first listing by (at DESC, id DESC).
import type { EventLog } from '../../../application/index';
import type { DocketDb } from './database';

export function createSqliteEventLog(db: DocketDb): EventLog {
  void db;
  throw new Error('not implemented');
}
