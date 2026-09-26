// scenarios/v1-parity.test.ts — the section-13 acceptance: the built-in `standard` flow reproduces
// v1's work-order lifecycle. One `it` per row of the parity table; the events are built from
// real gate-evaluator verdicts, so each row is driven by the evidence v1 would have seen
// (exit codes, scan findings, verdicts, approvals), never by hand-written verdict literals.
import { describe, expect, it } from 'vitest';
import { evaluateGate, type GateEvidence } from '../gates/index';
import type { GateDef, StageDef } from '../definitions/index';
import { BUILTIN_FLOWS } from '../library/index';
import type { Actor, EpochMs, GateSlug, RunId, RunOutcome, StageSlug } from '../shared/index';
import { deriveWorkOrderState, type WorkOrderEvent } from '../flow/index';

const USER: Actor = { kind: 'user', id: 'u-1' };

const stageOf = (id: string): StageSlug => id as StageSlug;

// The built-in flows reference the `tests` command set; the workspace defines what it runs.
const CTX = { commandSets: { tests: ['npm test'] } };

const standard = () => {
  const found = BUILTIN_FLOWS.find((flow) => flow.id === 'standard');
  if (found === undefined) throw new Error('expected a built-in flow "standard"');
  return found;
};

const stageOfFlow = (id: string): StageDef => {
  const found = standard().stages.find((stage) => stage.id === id);
  if (found === undefined) throw new Error(`expected a stage "${id}" in the standard flow`);
  return found;
};

const gateOfStage = (stageId: string, gateId: string): GateDef => {
  const found = stageOfFlow(stageId).exit.find((gate) => gate.id === gateId);
  if (found === undefined) throw new Error(`expected a gate "${gateId}" on stage "${stageId}"`);
  return found;
};

// Evidence shapes the parity rows name: a green command set, a clean scan, a human approval,
// and the reviewer's verdict with and without resolvable evidence pointers.
const TESTS_PASS: GateEvidence = { commands: { 'npm test': { exitCode: 0 } } };
const TESTS_FAIL: GateEvidence = { commands: { 'npm test': { exitCode: 1 } } };
const SECRETS_CLEAN: GateEvidence = { secretScan: { findings: 0 } };
const APPROVED: GateEvidence = { approval: { decision: 'approved', by: USER } };
const VERDICT_RESOLVED: GateEvidence = { agentVerdict: { approve: true, pointersResolved: true } };
const VERDICT_UNRESOLVED: GateEvidence = { agentVerdict: { approve: true, pointersResolved: false } };

const runOf = (n: number): RunId => `01RUN000000000000000000${String(n).padStart(2, '0')}` as RunId;

const created = (at: EpochMs = 10): WorkOrderEvent => ({ type: 'created', at, by: USER, flow: standard().id });
const runStarted = (stage: string, attempt = 1, at: EpochMs = 20): WorkOrderEvent => ({
  type: 'run_started',
  at,
  runId: runOf(attempt),
  stage: stageOf(stage),
  attempt,
});
const runFinished = (outcome: RunOutcome, run = 1, at: EpochMs = 30): WorkOrderEvent => ({
  type: 'run_finished',
  at,
  runId: runOf(run),
  outcome,
});
const gateOn = (stage: string, gate: string, evidence: GateEvidence, at: EpochMs = 40): WorkOrderEvent => ({
  type: 'gate_evaluated',
  at,
  stage: stageOf(stage),
  gate: gate as GateSlug,
  verdict: evaluateGate(gateOfStage(stage, gate), evidence, CTX),
});

const derive = (events: readonly WorkOrderEvent[]) => deriveWorkOrderState(standard(), events);

