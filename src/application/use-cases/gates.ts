// use-cases/gates.ts — human decisions, machine-gate evaluation and agent verdicts. Every verdict
// is judged by the domain's evaluateGate and recorded as one gate_evaluated event on the work
// order; the application only gathers evidence through ports and writes results back.
import type {
  Actor,
  Definitions,
  FlowDef,
  GateContext,
  GateDef,
  GateEvidence,
  GateSlug,
  GateVerdict,
  RepoRef,
  Result,
  StageSlug,
  WorkOrderEvent,
  WorkOrderId,
  WorkOrderState,
} from '../../domain/index';
import { MINUTE, deriveWorkOrderState, err, evaluateGate, ok } from '../../domain/index';

import type { AppDeps, ForgeResolver, WorkOrderRecord } from '../ports';

import { pollRemoteChecks } from './remote-checks-gate';

/** A gate's commands run in the work order's worktree, ten minutes each. */
const COMMAND_TIMEOUT_MS = 10 * MINUTE;

type LoadError = 'not_found' | 'definitions_invalid';

interface LoadedWorkOrder {
  readonly record: WorkOrderRecord;
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
  return ok({
    record,
    definitions: definitions.value,
    flow,
    events,
    state: deriveWorkOrderState(flow, events),
  });
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

/** Records one decided gate — the event on the work order plus its audit entry — and returns the
 *  state that event derives. */
const recordGateDecision = async (
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders'>,
  decided: {
    readonly id: WorkOrderId;
    readonly stage: StageSlug;
    readonly gate: GateSlug;
    readonly verdict: GateVerdict;
    readonly decision: 'approved' | 'rejected';
    readonly actor: Actor;
  },
  flow: FlowDef,
  events: readonly WorkOrderEvent[],
): Promise<WorkOrderState> => {
  const now = deps.clock.now();
  const event: WorkOrderEvent = {
    type: 'gate_evaluated',
    at: now,
    stage: decided.stage,
    gate: decided.gate,
    verdict: decided.verdict,
  };
  await deps.workOrders.appendEvent(decided.id, event);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: now,
    actor: decided.actor,
    action: 'gate.decided',
    subject: { kind: 'work_order', id: decided.id },
    detail: { gate: decided.gate, decision: decided.decision },
  });
  return deriveWorkOrderState(flow, [...events, event]);
};

/** The `page_approval` gate the work order's current stage is waiting on, if any — the gate a page
 *  approval decides. Undefined when the work order or its definitions are gone, or when nothing of
 *  that kind is pending (the stage moved on, or another gate kind is the one waiting). */
export async function pendingPageApprovalGate(
  deps: Pick<AppDeps, 'workOrders' | 'definitions'>,
  id: WorkOrderId,
): Promise<GateSlug | undefined> {
  const loaded = await loadWorkOrder(deps, id);
  if (!loaded.ok) return undefined;
  const { flow, state } = loaded.value;
  if (state.status !== 'awaiting_human' || state.stage === null) return undefined;
  const stage = flow.stages.find((candidate) => candidate.id === state.stage);
  return stage?.exit.find((gate) => gate.kind === 'page_approval' && state.pendingGates.includes(gate.id))?.id;
}

export type DecideGateError = 'not_found' | 'not_current_stage' | 'not_pending' | 'not_a_human_gate' | 'agent_cannot_decide';

