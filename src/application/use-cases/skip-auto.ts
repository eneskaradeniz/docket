// use-cases/skip-auto.ts — rule A-432 (applyStageSkipAutoPolicy): the stage-skip auto pass
// of D-10's auto level. Wherever a run finishes or on the periodic sweep, the pass resolves the
// effective autonomy (R-170, re-resolved per pass), asks the domain which pending stage-skip
// proposals the policy may approve (R-189), and appends each approval as a stage_skip_decided
// event with decidedByPolicy evidence (R-190). Purity, defense-in-depth, and every doubt writes nothing.
import type { Result, StageSkipAutoApproval, WorkOrderId, WorkOrderState } from '../../domain/index';
import { decideStageSkipAuto, deriveWorkOrderState, err, ok } from '../../domain/index';

import type { AppDeps } from '../ports';
import { loadWorkOrder } from './gates';
import { effectiveAutonomy } from './work-orders';

export type SkipAutoDeps = Pick<AppDeps, 'clock' | 'workOrders' | 'definitions' | 'settings'>;

export interface ApplyStageSkipAutoInput {
  readonly id: WorkOrderId;
}

export interface StageSkipAutoPass {
  readonly state: WorkOrderState;
  readonly decided: readonly StageSkipAutoApproval[];
}

export async function applyStageSkipAutoPolicy(
  deps: SkipAutoDeps,
  input: ApplyStageSkipAutoInput,
): Promise<Result<StageSkipAutoPass, 'not_found'>> {
  const loaded = await loadWorkOrder(deps, input.id);
  if (!loaded.ok) return err('not_found');
  const { flow } = loaded.value;

  const events = await deps.workOrders.events(input.id);
  const state = deriveWorkOrderState(flow, events);

  // The level is re-resolved per pass, never cached across them (R-170).
  // An unreadable level writes nothing and stays quiet.
  const resolved = await effectiveAutonomy(deps, {
    workOrder: input.id,
    ...(state.stage !== null ? { stage: state.stage } : {}),
  });
  if (!resolved.ok) {
    return ok({ state, decided: [] });
  }

  const approvals = decideStageSkipAuto(flow, state, events, resolved.value.level);
  if (approvals.length === 0) {
    return ok({ state, decided: [] });
  }

  const decided: StageSkipAutoApproval[] = [];
  for (const approval of approvals) {
    // Defense-in-depth: verify both resolved autonomy level and approval level are 'auto'.
    if (resolved.value.level !== 'auto' || approval.level !== 'auto') continue;

    await deps.workOrders.appendEvent(input.id, {
      type: 'stage_skip_decided',
      at: deps.clock.now(),
      approved: true,
      decidedByPolicy: { policy: approval.policy, level: approval.level },
    });
    decided.push(approval);
  }

  const after = await loadWorkOrder(deps, input.id);
  const finalState = after.ok ? after.value.state : deriveWorkOrderState(flow, await deps.workOrders.events(input.id));
  return ok({ state: finalState, decided });
}
