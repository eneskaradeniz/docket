import { describe, expect, it } from 'vitest';
import type { FlowDef, GateDef } from '../definitions';
import type { GateVerdict } from '../gates';
import type { Actor, EnvSlug, EpochMs, FlowSlug, GateSlug, RoleSlug, RunId, RunOutcome, StageSlug } from '../shared';
import { deriveWorkOrderState, type WorkOrderState, type WorkOrderStatus } from './derive';
import type { WorkOrderEvent } from './events';

const USER: Actor = { kind: 'user', id: 'u-1' };

const stageOf = (id: string): StageSlug => id as StageSlug;
const gateOf = (id: string): GateSlug => id as GateSlug;
const roleOf = (id: string): RoleSlug => id as RoleSlug;
const flowOf = (id: string): FlowSlug => id as FlowSlug;
const envOf = (id: string): EnvSlug => id as EnvSlug;
const runOf = (n: number): RunId => `01RUN000000000000000000${String(n).padStart(2, '0')}` as RunId;

const HUMAN_PLAN: GateDef = { kind: 'human', id: gateOf('plan-approval'), label: 'Plan onayı' };
const COMMAND_TESTS: GateDef = { kind: 'command', id: gateOf('tests'), commandSet: 'tests' };
const SCAN_SECRETS: GateDef = { kind: 'secret_scan', id: gateOf('secrets') };
const HUMAN_CLOSURE: GateDef = { kind: 'human', id: gateOf('closure'), label: 'Kapanış' };
const PAGE_FINDINGS: GateDef = { kind: 'page_approval', id: gateOf('findings'), label: 'Bulgular' };
const AGENT_VERDICT: GateDef = { kind: 'agent_verdict', id: gateOf('verdict'), role: roleOf('reviewer') };
const HUMAN_APPROVAL: GateDef = { kind: 'human', id: gateOf('approval'), label: 'Onay' };
const COMMAND_LINT: GateDef = { kind: 'command', id: gateOf('lint'), commandSet: 'lint' };

// Acceptance fixture: three stages covering the gate flavours this module reasons about —
// a human-gated stage, a machine-gated stage with onFail, and a human-only (no role) stage.
const THREE_STAGE: FlowDef = {
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
    { id: stageOf('close'), name: 'Close', role: null, exit: [HUMAN_CLOSURE] },
  ],
};

// onFail pointing at a different (earlier) stage, so entry counting across stages is visible.
const GOTO_FLOW: FlowDef = {
  id: flowOf('goto'),
  name: 'Goto',
  stages: [
    {
      id: stageOf('fix'),
      name: 'Fix',
      role: roleOf('developer'),
      exit: [COMMAND_LINT],
      onFail: { goto: stageOf('fix'), maxAttempts: 2 },
    },
    {
      id: stageOf('build'),
      name: 'Build',
      role: roleOf('developer'),
      exit: [COMMAND_TESTS],
      onFail: { goto: stageOf('fix'), maxAttempts: 2 },
    },
  ],
};

// A stage without onFail: every failure is terminal.
const NO_ONFAIL: FlowDef = {
  id: flowOf('no-onfail'),
  name: 'No onFail',
  stages: [{ id: stageOf('solo'), name: 'Solo', role: roleOf('developer'), exit: [COMMAND_TESTS] }],
};

// page_approval is a human gate: success here waits for a person, it never gates.
const PAGE_FLOW: FlowDef = {
  id: flowOf('page'),
  name: 'Page',
  stages: [{ id: stageOf('research'), name: 'Research', role: roleOf('analyst'), exit: [PAGE_FINDINGS] }],
};

// Mixed exit gates: a non-human verdict gate plus the two flavours of human gate.
const MIXED_FLOW: FlowDef = {
  id: flowOf('mixed'),
  name: 'Mixed',
  stages: [{ id: stageOf('review'), name: 'Review', role: roleOf('reviewer'), exit: [AGENT_VERDICT, HUMAN_APPROVAL, PAGE_FINDINGS] }],
};

