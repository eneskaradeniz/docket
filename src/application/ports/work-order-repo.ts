// Persistence port for work orders and their event lists.
import type {
  Actor,
  EpochMs,
  FlowSlug,
  TaskSlug,
  WorkOrderEvent,
  WorkOrderId,
  RepoSlug,
} from '../../domain/index';

export interface WorkOrderRecord {
  readonly id: WorkOrderId;
  readonly repo: RepoSlug;
  readonly flow: FlowSlug;
  readonly title: string;
  readonly task?: TaskSlug;
  readonly createdAt: EpochMs;
  readonly createdBy: Actor;
}

export interface WorkOrderRepo {
  create(record: WorkOrderRecord): Promise<void>;
  get(id: WorkOrderId): Promise<WorkOrderRecord | undefined>;
  list(filter: { readonly repo?: RepoSlug }): Promise<readonly WorkOrderRecord[]>; // createdAt asc
  appendEvent(id: WorkOrderId, event: WorkOrderEvent): Promise<void>;
  events(id: WorkOrderId): Promise<readonly WorkOrderEvent[]>; // append order
}
