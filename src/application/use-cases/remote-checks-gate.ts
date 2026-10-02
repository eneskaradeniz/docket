// use-cases/remote-checks-gate.ts — the dispatcher's poll of a remote_checks gate. The forge is
// asked for the branch's check runs, they are matched against the gate's `required` list and
// reduced to one status, and the domain's evaluator turns that status into the verdict recorded
// as a single gate_evaluated event. A still-pending poll records nothing: the dispatcher re-polls.
import type {
  Definitions,
  EpochMs,
  FlowDef,
  GateContext,
  GateDef,
  GateEvidence,
  GateSlug,
  RepoRef,
  Result,
  StageSlug,
  WorkOrderEvent,
  WorkOrderId,
  WorkOrderState,
} from '../../domain/index';
import { MINUTE, deriveWorkOrderState, err, evaluateGate, ok } from '../../domain/index';

import type { AppDeps, CheckRun, ForgeResolver } from '../ports';

type LoadError = 'not_found' | 'definitions_invalid';

interface LoadedWorkOrder {
  readonly definitions: Definitions;
  readonly flow: FlowDef;
  readonly events: readonly WorkOrderEvent[];
  readonly state: WorkOrderState;
}

const loadWorkOrder = async (
  deps: Pick<AppDeps, 'workOrders' | 'definitions'>,
  id: WorkOrderId,
): Promise<Result<LoadedWorkOrder, LoadError>> => {
  const record = await deps.workOrders.get(id);
  if (record === undefined) return err('not_found');
  const definitions = await deps.definitions.load(record.repo);
  if (!definitions.ok) return err('definitions_invalid');
  const flow = definitions.value.flows.find((candidate) => candidate.id === record.flow);
  if (flow === undefined) return err('not_found');
  const events = await deps.workOrders.events(id);
  return ok({ definitions: definitions.value, flow, events, state: deriveWorkOrderState(flow, events) });
};

/** The current stage's exit gate with that id; undefined when the work order is done or the gate
 *  belongs to another stage. */
const findCurrentGate = (
  flow: FlowDef,
  state: WorkOrderState,
  gate: GateSlug,
): { readonly stage: StageSlug; readonly gate: GateDef } | undefined => {
  if (state.stage === null) return undefined;
  const stage = flow.stages.find((candidate) => candidate.id === state.stage);
  if (stage === undefined) return undefined;
  const found = stage.exit.find((candidate) => candidate.id === gate);
  return found === undefined ? undefined : { stage: state.stage, gate: found };
};

const gateContext = (definitions: Definitions): GateContext => ({
  commandSets: definitions.repo?.commandSets ?? {},
  environments: definitions.repo?.environments,
});

type RemoteChecksGate = Extract<GateDef, { readonly kind: 'remote_checks' }>;
type RemoteStatus = NonNullable<GateEvidence['remoteChecks']>['status'];

/** The checks the gate cares about: all of them, or only those named in `required`. */
const matchedChecks = (gate: RemoteChecksGate, checks: readonly CheckRun[]): readonly CheckRun[] =>
  gate.required === 'all' ? checks : checks.filter((check) => gate.required.includes(check.name));

/** A poll that matched nothing has no evidence that anything passed, and a required name the
 *  forge has not reported is a check with no result yet — both wait like an unfinished check
 *  instead of passing vacuously. */
const reduceStatus = (gate: RemoteChecksGate, matched: readonly CheckRun[]): RemoteStatus => {
  if (matched.length === 0) return 'pending';
  if (matched.some((check) => check.status === 'failed' || check.status === 'cancelled')) return 'has_failure';
  if (gate.required !== 'all') {
    const reported = new Set(matched.map((check) => check.name));
    if (gate.required.some((name) => !reported.has(name))) return 'pending';
  }
  return matched.every((check) => check.status === 'passed') ? 'all_passed' : 'pending';
};

/** When the gate became pending. Membership in `pendingGates` only changes when the fold enters
 *  (or re-enters) a stage, so replaying prefixes backwards finds the newest event whose
 *  application left the gate pending — the start of its current pending run. */
const pendingSince = (
  flow: FlowDef,
  events: readonly WorkOrderEvent[],
  gate: GateSlug,
): EpochMs | undefined => {
  let since: EpochMs | undefined;
  for (let i = events.length; i > 0; i -= 1) {
    if (!deriveWorkOrderState(flow, events.slice(0, i)).pendingGates.includes(gate)) break;
    since = events[i - 1].at;
  }
  return since;
};

export type RemoteChecksError =
  | 'not_found' | 'not_current_stage' | 'not_pending' | 'not_a_remote_checks_gate'
  | 'forge_unavailable' | 'forge_error';

export async function pollRemoteChecks(
  deps: Pick<AppDeps, 'clock' | 'workOrders' | 'definitions'>,
  forges: ForgeResolver,
  input: {
    readonly id: WorkOrderId;
    readonly gate: GateSlug;
    readonly branchRef: string;
    readonly repo: RepoRef;
  },
): Promise<Result<WorkOrderState, RemoteChecksError>> {
  const loaded = await loadWorkOrder(deps, input.id);
  // Same reading as decideHumanGate: without loadable definitions there is no gate to find, and
  // this use case's error vocabulary has no code for broken definitions.
  if (!loaded.ok) return err('not_found');
  const { definitions, flow, events, state } = loaded.value;

  const current = findCurrentGate(flow, state, input.gate);
  if (current === undefined) return err('not_current_stage');
  if (!state.pendingGates.includes(input.gate)) return err('not_pending');
  if (current.gate.kind !== 'remote_checks') return err('not_a_remote_checks_gate');
  const remoteGate = current.gate;

  const forge = await forges.forRepo(input.repo);
  if (forge === undefined) return err('forge_unavailable');
  const checks = await forge.checks(input.repo, input.branchRef);
  if (!checks.ok) return err('forge_error');

  const matched = matchedChecks(remoteGate, checks.value);
  let status = reduceStatus(remoteGate, matched);
  // The deadline only guards a poll still waiting on checks: a result that already arrived within
  // the window must not be discarded because this particular poll ran late.
  const since = pendingSince(flow, events, input.gate);
  if (status === 'pending' && since !== undefined) {
    const elapsed = deps.clock.now() - since;
    if (elapsed > remoteGate.timeoutMinutes * MINUTE) status = 'timeout';
  }

  if (status === 'pending') return ok(state);

  const evidence: GateEvidence = {
    remoteChecks: {
      checks: matched.map((check) => ({ name: check.name, status: check.status })),
      status,
    },
  };
  const event: WorkOrderEvent = {
    type: 'gate_evaluated',
    at: deps.clock.now(),
    stage: current.stage,
    gate: input.gate,
    verdict: evaluateGate(remoteGate, evidence, gateContext(definitions)),
  };
  await deps.workOrders.appendEvent(input.id, event);
  return ok(deriveWorkOrderState(flow, [...events, event]));
}
