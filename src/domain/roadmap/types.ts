// roadmap/types.ts — exact contract from docs/v2/domain.md section 10.
import type { WorkOrderStatus } from '../flow';
import type { PhaseSlug, TaskSlug } from '../shared';

export interface TaskDef {
  readonly id: TaskSlug;
  readonly title: string;
  readonly dependsOn: readonly TaskSlug[]; // any task in the roadmap
  readonly acceptance: readonly string[];
  readonly repo?: string;
}

export interface PhaseDef {
  readonly id: PhaseSlug;
  readonly name: string;
  readonly blockedBy: readonly PhaseSlug[];
  readonly tasks: readonly TaskDef[];
}

export interface Roadmap {
  readonly phases: readonly PhaseDef[];
}

export type RoadmapIssueCode =
  | 'invalid_slug'
  | 'duplicate_id'
  | 'unknown_task'
  | 'unknown_phase'
  | 'task_cycle'
  | 'phase_cycle'
  | 'cross_cycle'
  | 'missing_field'
  | 'wrong_type';

export interface RoadmapIssue {
  readonly path: string;
  readonly code: RoadmapIssueCode;
  readonly message: string;
}

export type TaskStatus = 'planned' | 'waiting' | 'running' | 'done';
export type PhaseStatus = 'planned' | 'waiting' | 'running' | 'done';

export interface LinkedWorkOrder {
  readonly task: TaskSlug;
  readonly status: WorkOrderStatus;
}

export interface RoadmapView {
  readonly tasks: Readonly<Record<string, TaskStatus>>; // TaskSlug → status
  readonly phases: Readonly<Record<string, PhaseStatus>>; // PhaseSlug → status
  readonly runnable: readonly TaskSlug[]; // in roadmap order
}
