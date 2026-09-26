// flow/next-action.ts — exact contract from docs/v2/domain.md section 5.
import type { FlowDef, GateDef } from '../definitions';
import type { GateSlug, RoleSlug, StageSlug } from '../shared';
import type { WorkOrderState } from './derive';

export type FlowAction =
  | { readonly kind: 'start_run'; readonly stage: StageSlug; readonly role: RoleSlug; readonly attempt: number }
  | { readonly kind: 'evaluate_gates'; readonly stage: StageSlug; readonly gates: readonly GateSlug[] }
  | { readonly kind: 'await_human'; readonly stage: StageSlug; readonly gates: readonly GateSlug[] }
  | { readonly kind: 'wait_limit' }
  | { readonly kind: 'none' };

const NONE: FlowAction = { kind: 'none' };

/** Only a person answers these two kinds; every other gate is machine-evaluated. */
const isHumanGate = (gate: GateDef): boolean => gate.kind === 'human' || gate.kind === 'page_approval';

/** The pending gates of one flavour, in the order the flow's stage defines them. */
const pendingOfKind = (
  exit: readonly GateDef[],
  pending: readonly GateSlug[],
  human: boolean,
): readonly GateSlug[] =>
  exit.filter((gate) => isHumanGate(gate) === human).map((gate) => gate.id).filter((id) => pending.includes(id));

export function nextAction(flow: FlowDef, state: WorkOrderState): FlowAction {
  // Every action but waiting on a limit names a stage; a state whose stage the flow does not
  // know has nothing actionable.
  const stage = state.stage === null ? undefined : flow.stages.find((candidate) => candidate.id === state.stage);
  if (stage === undefined) return state.status === 'limit_waiting' ? { kind: 'wait_limit' } : NONE;
  switch (state.status) {
    case 'ready':
      // A stage without a role never runs — only a person can move it, via its gates.
      return stage.role === null
        ? NONE
        : { kind: 'start_run', stage: stage.id, role: stage.role, attempt: state.attempt };
    case 'gating':
      return { kind: 'evaluate_gates', stage: stage.id, gates: pendingOfKind(stage.exit, state.pendingGates, false) };
    case 'awaiting_human':
      return { kind: 'await_human', stage: stage.id, gates: pendingOfKind(stage.exit, state.pendingGates, true) };
    case 'limit_waiting':
      return { kind: 'wait_limit' };
    default:
      return NONE; // running, blocked, done — the application waits
  }
}