export async function decideHumanGate(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'>,
  input: {
    readonly id: WorkOrderId;
    readonly gate: GateSlug;
    readonly decision: 'approved' | 'rejected';
    readonly note?: string;
    readonly actor: Actor;
  },
): Promise<Result<WorkOrderState, DecideGateError>> {
  const loaded = await loadWorkOrder(deps, input.id);
  // Neither a missing work order nor unloadable definitions leaves a gate to locate, and this
  // use case's error vocabulary has no code for broken definitions: the gate the caller asked
  // for simply cannot be found.
  if (!loaded.ok) return err('not_found');
  const { definitions, flow, events, state } = loaded.value;
  const current = findCurrentGate(flow, state, input.gate);
  if (current === undefined) return err('not_current_stage');
  if (current.gate.kind !== 'human' && current.gate.kind !== 'page_approval') return err('not_a_human_gate');
  if (input.actor.kind === 'agent') return err('agent_cannot_decide');
  // A human decision lands only while the stage actually waits for one. In every other status
  // the pending list is the fold's pre-fill (or residue) of the stage's gates, and a
  // gate_evaluated event now would be a dead fact the fold ignores.
  if (state.status !== 'awaiting_human' || !state.pendingGates.includes(input.gate)) return err('not_pending');

  const evidence: GateEvidence =
    current.gate.kind === 'page_approval'
      ? { pageApproval: { decision: input.decision, by: input.actor } }
      : {
          approval:
            input.note === undefined
              ? { decision: input.decision, by: input.actor }
              : { decision: input.decision, by: input.actor, note: input.note },
        };
  const verdict = evaluateGate(current.gate, evidence, gateContext(definitions));
  const stateAfter = await recordGateDecision(
    deps,
    { id: input.id, stage: current.stage, gate: input.gate, verdict, decision: input.decision, actor: input.actor },
    flow,
    events,
  );
  return ok(stateAfter);
}

/** Runs a whole command set in order, shaped the way the gate evaluator reads its evidence. */
const runCommandSet = async (
  deps: Pick<AppDeps, 'commands'>,
  cwd: string,
  commands: readonly string[],
): Promise<NonNullable<GateEvidence['commands']>> => {
  const results: Record<string, { readonly exitCode: number }> = {};
  for (const command of commands) {
    const result = await deps.commands.run(cwd, command, COMMAND_TIMEOUT_MS);
    results[command] = { exitCode: result.exitCode };
  }
  return results;
};

/** The changes gate's measured evidence: files changed since the work order's worktree base. A
 *  git failure surfaces as itself and never folds into a count — only the port's own file list
 *  decides the number. */
const countChangedFiles = async (
  deps: Pick<AppDeps, 'checkpoints'>,
  input: { readonly cwd: string; readonly workOrderId: WorkOrderId },
): Promise<Result<number, 'git_failed'>> => {
  const base = await deps.checkpoints.base(input);
  if (!base.ok) return err(base.error);
  const diff = await deps.checkpoints.diffSince({ cwd: input.cwd, since: base.value });
  if (!diff.ok) return err(diff.error);
  return ok(diff.value.files.length);
};

/** Evaluates every pending machine gate of the current stage that a machine can conclude:
 *  changes, command and secret_scan gates, then remote_checks gates when the caller brought a
 *  forge. agent_verdict gates wait for their reviewer (submitAgentVerdict); deploy gates wait for
 *  a human (approveAndDeploy) — a deploy is never decided by a machine pass. */