// Zero-gate stages: the first advances on entry only because it has no role; the last
// advances as soon as its run succeeds.
const ZERO_GATE_FLOW: FlowDef = {
  id: flowOf('zero-gate'),
  name: 'Zero gate',
  stages: [
    { id: stageOf('auto'), name: 'Auto', role: null, exit: [] },
    { id: stageOf('sign'), name: 'Sign', role: null, exit: [HUMAN_CLOSURE] },
  ],
};

const WITH_ROLE_ZERO_GATE_FLOW: FlowDef = {
  id: flowOf('with-role-zero-gate'),
  name: 'With role zero gate',
  stages: [
    { id: stageOf('work'), name: 'Work', role: roleOf('planner'), exit: [HUMAN_PLAN] },
    { id: stageOf('wrap'), name: 'Wrap', role: roleOf('documenter'), exit: [] },
  ],
};

// A role-bearing zero-gate stage still rests at ready — only its run's success advances it.
const ROLE_NO_GATES_FLOW: FlowDef = {
  id: flowOf('role-no-gates'),
  name: 'Role no gates',
  stages: [
    { id: stageOf('solo'), name: 'Solo', role: roleOf('developer'), exit: [] },
    { id: stageOf('after'), name: 'After', role: roleOf('reviewer'), exit: [AGENT_VERDICT] },
  ],
};

// An unknown verdict on the last stage must block, never advance to done.
const LAST_AGENT_FLOW: FlowDef = {
  id: flowOf('last-agent'),
  name: 'Last agent',
  stages: [{ id: stageOf('verdicts'), name: 'Verdicts', role: roleOf('reviewer'), exit: [AGENT_VERDICT] }],
};

// A deploy stage: the deploy gate is machine-flavoured, so a succeeded run gates on it until an
// approved deployment is recorded; a failed deployment re-enters the stage for one retry.
const DEPLOY_STG: GateDef = { kind: 'deploy', id: gateOf('deploy-stg'), environment: envOf('stg') };
const DEPLOY_FLOW: FlowDef = {
  id: flowOf('deploy'),
  name: 'Deploy',
  stages: [
    { id: stageOf('build'), name: 'Build', role: roleOf('developer'), exit: [COMMAND_TESTS] },
    { id: stageOf('ship'), name: 'Ship', role: roleOf('developer'), exit: [DEPLOY_STG], onFail: { goto: stageOf('ship'), maxAttempts: 2 } },
  ],
};

const created = (at: EpochMs = 10): WorkOrderEvent => ({ type: 'created', at, by: USER, flow: THREE_STAGE.id });
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
const gateOn = (stage: string, gate: string, verdict: GateVerdict, at: EpochMs = 40): WorkOrderEvent => ({
  type: 'gate_evaluated',
  at,
  stage: stageOf(stage),
  gate: gateOf(gate),
  verdict,
});
const gatePassed = (stage: string, gate: string, at: EpochMs = 40): WorkOrderEvent => gateOn(stage, gate, { status: 'passed' }, at);
const gateFailed = (stage: string, gate: string, reason = 'boom', at: EpochMs = 40): WorkOrderEvent =>
  gateOn(stage, gate, { status: 'failed', reason }, at);
const blockedEvent = (reason: string, at: EpochMs = 50): WorkOrderEvent => ({ type: 'blocked', at, by: USER, reason });
const unblockedEvent = (at: EpochMs = 60): WorkOrderEvent => ({ type: 'unblocked', at, by: USER });
const closedEvent = (at: EpochMs = 70): WorkOrderEvent => ({ type: 'closed', at, by: USER });
const COMMIT = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
const deployAttempted = (result: 'success' | 'failed', at: EpochMs = 45, outputTail?: string): WorkOrderEvent => ({
  type: 'deployment_attempted',
  at,
  stage: stageOf('ship'),
  gate: gateOf('deploy-stg'),
  environment: envOf('stg'),
  commit: COMMIT,
  approvedBy: USER,
  result,
  ...(outputTail === undefined ? {} : { outputTail }),
});

