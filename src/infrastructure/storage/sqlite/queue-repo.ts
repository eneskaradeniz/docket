// SQLite-backed durable dispatch queue; listing order is id asc.
import type { QueueRepo } from '../../../application/index';
import type { QueueItem } from '../../../domain/index';
import type { DocketDb } from './database';

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

/** Only our own writes fill `data`, so anything else is a programming error. */
function itemFromRow(row: DataRow): QueueItem {
  if (typeof row.data !== 'string') throw new Error('queue_items row without JSON data');
  const parsed: unknown = JSON.parse(row.data);
  return parsed as QueueItem;
}

export function createSqliteQueueRepo(db: DocketDb): QueueRepo {
  return {
    put: async (item: QueueItem): Promise<void> => {
      db.raw
        .prepare('INSERT INTO queue_items (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data')
        .run(item.id, JSON.stringify(item));
    },

    remove: async (id): Promise<void> => {
      db.raw.prepare('DELETE FROM queue_items WHERE id = ?').run(id);
    },

    list: async (): Promise<readonly QueueItem[]> =>
      db.raw
        .prepare('SELECT data FROM queue_items ORDER BY id ASC')
        .all()
        .map((row) => itemFromRow(row)),
  };
}
