// SQLite-backed durable dispatch queue; listing order is id asc.
import type { QueueRepo } from '../../../application/index';
import type { DocketDb } from './database';

export function createSqliteQueueRepo(db: DocketDb): QueueRepo {
  void db;
  throw new Error('not implemented');
}