const derive = (flow: FlowDef, events: readonly WorkOrderEvent[]): WorkOrderState => deriveWorkOrderState(flow, events);

// The prefix of a healthy walk up to implement's gates, so single-rule tests read as deltas.
const AT_IMPLEMENT_READY: readonly WorkOrderEvent[] = [
  created(),
  runStarted('plan'),
  runFinished('succeeded'),
  gatePassed('plan', 'plan-approval'),
];
const AT_IMPLEMENT_GATING: readonly WorkOrderEvent[] = [...AT_IMPLEMENT_READY, runStarted('implement'), runFinished('succeeded')];

// Three failed gates against implement's onFail (goto implement ×3): attempts 2 and 3, then blocked.
const FAILED_THRICE: readonly WorkOrderEvent[] = (() => {
  const events: WorkOrderEvent[] = [...AT_IMPLEMENT_GATING];
  for (let n = 1; n <= 3; n += 1) {
    events.push(gateFailed('implement', 'tests', `failure ${n}`));
    if (n < 3) events.push(runStarted('implement', n + 1), runFinished('succeeded', n + 1));
  }
  return events;
})();

// A healthy walk up to the deploy stage's gating point, so the deployment tests read as deltas.
const AT_SHIP_GATING: readonly WorkOrderEvent[] = [
  created(),
  runStarted('build'),
  runFinished('succeeded'),
  gatePassed('build', 'tests'),
  runStarted('ship'),
  runFinished('succeeded'),
];

describe('deriveWorkOrderState — creation (R-17)', () => {
  it('R-17: created enters the first stage at attempt 1, ready when it has a role', () => {
    expect(derive(THREE_STAGE, [created()])).toEqual({
      status: 'ready',
      stage: 'plan',
      attempt: 1,
      pendingGates: ['plan-approval'],
    });
  });

  it('R-17: a stage without a role is awaiting_human with all its gates pending', () => {
    expect(derive(ZERO_GATE_FLOW, [created()])).toEqual({
      status: 'awaiting_human',
      stage: 'sign',
      attempt: 1,
      pendingGates: ['closure'],
    });
  });

  it('R-17: a first stage with a role and no gates is ready with no pending gates', () => {
    expect(derive(ROLE_NO_GATES_FLOW, [created()])).toEqual({
      status: 'ready',
      stage: 'solo',
      attempt: 1,
      pendingGates: [],
    });
  });

  it('R-19: a no-role zero-gate stage advances on entry', () => {
    // ZERO_GATE_FLOW starts with the role-less zero-gate "auto" — creation lands on "sign".
    expect(derive(ZERO_GATE_FLOW, [created()])).toMatchObject({ stage: 'sign', status: 'awaiting_human', attempt: 1 });
  });

  it('a flow whose stages are all no-role zero-gate stages is done at creation', () => {
    const allAuto: FlowDef = {
      id: flowOf('all-auto'),
      name: 'All auto',
      stages: [
        { id: stageOf('a1'), name: 'A1', role: null, exit: [] },
        { id: stageOf('a2'), name: 'A2', role: null, exit: [] },
      ],
    };
    expect(derive(allAuto, [created()])).toEqual({ status: 'done', stage: null, attempt: 1, pendingGates: [] });
  });

  it('R-23a: an empty history derives the same entry state as created', () => {
    expect(derive(THREE_STAGE, [])).toEqual(derive(THREE_STAGE, [created()]));
  });
});

