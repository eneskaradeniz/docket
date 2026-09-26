// In-memory WorkOrderRepo — work orders keyed by id, events kept per work order.
import type { WorkOrderEvent, WorkOrderId, WorkspaceSlug } from '../../../domain/index';

import type { WorkOrderRecord, WorkOrderRepo } from '../work-order-repo';

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeWorkOrderRepo extends WorkOrderRepo {}

export const createFakeWorkOrderRepo = (): FakeWorkOrderRepo => {
  const byId = new Map<WorkOrderId, WorkOrderRecord>();
  const eventsById = new Map<WorkOrderId, WorkOrderEvent[]>();

  return {
    // A duplicate create is fixture misuse — silently overwriting would hide the bug.
    create: async (record: WorkOrderRecord): Promise<void> => {
      if (byId.has(record.id)) throw new Error(`work order ${record.id} already exists`);
      byId.set(record.id, { ...record });
    },

    get: async (id: WorkOrderId): Promise<WorkOrderRecord | undefined> => byId.get(id),

    // Stable sort keeps insertion order on createdAt ties.
    list: async (filter: { readonly workspace?: WorkspaceSlug }): Promise<readonly WorkOrderRecord[]> =>
      [...byId.values()]
        .filter((record) => filter.workspace === undefined || record.workspace === filter.workspace)
        .sort((a, b) => a.createdAt - b.createdAt),

    appendEvent: async (id: WorkOrderId, event: WorkOrderEvent): Promise<void> => {
      if (!byId.has(id)) throw new Error(`work order ${id} does not exist`);
      const events = eventsById.get(id);
      if (events === undefined) eventsById.set(id, [event]);
      else events.push(event);
    },

    events: async (id: WorkOrderId): Promise<readonly WorkOrderEvent[]> => [...(eventsById.get(id) ?? [])],
  };
};
