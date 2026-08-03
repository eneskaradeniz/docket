// ADR-0001 forward: each gated WO-level stage names the evidence it requires.
// Single source for deriveRail (needs), deriveEvidence (WO-level), derivePrimaryAction (absent-when-unsatisfied).
import type { EvidenceKind, StageId } from './types';

export const GATES: Partial<Record<StageId, EvidenceKind[]>> = {
  architect_approval: ['plan_approval'],
  verification: ['verification'],
  closure: ['closure'],
};