describe('deriveWorkOrderState — runs (R-18)', () => {
  it('R-18: run_started moves a ready stage to running', () => {
    expect(derive(THREE_STAGE, [created(), runStarted('plan')])).toMatchObject({ status: 'running', stage: 'plan', attempt: 1 });
  });

  it('R-18: run_finished with limit leaves the work order limit_waiting', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_READY, runStarted('implement'), runFinished('limit')])).toEqual({
      status: 'limit_waiting',
      stage: 'implement',
      attempt: 1,
      pendingGates: ['tests', 'secrets'],
    });
  });

  it('R-18: run_finished with cancelled returns to ready at the same attempt', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_READY, runStarted('implement'), runFinished('cancelled')])).toEqual({
      status: 'ready',
      stage: 'implement',
      attempt: 1,
      pendingGates: ['tests', 'secrets'],
    });
  });

  it('R-18: cancelled on a stage without a role returns to awaiting_human', () => {
    expect(
      derive(THREE_STAGE, [
        ...AT_IMPLEMENT_GATING,
        gatePassed('implement', 'tests'),
        gatePassed('implement', 'secrets'),
        runStarted('close'),
        runFinished('cancelled'),
      ]),
    ).toEqual({ status: 'awaiting_human', stage: 'close', attempt: 1, pendingGates: ['closure'] });
  });

  it('R-18: run_finished failed without onFail blocks with reason "run failed"', () => {
    expect(derive(NO_ONFAIL, [created(), runStarted('solo'), runFinished('failed')])).toEqual({
      status: 'blocked',
      stage: 'solo',
      attempt: 1,
      pendingGates: ['tests'],
      blockedReason: 'run failed',
    });
  });

  it('R-18: run_finished failed with onFail applies the fail rule instead of blocking', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_READY, runStarted('implement'), runFinished('failed')])).toEqual({
      status: 'ready',
      stage: 'implement',
      attempt: 2,
      pendingGates: ['tests', 'secrets'],
    });
  });

  it('a run_started naming another stage is ignored', () => {
    expect(derive(THREE_STAGE, [created(), runStarted('implement')])).toEqual(derive(THREE_STAGE, [created()]));
  });
});

describe('deriveWorkOrderState — success and pending gates (R-19)', () => {
  it('R-19: success makes the stage gates pending and gates while a non-human gate is pending', () => {
    expect(derive(THREE_STAGE, AT_IMPLEMENT_GATING)).toEqual({
      status: 'gating',
      stage: 'implement',
      attempt: 1,
      pendingGates: ['tests', 'secrets'],
    });
  });

  it('R-19: success with only human gates is awaiting_human, never gating', () => {
    expect(derive(THREE_STAGE, [created(), runStarted('plan'), runFinished('succeeded')])).toEqual({
      status: 'awaiting_human',
      stage: 'plan',
      attempt: 1,
      pendingGates: ['plan-approval'],
    });
  });

  it('R-19: page_approval counts as a human gate, so a page-gated stage awaits a human', () => {
    expect(derive(PAGE_FLOW, [created(), runStarted('research'), runFinished('succeeded')])).toEqual({
      status: 'awaiting_human',
      stage: 'research',
      attempt: 1,
      pendingGates: ['findings'],
    });
  });

  it('R-19: a zero-gate stage advances immediately after its run succeeds', () => {
    expect(
      derive(WITH_ROLE_ZERO_GATE_FLOW, [
        created(),
        runStarted('work'),
        runFinished('succeeded'),
        gatePassed('work', 'plan-approval'),
        runStarted('wrap'),
        runFinished('succeeded'),
      ]),
    ).toEqual({ status: 'done', stage: null, attempt: 1, pendingGates: [] });
  });

  it('R-19: passing the non-human gates of a mixed stage flips it to awaiting_human', () => {
    expect(derive(MIXED_FLOW, [created(), runStarted('review'), runFinished('succeeded'), gatePassed('review', 'verdict')])).toEqual({
      status: 'awaiting_human',
      stage: 'review',
      attempt: 1,
      pendingGates: ['approval', 'findings'],
    });
  });
});

