// SQLite-backed run repository; index columns keep `listActive` cheap via a partial index.
import type { RunPatch, RunRecord, RunRepo } from '../../../application/index';
import type { AgentEvent, RunId, WorkOrderId } from '../../../domain/index';

import type { DocketDb } from './database';

const decodeRecord = (text: unknown): RunRecord => {
  if (typeof text !== 'string') throw new Error('runs.data must hold text');
  return JSON.parse(text) as RunRecord;
};

const decodeEvent = (text: unknown): AgentEvent => {
  if (typeof text !== 'string') throw new Error('run_events.data must hold text');
  return JSON.parse(text) as AgentEvent;
};

export function createSqliteRunRepo(db: DocketDb): RunRepo {
  const insert = db.raw.prepare(
    'INSERT INTO runs (id, work_order_id, started_at, ended_at, data) VALUES (?, ?, ?, ?, ?)',
  );
  const byId = db.raw.prepare('SELECT data FROM runs WHERE id = ?');
  const byWorkOrder = db.raw.prepare(
    'SELECT data FROM runs WHERE work_order_id = ? ORDER BY started_at ASC, id ASC',
  );
  const active = db.raw.prepare(
    'SELECT data FROM runs WHERE ended_at IS NULL ORDER BY started_at ASC, id ASC',
  );
  // Every index column is rewritten from the merged record so `ended_at` tracks the patch.
  const updateRun = db.raw.prepare(
    'UPDATE runs SET work_order_id = ?, started_at = ?, ended_at = ?, data = ? WHERE id = ?',
  );
  const maxSeq = db.raw.prepare(
    'SELECT COALESCE(MAX(seq), 0) AS previous FROM run_events WHERE run_id = ?',
  );
  const insertEvent = db.raw.prepare('INSERT INTO run_events (run_id, seq, data) VALUES (?, ?, ?)');
  const eventsFor = db.raw.prepare('SELECT data FROM run_events WHERE run_id = ? ORDER BY seq ASC');

  return {
    create: async (record: RunRecord): Promise<void> => {
      insert.run(record.id, record.workOrderId, record.startedAt, record.endedAt ?? null, JSON.stringify(record));
    },

    update: async (id: RunId, patch: RunPatch): Promise<void> => {
      const row = byId.get(id);
      if (row === undefined) throw new Error(`run ${id} does not exist`);
      const next: RunRecord = { ...decodeRecord(row['data']), ...patch };
      updateRun.run(next.workOrderId, next.startedAt, next.endedAt ?? null, JSON.stringify(next), id);
    },

    get: async (id: RunId): Promise<RunRecord | undefined> => {
      const row = byId.get(id);
      return row === undefined ? undefined : decodeRecord(row['data']);
    },

    listForWorkOrder: async (id: WorkOrderId): Promise<readonly RunRecord[]> =>
      byWorkOrder.all(id).map((row) => decodeRecord(row['data'])),

    listActive: async (): Promise<readonly RunRecord[]> =>
      active.all().map((row) => decodeRecord(row['data'])),

    appendEvents: async (id: RunId, events: readonly AgentEvent[]): Promise<void> => {
      // One transaction: the batch is all-or-none, seq continues from the previous max, and an
      // unknown run fails before any row is written.
      db.transaction(() => {
        if (byId.get(id) === undefined) throw new Error(`run ${id} does not exist`);
        const row = maxSeq.get(id);
        let seq = row === undefined ? 0 : Number(row['previous']);
        for (const event of events) {
          seq += 1;
          insertEvent.run(id, seq, JSON.stringify(event));
        }
      });
    },

    events: async (id: RunId): Promise<readonly AgentEvent[]> =>
      eventsFor.all(id).map((row) => decodeEvent(row['data'])),
  };
}
