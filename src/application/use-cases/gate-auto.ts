// use-cases/gate-auto.ts — rule A-410 (applyGateAutoPolicy): the gate-auto pass of D-10's auto
// level. Wherever the app has just evaluated a work order's machine gates, the pass resolves the
// effective autonomy (A-394, re-resolved per pass — R-170), asks the domain which pending human
// gates the policy may approve (R-181), and appends each approval through decideHumanGate — the
// same path and the same gate_evaluated event as a user decision. The policy only approves; any
// doubt leaves the gate pending for the human, and the next pass simply tries again.
import type { Actor, GateSlug, WorkOrderId, WorkOrderState } from '../../domain/index';
import { decideGateAuto, deriveWorkOrderState, err, ok, type Result } from '../../domain/index';

import type { AppDeps } from '../ports';

import { decideHumanGate, loadWorkOrder } from './gates';
import { effectiveAutonomy } from './work-orders';

/** The gate-auto pass's answer: the state its decisions derive, and the gates it approved — the
 *  composition root emits the work-orders-changed notification (U-12) for exactly that list, so
 *  an open detail re-queries on a policy approval and a quiet pass stays quiet on the wire. */
export interface GateAutoPass {
  readonly state: WorkOrderState;
  readonly approved: readonly GateSlug[];
}

export async function applyGateAutoPolicy(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'settings'>,
  input: { readonly id: WorkOrderId },
): Promise<Result<GateAutoPass, 'not_found'>> {
  const loaded = await loadWorkOrder(deps, input.id);
  // Same reading as decideHumanGate: without loadable definitions there is no gate to find, and
  // this pass's error vocabulary has no code for broken definitions.
  if (!loaded.ok) return err('not_found');
  const { flow, events } = loaded.value;

  // The level is re-resolved per pass, never cached across them: a level change governs only the
  // decisions made after it (R-170). An unreadable level is the typed read's own surface — the
  // pass writes nothing and stays quiet, exactly like the executor's permission ask.
  const state = deriveWorkOrderState(flow, events);
  const autonomy = await effectiveAutonomy(deps, {
    workOrder: input.id,
    ...(state.stage !== null ? { stage: state.stage } : {}),
  });
  if (!autonomy.ok) {
    return ok({ state, approved: [] });
  }

  const approvals = decideGateAuto(flow, state, events, autonomy.value.level);
  const approved: GateSlug[] = [];
  for (const approval of approvals) {
    const actor: Actor = { kind: 'policy', policy: approval.policy, level: approval.level };
    const decided = await decideHumanGate(deps, {
      id: input.id,
      gate: approval.gate,
      decision: 'approved',
      actor,
    });
    // A refusal or a state that moved under the pass stops it: the rest stays pending for the
    // human, and the next pass re-reads the world as it then is.
    if (!decided.ok) break;
    approved.push(approval.gate);
  }
  return ok({ state: deriveWorkOrderState(flow, await deps.workOrders.events(input.id)), approved });
}
