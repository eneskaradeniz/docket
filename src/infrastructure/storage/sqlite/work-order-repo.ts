// SQLite-backed work order repository; the full record rides in `data`, plus derived index columns.
import type { WorkOrderRecord, WorkOrderRepo } from '../../../application/index';
import type { WorkOrderEvent, WorkOrderId, RepoSlug } from '../../../domain/index';

import type { DocketDb } from './database';

const decodeRecord = (text: unknown): WorkOrderRecord => {
  if (typeof text !== 'string') throw new Error('work_orders.data must hold text');
  return JSON.parse(text) as WorkOrderRecord;
};

const decodeEvent = (text: unknown): WorkOrderEvent => {
  if (typeof text !== 'string') throw new Error('work_order_events.data must hold text');
  return JSON.parse(text) as WorkOrderEvent;
};

export function createSqliteWorkOrderRepo(db: DocketDb): WorkOrderRepo {
  const insert = db.raw.prepare(
    'INSERT INTO work_orders (id, workspace, created_at, data) VALUES (?, ?, ?, ?)',
  );
  const byId = db.raw.prepare('SELECT data FROM work_orders WHERE id = ?');
  // The composite indexes cover both orderings; ties break by id asc, matching the fake's
  // insertion order for the monotonic ids the application generates.
  const byRepo = db.raw.prepare(
    'SELECT data FROM work_orders WHERE workspace = ? ORDER BY created_at ASC, id ASC',
  );
  const everything = db.raw.prepare('SELECT data FROM work_orders ORDER BY created_at ASC, id ASC');
  const maxSeq = db.raw.prepare(
    'SELECT COALESCE(MAX(seq), 0) AS previous FROM work_order_events WHERE work_order_id = ?',
  );
  const insertEvent = db.raw.prepare(
    'INSERT INTO work_order_events (work_order_id, seq, data) VALUES (?, ?, ?)',
  );
  const eventsFor = db.raw.prepare(
    'SELECT data FROM work_order_events WHERE work_order_id = ? ORDER BY seq ASC',
  );

  return {
    create: async (record: WorkOrderRecord): Promise<void> => {
      insert.run(record.id, record.repo, record.createdAt, JSON.stringify(record));
    },

    get: async (id: WorkOrderId): Promise<WorkOrderRecord | undefined> => {
      const row = byId.get(id);
      return row === undefined ? undefined : decodeRecord(row['data']);
    },

    list: async (filter: { readonly repo?: RepoSlug }): Promise<readonly WorkOrderRecord[]> => {
      const rows =
        filter.repo === undefined ? everything.all() : byRepo.all(filter.repo);
      return rows.map((row) => decodeRecord(row['data']));
    },

    appendEvent: async (id: WorkOrderId, event: WorkOrderEvent): Promise<void> => {
      // One transaction: the max+1 read and the insert see the same snapshot, and the foreign
      // key on an unknown work order rolls the whole write back.
      db.transaction(() => {
        const row = maxSeq.get(id);
        const previous = row === undefined ? 0 : Number(row['previous']);
        insertEvent.run(id, previous + 1, JSON.stringify(event));
      });
    },

    events: async (id: WorkOrderId): Promise<readonly WorkOrderEvent[]> =>
      eventsFor.all(id).map((row) => decodeEvent(row['data'])),
  };
}
