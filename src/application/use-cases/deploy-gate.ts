// use-cases/deploy-gate.ts — the human-triggered deploy. The application checks the approval
// rules, gathers the environment's env values through the ports, runs the deploy (and verify)
// command sets in the worktree, and records what the domain's evaluator says about the result.
import type {
  Actor,
  Definitions,
  EnvSlug,
  EnvValue,
  EnvironmentDef,
  FlowDef,
  GateContext,
  GateDef,
  GateEvidence,
  GateSlug,
  Result,
  StageSlug,
  WorkOrderEvent,
  WorkOrderId,
  WorkOrderState,
} from '../../domain/index';
import { MINUTE, deriveWorkOrderState, err, evaluateGate, ok } from '../../domain/index';

import type { AppDeps, WorkOrderRecord } from '../ports';

/** Deploy commands get the same ten minutes a command gate's commands get. */
const COMMAND_TIMEOUT_MS = 10 * MINUTE;

/** Values shorter than this are left alone: replacing everyday short strings would mangle the
 *  tail without making it meaningfully safer. */
const REDACT_MIN_LENGTH = 8;
const REDACTION = '[env]';

type LoadError = 'not_found' | 'definitions_invalid';

const loadWorkOrder = async (
  deps: Pick<AppDeps, 'workOrders' | 'definitions'>,
  id: WorkOrderId,
): Promise<
  Result<{
    readonly record: WorkOrderRecord;
    readonly definitions: Definitions;
    readonly flow: FlowDef;
    readonly events: readonly WorkOrderEvent[];
    readonly state: WorkOrderState;
  }, LoadError>
> => {
  const record = await deps.workOrders.get(id);
  if (record === undefined) return err('not_found');
  const definitions = await deps.definitions.load(record.workspace);
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

/** A deploy gate can only be judged against the environments the workspace defines. */
const gateContext = (definitions: Definitions): GateContext => ({
  commandSets: definitions.workspace?.commandSets ?? {},
  environments: definitions.workspace?.environments,
});

interface ResolvedEnv {
  readonly values: Readonly<Record<string, string>>;
  readonly unresolved: readonly string[];
}

/** Literal values pass through; secret refs are resolved through the vault and never stored. */
const resolveEnv = async (
  vault: Pick<AppDeps, 'secrets'>,
  env: Readonly<Record<string, EnvValue>>,
): Promise<ResolvedEnv> => {
  const values: Record<string, string> = {};
  const unresolved: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if ('literal' in value) {
      values[key] = value.literal;
      continue;
    }
    const secret = await vault.secrets.get(value.secretRef);
    if (secret === undefined) unresolved.push(value.secretRef);
    else values[key] = secret;
  }
  return { values, unresolved };
};

/** The port already promises a redacted tail; scrubbing again against exactly the values this
 *  call injected means no runner implementation can leak them into the event. */
const redactEnvValues = (text: string, values: Readonly<Record<string, string>>): string => {
  let out = text;
  for (const value of Object.values(values)) {
    if (value.length >= REDACT_MIN_LENGTH) out = out.split(value).join(REDACTION);
  }
  return out;
};

interface SetOutcome {
  readonly allZero: boolean;
  readonly outputTail: string;
}

/** Runs a command set the way command gates do: every command, in set order, in the worktree.
 *  The tail carried forward is the last command's on success and the first failing command's —
 *  the output that explains the outcome, not a later command's noise. */
