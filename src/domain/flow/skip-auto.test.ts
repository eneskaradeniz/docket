import { describe, expect, it } from 'vitest';
import type { FlowDef, GateDef } from '../definitions';
import type { Actor, EnvSlug, FlowSlug, GateSlug, RoleSlug, StageSlug } from '../shared';
import { deriveWorkOrderState, type WorkOrderState } from './derive';
import type { WorkOrderEvent } from './events';
import { STAGE_SKIP_AUTO_POLICY, decideStageSkipAuto } from './skip-auto';

const USER: Actor = { kind: 'user', id: 'u-1' };

const stageOf = (id: string): StageSlug => id as StageSlug;
const gateOf = (id: string): GateSlug => id as GateSlug;
const roleOf = (id: string): RoleSlug => id as RoleSlug;
const flowOf = (id: string): FlowSlug => id as FlowSlug;
const envOf = (id: string): EnvSlug => id as EnvSlug;

const COMMAND_TESTS: GateDef = { kind: 'command', id: gateOf('tests'), commandSet: 'tests' };
const COMMAND_LINT: GateDef = { kind: 'command', id: gateOf('lint'), commandSet: 'lint' };
const HUMAN_APPROVAL: GateDef = { kind: 'human', id: gateOf('human-approval'), label: 'Human approval' };
const PAGE_APPROVAL: GateDef = { kind: 'page_approval', id: gateOf('page-approval'), label: 'Page approval' };
const DEPLOY_STG: GateDef = { kind: 'deploy', id: gateOf('deploy-stg'), environment: envOf('stg') };

const FOUR_STAGE_FLOW: FlowDef = {
  id: flowOf('four-stage'),
  name: 'Four Stage Flow',
  stages: [
    { id: stageOf('plan'), name: 'Plan', role: roleOf('planner'), exit: [COMMAND_LINT] },
    { id: stageOf('build'), name: 'Build', role: roleOf('developer'), exit: [COMMAND_TESTS] },
    { id: stageOf('review'), name: 'Review', role: roleOf('reviewer'), exit: [COMMAND_TESTS] },
    { id: stageOf('ship'), name: 'Ship', role: roleOf('developer'), exit: [DEPLOY_STG] },
  ],
};

const FLOW_WITH_HUMAN_INTERMEDIATE: FlowDef = {
  id: flowOf('flow-human-inter'),
  name: 'Flow with Human Intermediate',
  stages: [
    { id: stageOf('plan'), name: 'Plan', role: roleOf('planner'), exit: [COMMAND_LINT] },
    { id: stageOf('build'), name: 'Build', role: roleOf('developer'), exit: [HUMAN_APPROVAL] },
    { id: stageOf('review'), name: 'Review', role: roleOf('reviewer'), exit: [COMMAND_TESTS] },
    { id: stageOf('ship'), name: 'Ship', role: roleOf('developer'), exit: [DEPLOY_STG] },
  ],
};

const FLOW_WITH_PAGE_INTERMEDIATE: FlowDef = {
  id: flowOf('flow-page-inter'),
  name: 'Flow with Page Intermediate',
  stages: [
    { id: stageOf('plan'), name: 'Plan', role: roleOf('planner'), exit: [COMMAND_LINT] },
    { id: stageOf('build'), name: 'Build', role: roleOf('developer'), exit: [PAGE_APPROVAL] },
    { id: stageOf('review'), name: 'Review', role: roleOf('reviewer'), exit: [COMMAND_TESTS] },
  ],
};

const createdEvent = (): WorkOrderEvent => ({
  type: 'created',
  at: 1,
  by: USER,
  flow: FOUR_STAGE_FLOW.id,
});

