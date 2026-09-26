// The dispatcher's durable queue.
import type { QueueItem, QueueItemId } from '../../domain/index';

export interface QueueRepo {
  put(item: QueueItem): Promise<void>; // upsert by id
  remove(id: QueueItemId): Promise<void>;
  list(): Promise<readonly QueueItem[]>;
}
