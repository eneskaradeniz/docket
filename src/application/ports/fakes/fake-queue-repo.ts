// In-memory QueueRepo — the dispatcher's queue as an id-keyed map.
import type { QueueItem, QueueItemId } from '../../../domain/index';

import type { QueueRepo } from '../queue-repo';

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeQueueRepo extends QueueRepo {}

export const createFakeQueueRepo = (): FakeQueueRepo => {
  // Map keys keep their first insertion position, so an upsert never reorders the queue.
  const byId = new Map<QueueItemId, QueueItem>();

  return {
    put: async (item: QueueItem): Promise<void> => {
      byId.set(item.id, { ...item });
    },

    remove: async (id: QueueItemId): Promise<void> => {
      byId.delete(id);
    },

    list: async (): Promise<readonly QueueItem[]> => [...byId.values()],
  };
};
