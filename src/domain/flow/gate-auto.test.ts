import { describe, expect, it } from 'vitest';
import type { FlowDef, GateDef } from '../definitions';
import type { Actor, EpochMs, FlowSlug, GateSlug, RoleSlug, RunId, RunOutcome, StageSlug } from '../shared';
import { deriveWorkOrderState } from './derive';
import type { WorkOrderEvent } from './events';
import { GATE_AUTO_POLICY, decideGateAuto } from './gate-auto';

const USER: Actor = { kind: 'user', id: 'u-1' };

const stageOf = (id: string): StageSlug => id as StageSlug;
const gateOf = (id: string): GateSlug => id as GateSlug;
const roleOf = (id: string): RoleSlug => id as RoleSlug;
const flowOf = (id: string): FlowSlug => id as FlowSlug;
const runOf = (n: number): RunId => `01RUN000000000000000000${String(n).padStart(2, '0')}` as RunId;

const LINT: GateDef = { kind: 'command', id: gateOf('lint'), commandSet: 'lint' };
const SECRETS: GateDef = { kind: 'secret_scan', id: gateOf('secrets') };
const APPROVAL: GateDef = { kind: 'human', id: gateOf('approval'), label: 'Onay' };
const REVIEW: GateDef = { kind: 'human', id: gateOf('review'), label: 'Gözden geçirme' };
const FINDINGS: GateDef = { kind: 'page_approval', id: gateOf('findings'), label: 'Bulgular' };

// The stage the policy is for: machine gates first, the human gate the policy may decide last.
const POLICY_FLOW: FlowDef = {
  id: flowOf('policy'),
  name: 'Policy',
  stages: [
    {
      id: stageOf('implement'),
      name: 'Implement',
      role: roleOf('developer'),
      exit: [LINT, SECRETS, APPROVAL],
    },
    { id: stageOf('close'), name: 'Close', role: null, exit: [REVIEW] },
  ],
};

// Two human gates after the machine ones: both are decidable, in stage order.
const TWO_HUMAN_FLOW: FlowDef = {
  id: flowOf('two-human'),
  name: 'Two human',
  stages: [
    {
      id: stageOf('implement'),
      name: 'Implement',
      role: roleOf('developer'),
      exit: [LINT, APPROVAL, REVIEW],
    },
  ],
};

// A pending page_approval is a user-only decision (R-168): no machine pass licenses it.
const PAGE_FLOW: FlowDef = {
  id: flowOf('page'),
  name: 'Page',
  stages: [
    {
      id: stageOf('publish'),
      name: 'Publish',
      role: roleOf('developer'),
      exit: [LINT, FINDINGS],
    },
  ],
};

// A role-less stage parks awaiting_human with every gate still pending — machine evidence
// missing, so the policy must not touch its human gate.
const ROLELESS_FLOW: FlowDef = {
  id: flowOf('roleless'),
  name: 'Roleless',
  stages: [
    { id: stageOf('manual'), name: 'Manual', role: null, exit: [LINT, APPROVAL] },
  ],
};

// A human-only exit (the planner pattern): nothing machine passed, nothing to rely on.
const HUMAN_ONLY_FLOW: FlowDef = {
  id: flowOf('human-only'),
  name: 'Human only',
  stages: [
    { id: stageOf('plan'), name: 'Plan', role: roleOf('planner'), exit: [APPROVAL] },
  ],
};

const created = (flow: FlowSlug = POLICY_FLOW.id, at: EpochMs = 10): WorkOrderEvent => ({ type: 'created', at, by: USER, flow });
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
const gatePassed = (stage: string, gate: string, at: EpochMs = 40): WorkOrderEvent => ({
  type: 'gate_evaluated',
  at,
  stage: stageOf(stage),
  gate: gateOf(gate),
  verdict: { status: 'passed' },
});
const gateFailed = (stage: string, gate: string, at: EpochMs = 40): WorkOrderEvent => ({
  type: 'gate_evaluated',
  at,
  stage: stageOf(stage),
  gate: gateOf(gate),
  verdict: { status: 'failed', reason: 'no' },
});

/** The full machine pass of POLICY_FLOW's implement stage: after it, only the human gate waits. */
const machinePass = (): readonly WorkOrderEvent[] => [
  created(),
  runStarted('implement'),
  runFinished('succeeded'),
  gatePassed('implement', 'lint'),
  gatePassed('implement', 'secrets'),
];