export async function evaluateMachineGates(
  deps: Pick<AppDeps, 'clock' | 'workOrders' | 'definitions' | 'commands' | 'secretScanner' | 'worktrees' | 'runs' | 'checkpoints'>,
  input: {
    readonly id: WorkOrderId;
    /** Without this the stage's remote_checks gates are left pending — there is no forge to ask. */
    readonly remote?: {
      readonly forges: ForgeResolver;
      readonly repo: RepoRef;
      readonly branchRef: string;
    };
  },
): Promise<Result<WorkOrderState, 'not_found' | 'not_gating' | 'definitions_invalid' | 'no_repo' | 'git_failed'>> {
  const loaded = await loadWorkOrder(deps, input.id);
  if (!loaded.ok) return err(loaded.error);
  const { record, definitions, flow, events, state } = loaded.value;
  if (state.status !== 'gating') return err('not_gating');
  const worktree = await deps.worktrees.ensure(record.repo, record.id);
  if (!worktree.ok) return err('no_repo');
  const ctx = gateContext(definitions);

  let history = events;
  // Whether a zero-measured changes gate halted the pass: the gates behind it — and the remote
  // polls after the loop — belong to the same machine pass, so they wait with it.
  let haltedForAttestation = false;
  // One gate at a time, re-deriving in between: a verdict can advance, retry or block the stage,
  // and a gate that is no longer pending must not be evaluated — its event would be a dead fact.
  for (;;) {
    const current = deriveWorkOrderState(flow, history);
    if (current.status !== 'gating' || current.stage === null) break;
    const stage = flow.stages.find((candidate) => candidate.id === current.stage);
    if (stage === undefined) break;
    const gate = stage.exit.find(
      (candidate) =>
        current.pendingGates.includes(candidate.id) &&
        (candidate.kind === 'command' || candidate.kind === 'secret_scan' || candidate.kind === 'changes'),
    );
    if (gate === undefined) break;

    // A changes gate the diff measures at zero has no machine verdict (R-61): no event, and the
    // pass ends there — the operator's attestation decides, and the gates behind it (a long test
    // run, a forge poll) wait for that decision instead of running against a nothing-changed tree.
    if (gate.kind === 'changes') {
      const filesChanged = await countChangedFiles(deps, { cwd: worktree.value.path, workOrderId: record.id });
      if (!filesChanged.ok) return err(filesChanged.error);
      if (filesChanged.value === 0) {
        haltedForAttestation = true;
        break;
      }
      const measured: WorkOrderEvent = {
        type: 'gate_evaluated',
        at: deps.clock.now(),
        stage: current.stage,
        gate: gate.id,
        verdict: evaluateGate(gate, { changes: { filesChanged: filesChanged.value } }, ctx),
      };
      history = [...history, measured];
      await deps.workOrders.appendEvent(input.id, measured);
      continue;
    }

    const evidence: GateEvidence =
      gate.kind === 'command'
        ? { commands: await runCommandSet(deps, worktree.value.path, ctx.commandSets[gate.commandSet] ?? []) }
        : { secretScan: await deps.secretScanner.scan(worktree.value.path) };

    const event: WorkOrderEvent = {
      type: 'gate_evaluated',
      at: deps.clock.now(),
      stage: current.stage,
      gate: gate.id,
      verdict: evaluateGate(gate, evidence, ctx),
    };
    history = [...history, event];
    await deps.workOrders.appendEvent(input.id, event);
  }

  // remote_checks gates come after the local ones. Each poll is delegated whole — it reloads,
  // judges and records its own event — so this loop re-reads history instead of extending it.
  // A pass halted for an attestation polls nothing (A-96): the polls are part of that pass.
  if (input.remote !== undefined && !haltedForAttestation) {
    const polled = new Set<GateSlug>();
    for (;;) {
      const current = deriveWorkOrderState(flow, await deps.workOrders.events(input.id));
      if (current.status !== 'gating' || current.stage === null) break;
      const stage = flow.stages.find((candidate) => candidate.id === current.stage);
      if (stage === undefined) break;
      const gate = stage.exit.find(
        (candidate) =>
          candidate.kind === 'remote_checks' &&
          current.pendingGates.includes(candidate.id) &&
          !polled.has(candidate.id),
      );
      if (gate === undefined) break;
      // One poll per gate per call: an unconcluded poll stays pending for the dispatcher's next
      // tick, and a poll that cannot reach a verdict must not fail the rest of the evaluation.
      polled.add(gate.id);
      await pollRemoteChecks(deps, input.remote.forges, {
        id: input.id,
        gate: gate.id,
        branchRef: input.remote.branchRef,
        repo: input.remote.repo,
      });
    }
  }
  return ok(deriveWorkOrderState(flow, await deps.workOrders.events(input.id)));
}

