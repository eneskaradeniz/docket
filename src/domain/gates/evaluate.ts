// gates/evaluate.ts — evidence + context → verdict for each gate kind, via a registry
// so a new gate kind is a new evaluator, never an edit to the engine.
import type { Actor } from '../shared';
import type { GateDef } from '../definitions';

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
}

export type GateEvaluator<K extends GateDef['kind']> = (
  gate: Extract<GateDef, { kind: K }>,
  evidence: GateEvidence,
  ctx: GateContext,
) => GateVerdict;

export interface GateContext {
  readonly commandSets: Readonly<Record<string, readonly string[]>>;
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
  // One pass in set order: the first missing result means we are still waiting; the first
  // non-zero exit is the failure to report (later commands may never have run).
  for (const command of commands) {
    const result = results[command];
    if (result === undefined) return { status: 'pending' };
    if (result.exitCode !== 0) {
      return { status: 'failed', reason: `command failed (exit ${result.exitCode}): ${command}` };
    }
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

export const GATE_EVALUATORS: { readonly [K in GateDef['kind']]: GateEvaluator<K> } = {
  human: evaluateHuman,
  page_approval: evaluatePageApproval,
  command: evaluateCommand,
  secret_scan: evaluateSecretScan,
  agent_verdict: evaluateAgentVerdict,
};

export function evaluateGate(gate: GateDef, evidence: GateEvidence, ctx: GateContext): GateVerdict {
  // The registry lookup already selects by kind; the cast only widens the parameter back to
  // GateDef for the call. Sound because each evaluator reads only its own kind's fields.
  const evaluate = GATE_EVALUATORS[gate.kind] as GateEvaluator<GateDef['kind']>;
  return evaluate(gate, evidence, ctx);
}