describe('decideStageSkipAuto (R-189)', () => {
  it('R-189: returns approval under auto level when proposal is clean, pending, and strictly ahead', () => {
    const events: readonly WorkOrderEvent[] = [
      createdEvent(),
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('build'), stageOf('review')], reason: 'already completed' },
    ];
    const state = deriveWorkOrderState(FOUR_STAGE_FLOW, events);
    expect(state.stage).toBe('plan');
    expect(state.status).toBe('ready');

    const result = decideStageSkipAuto(FOUR_STAGE_FLOW, state, events, 'auto');
    expect(result).toEqual([
      {
        stages: [stageOf('build'), stageOf('review')],
        policy: STAGE_SKIP_AUTO_POLICY,
        level: 'auto',
      },
    ]);
  });

  it('R-189: returns empty array for non-auto autonomy levels', () => {
    const events: readonly WorkOrderEvent[] = [
      createdEvent(),
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('build')], reason: 'skip' },
    ];
    const state = deriveWorkOrderState(FOUR_STAGE_FLOW, events);

    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, state, events, 'manual')).toEqual([]);
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, state, events, 'balanced')).toEqual([]);
  });

  it('R-189: returns empty array when there is no pending proposal', () => {
    const eventsNoProposal: readonly WorkOrderEvent[] = [createdEvent()];
    const state1 = deriveWorkOrderState(FOUR_STAGE_FLOW, eventsNoProposal);
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, state1, eventsNoProposal, 'auto')).toEqual([]);

    const eventsAlreadyDecided: readonly WorkOrderEvent[] = [
      createdEvent(),
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('build')], reason: 'skip' },
      { type: 'stage_skip_decided', at: 11, approved: true },
    ];
    const state2 = deriveWorkOrderState(FOUR_STAGE_FLOW, eventsAlreadyDecided);
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, state2, eventsAlreadyDecided, 'auto')).toEqual([]);
  });

  it('R-189: returns empty array when status is blocked or done', () => {
    const events: readonly WorkOrderEvent[] = [
      createdEvent(),
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('build')], reason: 'skip' },
    ];
    const state = deriveWorkOrderState(FOUR_STAGE_FLOW, events);

    const blockedState: WorkOrderState = { ...state, status: 'blocked', blockedReason: 'operator block' };
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, blockedState, events, 'auto')).toEqual([]);

    const doneState: WorkOrderState = { ...state, status: 'done', stage: null };
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, doneState, events, 'auto')).toEqual([]);
  });

  it('R-189: returns empty array if any gate_evaluated in history failed', () => {
    const events: readonly WorkOrderEvent[] = [
      createdEvent(),
      {
        type: 'gate_evaluated',
        at: 5,
        stage: stageOf('plan'),
        gate: gateOf('tests'),
        verdict: { status: 'failed', reason: 'tests broke' },
      },
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('build')], reason: 'skip' },
    ];
    const state = deriveWorkOrderState(FOUR_STAGE_FLOW, events);
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, state, events, 'auto')).toEqual([]);
  });

  it('R-189: returns empty array if any earlier stage_skip_decided was rejected (approved: false)', () => {
    const events: readonly WorkOrderEvent[] = [
      createdEvent(),
      { type: 'stage_skip_proposed', at: 5, stages: [stageOf('build')], reason: 'first skip' },
      { type: 'stage_skip_decided', at: 6, approved: false },
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('review')], reason: 'second skip' },
    ];
    const state = deriveWorkOrderState(FOUR_STAGE_FLOW, events);
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, state, events, 'auto')).toEqual([]);
  });

  it('R-189: returns empty array if proposed stage is not in flow or not strictly ahead', () => {
    // Stage not in flow
    const eventsGhost: readonly WorkOrderEvent[] = [
      createdEvent(),
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('ghost-stage')], reason: 'skip' },
    ];
    const stateGhost = deriveWorkOrderState(FOUR_STAGE_FLOW, eventsGhost);
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, stateGhost, eventsGhost, 'auto')).toEqual([]);

    // Proposing current stage ('plan')
    const eventsCurrent: readonly WorkOrderEvent[] = [
      createdEvent(),
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('plan')], reason: 'skip' },
    ];
    const stateCurrent = deriveWorkOrderState(FOUR_STAGE_FLOW, eventsCurrent);
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, stateCurrent, eventsCurrent, 'auto')).toEqual([]);
  });

  it('R-189: returns empty array if proposed stage exit blocks skip or has USER_ONLY_GATES', () => {
    // Stage with deploy gate (ship)
    const eventsDeploy: readonly WorkOrderEvent[] = [
      createdEvent(),
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('ship')], reason: 'skip' },
    ];
    const stateDeploy = deriveWorkOrderState(FOUR_STAGE_FLOW, eventsDeploy);
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, stateDeploy, eventsDeploy, 'auto')).toEqual([]);

    // Stage with human exit gate
    const eventsHuman: readonly WorkOrderEvent[] = [
      { type: 'created', at: 1, by: USER, flow: FLOW_WITH_HUMAN_INTERMEDIATE.id },
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('build')], reason: 'skip' },
    ];
    const stateHuman = deriveWorkOrderState(FLOW_WITH_HUMAN_INTERMEDIATE, eventsHuman);
    expect(decideStageSkipAuto(FLOW_WITH_HUMAN_INTERMEDIATE, stateHuman, eventsHuman, 'auto')).toEqual([]);

    // Stage with page_approval exit gate
    const eventsPage: readonly WorkOrderEvent[] = [
      { type: 'created', at: 1, by: USER, flow: FLOW_WITH_PAGE_INTERMEDIATE.id },
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('build')], reason: 'skip' },
    ];
    const statePage = deriveWorkOrderState(FLOW_WITH_PAGE_INTERMEDIATE, eventsPage);
    expect(decideStageSkipAuto(FLOW_WITH_PAGE_INTERMEDIATE, statePage, eventsPage, 'auto')).toEqual([]);
  });

  it('R-189: partial approvals are refused — any failing stage in proposal refuses the entire proposal', () => {
    // 'review' is skippable, but 'ship' has a deploy gate: the whole proposal must be refused
    const events: readonly WorkOrderEvent[] = [
      createdEvent(),
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('review'), stageOf('ship')], reason: 'skip both' },
    ];
    const state = deriveWorkOrderState(FOUR_STAGE_FLOW, events);
    expect(decideStageSkipAuto(FOUR_STAGE_FLOW, state, events, 'auto')).toEqual([]);
  });

  it('R-189: is a pure function that never mutates inputs and gives identical results for identical inputs', () => {
    const events: readonly WorkOrderEvent[] = [
      createdEvent(),
      { type: 'stage_skip_proposed', at: 10, stages: [stageOf('build')], reason: 'skip' },
    ];
    const state = deriveWorkOrderState(FOUR_STAGE_FLOW, events);
    const eventsSnapshot = JSON.stringify(events);
    const stateSnapshot = JSON.stringify(state);

    const first = decideStageSkipAuto(FOUR_STAGE_FLOW, state, events, 'auto');
    const second = decideStageSkipAuto(FOUR_STAGE_FLOW, state, events, 'auto');

    expect(first).toEqual(second);
    expect(JSON.stringify(events)).toBe(eventsSnapshot);
    expect(JSON.stringify(state)).toBe(stateSnapshot);
  });
});
