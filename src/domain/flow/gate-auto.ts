// flow/gate-auto.ts — decideGateAuto, the gate-auto policy of D-10's `auto` level (R-181): which
// pending human gates of the current stage a policy actor may approve. The carve-out reads
// USER_ONLY_GATES (R-168's named constant, never a copy); every doubt answers the empty list and
// the decision stays with the human. Pure — the same inputs always give the same answer.
import type { FlowDef, GateDef } from '../definitions';
import type { AutonomyLevel, GateSlug, PolicyId } from '../shared';
import { USER_ONLY_GATES } from '../shared';
import type { WorkOrderEvent } from './events';
import type { WorkOrderState } from './derive';

const asPolicyId = (id: string): PolicyId => id as PolicyId;

/** The named rule set behind every gate-auto approval. */
export const GATE_AUTO_POLICY: PolicyId = asPolicyId('gate-auto');

/** One approval the policy may append: the gate, the deciding rule set, the level in force, and
 *  the machine gates of the current attempt the approval relies on. */
export interface GateAutoApproval {
  readonly gate: GateSlug;
  readonly policy: PolicyId;
  readonly level: AutonomyLevel;
  readonly passedMachineGates: readonly GateSlug[];
}

/** Only a person answers these two kinds; every other gate is machine-evaluated. */
const isHumanGate = (gate: GateDef): boolean => gate.kind === 'human' || gate.kind === 'page_approval';

/** The stage's machine gates — its non-human exit, in stage order. Shared with the application's
 *  decideHumanGate, so the event's evidence list and this decision name the same gates. */
export const machineGateIds = (exit: readonly GateDef[]): readonly GateSlug[] =>
  exit.filter((gate) => !isHumanGate(gate)).map((gate) => gate.id);

/** Every gate that already failed anywhere in the work order's history — a human reject is
 *  standing doubt the policy never overrides, whatever the later attempts re-armed. */
const failedGateIds = (events: readonly WorkOrderEvent[]): ReadonlySet<GateSlug> => {
  const failed = new Set<GateSlug>();
  for (const event of events) {
    if (event.type === 'gate_evaluated' && event.verdict.status === 'failed') failed.add(event.gate);
  }
  return failed;
};

export function decideGateAuto(
  flow: FlowDef,
  state: WorkOrderState,
  events: readonly WorkOrderEvent[],
  level: AutonomyLevel,
): readonly GateAutoApproval[] {
  if (state.status !== 'awaiting_human' || state.stage === null) return [];
  if (level !== 'auto') return [];
  const stage = flow.stages.find((candidate) => candidate.id === state.stage);
  if (stage === undefined) return [];
  const machineGates = machineGateIds(stage.exit);
  // A human gate with no machine gate to rely on stays with the human at every level, and so does
  // one whose stage's machine evidence is not concluded for this attempt — a pending machine gate
  // keeps the stage short of the standing a policy approval builds on.
  if (machineGates.length === 0 || machineGates.some((gate) => state.pendingGates.includes(gate))) return [];
  const failed = failedGateIds(events);
  return stage.exit
    .filter(
      (gate) =>
        gate.kind === 'human' &&
        state.pendingGates.includes(gate.id) &&
        !(USER_ONLY_GATES as readonly string[]).includes(gate.kind) &&
        !failed.has(gate.id),
    )
    .map((gate) => ({ gate: gate.id, policy: GATE_AUTO_POLICY, level, passedMachineGates: machineGates }));
}