describe('deriveWorkOrderState — gate evaluation and advance (R-20)', () => {
  it('R-20: a passed gate leaves the stage pending on the remaining gates', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, gatePassed('implement', 'tests')])).toEqual({
      status: 'gating',
      stage: 'implement',
      attempt: 1,
      pendingGates: ['secrets'],
    });
  });

  it('R-20: a pending verdict keeps the gate pending and the status unchanged', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, gateOn('implement', 'tests', { status: 'pending' })])).toEqual({
      status: 'gating',
      stage: 'implement',
      attempt: 1,
      pendingGates: ['tests', 'secrets'],
    });
  });

  it('R-20: when all gates pass the flow advances to the next stage at attempt 1, ready', () => {
    expect(derive(THREE_STAGE, AT_IMPLEMENT_READY)).toEqual({
      status: 'ready',
      stage: 'implement',
      attempt: 1,
      pendingGates: ['tests', 'secrets'],
    });
  });

  it('R-20: advancing into a stage without a role yields awaiting_human with its gates pending', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, gatePassed('implement', 'tests'), gatePassed('implement', 'secrets')])).toEqual(
      { status: 'awaiting_human', stage: 'close', attempt: 1, pendingGates: ['closure'] },
    );
  });

  it('R-20: passing the last stage gates ends the work order with stage null', () => {
    expect(
      derive(THREE_STAGE, [
        ...AT_IMPLEMENT_GATING,
        gatePassed('implement', 'tests'),
        gatePassed('implement', 'secrets'),
        gatePassed('close', 'closure'),
      ]),
    ).toEqual({ status: 'done', stage: null, attempt: 1, pendingGates: [] });
  });

  it('R-20: re-evaluating an already-passed gate changes nothing', () => {
    const once = derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, gatePassed('implement', 'tests')]);
    const twice = derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, gatePassed('implement', 'tests'), gatePassed('implement', 'tests')]);
    expect(twice).toEqual(once);
  });

  it('a gate_evaluated naming another stage is ignored', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, gatePassed('close', 'closure')])).toEqual(derive(THREE_STAGE, AT_IMPLEMENT_GATING));
  });

  it('a gate_evaluated for a gate outside the stage exit is ignored', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, gatePassed('implement', 'closure')])).toEqual(
      derive(THREE_STAGE, AT_IMPLEMENT_GATING),
    );
  });

  it('a gate_evaluated while the stage is still running is ignored', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_READY, runStarted('implement'), gatePassed('implement', 'tests')])).toEqual(
      derive(THREE_STAGE, [...AT_IMPLEMENT_READY, runStarted('implement')]),
    );
  });
});