describe('decideGateAuto', () => {
  it('R-181: lists the pending human gate once the stage’s machine gates all passed, with the machine evidence in stage order', () => {
    const events = machinePass();
    const state = deriveWorkOrderState(POLICY_FLOW, events);
    expect(state.status).toBe('awaiting_human');
    expect(decideGateAuto(POLICY_FLOW, state, events, 'auto')).toEqual([
      {
        gate: gateOf('approval'),
        policy: GATE_AUTO_POLICY,
        level: 'auto',
        passedMachineGates: [gateOf('lint'), gateOf('secrets')],
      },
    ]);
  });

  it('R-181: lists every decidable human gate of the stage, in stage order', () => {
    const events: readonly WorkOrderEvent[] = [
      created(),
      runStarted('implement'),
      runFinished('succeeded'),
      gatePassed('implement', 'lint'),
    ];
    const state = deriveWorkOrderState(TWO_HUMAN_FLOW, events);
    expect(state.status).toBe('awaiting_human');
    expect(decideGateAuto(TWO_HUMAN_FLOW, state, events, 'auto').map((approval) => approval.gate)).toEqual([
      gateOf('approval'),
      gateOf('review'),
    ]);
  });

  it('R-181: never lists a gate of USER_ONLY_GATES — a pending page_approval stays with the human', () => {
    const events: readonly WorkOrderEvent[] = [
      created(PAGE_FLOW.id),
      runStarted('publish'),
      runFinished('succeeded'),
      gatePassed('publish', 'lint'),
    ];
    const state = deriveWorkOrderState(PAGE_FLOW, events);
    expect(state.status).toBe('awaiting_human');
    expect(decideGateAuto(PAGE_FLOW, state, events, 'auto')).toEqual([]);
  });

  it('R-181: empty while a machine gate is still pending — a role-less stage’s machine evidence is missing', () => {
    const events: readonly WorkOrderEvent[] = [created(ROLELESS_FLOW.id)];
    const state = deriveWorkOrderState(ROLELESS_FLOW, events);
    expect(state.status).toBe('awaiting_human');
    expect(decideGateAuto(ROLELESS_FLOW, state, events, 'auto')).toEqual([]);
  });

  it('R-181: empty when the gate carries an earlier failed verdict — a human reject is standing doubt', () => {
    const events: readonly WorkOrderEvent[] = [
      ...machinePass(),
      gateFailed('implement', 'approval'),
      runStarted('implement', 2),
      runFinished('succeeded', 2),
      gatePassed('implement', 'lint', 60),
      gatePassed('implement', 'secrets', 61),
    ];
    const state = deriveWorkOrderState(POLICY_FLOW, events);
    expect(state.status).toBe('awaiting_human');
    expect(state.pendingGates).toContain(gateOf('approval'));
    expect(decideGateAuto(POLICY_FLOW, state, events, 'auto')).toEqual([]);
  });

  it('R-181: empty below the auto level', () => {
    const events = machinePass();
    const state = deriveWorkOrderState(POLICY_FLOW, events);
    expect(decideGateAuto(POLICY_FLOW, state, events, 'manual')).toEqual([]);
  });

  it('R-181: empty unless the stage actually waits for a human', () => {
    const events: readonly WorkOrderEvent[] = [
      created(),
      runStarted('implement'),
      runFinished('succeeded'),
      gatePassed('implement', 'lint'),
    ];
    const state = deriveWorkOrderState(POLICY_FLOW, events);
    expect(state.status).toBe('gating');
    expect(decideGateAuto(POLICY_FLOW, state, events, 'auto')).toEqual([]);
  });

  it('R-181: a human-only stage stays with the human at every level — no machine gate to rely on', () => {
    const events: readonly WorkOrderEvent[] = [
      created(HUMAN_ONLY_FLOW.id),
      runStarted('plan'),
      runFinished('succeeded'),
    ];
    const state = deriveWorkOrderState(HUMAN_ONLY_FLOW, events);
    expect(state.status).toBe('awaiting_human');
    expect(decideGateAuto(HUMAN_ONLY_FLOW, state, events, 'auto')).toEqual([]);
  });
});
