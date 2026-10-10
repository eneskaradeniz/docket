// SQLite-backed assistant action repository. The record is stored as JSON in `data`; the columns
// beside it (conversation, status, proposal time) exist only so one conversation's records can be
// listed, filtered and counted without reading every record. Records hold ids, codes and the
// action's own fields — the application never puts anything else in them.
import type { ActionRepo } from '../../../application/index';
import type { ActionRecord } from '../../../domain/index';
import type { DocketDb } from './database';

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

/** Only our own writes fill `data`, so anything else is a programming error. */
function recordOf(row: DataRow): ActionRecord {
  if (typeof row.data !== 'string') throw new Error('actions row without JSON data');
  return JSON.parse(row.data) as ActionRecord;
}

export function createSqliteActionRepo(db: DocketDb): ActionRepo {
  return {
    save: async (r: ActionRecord): Promise<void> => {
      db.raw
        .prepare(
          'INSERT INTO actions (id, conversation, status, proposed_at, data) VALUES (?, ?, ?, ?, ?) ' +
            'ON CONFLICT (id) DO UPDATE SET conversation = excluded.conversation, status = excluded.status, ' +
            'proposed_at = excluded.proposed_at, data = excluded.data',
        )
        .run(r.id, r.conversation, r.status, r.proposedAt, JSON.stringify(r));
    },

    get: async (id): Promise<ActionRecord | undefined> => {
      const row = db.raw.prepare('SELECT data FROM actions WHERE id = ?').get(id);
      return row === undefined ? undefined : recordOf(row);
    },

    forConversation: async (c): Promise<readonly ActionRecord[]> =>
      db.raw
        .prepare('SELECT data FROM actions WHERE conversation = ? ORDER BY proposed_at ASC, id ASC')
        .all(c)
        .map((row) => recordOf(row)),

    pending: async (c): Promise<readonly ActionRecord[]> =>
      db.raw
        .prepare("SELECT data FROM actions WHERE conversation = ? AND status = 'pending' ORDER BY proposed_at ASC, id ASC")
        .all(c)
        .map((row) => recordOf(row)),

    countFor: async (c): Promise<number> => {
      const row = db.raw.prepare('SELECT COUNT(*) AS n FROM actions WHERE conversation = ?').get(c);
      return row === undefined ? 0 : Number(row.n);
    },
  };
}
