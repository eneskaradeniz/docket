// Persistence port for runs and their streamed agent events.
import type {
  AccountRoute,
  AgentEvent,
  EpochMs,
  RoleSlug,
  RollingNote,
  RunId,
  RunOutcome,
  StageSlug,
  WorkOrderId,
} from '../../domain/index';

export interface RunRecord {
  readonly id: RunId;
  readonly workOrderId: WorkOrderId;
  readonly stage: StageSlug;
  readonly attempt: number;
  readonly role: RoleSlug;
  readonly route: AccountRoute;
  readonly definitionsRev?: string; // revision marker of the definitions the stage prompt was computed from; drives A-62's changed-note
  readonly startedAt: EpochMs;
  readonly endedAt?: EpochMs;
  readonly outcome?: RunOutcome;
  readonly sessionRef?: string;
  readonly autoResumesUsed: number;
}

export type RunPatch = Partial<Pick<RunRecord, 'endedAt' | 'outcome' | 'sessionRef' | 'autoResumesUsed'>>;

export interface RunRepo {
  create(record: RunRecord): Promise<void>;
  update(id: RunId, patch: RunPatch): Promise<void>;
  get(id: RunId): Promise<RunRecord | undefined>;
  listForWorkOrder(id: WorkOrderId): Promise<readonly RunRecord[]>; // startedAt asc
  listActive(): Promise<readonly RunRecord[]>; // no endedAt
  appendEvents(id: RunId, events: readonly AgentEvent[]): Promise<void>;
  events(id: RunId): Promise<readonly AgentEvent[]>;
  saveHandoffNote(id: RunId, note: RollingNote): Promise<void>;
  handoffNote(id: RunId): Promise<RollingNote | undefined>;
  /** The first checkpoint sha of the run's stage attempt; set by the executor (A-59). */
  saveStageBase(id: RunId, sha: string): Promise<void>;
  stageBase(id: RunId): Promise<string | undefined>;
}
