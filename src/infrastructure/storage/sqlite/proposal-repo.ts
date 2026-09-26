// SQLite-backed proposal repository; listing order is id asc.
import type { ProposalRepo } from '../../../application/index';
import type { DocketDb } from './database';

export function createSqliteProposalRepo(db: DocketDb): ProposalRepo {
  void db;
  throw new Error('not implemented');
}
