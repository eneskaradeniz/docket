import { describe, expect, it } from 'vitest';
import type { FlowDef, GateDef } from '../definitions';
import type { FlowSlug, GateSlug, RoleSlug, StageSlug } from '../shared';
import type { WorkOrderState } from './derive';
import { nextAction, type FlowAction } from './next-action';

const stageOf = (id: string): StageSlug => id as StageSlug;
const gateOf = (id: string): GateSlug => id as GateSlug;
const roleOf = (id: string): RoleSlug => id as RoleSlug;
const flowOf = (id: string): FlowSlug => id as FlowSlug;

const HUMAN_PLAN: GateDef = { kind: 'human', id: gateOf('plan-approval'), label: 'Plan onayı' };
const COMMAND_TESTS: GateDef = { kind: 'command', id: gateOf('tests'), commandSet: 'tests' };
const SCAN_SECRETS: GateDef = { kind: 'secret_scan', id: gateOf('secrets') };
const HUMAN_CLOSURE: GateDef = { kind: 'human', id: gateOf('closure'), label: 'Kapanış' };
const PAGE_FINDINGS: GateDef = { kind: 'page_approval', id: gateOf('findings'), label: 'Bulgular' };
const AGENT_VERDICT: GateDef = { kind: 'agent_verdict', id: gateOf('verdict'), role: roleOf('reviewer') };
const HUMAN_APPROVAL: GateDef = { kind: 'human', id: gateOf('approval'), label: 'Onay' };

const FLOW: FlowDef = {
  id: flowOf('fixture'),
  name: 'Fixture',
  stages: [
    { id: stageOf('plan'), name: 'Plan', role: roleOf('planner'), exit: [HUMAN_PLAN] },
    {
      id: stageOf('implement'),
      name: 'Implement',
      role: roleOf('developer'),
      exit: [COMMAND_TESTS, SCAN_SECRETS],
      onFail: { goto: stageOf('implement'), maxAttempts: 3 },
    },
    {
      id: stageOf('review'),
      name: 'Review',
      role: roleOf('reviewer'),
      exit: [AGENT_VERDICT, HUMAN_APPROVAL, PAGE_FINDINGS],
    },
    { id: stageOf('close'), name: 'Close', role: null, exit: [HUMAN_CLOSURE] },
  ],
};

const state = (status: WorkOrderState['status'], stage: string | null, attempt: number, pendingGates: readonly string[]): WorkOrderState => ({
  status,
  stage: stage === null ? null : stageOf(stage),
  attempt,
  pendingGates: pendingGates.map(gateOf),
});

const action = (s: WorkOrderState): FlowAction => nextAction(FLOW, s);

describe('nextAction', () => {
  it('R-24: ready starts a run with the stage, its role and the current attempt', () => {
    expect(action(state('ready', 'implement', 2, ['tests', 'secrets']))).toEqual({
      kind: 'start_run',
      stage: 'implement',
      role: 'developer',
      attempt: 2,
    });
  });

  it('R-24: gating evaluates the pending non-human gates', () => {
    expect(action(state('gating', 'implement', 1, ['tests', 'secrets']))).toEqual({
      kind: 'evaluate_gates',
      stage: 'implement',
      gates: ['tests', 'secrets'],
    });
  });

  it('R-24: gating lists only non-human gates when human gates are pending too', () => {
    expect(action(state('gating', 'review', 1, ['verdict', 'approval', 'findings']))).toEqual({
      kind: 'evaluate_gates',
      stage: 'review',
      gates: ['verdict'],
    });
  });

  it('R-24: awaiting_human waits on the pending human gates', () => {
    expect(action(state('awaiting_human', 'close', 1, ['closure']))).toEqual({
      kind: 'await_human',
      stage: 'close',
      gates: ['closure'],
    });
  });

  it('R-24: awaiting_human lists both human gate kinds — human and page_approval', () => {
    expect(action(state('awaiting_human', 'review', 1, ['verdict', 'approval', 'findings']))).toEqual({
      kind: 'await_human',
      stage: 'review',
      gates: ['approval', 'findings'],
    });
  });

  it('R-24: limit_waiting waits for the limit', () => {
    expect(action(state('limit_waiting', 'implement', 1, ['tests', 'secrets']))).toEqual({ kind: 'wait_limit' });
  });

  it('R-24: running, blocked and done have nothing to do', () => {
    expect(action(state('running', 'implement', 1, ['tests', 'secrets']))).toEqual({ kind: 'none' });
    expect(action(state('blocked', 'implement', 3, ['tests', 'secrets']))).toEqual({ kind: 'none' });
    expect(action(state('done', null, 1, []))).toEqual({ kind: 'none' });
  });

  it('asks nothing for a stage the flow does not know', () => {
    expect(action(state('ready', 'mystery', 1, []))).toEqual({ kind: 'none' });
    expect(action(state('gating', 'mystery', 1, ['tests']))).toEqual({ kind: 'none' });
    expect(action(state('awaiting_human', 'mystery', 1, ['closure']))).toEqual({ kind: 'none' });
  });

  it('asks nothing for a ready stage whose role is null — there is no run to start', () => {
    expect(action(state('ready', 'close', 1, ['closure']))).toEqual({ kind: 'none' });
  });

  it('keeps gate order as the flow defines it', () => {
    expect(action(state('gating', 'implement', 1, ['secrets', 'tests']))).toEqual({
      kind: 'evaluate_gates',
      stage: 'implement',
      gates: ['tests', 'secrets'],
    });
  });

  it('does not mutate the input state', () => {
    const s = Object.freeze(state('gating', 'implement', 1, ['tests', 'secrets']));
    expect(() => action(s)).not.toThrow();
  });
});
