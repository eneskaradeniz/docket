// gates/evaluate.ts — evidence + context → verdict for each gate kind, via a registry
// so a new gate kind is a new evaluator, never an edit to the engine.
import type { Actor, EnvSlug } from '../shared';
import type { EnvironmentDef, GateDef } from '../definitions';

export type GateVerdict =
  | { readonly status: 'passed' }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'pending' } // waiting for evidence or a human
  | { readonly status: 'unknown'; readonly reason: string }; // we could not look

export interface GateEvidence {
  readonly commands?: Readonly<Record<string, { readonly exitCode: number } | undefined>>; // per command in the set
  readonly secretScan?: { readonly findings: number };
  readonly agentVerdict?: { readonly approve: boolean; readonly pointersResolved: boolean };
  readonly approval?: {
    readonly decision: 'approved' | 'rejected';
    readonly by: Actor;
    readonly note?: string;
  };
  readonly pageApproval?: { readonly decision: 'approved' | 'rejected'; readonly by: Actor };
  readonly deployment?: {
    readonly environment: EnvSlug;
    readonly commit: string;
    readonly result: 'success' | 'failed';
    readonly approvedBy: Actor;
    readonly confirmedEnvironment?: EnvSlug; // the environment id the user typed to confirm
  };
  readonly remoteChecks?: {
    readonly checks: readonly CheckRunResult[];
    readonly status: 'all_passed' | 'has_failure' | 'pending' | 'timeout';
  };
}

export interface CheckRunResult {
  readonly name: string;
  readonly status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped';
}

export type GateEvaluator<K extends GateDef['kind']> = (
  gate: Extract<GateDef, { kind: K }>,
  evidence: GateEvidence,
  ctx: GateContext,
) => GateVerdict;

export interface GateContext {
  readonly commandSets: Readonly<Record<string, readonly string[]>>;
  readonly environments?: readonly EnvironmentDef[]; // required to evaluate `deploy` gates
}

const evaluateHuman: GateEvaluator<'human'> = (_gate, evidence) => {
  const approval = evidence.approval;
  if (approval === undefined) return { status: 'pending' };
  if (approval.decision === 'approved') return { status: 'passed' };
  return { status: 'failed', reason: approval.note ?? 'rejected' };
};

const evaluatePageApproval: GateEvaluator<'page_approval'> = (_gate, evidence) => {
  const approval = evidence.pageApproval;
  if (approval === undefined) return { status: 'pending' };
  if (approval.decision === 'approved') return { status: 'passed' };
  return { status: 'failed', reason: 'rejected' };
};

const evaluateCommand: GateEvaluator<'command'> = (gate, evidence, ctx) => {
  const commands = ctx.commandSets[gate.commandSet];
  if (commands === undefined) {
    return { status: 'unknown', reason: `unknown command set "${gate.commandSet}"` };
  }
  if (commands.length === 0) {
    return { status: 'unknown', reason: `command set "${gate.commandSet}" is empty` };
  }
  const results = evidence.commands ?? {};
  // Results may arrive in any order, so a failure must win over a missing result no matter where
  // each sits in the set: pass once in set order for the first failure to name, then once more
  // for evidence still outstanding.
  for (const command of commands) {
    const result = results[command];
    if (result !== undefined && result.exitCode !== 0) {
      return { status: 'failed', reason: `command failed (exit ${result.exitCode}): ${command}` };
    }
  }
  for (const command of commands) {
    if (results[command] === undefined) return { status: 'pending' };
  }
  return { status: 'passed' };
};

const evaluateSecretScan: GateEvaluator<'secret_scan'> = (_gate, evidence) => {
  const scan = evidence.secretScan;
  if (scan === undefined) return { status: 'pending' };
  if (scan.findings > 0) {
    return { status: 'failed', reason: `secret scan found ${scan.findings} findings` };
  }
  return { status: 'passed' };
};

const evaluateAgentVerdict: GateEvaluator<'agent_verdict'> = (_gate, evidence) => {
  const verdict = evidence.agentVerdict;
  if (verdict === undefined) return { status: 'pending' };
  if (!verdict.approve) return { status: 'failed', reason: 'agent did not approve' };
  if (!verdict.pointersResolved) {
    return { status: 'unknown', reason: 'evidence pointers did not resolve' };
  }
  return { status: 'passed' };
};

const evaluateDeploy: GateEvaluator<'deploy'> = (gate, evidence, ctx) => {
  // The protected flag lives on the definition, so the environment must resolve before any verdict.
  const environment = ctx.environments?.find((candidate) => candidate.id === gate.environment);
  if (environment === undefined) {
    return { status: 'unknown', reason: `unknown environment "${gate.environment}"` };
  }
  const deployment = evidence.deployment;
  if (deployment === undefined) return { status: 'pending' };
  // Deploying is a human action: the evidence counts only when a user approved it.
  if (deployment.approvedBy.kind !== 'user') return { status: 'pending' };
  // A protected environment needs the user to have typed its id to confirm the deploy.
  if (environment.protected && deployment.confirmedEnvironment !== gate.environment) {
    return { status: 'pending' };
  }
  if (deployment.result === 'success') return { status: 'passed' };
  return { status: 'failed', reason: `deploy to "${gate.environment}" failed` };
};

const evaluateRemoteChecks: GateEvaluator<'remote_checks'> = (_gate, evidence) => {
  const remote = evidence.remoteChecks;
  // The poller reduces the check runs to one status; the evaluator maps that status to a verdict.
  if (remote === undefined) return { status: 'pending' };
  switch (remote.status) {
    case 'all_passed':
      return { status: 'passed' };
    case 'has_failure': {
      // Cancelled runs also block promotion, so they count as failures when naming one.
      const failed = remote.checks.find((c) => c.status === 'failed' || c.status === 'cancelled');
      return failed === undefined
        ? { status: 'failed', reason: 'remote checks failed' }
        : { status: 'failed', reason: `remote check failed: ${failed.name}` };
    }
    case 'timeout':
      return { status: 'failed', reason: 'timeout' };
    case 'pending':
      return { status: 'pending' };
  }
};

export const GATE_EVALUATORS: { readonly [K in GateDef['kind']]: GateEvaluator<K> } = {
  human: evaluateHuman,
  page_approval: evaluatePageApproval,
  command: evaluateCommand,
  secret_scan: evaluateSecretScan,
  agent_verdict: evaluateAgentVerdict,
  deploy: evaluateDeploy,
  remote_checks: evaluateRemoteChecks,
};

export function evaluateGate(gate: GateDef, evidence: GateEvidence, ctx: GateContext): GateVerdict {
  // The registry lookup already selects by kind; the cast only widens the parameter back to
  // GateDef for the call. Sound because each evaluator reads only its own kind's fields.
  const evaluate = GATE_EVALUATORS[gate.kind] as GateEvaluator<GateDef['kind']>;
  return evaluate(gate, evidence, ctx);
}
