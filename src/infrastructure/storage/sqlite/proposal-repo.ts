// SQLite-backed proposal repository; listing order is id asc.
import type { ProposalRecord, ProposalRepo } from '../../../application/index';
import type { DocketDb } from './database';

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

/** Only our own writes fill `data`, so anything else is a programming error. */
function recordFromRow(row: DataRow): ProposalRecord {
  if (typeof row.data !== 'string') throw new Error('proposals row without JSON data');
  const parsed: unknown = JSON.parse(row.data);
  return parsed as ProposalRecord;
}

function optionalRecordFromRow(row: DataRow | undefined): ProposalRecord | undefined {
  return row === undefined ? undefined : recordFromRow(row);
}

export function createSqliteProposalRepo(db: DocketDb): ProposalRepo {
  return {
    save: async (record: ProposalRecord): Promise<void> => {
      db.raw
        .prepare(
          'INSERT INTO proposals (id, status, data) VALUES (?, ?, ?) ' +
            'ON CONFLICT (id) DO UPDATE SET status = excluded.status, data = excluded.data',
        )
        .run(record.id, record.status, JSON.stringify(record));
    },

    get: async (id): Promise<ProposalRecord | undefined> =>
      optionalRecordFromRow(db.raw.prepare('SELECT data FROM proposals WHERE id = ?').get(id)),

    list: async (filter): Promise<readonly ProposalRecord[]> => {
      const rows =
        filter.status === undefined
          ? db.raw.prepare('SELECT data FROM proposals ORDER BY id ASC').all()
          : db.raw.prepare('SELECT data FROM proposals WHERE status = ? ORDER BY id ASC').all(filter.status);
      return rows.map((row) => recordFromRow(row));
    },
  };
}