/** An agent_verdict gate's evidence: the reviewer role reports approve/reject with evidence pointers. */
export type VerdictError = 'not_found' | 'not_current_stage' | 'not_pending' | 'not_an_agent_gate' | 'wrong_role' | 'no_repo';

export async function submitAgentVerdict(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'worktrees' | 'evidence'>,
  input: {
    readonly id: WorkOrderId;
    readonly gate: GateSlug;
    readonly approve: boolean;
    readonly pointers: readonly string[];
    readonly actor: Actor;
  },
): Promise<Result<WorkOrderState, VerdictError>> {
  const loaded = await loadWorkOrder(deps, input.id);
  // Same reading as decideHumanGate: without loadable definitions there is no gate to find.
  if (!loaded.ok) return err('not_found');
  const { record, definitions, flow, events, state } = loaded.value;
  const current = findCurrentGate(flow, state, input.gate);
  if (current === undefined) return err('not_current_stage');
  if (!state.pendingGates.includes(input.gate)) return err('not_pending');
  if (current.gate.kind !== 'agent_verdict') return err('not_an_agent_gate');
  if (input.actor.kind !== 'agent' || input.actor.role !== current.gate.role) return err('wrong_role');
  const worktree = await deps.worktrees.ensure(record.repo, record.id);
  if (!worktree.ok) return err('no_repo');

  // An empty pointer list proves nothing, whatever a checker would say about the empty set.
  const pointersResolved =
    input.pointers.length > 0 && (await deps.evidence.resolvePointers(worktree.value.path, input.pointers));
  const verdict = evaluateGate(
    current.gate,
    { agentVerdict: { approve: input.approve, pointersResolved } },
    gateContext(definitions),
  );
  const stateAfter = await recordGateDecision(
    deps,
    {
      id: input.id,
      stage: current.stage,
      gate: input.gate,
      verdict,
      decision: input.approve ? 'approved' : 'rejected',
      actor: input.actor,
    },
    flow,
    events,
  );
  return ok(stateAfter);
}

/** The human answer to a changes gate the machine measured at zero (A-96): the operator attests
 *  that nothing needed changing — or that the run fell short and the stage should go again. */
export type AttestError = 'not_found' | 'not_current_stage' | 'not_pending' | 'not_a_changes_gate' | 'agent_cannot_decide';

export async function attestNoChanges(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'>,
  input: {
    readonly id: WorkOrderId;
    readonly gate: GateSlug;
    readonly noChangeNeeded: boolean;
    readonly actor: Actor;
  },
): Promise<Result<WorkOrderState, AttestError>> {
  const loaded = await loadWorkOrder(deps, input.id);
  // Same reading as decideHumanGate: without loadable definitions there is no gate to find.
  if (!loaded.ok) return err('not_found');
  const { definitions, flow, events, state } = loaded.value;
  const current = findCurrentGate(flow, state, input.gate);
  if (current === undefined) return err('not_current_stage');
  if (current.gate.kind !== 'changes') return err('not_a_changes_gate');
  if (input.actor.kind === 'agent') return err('agent_cannot_decide');
  // The attestation answers a gate the machine left measured-but-pending: a `changes` gate is not
  // a human gate, so that standing is `gating`, never `awaiting_human` — and in every other
  // status the pending list is the fold's pre-fill, where a verdict would be a dead fact.
  if (state.status !== 'gating' || !state.pendingGates.includes(input.gate)) return err('not_pending');

  const verdict = evaluateGate(
    current.gate,
    { changes: { filesChanged: 0, noChangeNeeded: input.noChangeNeeded } },
    gateContext(definitions),
  );
  const stateAfter = await recordGateDecision(
    deps,
    {
      id: input.id,
      stage: current.stage,
      gate: input.gate,
      verdict,
      decision: input.noChangeNeeded ? 'approved' : 'rejected',
      actor: input.actor,
    },
    flow,
    events,
  );
  return ok(stateAfter);
}