describe('deriveWorkOrderState — the fail rule (R-21, R-21a)', () => {
  it('R-21: a failed gate with onFail re-enters the goto stage at attempt = entries so far + 1', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, gateFailed('implement', 'tests', 'npm test exited 1')])).toEqual({
      status: 'ready',
      stage: 'implement',
      attempt: 2,
      pendingGates: ['tests', 'secrets'],
    });
  });

  it('R-21: a failed gate without onFail blocks with a reason naming the gate', () => {
    const blocked = derive(NO_ONFAIL, [
      created(),
      runStarted('solo'),
      runFinished('succeeded'),
      gateFailed('solo', 'tests', 'npm test exited 1'),
    ]);
    expect(blocked.status).toBe('blocked');
    expect(blocked.blockedReason).toContain('tests');
  });

  it('R-21: counting is per goto stage — a cross-stage goto lands on its next entry', () => {
    // fix was entered once (at creation); build fails → goto fix, which has one entry → attempt 2.
    expect(
      derive(GOTO_FLOW, [
        created(),
        runStarted('fix'),
        runFinished('succeeded'),
        gatePassed('fix', 'lint'),
        runStarted('build'),
        runFinished('succeeded'),
        gateFailed('build', 'tests'),
      ]),
    ).toEqual({ status: 'ready', stage: 'fix', attempt: 2, pendingGates: ['lint'] });
  });

  it('R-21: attempts exhausted blocks with a reason naming the gate', () => {
    const blocked = derive(THREE_STAGE, FAILED_THRICE);
    expect(blocked.status).toBe('blocked');
    expect(blocked.stage).toBe('implement');
    expect(blocked.attempt).toBe(3);
    expect(blocked.blockedReason).toContain('tests');
  });

  it('R-21: a failed run with attempts exhausted blocks with reason "run failed"', () => {
    let events: readonly WorkOrderEvent[] = [...AT_IMPLEMENT_READY];
    for (let n = 1; n <= 3; n += 1) {
      events = [...events, runStarted('implement', n), runFinished('failed', n)];
    }
    expect(derive(THREE_STAGE, events)).toEqual({
      status: 'blocked',
      stage: 'implement',
      attempt: 3,
      pendingGates: ['tests', 'secrets'],
      blockedReason: 'run failed',
    });
  });

  it('R-21a: the first entry is attempt 1 and each goto enters at the next number', () => {
    // implement was entered once by the advance from plan; every failed gate enters it again.
    let events: readonly WorkOrderEvent[] = [...AT_IMPLEMENT_GATING];
    const attempts: number[] = [];
    for (let n = 0; n < 2; n += 1) {
      events = [...events, gateFailed('implement', 'tests')];
      attempts.push(derive(THREE_STAGE, events).attempt);
      events = [...events, runStarted('implement', attempts[n]), runFinished('succeeded', attempts[n])];
    }
    expect(attempts).toEqual([2, 3]);
    // A fourth entry would exceed maxAttempts 3, so the third failure blocks at attempt 3.
    events = [...events, gateFailed('implement', 'tests')];
    const state = derive(THREE_STAGE, events);
    expect(state.status).toBe('blocked');
    expect(state.attempt).toBe(3);
  });

  it('R-21a: entries persist across the flow, so a stage re-entered by goto resumes its count', () => {
    const firstEntry = derive(GOTO_FLOW, [created()]);
    const reentered = derive(GOTO_FLOW, [created(), runStarted('fix'), runFinished('succeeded'), gateFailed('fix', 'lint')]);
    const exhausted = derive(GOTO_FLOW, [
      created(),
      runStarted('fix'),
      runFinished('succeeded'),
      gateFailed('fix', 'lint'),
      runStarted('fix', 2),
      runFinished('succeeded', 2),
      gateFailed('fix', 'lint'),
    ]);
    expect(firstEntry).toMatchObject({ stage: 'fix', attempt: 1 });
    expect(reentered).toMatchObject({ status: 'ready', stage: 'fix', attempt: 2 });
    // fix has been entered twice; maxAttempts 2 refuses a third entry.
    expect(exhausted.status).toBe('blocked');
    expect(exhausted.blockedReason).toContain('lint');
  });
});

describe('deriveWorkOrderState — unknown verdicts (R-22)', () => {
  it('R-22: a gate unknown blocks with the verdict reason', () => {
    expect(
      derive(MIXED_FLOW, [
        created(),
        runStarted('review'),
        runFinished('succeeded'),
        gateOn('review', 'verdict', { status: 'unknown', reason: 'evidence pointers did not resolve' }),
      ]),
    ).toEqual({
      status: 'blocked',
      stage: 'review',
      attempt: 1,
      pendingGates: ['verdict', 'approval', 'findings'],
      blockedReason: 'evidence pointers did not resolve',
    });
  });

  it('R-22: an unknown verdict on the last stage never advances to done', () => {
    const blocked = derive(LAST_AGENT_FLOW, [
      created(),
      runStarted('verdicts'),
      runFinished('succeeded'),
      gateOn('verdicts', 'verdict', { status: 'unknown', reason: 'no eyes on the box' }),
    ]);
    expect(blocked.status).toBe('blocked');
    expect(blocked.stage).not.toBe(null);
  });
});

