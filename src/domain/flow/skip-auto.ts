// flow/skip-auto.ts — decideStageSkipAuto, the stage-skip policy arm of D-10's `auto` level (R-189):
// which pending planner stage-skip proposals a policy actor may approve. Every doubt answers the empty
// list and the decision stays with the human. Pure — the same inputs always give the same answer.
import type { FlowDef } from '../definitions';
import type { AutonomyLevel, PolicyId, StageSlug } from '../shared';
import { USER_ONLY_GATES } from '../shared';
import { stageExitBlocksSkip, type WorkOrderState } from './derive';
import type { WorkOrderEvent } from './events';

const asPolicyId = (id: string): PolicyId => id as PolicyId;

/** The named rule set behind every stage-skip-auto approval. */
export const STAGE_SKIP_AUTO_POLICY: PolicyId = asPolicyId('stage-skip-auto');

/** One approval the policy may append: the stages to skip, the deciding rule set, and the level in force. */
export interface StageSkipAutoApproval {
  readonly stages: readonly StageSlug[];
  readonly policy: PolicyId;
  readonly level: AutonomyLevel;
}

export function decideStageSkipAuto(
  flow: FlowDef,
  state: WorkOrderState,
  events: readonly WorkOrderEvent[],
  level: AutonomyLevel,
): readonly StageSkipAutoApproval[] {
  // Condition 1: level === 'auto' only.
  if (level !== 'auto') return [];

  // Condition 3: state.status is live and neither blocked nor done.
  if (state.status === 'blocked' || state.status === 'done' || state.stage === null) return [];

  // Condition 2, 4, 5: walk events to track pending proposal, failed gates, and rejected skips.
  let pending: readonly StageSlug[] | null = null;
  for (const event of events) {
    if (event.type === 'stage_skip_proposed') {
      pending = event.stages;
    } else if (event.type === 'stage_skip_decided') {
      // Condition 5: No stage_skip_decided event in events has approved === false.
      if (!event.approved) return [];
      pending = null;
    } else if (event.type === 'gate_evaluated') {
      // Condition 4: No gate_evaluated event in events has verdict.status === 'failed'.
      if (event.verdict.status === 'failed') return [];
    }
  }

  // Condition 2: A pending stage_skip_proposed must exist and be non-empty.
  if (pending === null || pending.length === 0) return [];

  // Condition 6: Current stage index must be >= 0.
  const currentIdx = flow.stages.findIndex((s) => s.id === state.stage);
  if (currentIdx < 0) return [];

  // Every stage id in pending must exist in flow.stages at an index idx > currentIdx,
  // must not satisfy stageExitBlocksSkip(stage), and must have no exit gate whose kind is in USER_ONLY_GATES.
  // Any failure refuses the whole proposal (no partial approvals).
  const userOnlyKinds = USER_ONLY_GATES as readonly string[];
  for (const stageId of pending) {
    const targetIdx = flow.stages.findIndex((s) => s.id === stageId);
    if (targetIdx <= currentIdx) return [];
    const targetStage = flow.stages[targetIdx];
    if (stageExitBlocksSkip(targetStage)) return [];
    if (targetStage.exit.some((gate) => userOnlyKinds.includes(gate.kind))) return [];
  }

  return [{ stages: pending, policy: STAGE_SKIP_AUTO_POLICY, level: 'auto' }];
}
