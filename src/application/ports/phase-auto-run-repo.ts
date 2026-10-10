// The persisted record of a phase the operator started: one per (project, phase).
import type { PhaseAutoRun, PhaseSlug, ProjectSlug } from '../../domain/index';

export interface PhaseAutoRunRepo {
  get(project: ProjectSlug, phase: PhaseSlug): Promise<PhaseAutoRun | undefined>;
  /** Upserts the record of its (project, phase); the store keeps a copy. */
  put(record: PhaseAutoRun): Promise<void>;
  /** Every record, ordered by project then phase. */
  list(): Promise<readonly PhaseAutoRun[]>;
}