const runCommandSet = async (
  runner: Pick<AppDeps, 'commands'>,
  cwd: string,
  commands: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<SetOutcome> => {
  let allZero = true;
  let outputTail = '';
  for (const command of commands) {
    const result = await runner.commands.run(cwd, command, COMMAND_TIMEOUT_MS, env);
    if (result.exitCode !== 0) {
      if (allZero) outputTail = result.outputTail;
      allZero = false;
      continue;
    }
    if (allZero) outputTail = result.outputTail;
  }
  return { allZero, outputTail };
};

interface Execution {
  readonly result: 'success' | 'failed';
  readonly outputTail: string;
}

const executeDeployment = async (
  deps: Pick<AppDeps, 'commands' | 'secrets'>,
  cwd: string,
  environment: EnvironmentDef,
  commandSets: Readonly<Record<string, readonly string[]>>,
): Promise<Execution> => {
  const resolved = await resolveEnv(deps, environment.env);
  if (resolved.unresolved.length > 0) {
    // Without every secret the command would run half-configured, so nothing is executed at all.
    return { result: 'failed', outputTail: `unresolved secret reference: ${resolved.unresolved.join(', ')}` };
  }
  const deployCommands = commandSets[environment.deploy];
  if (deployCommands === undefined || deployCommands.length === 0) {
    return { result: 'failed', outputTail: `deploy command set "${environment.deploy}" is missing or empty` };
  }
  const deploy = await runCommandSet(deps, cwd, deployCommands, resolved.values);
  if (!deploy.allZero) {
    return { result: 'failed', outputTail: redactEnvValues(deploy.outputTail, resolved.values) };
  }
  if (environment.verify === undefined) {
    return { result: 'success', outputTail: redactEnvValues(deploy.outputTail, resolved.values) };
  }
  const verifyCommands = commandSets[environment.verify];
  if (verifyCommands === undefined || verifyCommands.length === 0) {
    return { result: 'failed', outputTail: `verify command set "${environment.verify}" is missing or empty` };
  }
  const verify = await runCommandSet(deps, cwd, verifyCommands, resolved.values);
  return {
    result: verify.allZero ? 'success' : 'failed',
    outputTail: redactEnvValues(verify.outputTail, resolved.values),
  };
};

export type DeployGateError =
  | 'not_found' | 'not_current_stage' | 'not_pending' | 'not_a_deploy_gate'
  | 'no_approval' | 'confirmation_mismatch' | 'promote_prerequisite_missing'
  | 'definitions_invalid' | 'unknown_environment' | 'no_repo';

export async function approveAndDeploy(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'worktrees' | 'commands' | 'secrets'>,
  input: {
    readonly id: WorkOrderId;
    readonly gate: GateSlug;
    readonly approver: Actor; // must be user
    readonly commit: string;
    readonly confirmedEnvironment?: EnvSlug; // required for protected environments
  },
): Promise<Result<WorkOrderState, DeployGateError>> {
  const loaded = await loadWorkOrder(deps, input.id);
  if (!loaded.ok) return err(loaded.error);
  const { record, definitions, flow, events, state } = loaded.value;

  const current = findCurrentGate(flow, state, input.gate);
  if (current === undefined) return err('not_current_stage');
  if (!state.pendingGates.includes(input.gate)) return err('not_pending');
  if (current.gate.kind !== 'deploy') return err('not_a_deploy_gate');
  // Bound to a name so the deploy variant's `environment` stays narrowed across the awaits below.
  const deployGate = current.gate;
  if (input.approver.kind !== 'user') return err('no_approval');

  // The protected flag lives on the definition, so the environment must resolve before the
  // confirmation can be judged.
  const ctx = gateContext(definitions);
  const environment = ctx.environments?.find((candidate) => candidate.id === deployGate.environment);
  if (environment === undefined) return err('unknown_environment');
  if (environment.protected && input.confirmedEnvironment !== deployGate.environment) {
    return err('confirmation_mismatch');
  }

  const worktree = await deps.worktrees.ensure(record.workspace, record.id);
  if (!worktree.ok) return err('no_repo');

  if (environment.promoteFrom !== undefined) {
    const promoted = events.some(
      (event) =>
        event.type === 'deployment_attempted' &&
        event.environment === environment.promoteFrom &&
        event.commit === input.commit &&
        event.result === 'success',
    );
    if (!promoted) return err('promote_prerequisite_missing');
  }

  const execution = await executeDeployment(deps, worktree.value.path, environment, ctx.commandSets);
  const now = deps.clock.now();
  const evidence: GateEvidence = {
    deployment: {
      environment: deployGate.environment,
      commit: input.commit,
      result: execution.result,
      approvedBy: input.approver,
      ...(input.confirmedEnvironment !== undefined ? { confirmedEnvironment: input.confirmedEnvironment } : {}),
    },
  };
  const attempt: WorkOrderEvent = {
    type: 'deployment_attempted',
    at: now,
    stage: current.stage,
    gate: input.gate,
    environment: deployGate.environment,
    commit: input.commit,
    approvedBy: input.approver,
    result: execution.result,
    outputTail: execution.outputTail,
  };
  const evaluated: WorkOrderEvent = {
    type: 'gate_evaluated',
    at: now,
    stage: current.stage,
    gate: input.gate,
    verdict: evaluateGate(deployGate, evidence, ctx),
  };
  await deps.workOrders.appendEvent(input.id, attempt);
  await deps.workOrders.appendEvent(input.id, evaluated);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: now,
    actor: input.approver,
    action: 'gate.decided',
    subject: { kind: 'work_order', id: input.id },
    detail: { gate: input.gate, decision: 'approved' },
  });
  return ok(deriveWorkOrderState(flow, [...events, attempt, evaluated]));
}
