// SQLite-backed work order repository; the full record rides in `data`, plus derived index columns.
import type { WorkOrderRecord, WorkOrderRepo } from '../../../application/index';
import type { ProjectSlug, WorkOrderEvent, WorkOrderId, RepoSlug } from '../../../domain/index';

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
    'INSERT INTO work_orders (id, project, repo, created_at, data) VALUES (?, ?, ?, ?, ?)',
  );
  const byId = db.raw.prepare('SELECT data FROM work_orders WHERE id = ?');
  // A-29 in one statement: the outer row fixes the target, the correlated count is the number of
  // work orders before it in (created_at, id) order. An unknown id answers no row, which is the
  // undefined of the port. No dedicated index is added: the planner already serves the count as a
  // covering scan over work_orders_by_project, and a local machine's work-order count keeps even
  // the full scan sub-millisecond.
  const numberById = db.raw.prepare(
    'SELECT (SELECT COUNT(*) FROM work_orders t WHERE (t.created_at, t.id) < (w.created_at, w.id)) + 1 AS rank FROM work_orders w WHERE w.id = ?',
  );
  // The composite indexes cover both orderings; ties break by id asc, matching the fake's
  // insertion order for the monotonic ids the application generates.
  const byProject = db.raw.prepare(
    'SELECT data FROM work_orders WHERE project = ? ORDER BY created_at ASC, id ASC',
  );
  const byRepo = db.raw.prepare(
    'SELECT data FROM work_orders WHERE repo = ? ORDER BY created_at ASC, id ASC',
  );
  const byProjectAndRepo = db.raw.prepare(
    'SELECT data FROM work_orders WHERE project = ? AND repo = ? ORDER BY created_at ASC, id ASC',
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
      insert.run(record.id, record.project, record.repo, record.createdAt, JSON.stringify(record));
    },

    get: async (id: WorkOrderId): Promise<WorkOrderRecord | undefined> => {
      const row = byId.get(id);
      return row === undefined ? undefined : decodeRecord(row['data']);
    },

    number: async (id: WorkOrderId): Promise<number | undefined> => {
      const row = numberById.get(id);
      return row === undefined ? undefined : Number(row['rank']);
    },

    list: async (filter: {
      readonly project?: ProjectSlug;
      readonly repo?: RepoSlug;
    }): Promise<readonly WorkOrderRecord[]> => {
      const rows =
        filter.project !== undefined && filter.repo !== undefined
          ? byProjectAndRepo.all(filter.project, filter.repo)
          : filter.project !== undefined
            ? byProject.all(filter.project)
            : filter.repo !== undefined
              ? byRepo.all(filter.repo)
              : everything.all();
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
