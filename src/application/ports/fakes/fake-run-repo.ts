// In-memory RunRepo — runs keyed by id, streamed agent events kept per run.
import type { AgentEvent, RunId, WorkOrderId } from '../../../domain/index';

import type { RunPatch, RunRecord, RunRepo } from '../run-repo';

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeRunRepo extends RunRepo {}

export const createFakeRunRepo = (): FakeRunRepo => {
  const byId = new Map<RunId, RunRecord>();
  const eventsById = new Map<RunId, AgentEvent[]>();

  return {
    create: async (record: RunRecord): Promise<void> => {
      if (byId.has(record.id)) throw new Error(`run ${record.id} already exists`);
      byId.set(record.id, { ...record });
    },

    update: async (id: RunId, patch: RunPatch): Promise<void> => {
      const existing = byId.get(id);
      if (existing === undefined) throw new Error(`run ${id} does not exist`);
      byId.set(id, { ...existing, ...patch });
    },

    get: async (id: RunId): Promise<RunRecord | undefined> => byId.get(id),

    // Stable sorts keep insertion order on startedAt ties.
    listForWorkOrder: async (id: WorkOrderId): Promise<readonly RunRecord[]> =>
      [...byId.values()].filter((record) => record.workOrderId === id).sort((a, b) => a.startedAt - b.startedAt),

    listActive: async (): Promise<readonly RunRecord[]> =>
      [...byId.values()].filter((record) => record.endedAt === undefined).sort((a, b) => a.startedAt - b.startedAt),

    appendEvents: async (id: RunId, events: readonly AgentEvent[]): Promise<void> => {
      if (!byId.has(id)) throw new Error(`run ${id} does not exist`);
      const existing = eventsById.get(id);
      if (existing === undefined) eventsById.set(id, [...events]);
      else existing.push(...events);
    },

    events: async (id: RunId): Promise<readonly AgentEvent[]> => [...(eventsById.get(id) ?? [])],
  };
};
