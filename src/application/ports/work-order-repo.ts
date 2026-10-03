// Persistence port for work orders and their event lists.
import type {
  Actor,
  EpochMs,
  FlowSlug,
  ProjectSlug,
  TaskSlug,
  WorkOrderEvent,
  WorkOrderId,
  RepoSlug,
} from '../../domain/index';

export interface WorkOrderRecord {
  readonly id: WorkOrderId;
  readonly project: ProjectSlug;
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
  /** Display number (A-29): 1-based rank of `id` by (createdAt asc, id asc) on this machine; undefined for an unknown id. */
  number(id: WorkOrderId): Promise<number | undefined>;
  list(filter: { readonly project?: ProjectSlug; readonly repo?: RepoSlug }): Promise<readonly WorkOrderRecord[]>; // createdAt asc
  appendEvent(id: WorkOrderId, event: WorkOrderEvent): Promise<void>;
  events(id: WorkOrderId): Promise<readonly WorkOrderEvent[]>; // append order
}
