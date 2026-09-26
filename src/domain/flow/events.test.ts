import { describe, expect, it } from 'vitest';
import type { GateVerdict } from '../gates';
import type { Actor, FlowSlug, GateSlug, RunId, RunOutcome, StageSlug } from '../shared';
import type { WorkOrderEvent } from './events';

const USER: Actor = { kind: 'user', id: 'u-1' };
const RUN: RunId = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as RunId;
const FLOW: FlowSlug = 'standard' as FlowSlug;
const STAGE: StageSlug = 'implement' as StageSlug;
const GATE: GateSlug = 'tests' as GateSlug;

describe('WorkOrderEvent', () => {
  it('has exactly the seven event types of the contract', () => {
    const events: readonly WorkOrderEvent[] = [
      { type: 'created', at: 1, by: USER, flow: FLOW },
      { type: 'run_started', at: 2, runId: RUN, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: 3, runId: RUN, outcome: 'succeeded' },
      { type: 'gate_evaluated', at: 4, stage: STAGE, gate: GATE, verdict: { status: 'passed' } },
      { type: 'blocked', at: 5, by: USER, reason: 'operator asked' },
      { type: 'unblocked', at: 6, by: USER },
      { type: 'closed', at: 7, by: USER },
    ];
    expect(events.map((event) => event.type)).toEqual([
      'created',
      'run_started',
      'run_finished',
      'gate_evaluated',
      'blocked',
      'unblocked',
      'closed',
    ]);
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