describe('deriveWorkOrderState — block, unblock, close (R-23)', () => {
  it('R-23: a blocked event blocks with its reason', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, blockedEvent('operator asked')])).toEqual({
      status: 'blocked',
      stage: 'implement',
      attempt: 1,
      pendingGates: ['tests', 'secrets'],
      blockedReason: 'operator asked',
    });
  });

  it('R-23: unblocked restores the exact pre-block state, including attempt and pending gates', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, blockedEvent('operator asked'), unblockedEvent()])).toEqual(
      derive(THREE_STAGE, AT_IMPLEMENT_GATING),
    );
  });

  it('R-23: events between the block and the unblocked do not survive the restore', () => {
    expect(
      derive(THREE_STAGE, [
        ...AT_IMPLEMENT_GATING,
        blockedEvent('operator asked'),
        gatePassed('implement', 'tests'),
        runStarted('implement'),
        unblockedEvent(),
      ]),
    ).toEqual(derive(THREE_STAGE, AT_IMPLEMENT_GATING));
  });

  it('R-23: unblocked after an attempts-exhausted block restores the state before the failing gate', () => {
    expect(derive(THREE_STAGE, [...FAILED_THRICE, unblockedEvent()])).toEqual({
      status: 'gating',
      stage: 'implement',
      attempt: 3,
      pendingGates: ['tests', 'secrets'],
    });
  });

  it('R-23: a second blocked event while blocked only changes the reason', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, blockedEvent('first'), blockedEvent('second'), unblockedEvent()])).toEqual(
      derive(THREE_STAGE, AT_IMPLEMENT_GATING),
    );
  });

  it('an unblocked without a block changes nothing', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, unblockedEvent()])).toEqual(derive(THREE_STAGE, AT_IMPLEMENT_GATING));
  });

  it('R-23a: events arriving while blocked leave the state untouched', () => {
    expect(
      derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, blockedEvent('stop'), runStarted('implement'), gateFailed('implement', 'tests')]),
    ).toEqual(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, blockedEvent('stop')]));
  });

  it('R-23a: block reasons name the cause — "run failed", the failed gate, or the unknown verdict reason', () => {
    const runFailed = derive(NO_ONFAIL, [created(), runStarted('solo'), runFinished('failed')]);
    expect(runFailed.blockedReason).toBe('run failed');
    const gateFailedState = derive(NO_ONFAIL, [created(), runStarted('solo'), runFinished('succeeded'), gateFailed('solo', 'tests', 'exit 1')]);
    expect(gateFailedState.blockedReason).toBe('gate "tests" failed: exit 1');
  });

  it('R-23: closed ends the work order with status done and stage null', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, closedEvent()])).toEqual({
      status: 'done',
      stage: null,
      attempt: 1,
      pendingGates: [],
    });
  });

  it('R-23: a blocked work order can still be closed', () => {
    expect(derive(THREE_STAGE, [...AT_IMPLEMENT_GATING, blockedEvent('stop'), closedEvent()])).toMatchObject({
      status: 'done',
      stage: null,
    });
  });

  it('R-23: events after done are ignored', () => {
    const done = derive(THREE_STAGE, [
      ...AT_IMPLEMENT_GATING,
      gatePassed('implement', 'tests'),
      gatePassed('implement', 'secrets'),
      gatePassed('close', 'closure'),
    ]);
    const after = derive(THREE_STAGE, [
      ...AT_IMPLEMENT_GATING,
      gatePassed('implement', 'tests'),
      gatePassed('implement', 'secrets'),
      gatePassed('close', 'closure'),
      runStarted('close'),
      gateFailed('implement', 'tests'),
      blockedEvent('late'),
      unblockedEvent(),
      closedEvent(),
    ]);
    expect(after).toEqual(done);
  });
});

