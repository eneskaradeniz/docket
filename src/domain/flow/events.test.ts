import { describe, expect, it } from 'vitest';
import type { GateVerdict } from '../gates';
import type { Actor, EnvSlug, FlowSlug, GateSlug, RunId, RunOutcome, StageSlug } from '../shared';
import type { WorkOrderEvent } from './events';

const USER: Actor = { kind: 'user', id: 'u-1' };
const RUN: RunId = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as RunId;
const FLOW: FlowSlug = 'standard' as FlowSlug;
const STAGE: StageSlug = 'implement' as StageSlug;
const GATE: GateSlug = 'tests' as GateSlug;
const ENV: EnvSlug = 'stg' as EnvSlug;
const COMMIT = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';

describe('WorkOrderEvent', () => {
  it('has exactly the eight event types of the contract', () => {
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
      { type: 'closed', at: 8, by: USER },
    ];
    expect(events.map((event) => event.type)).toEqual([
      'created',
      'run_started',
      'run_finished',
      'gate_evaluated',
      'blocked',
      'unblocked',
      'deployment_attempted',
      'closed',
    ]);
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
