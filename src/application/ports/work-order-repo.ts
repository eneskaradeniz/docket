// Persistence port for work orders and their event lists.
import type {
  Actor,
  AutonomyLevel,
  EpochMs,
  FlowSlug,
  FlowPin,
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
  /** Absent when the operator wrote none, and on every row stored before the field existed. */
  readonly description?: string;
  readonly task?: TaskSlug;
  /** A-324/A-344: the pinned flow and role definitions, stored at creation. Absent on rows
   *  stored before Phase 7 and on work orders opened against a repo without a Phase 7 flow. */
  readonly pin?: FlowPin;
  /** The work-order layer of the autonomy chain (D-10, A-394): stored verbatim, absent on every
   *  row stored before the field existed — absence inherits down the chain. */
  readonly autonomy?: AutonomyLevel;
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