describe('deriveWorkOrderState — deployment attempts (E-10)', () => {
  it('E-10: a deployment_attempted is a recorded fact — the gate only moves with its verdict event', () => {
    expect(derive(DEPLOY_FLOW, [...AT_SHIP_GATING, deployAttempted('success')])).toEqual(derive(DEPLOY_FLOW, AT_SHIP_GATING));
  });

  it('E-10: the record never decides the gate — the accompanying gate_evaluated carries the transition', () => {
    expect(derive(DEPLOY_FLOW, [...AT_SHIP_GATING, deployAttempted('success'), gatePassed('ship', 'deploy-stg')])).toEqual({
      status: 'done',
      stage: null,
      attempt: 1,
      pendingGates: [],
    });
  });

  it('E-10: a failed record followed by its failed verdict applies the fail rule like any gate', () => {
    expect(
      derive(DEPLOY_FLOW, [...AT_SHIP_GATING, deployAttempted('failed', 45, 'deploy exited 1'), gateFailed('ship', 'deploy-stg', 'deploy failed in stg')]),
    ).toEqual({ status: 'ready', stage: 'ship', attempt: 2, pendingGates: ['deploy-stg'] });
  });

  it('E-10: one record per evaluation — a retried deployment adds a second record, the final verdict still decides', () => {
    expect(
      derive(DEPLOY_FLOW, [
        ...AT_SHIP_GATING,
        deployAttempted('failed', 45, 'deploy exited 1'),
        gateFailed('ship', 'deploy-stg', 'deploy failed in stg'),
        runStarted('ship', 2),
        runFinished('succeeded', 2),
        deployAttempted('success', 55),
        gatePassed('ship', 'deploy-stg'),
      ]),
    ).toEqual({ status: 'done', stage: null, attempt: 2, pendingGates: [] });
  });

  it('E-10: the redacted outputTail rides along as inert data, with or without it the fold is the same', () => {
    // Built at runtime so no credential-shaped literal ever sits in the source.
    const tokenTail = ['deploy: releasing commit ' + COMMIT, 'export DEPLOY_TOKEN=' + 'x'.repeat(12)].join('\n');
    const withTail = derive(DEPLOY_FLOW, [...AT_SHIP_GATING, deployAttempted('success', 45, tokenTail)]);
    const withoutTail = derive(DEPLOY_FLOW, [...AT_SHIP_GATING, deployAttempted('success', 46)]);
    expect(withTail).toEqual(withoutTail);
  });

  it('E-10: a deployment_attempted arriving while blocked is held by the block with everything else', () => {
    expect(
      derive(DEPLOY_FLOW, [...AT_SHIP_GATING, blockedEvent('hold'), deployAttempted('success'), gatePassed('ship', 'deploy-stg')]),
    ).toEqual(derive(DEPLOY_FLOW, [...AT_SHIP_GATING, blockedEvent('hold')]));
  });

  it('E-10: a deployment_attempted after done changes nothing', () => {
    const done = derive(DEPLOY_FLOW, [...AT_SHIP_GATING, deployAttempted('success'), gatePassed('ship', 'deploy-stg')]);
    expect(
      derive(DEPLOY_FLOW, [...AT_SHIP_GATING, deployAttempted('success'), gatePassed('ship', 'deploy-stg'), deployAttempted('failed', 99)]),
    ).toEqual(done);
  });
});

describe('deriveWorkOrderState — acceptance walk', () => {
  it('the three-stage fixture covers every status at least once', () => {
    const happy: readonly WorkOrderEvent[] = [
      created(),
      runStarted('plan'),
      runFinished('succeeded'),
      gatePassed('plan', 'plan-approval'),
      runStarted('implement'),
      runFinished('limit'),
      runStarted('implement'),
      runFinished('succeeded'),
      gatePassed('implement', 'tests'),
      gatePassed('implement', 'secrets'),
      gatePassed('close', 'closure'),
    ];
    const seen = new Set<WorkOrderStatus>();
    for (let n = 1; n <= happy.length; n += 1) seen.add(derive(THREE_STAGE, happy.slice(0, n)).status);
    for (let n = 1; n <= FAILED_THRICE.length; n += 1) seen.add(derive(THREE_STAGE, FAILED_THRICE.slice(0, n)).status);

    expect([...seen].sort()).toEqual(['awaiting_human', 'blocked', 'done', 'gating', 'limit_waiting', 'ready', 'running'].sort());
  });

  it('does not mutate the input events or the flow', () => {
    const events: readonly WorkOrderEvent[] = Object.freeze([
      Object.freeze(created()),
      Object.freeze(runStarted('plan')),
      Object.freeze(runFinished('succeeded')),
      Object.freeze(gatePassed('plan', 'plan-approval')),
    ]);
    const flow: FlowDef = Object.freeze({ ...THREE_STAGE, stages: THREE_STAGE.stages.map((stage) => Object.freeze({ ...stage })) });
    expect(() => derive(flow, events)).not.toThrow();
  });
});
