import { describe, expect, it } from 'vitest';
import type { GateVerdict } from '../gates';
import type { Actor, EnvSlug, FlowSlug, GateSlug, PolicyId, RunId, RunOutcome, Slug, StageSlug } from '../shared';
import type { FlowDef } from '../definitions';
import { deriveWorkOrderState } from './derive';
import { REMOTE_CHECKS_EVENT_MAX, remoteChecksEvidence, type WorkOrderEvent } from './events';

const USER: Actor = { kind: 'user', id: 'u-1' };
const RUN: RunId = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as RunId;
const FLOW: FlowSlug = 'standard' as FlowSlug;
const STAGE: StageSlug = 'implement' as StageSlug;
const GATE: GateSlug = 'tests' as GateSlug;
const ENV: EnvSlug = 'stg' as EnvSlug;
const COMMIT = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';

describe('WorkOrderEvent', () => {
  it('has exactly the ten event types of the contract', () => {
    const events: readonly WorkOrderEvent[] = [
      { type: 'created', at: 1, by: USER, flow: FLOW },
      { type: 'run_started', at: 2, runId: RUN, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: 3, runId: RUN, outcome: 'succeeded' },
      { type: 'gate_evaluated', at: 4, stage: STAGE, gate: GATE, verdict: { status: 'passed' } },
      { type: 'blocked', at: 5, by: USER, reason: 'operator asked' },
      { type: 'unblocked', at: 6, by: USER },
      {
        type: 'deployment_attempted',
        at: 7,
        stage: STAGE,
        gate: GATE,
        environment: ENV,
        commit: COMMIT,
        approvedBy: USER,
        result: 'success',
      },
      { type: 'stage_skip_proposed', at: 8, stages: [STAGE], reason: 'small change' },
      { type: 'stage_skip_decided', at: 9, approved: true },
      { type: 'closed', at: 10, by: USER },
    ];
    expect(events.map((event) => event.type)).toEqual([
      'created',
      'run_started',
      'run_finished',
      'gate_evaluated',
      'blocked',
      'unblocked',
      'deployment_attempted',
      'stage_skip_proposed',
      'stage_skip_decided',
      'closed',
    ]);
  });

  it('R-133: stage-skip proposal and decision recorded as ledger events', () => {
    const proposed: WorkOrderEvent = {
      type: 'stage_skip_proposed',
      at: 1,
      stages: ['review' as StageSlug],
      reason: 'tests already cover it',
    };
    const decided: WorkOrderEvent = { type: 'stage_skip_decided', at: 2, approved: false };
    expect(proposed).toMatchObject({ type: 'stage_skip_proposed', stages: ['review'], reason: 'tests already cover it' });
    expect(decided).toEqual({ type: 'stage_skip_decided', at: 2, approved: false });
  });

  it('R-190: stage_skip_decided optionally carries decidedByPolicy evidence; older events without it remain valid', () => {
    const bare: WorkOrderEvent = { type: 'stage_skip_decided', at: 1, approved: true };
    const withPolicy: WorkOrderEvent = {
      type: 'stage_skip_decided',
      at: 2,
      approved: true,
      decidedByPolicy: { policy: 'stage-skip-auto' as PolicyId, level: 'auto' },
    };
    expect(bare.decidedByPolicy).toBeUndefined();
    expect(withPolicy.decidedByPolicy).toEqual({ policy: 'stage-skip-auto', level: 'auto' });
  });

  it('deployment_attempted carries both results and an optional outputTail', () => {
    const results: readonly ('success' | 'failed')[] = ['success', 'failed'];
    const bare = results.map(
      (result): WorkOrderEvent => ({
        type: 'deployment_attempted',
        at: 1,
        stage: STAGE,
        gate: GATE,
        environment: ENV,
        commit: COMMIT,
        approvedBy: USER,
        result,
      }),
    );
    expect(bare).toHaveLength(2);
    const withTail: WorkOrderEvent = {
      type: 'deployment_attempted',
      at: 2,
      stage: STAGE,
      gate: GATE,
      environment: ENV,
      commit: COMMIT,
      approvedBy: USER,
      result: 'failed',
      outputTail: 'deploy exited 1',
    };
    expect(withTail.outputTail).toBe('deploy exited 1');
  });

  it('carries every run outcome and every gate verdict shape', () => {
    const outcomes: readonly RunOutcome[] = ['succeeded', 'failed', 'limit', 'cancelled'];
    const finished = outcomes.map((outcome): WorkOrderEvent => ({ type: 'run_finished', at: 1, runId: RUN, outcome }));
    expect(finished).toHaveLength(4);

    const verdicts: readonly GateVerdict[] = [
      { status: 'passed' },
      { status: 'failed', reason: 'boom' },
      { status: 'pending' },
      { status: 'unknown', reason: 'cannot look' },
    ];
    const evaluated = verdicts.map(
      (verdict): WorkOrderEvent => ({ type: 'gate_evaluated', at: 2, stage: STAGE, gate: GATE, verdict }),
    );
    expect(evaluated).toHaveLength(4);
  });
});

describe('remoteChecks evidence (R-166)', () => {
  it('R-166: the evidence keeps the first 30 checks in forge order, name and status only', () => {
    const checks = Array.from({ length: REMOTE_CHECKS_EVENT_MAX + 2 }, (_, index) => ({
      name: `check-${index}`,
      status: 'passed' as const,
    }));
    const evidence = remoteChecksEvidence(checks);
    expect(evidence.checks).toHaveLength(REMOTE_CHECKS_EVENT_MAX);
    expect(evidence.checks[0]).toEqual({ name: 'check-0', status: 'passed' });
    expect(evidence.checks[REMOTE_CHECKS_EVENT_MAX - 1]).toEqual({
      name: `check-${REMOTE_CHECKS_EVENT_MAX - 1}`,
      status: 'passed',
    });
    // Name and status only: a url or an environment value never rides the event.
    expect(Object.keys(evidence.checks[0]).sort()).toEqual(['name', 'status']);
  });

  it('R-166: an event without remoteChecks folds exactly as one with it', () => {
    const flow: FlowDef = {
      id: FLOW,
      name: 'Standard',
      stages: [
        {
          id: STAGE,
          name: 'Implement',
          role: 'worker' as Slug<'role'>,
          exit: [{ kind: 'remote_checks', id: GATE, required: 'all', timeoutMinutes: 10 }],
        },
      ],
    };
    const opening: readonly WorkOrderEvent[] = [
      { type: 'created', at: 1, by: USER, flow: FLOW },
      { type: 'run_started', at: 2, runId: RUN, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: 3, runId: RUN, outcome: 'succeeded' },
    ];
    const bare: WorkOrderEvent = { type: 'gate_evaluated', at: 4, stage: STAGE, gate: GATE, verdict: { status: 'passed' } };
    const withEvidence: WorkOrderEvent = {
      ...bare,
      remoteChecks: remoteChecksEvidence([{ name: 'lint', status: 'passed' }]),
    };
    expect(deriveWorkOrderState(flow, [...opening, withEvidence])).toEqual(
      deriveWorkOrderState(flow, [...opening, bare]),
    );
  });
});
