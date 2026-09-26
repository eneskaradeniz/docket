// SQLite-backed work order repository; the full record rides in `data`, plus derived index columns.
import type { WorkOrderRepo } from '../../../application/index';
import type { DocketDb } from './database';

export function createSqliteWorkOrderRepo(db: DocketDb): WorkOrderRepo {
  void db;
  throw new Error('not implemented');
}