// Shared prefixes, so each row reads as the delta that makes it interesting.
const PLAN_RUN_SUCCEEDED: readonly WorkOrderEvent[] = [created(), runStarted('plan'), runFinished('succeeded')];
const IMPLEMENT_READY: readonly WorkOrderEvent[] = [...PLAN_RUN_SUCCEEDED, gateOn('plan', 'plan-approval', APPROVED)];
const IMPLEMENT_GATING: readonly WorkOrderEvent[] = [...IMPLEMENT_READY, runStarted('implement'), runFinished('succeeded')];
const REVIEW_GATING: readonly WorkOrderEvent[] = [
  ...IMPLEMENT_GATING,
  gateOn('implement', 'tests', TESTS_PASS),
  gateOn('implement', 'secrets', SECRETS_CLEAN),
  runStarted('review'),
  runFinished('succeeded'),
];
const CLOSE_AWAITING: readonly WorkOrderEvent[] = [
  ...REVIEW_GATING,
  gateOn('review', 'review-verdict', VERDICT_RESOLVED),
  gateOn('review', 'review-approval', APPROVED),
];

describe('v1 parity — the built-in standard flow reproduces v1\'s work-order lifecycle', () => {
  it('created: plan, ready', () => {
    expect(derive([created()])).toEqual({
      status: 'ready',
      stage: 'plan',
      attempt: 1,
      pendingGates: ['plan-approval'],
    });
  });

  it('plan run succeeded, plan-approval pending: plan, awaiting_human', () => {
    expect(derive(PLAN_RUN_SUCCEEDED)).toEqual({
      status: 'awaiting_human',
      stage: 'plan',
      attempt: 1,
      pendingGates: ['plan-approval'],
    });
  });

  it('plan approved: implement, ready', () => {
    expect(derive(IMPLEMENT_READY)).toEqual({
      status: 'ready',
      stage: 'implement',
      attempt: 1,
      pendingGates: ['tests', 'secrets'],
    });
  });

  it('implement succeeded, tests pass, secrets 0: review, ready', () => {
    expect(
      derive([...IMPLEMENT_GATING, gateOn('implement', 'tests', TESTS_PASS), gateOn('implement', 'secrets', SECRETS_CLEAN)]),
    ).toEqual({
      status: 'ready',
      stage: 'review',
      attempt: 1,
      pendingGates: ['review-verdict', 'review-approval'],
    });
  });

  it('implement succeeded, tests fail (1st): implement, attempt 2, ready', () => {
    expect(derive([...IMPLEMENT_GATING, gateOn('implement', 'tests', TESTS_FAIL)])).toEqual({
      status: 'ready',
      stage: 'implement',
      attempt: 2,
      pendingGates: ['tests', 'secrets'],
    });
  });

  it('tests fail three times: blocked', () => {
    const events: WorkOrderEvent[] = [...IMPLEMENT_GATING];
    for (let n = 1; n <= 3; n += 1) {
      events.push(gateOn('implement', 'tests', TESTS_FAIL));
      if (n < 3) events.push(runStarted('implement', n + 1), runFinished('succeeded', n + 1));
    }
    const state = derive(events);
    expect(state.status).toBe('blocked');
    expect(state.stage).toBe('implement');
    expect(state.attempt).toBe(3);
    expect(state.blockedReason).toContain('tests');
  });

  it('review verdict approve but pointers unresolved: blocked (unknown)', () => {
    // An approve whose evidence pointers did not resolve evaluates to `unknown`, and unknown
    // blocks — it must not fall into review's onFail (which would re-enter implement).
    const state = derive([...REVIEW_GATING, gateOn('review', 'review-verdict', VERDICT_UNRESOLVED)]);
    expect(state.status).toBe('blocked');
    expect(state.stage).toBe('review');
    expect(state.blockedReason).toBe('evidence pointers did not resolve');
  });

  it('review verdict + approval pass: close, awaiting_human', () => {
    expect(derive(CLOSE_AWAITING)).toEqual({
      status: 'awaiting_human',
      stage: 'close',
      attempt: 1,
      pendingGates: ['closure'],
    });
  });

  it('closure approved: done', () => {
    expect(derive([...CLOSE_AWAITING, gateOn('close', 'closure', APPROVED)])).toEqual({
      status: 'done',
      stage: null,
      attempt: 1,
      pendingGates: [],
    });
  });

  it('run ended by limit: limit_waiting', () => {
    expect(derive([...IMPLEMENT_READY, runStarted('implement'), runFinished('limit')])).toEqual({
      status: 'limit_waiting',
      stage: 'implement',
      attempt: 1,
      pendingGates: ['tests', 'secrets'],
    });
  });
});
