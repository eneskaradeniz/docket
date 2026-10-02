// api/queries.test.ts — the read models behind createApi: the cockpit (A-22) and the repo
// board (A-23, A-30, A-31), plus the workOrder.detail pass-through. Scenarios are seeded straight
// into the fakes; only the query under test goes through the api.
import { describe, expect, it } from 'vitest';

import type {
  AccountId,
  Actor,
  AgentEvent,
  FlowSlug,
  GateSlug,
  QueueItem,
  QueueItemId,
  RunId,
  RunOutcome,
  Slug,
  StageSlug,
  TaskSlug,
  Ulid,
  WorkOrderEvent,
  WorkOrderId,
  RepoSlug,
} from '../domain/index';
import { parseSlug, parseUlid } from '../domain/index';

import type { AppDeps, DiscoveredProvider, ModelCatalog, ProviderDiscovery, RunRecord } from '../application';
import { createPermissionBoard } from '../application';
import type { FakeDefinitionStore } from '../application/ports/fakes';
import {
  createFakeCapabilityCatalog,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeModelCatalog,
  FAKE_ROADMAP_TARGET,
} from '../application/ports/fakes';

import { createApi } from './api';
import type { RepoRegistryPort } from './api';
import type {
  AccountModelsView,
  BoardView,
  CockpitView,
  OpenAskView,
  ProjectTree,
  RoadmapPageView,
  SettingsAccountsView,
  RepoListItem,
} from './queries';
import { RUN_EVENTS_TAIL_LIMIT } from './queries';

function slugOf<B extends string>(input: string): Slug<B> {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
}

function ulidOf<B extends string>(input: string): Ulid<B> {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
}

const ACTOR: Actor = { kind: 'user', id: 'u-1' };

const REPO = slugOf<'repo'>('acme');
const BROKEN_REPO = slugOf<'repo'>('bozuk');
const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAZ');

const PLAN = slugOf<'stage'>('plan');
const IMPLEMENT = slugOf<'stage'>('implement');
const CLOSE = slugOf<'stage'>('close');
const PLAN_APPROVAL = slugOf<'gate'>('plan-approval');
const CLOSURE = slugOf<'gate'>('closure');

const BOARD_FLOW = slugOf<'flow'>('board-flow');
const SIDE_FLOW = slugOf<'flow'>('side-flow');
const SOLO_FLOW = slugOf<'flow'>('solo-flow');

const ROLE_JSON = {
  id: 'worker',
  name: 'Worker',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

// The default flow the board is built from; side-flow and solo-flow exist to pin placement by
// stage id across flows (side-flow shares 'implement') and the no-column case (solo-flow does not).
const FLOWS_JSON = [
  {
    id: 'board-flow',
    name: 'Board Flow',
    stages: [
      {
        id: 'plan',
        name: 'Plan',
        role: 'worker',
        exit: [{ kind: 'human', id: 'plan-approval', label: 'Plan approval' }],
      },
      { id: 'implement', name: 'Implement', role: 'worker', exit: [] },
      { id: 'close', name: 'Close', role: null, exit: [{ kind: 'human', id: 'closure', label: 'Closure' }] },
    ],
  },
  {
    id: 'side-flow',
    name: 'Side Flow',
    stages: [{ id: 'implement', name: 'Implement', role: 'worker', exit: [] }],
  },
  {
    id: 'solo-flow',
    name: 'Solo Flow',
    stages: [{ id: 'solo', name: 'Solo', role: 'worker', exit: [] }],
  },
];

const DEFINITIONS_JSON = JSON.stringify({
  roles: [ROLE_JSON],
  flows: FLOWS_JSON,
  capabilities: [],
  repo: {
    id: 'acme',
    name: 'Acme',
    repos: [],
    flows: ['board-flow', 'side-flow', 'solo-flow'],
    defaultFlow: 'board-flow',
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  },
});

interface Harness {
  readonly deps: AppDeps;
  /** The fake behind `deps.definitions`, exposed for tests that seed a repo of their own. */
  readonly definitions: FakeDefinitionStore;
}

const createHarness = (): Harness => {
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', DEFINITIONS_JSON);
  // A second repo whose definitions no longer parse: its work orders must not break the
  // cockpit, they simply cannot be classified.
  definitions.seed({ kind: 'repo', repo: BROKEN_REPO }, 'defs.json', '{not json');
  return { deps: createFakeDeps({ definitions }), definitions };
};

const seedWorkOrder = async (
  h: Harness,
  id: WorkOrderId,
  flow: FlowSlug,
  title: string,
  createdAt: number,
  repo: RepoSlug = REPO,
  project = slugOf<'project'>('proj'),
): Promise<void> => {
  await h.deps.workOrders.create({ id, project, repo, flow, title, createdAt, createdBy: ACTOR });
  await h.deps.workOrders.appendEvent(id, { type: 'created', at: createdAt, by: ACTOR, flow });
};

const seedEvents = async (h: Harness, id: WorkOrderId, events: readonly WorkOrderEvent[]): Promise<void> => {
  for (const event of events) await h.deps.workOrders.appendEvent(id, event);
};

const seedRun = async (h: Harness, record: RunRecord, events: readonly AgentEvent[] = []): Promise<void> => {
  await h.deps.runs.create(record);
  if (events.length > 0) await h.deps.runs.appendEvents(record.id, events);
};

const runStarted = (at: number, runId: RunId, stage: StageSlug): WorkOrderEvent => ({
  type: 'run_started',
  at,
  runId,
  stage,
  attempt: 1,
});

const runFinished = (at: number, runId: RunId, outcome: RunOutcome): WorkOrderEvent => ({
  type: 'run_finished',
  at,
  runId,
  outcome,
});

const gatePassed = (at: number, stage: StageSlug, gate: GateSlug): WorkOrderEvent => ({
  type: 'gate_evaluated',
  at,
  stage,
  gate,
  verdict: { status: 'passed' },
});

const activeRun = (id: RunId, workOrderId: WorkOrderId, stage: StageSlug, startedAt: number): RunRecord => ({
  id,
  workOrderId,
  stage,
  attempt: 1,
  role: slugOf<'role'>('worker'),
  route: { accountId: ACCOUNT },
  startedAt,
  autoResumesUsed: 0,
});

// --- the cockpit scenario: every attention kind at once, plus the states that stay out ---------

const WO_ASK = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const WO_AWAIT_EARLY = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const WO_AWAIT_LATE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAX');
const WO_BLOCKED = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAY');
const WO_LIMIT = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAZ');
const WO_RUNNING = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB1');
const WO_READY = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB2');
const WO_DONE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB3');
const WO_ASK_ANSWERED = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB4');
const WO_BROKEN = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB5');

const RUN_ASK = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H01');
const RUN_RUNNING = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H02');
const RUN_ANSWERED = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H03');
const RUN_EARLY = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H11');
const RUN_LATE = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H12');
const RUN_LIMIT = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H13');

const seedCockpitScenario = async (h: Harness, projectOf: (repo: RepoSlug) => string = () => 'proj'): Promise<Harness> => {
  await seedWorkOrder(h, WO_READY, BOARD_FLOW, 'Just ready', 100, REPO, slugOf<'project'>(projectOf(REPO)));

  await seedWorkOrder(h, WO_DONE, BOARD_FLOW, 'All finished', 200, REPO, slugOf<'project'>(projectOf(REPO)));
  await seedEvents(h, WO_DONE, [
    runStarted(250, RUN_EARLY, PLAN),
    runFinished(300, RUN_EARLY, 'succeeded'),
    gatePassed(350, PLAN, PLAN_APPROVAL),
    runStarted(400, RUN_LATE, IMPLEMENT),
    runFinished(450, RUN_LATE, 'succeeded'),
    gatePassed(500, CLOSE, CLOSURE),
  ]);

  await seedWorkOrder(h, WO_AWAIT_EARLY, BOARD_FLOW, 'Waiting early', 1_000, REPO, slugOf<'project'>(projectOf(REPO)));
  await seedEvents(h, WO_AWAIT_EARLY, [runStarted(1_100, RUN_EARLY, PLAN), runFinished(1_200, RUN_EARLY, 'succeeded')]);

  await seedWorkOrder(h, WO_LIMIT, BOARD_FLOW, 'Hit a limit', 1_500, REPO, slugOf<'project'>(projectOf(REPO)));
  await seedEvents(h, WO_LIMIT, [runStarted(1_600, RUN_LIMIT, PLAN), runFinished(2_000, RUN_LIMIT, 'limit')]);

  await seedWorkOrder(h, WO_AWAIT_LATE, BOARD_FLOW, 'Waiting late', 2_000, REPO, slugOf<'project'>(projectOf(REPO)));
  await seedEvents(h, WO_AWAIT_LATE, [runStarted(2_400, RUN_LATE, PLAN), runFinished(2_500, RUN_LATE, 'succeeded')]);

  await seedWorkOrder(h, WO_ASK, BOARD_FLOW, 'Waiting on a permission', 4_000, REPO, slugOf<'project'>(projectOf(REPO)));
  await seedEvents(h, WO_ASK, [runStarted(4_100, RUN_ASK, PLAN)]);
  await seedRun(h, activeRun(RUN_ASK, WO_ASK, PLAN, 4_000), [
    { type: 'permission_ask', at: 5_000, id: 'ask-1', tool: 'write', options: ['allow', 'deny'] },
  ]);

  await seedWorkOrder(h, WO_RUNNING, BOARD_FLOW, 'Busy running', 4_300, REPO, slugOf<'project'>(projectOf(REPO)));
  await seedEvents(h, WO_RUNNING, [runStarted(4_400, RUN_RUNNING, PLAN)]);
  await seedRun(h, activeRun(RUN_RUNNING, WO_RUNNING, PLAN, 4_500));

  await seedWorkOrder(h, WO_ASK_ANSWERED, BOARD_FLOW, 'Ask already answered', 5_000, REPO, slugOf<'project'>(projectOf(REPO)));
  await seedEvents(h, WO_ASK_ANSWERED, [runStarted(5_100, RUN_ANSWERED, PLAN)]);
  await seedRun(h, activeRun(RUN_ANSWERED, WO_ASK_ANSWERED, PLAN, 5_500), [
    { type: 'permission_ask', at: 5_200, id: 'ask-2', tool: 'write', options: ['allow', 'deny'] },
    { type: 'tool_result', at: 5_300, id: 'ask-2', ok: true },
  ]);

  await seedWorkOrder(h, WO_BLOCKED, BOARD_FLOW, 'Explicitly blocked', 9_700, REPO, slugOf<'project'>(projectOf(REPO)));
  await seedEvents(h, WO_BLOCKED, [{ type: 'blocked', at: 9_900, by: ACTOR, reason: 'waiting on upstream' }]);

  await seedWorkOrder(h, WO_BROKEN, BOARD_FLOW, 'Underivable state', 50, BROKEN_REPO, slugOf<'project'>(projectOf(BROKEN_REPO)));
  return h;
};

// --- the queue and close-out fixtures for the cockpit field rules (A-35 … A-39) -------------------

const WO_STALE_STAGE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GB6');
const WO_CLOSED_EVENT = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GB7');
const RUN_STALE_STAGE = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H25');
const ACCOUNT_BARE = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5GC1');
const QUEUE_POOL = ulidOf<'pool'>('01ARZ3NDEKTSV4RRFFQ69G5GC2');
const QUEUE_METER = ulidOf<'meter'>('01ARZ3NDEKTSV4RRFFQ69G5GC3');
const QUEUE_EARLY = ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5HC1');
const QUEUE_LATE = ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5HC2');
const QUEUE_OTHER = ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5HC3');
const QUEUE_LIMITED = ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5HC4');
const QUEUE_BARE = ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5HC5');

const queueItem = (
  id: QueueItemId,
  workOrderId: WorkOrderId,
  stage: StageSlug,
  enqueuedAt: number,
  repo: RepoSlug = REPO,
  route: { readonly accountId: AccountId } = { accountId: ACCOUNT },
): QueueItem => ({ id, workOrderId, repo, stage, route, priority: 0, enqueuedAt });

// --- the board scenario: one work order per position, plus the cross-flow cases ---------------

const WO_B_PLAN = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GAV');
const WO_B_IMPL = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GAW');
const WO_B_RUN = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GAX');
const WO_B_SIDE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GAY');
const WO_B_SOLO = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GAZ');
const WO_B_CLOSE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GB1');
const WO_B_DONE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GB2');

const RUN_B_RUN = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H21');

// The accounts the board's account/since rules (A-30, A-31) read: two with records, one whose
// record is gone, and the extra runs that put them on the scenario's cards.
const ACCOUNT_SPARE = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5GB3');
const ACCOUNT_GONE = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5GB4');
const RUN_B_FIRST = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H22');
const RUN_B_SPARE = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H23');
const RUN_B_GONE = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H24');
const WO_B_LATE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GB5');

const accountRecord = (id: AccountId, label: string) => ({
  id,
  provider: 'acme-prov',
  label,
  authMode: 'subscription' as const,
  limitPolicy: 'wait_resume' as const,
  caps: [],
});

const seedBoardScenario = async (h: Harness): Promise<Harness> => {
  await seedWorkOrder(h, WO_B_PLAN, BOARD_FLOW, 'Board plan', 100);
  await seedEvents(h, WO_B_PLAN, [runStarted(150, RUN_EARLY, PLAN), runFinished(200, RUN_EARLY, 'succeeded')]);

  await seedWorkOrder(h, WO_B_IMPL, BOARD_FLOW, 'At implement', 200);
  await seedEvents(h, WO_B_IMPL, [
    runStarted(250, RUN_LATE, PLAN),
    runFinished(300, RUN_LATE, 'succeeded'),
    gatePassed(350, PLAN, PLAN_APPROVAL),
  ]);

  await seedWorkOrder(h, WO_B_RUN, BOARD_FLOW, 'Still running', 300);
  await seedEvents(h, WO_B_RUN, [
    runStarted(350, RUN_LIMIT, PLAN),
    runFinished(400, RUN_LIMIT, 'succeeded'),
    gatePassed(450, PLAN, PLAN_APPROVAL),
    runStarted(500, RUN_B_RUN, IMPLEMENT),
  ]);
  await seedRun(h, activeRun(RUN_B_RUN, WO_B_RUN, IMPLEMENT, 500));

  await seedWorkOrder(h, WO_B_SIDE, SIDE_FLOW, 'Side entry', 400);
  await seedWorkOrder(h, WO_B_SOLO, SOLO_FLOW, 'Solo entry', 450);

  await seedWorkOrder(h, WO_B_CLOSE, BOARD_FLOW, 'At close', 500);
  await seedEvents(h, WO_B_CLOSE, [
    runStarted(550, RUN_EARLY, PLAN),
    runFinished(600, RUN_EARLY, 'succeeded'),
    gatePassed(650, PLAN, PLAN_APPROVAL),
    runStarted(700, RUN_LATE, IMPLEMENT),
    runFinished(750, RUN_LATE, 'succeeded'),
  ]);

  await seedWorkOrder(h, WO_B_DONE, BOARD_FLOW, 'Finished', 600);
  await seedEvents(h, WO_B_DONE, [
    runStarted(650, RUN_EARLY, PLAN),
    runFinished(700, RUN_EARLY, 'succeeded'),
    gatePassed(750, PLAN, PLAN_APPROVAL),
    runStarted(800, RUN_LATE, IMPLEMENT),
    runFinished(850, RUN_LATE, 'succeeded'),
    gatePassed(900, CLOSE, CLOSURE),
  ]);
  return h;
};

// --- the detail scenario: a flow with a deploy gate over a protected environment chain -------------

const RELEASE_REPO = slugOf<'repo'>('release');
const RELEASE_FLOW = slugOf<'flow'>('release-flow');
const WO_RELEASE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GB6');

const RELEASE_DEFINITIONS_JSON = JSON.stringify({
  roles: [ROLE_JSON],
  flows: [
    {
      id: 'release-flow',
      name: 'Release Flow',
      stages: [
        { id: 'build', name: 'Build', role: 'worker', exit: [] },
        {
          id: 'ship',
          name: 'Ship',
          role: null,
          exit: [
            { kind: 'human', id: 'ship-approval', label: 'Ship approval' },
            { kind: 'deploy', id: 'deploy-prod', environment: 'prod' },
          ],
        },
      ],
    },
  ],
  capabilities: [],
  repo: {
    id: 'release',
    name: 'Release',
    repos: [],
    flows: ['release-flow'],
    defaultFlow: 'release-flow',
    commandSets: { 'deploy-dev': ['true'], 'deploy-staging': ['true'], 'deploy-prod': ['true'] },
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
    environments: [
      { id: 'dev', name: 'Dev', order: 1, deploy: 'deploy-dev', env: {}, protected: false },
      { id: 'staging', name: 'Staging', order: 2, deploy: 'deploy-staging', env: {}, protected: false, promoteFrom: 'dev' },
      { id: 'prod', name: 'Prod', order: 3, deploy: 'deploy-prod', env: {}, protected: true, promoteFrom: 'staging' },
    ],
  },
});

// --- the tests ---------------------------------------------------------------------------------------

describe('cockpit', () => {
  it('A-22: attention is ordered by kind (permission_ask, awaiting_human, blocked, limit_waiting), then since ascending', async () => {
    const h = await seedCockpitScenario(createHarness());
    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;

    expect(view.attention.map((item) => item.workOrderId)).toEqual([
      WO_ASK,
      WO_AWAIT_EARLY,
      WO_AWAIT_LATE,
      WO_BLOCKED,
      WO_LIMIT,
    ]);
    expect(view.attention[0]).toEqual({
      workOrderId: WO_ASK,
      number: 7,
      project: 'proj',
      repo: 'acme',
      title: 'Waiting on a permission',
      kind: 'permission_ask',
      stage: 'plan',
      since: 5_000,
    });
    // The two awaiting_human items keep since-ascending order among themselves, and kind outranks
    // since: the blocked item (since 9_900) still precedes the limit_waiting one (since 2_000).
    expect(view.attention.map((item) => [item.kind, item.since])).toEqual([
      ['permission_ask', 5_000],
      ['awaiting_human', 1_200],
      ['awaiting_human', 2_500],
      ['blocked', 9_900],
      ['limit_waiting', 2_000],
    ]);
  });

  it('A-22: only attention-worthy work orders are listed; active runs are reported separately', async () => {
    const h = await seedCockpitScenario(createHarness());
    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;

    // ready, running, done, an answered ask and an underivable repo all stay out of attention.
    const listed = view.attention.map((item) => item.workOrderId);
    expect(listed).not.toContain(WO_READY);
    expect(listed).not.toContain(WO_RUNNING);
    expect(listed).not.toContain(WO_DONE);
    expect(listed).not.toContain(WO_ASK_ANSWERED);
    expect(listed).not.toContain(WO_BROKEN);

    expect(view.running).toEqual([
      { workOrderId: WO_ASK, number: 7, stage: 'plan', accountId: ACCOUNT, provider: '', startedAt: 4_000, title: 'Waiting on a permission', stageIndex: 1, stageCount: 3, queued: false, limitResetsAt: null },
      { workOrderId: WO_RUNNING, number: 8, stage: 'plan', accountId: ACCOUNT, provider: '', startedAt: 4_500, title: 'Busy running', stageIndex: 1, stageCount: 3, queued: false, limitResetsAt: null },
      { workOrderId: WO_ASK_ANSWERED, number: 9, stage: 'plan', accountId: ACCOUNT, provider: '', startedAt: 5_500, title: 'Ask already answered', stageIndex: 1, stageCount: 3, queued: false, limitResetsAt: null },
    ]);
  });

  it('A-29: every view item that names a work order carries its display number', async () => {
    const h = await seedCockpitScenario(createHarness());
    // The scenario's runs all route through ACCOUNT; the account record itself is only needed by
    // the account.detail read.
    await h.deps.accounts.save({
      id: ACCOUNT,
      provider: 'acme-prov',
      label: 'Main',
      authMode: 'subscription',
      limitPolicy: 'wait_resume',
      caps: [],
    });
    const api = createApi(h.deps);

    const cockpit = (await api.query({ type: 'cockpit' })) as CockpitView;
    expect(cockpit.attention.map((item) => [item.workOrderId, item.number])).toEqual([
      [WO_ASK, 7],
      [WO_AWAIT_EARLY, 4],
      [WO_AWAIT_LATE, 6],
      [WO_BLOCKED, 10],
      [WO_LIMIT, 5],
    ]);
    expect(cockpit.running.map((item) => item.number)).toEqual([7, 8, 9]);
    // The scenario's one done work order is number 3; recentlyClosed carries it.
    expect(cockpit.recentlyClosed).toEqual([
      {
        workOrderId: WO_DONE,
        number: 3,
        title: 'All finished',
        project: 'proj',
        repo: 'acme',
        closedAt: 500,
        outcome: 'merged',
      },
    ]);

    const board = (await api.query({ type: 'repo.board', repo: 'acme' })) as BoardView;
    // The plan column holds every non-done acme order in createdAt order; the later stages and
    // the done lane hold the rest.
    expect(board.columns.map((column) => column.workOrders.map((card) => card.number))).toEqual([
      [2, 4, 5, 6, 7, 8, 9, 10],
      [],
      [],
    ]);
    expect(board.done.map((card) => card.number)).toEqual([3]);

    const detail = (await api.query({ type: 'workOrder.detail', id: WO_AWAIT_EARLY })) as { readonly number: number };
    expect(detail.number).toBe(4);

    const account = (await api.query({ type: 'account.detail', id: ACCOUNT })) as {
      readonly activeWork: readonly { readonly workOrderId: string; readonly number: number }[];
    };
    expect(account.activeWork.map((item) => [item.workOrderId, item.number])).toEqual([
      [WO_ASK, 7],
      [WO_RUNNING, 8],
      [WO_ASK_ANSWERED, 9],
    ]);
  });

  it('A-35: running rows carry the title and the 1-based stage position; a stage outside the flow zeroes the strip', async () => {
    const h = await seedCockpitScenario(createHarness());
    // A run whose stage no longer exists in board-flow; created last, so the scenario's numbering
    // is untouched and the row rides after the scenario's runs.
    await seedWorkOrder(h, WO_STALE_STAGE, BOARD_FLOW, 'Stale stage', 9_800);
    await seedRun(h, activeRun(RUN_STALE_STAGE, WO_STALE_STAGE, slugOf<'stage'>('gone'), 9_900));

    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;

    // board-flow is plan (1), implement (2), close (3); every scenario run rides plan.
    expect(view.running.map((row) => [row.title, row.stageIndex, row.stageCount])).toEqual([
      ['Waiting on a permission', 1, 3],
      ['Busy running', 1, 3],
      ['Ask already answered', 1, 3],
      ['Stale stage', 0, 0],
    ]);
  });

  it('A-36: queued items ride running after the running rows, startedAt = the enqueue instant', async () => {
    const h = await seedCockpitScenario(createHarness(), (repo) => (repo === REPO ? 'proj' : 'other'));
    await h.deps.queue.put(queueItem(QUEUE_OTHER, WO_BROKEN, PLAN, 4_000, BROKEN_REPO));
    await h.deps.queue.put(queueItem(QUEUE_EARLY, WO_AWAIT_LATE, IMPLEMENT, 5_500));
    await h.deps.queue.put(queueItem(QUEUE_LATE, WO_READY, PLAN, 6_000));

    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;

    // Three running rows first, then the queue by enqueuedAt asc. A queued row's startedAt is the
    // instant it was queued, and the broken repo's flow no longer loads, so its strip is 0/0.
    expect(view.running.slice(3).map((row) => [row.workOrderId, row.startedAt, row.queued, row.title])).toEqual([
      [WO_BROKEN, 4_000, true, 'Underivable state'],
      [WO_AWAIT_LATE, 5_500, true, 'Waiting late'],
      [WO_READY, 6_000, true, 'Just ready'],
    ]);
    expect(view.running[3]).toMatchObject({ stage: 'plan', accountId: ACCOUNT, stageIndex: 0, stageCount: 0 });
    expect(view.running[4]).toMatchObject({ stage: 'implement', stageIndex: 2, stageCount: 3 });

    const narrowed = (await createApi(h.deps).query({ type: 'cockpit', project: 'proj' })) as CockpitView;
    expect(narrowed.running.filter((row) => row.queued === true).map((row) => row.workOrderId)).toEqual([WO_AWAIT_LATE, WO_READY]);
  });

  it('A-37: a queued row blocked by quota reads limit with the earliest reset; other waits read queue', async () => {
    const h = await seedCockpitScenario(createHarness());
    await h.deps.accounts.savePools(ACCOUNT, [
      { id: QUEUE_POOL, accountId: ACCOUNT, label: 'allowance', kind: 'allowance', appliesTo: 'all' },
    ]);
    await h.deps.accounts.saveMeter({
      id: QUEUE_METER,
      poolId: QUEUE_POOL,
      cadence: 'calendar',
      unit: 'fraction',
      remaining: 0,
      resetsAt: 9_000,
      resetPrecision: 'exact',
      observedAt: 1_000,
      source: 'pushed',
    });
    // Routes to an account with no quota data at all: waiting, but not for a limit.
    await h.deps.queue.put(queueItem(QUEUE_LIMITED, WO_READY, PLAN, 6_000));
    await h.deps.queue.put(queueItem(QUEUE_BARE, WO_AWAIT_EARLY, IMPLEMENT, 6_500, REPO, { accountId: ACCOUNT_BARE }));

    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;

    const byWorkOrder = new Map(view.running.map((row) => [row.workOrderId, row]));
    expect(byWorkOrder.get(WO_READY)).toMatchObject({ queued: true, queuedReason: 'limit', limitResetsAt: 9_000 });
    expect(byWorkOrder.get(WO_AWAIT_EARLY)).toMatchObject({ queued: true, queuedReason: 'queue', limitResetsAt: null });
    expect(view.running.filter((row) => row.queued === false).every((row) => row.queuedReason === undefined && row.limitResetsAt === null)).toBe(true);
  });

  it('A-38: project cards carry the latest work-order status change; null when the project has none', async () => {
    const h = await seedCockpitScenario(createHarness());
    await h.deps.projects.save({ id: slugOf<'project'>('proj'), name: 'Proj', mainRepo: REPO, repos: [REPO] });
    await h.deps.projects.save({ id: slugOf<'project'>('empty'), name: 'Empty', mainRepo: REPO, repos: [REPO] });

    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;

    const byProject = new Map(view.projects.map((card) => [card.project, card]));
    // The scenario's newest status change is the explicit block at 9_900; every order, the
    // underivable one included, lives in 'proj' under the default mapping.
    expect(byProject.get('proj')?.lastActivityAt).toBe(9_900);
    expect(byProject.get('empty')?.lastActivityAt).toBeNull();
  });

  it('A-39: outcome — a finished flow reads merged, a closed event reads cancelled', async () => {
    const h = await seedCockpitScenario(createHarness());
    await seedWorkOrder(h, WO_CLOSED_EVENT, BOARD_FLOW, 'Closed by hand', 600);
    await seedEvents(h, WO_CLOSED_EVENT, [{ type: 'closed', at: 700, by: ACTOR }]);

    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;

    expect(view.recentlyClosed.map((entry) => [entry.workOrderId, entry.outcome])).toEqual([
      [WO_CLOSED_EVENT, 'cancelled'],
      [WO_DONE, 'merged'],
    ]);
  });

  it('A-40: each row carries its route account’s provider def id, empty when the account no longer loads', async () => {
    const h = await seedCockpitScenario(createHarness());
    await h.deps.accounts.save(accountRecord(ACCOUNT, 'Main'));
    // A queued row whose account record is gone: the provider resolves to '', never a guess.
    await h.deps.queue.put(queueItem(QUEUE_BARE, WO_AWAIT_EARLY, IMPLEMENT, 6_500, REPO, { accountId: ACCOUNT_BARE }));

    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;

    // The query always fills the field — running and queued rows alike.
    expect(view.running.every((row) => row.provider !== undefined)).toBe(true);
    const byWorkOrder = new Map(view.running.map((row) => [row.workOrderId, row]));
    expect(byWorkOrder.get(WO_RUNNING)?.provider).toBe('acme-prov');
    expect(byWorkOrder.get(WO_AWAIT_EARLY)?.provider).toBe('');
  });
});

describe('repo.board', () => {
  it('A-23: has one column per stage of the repo default flow, in flow order', async () => {
    const h = await seedBoardScenario(createHarness());
    const view = (await createApi(h.deps).query({ type: 'repo.board', repo: 'acme' })) as BoardView;

    expect(view.repo).toBe('acme');
    expect(view.flow).toBe('board-flow');
    expect(view.columns.map((column) => [column.stage, column.name])).toEqual([
      ['plan', 'Plan'],
      ['implement', 'Implement'],
      ['close', 'Close'],
    ]);
  });

  it('A-23: each work order sits in the column of its current stage and done work orders go to done', async () => {
    const h = await seedBoardScenario(createHarness());
    const view = (await createApi(h.deps).query({ type: 'repo.board', repo: 'acme' })) as BoardView;

    expect(view.columns[0]?.workOrders).toEqual([
      { id: WO_B_PLAN, number: 1, title: 'Board plan', status: 'awaiting_human', account: null, since: '1970-01-01T00:00:00.200Z' },
    ]);
    expect(view.columns[1]?.workOrders).toEqual([
      { id: WO_B_IMPL, number: 2, title: 'At implement', status: 'ready', account: null, since: '1970-01-01T00:00:00.350Z' },
      { id: WO_B_RUN, number: 3, title: 'Still running', status: 'running', account: null, since: '1970-01-01T00:00:00.500Z' },
      { id: WO_B_SIDE, number: 4, title: 'Side entry', status: 'ready', account: null, since: '1970-01-01T00:00:00.400Z' },
    ]);
    expect(view.columns[2]?.workOrders).toEqual([
      { id: WO_B_CLOSE, number: 6, title: 'At close', status: 'awaiting_human', account: null, since: '1970-01-01T00:00:00.750Z' },
    ]);
    expect(view.done).toEqual([{ id: WO_B_DONE, number: 7, title: 'Finished' }]);

    // A stage the default flow does not have cannot place its work order anywhere on this board.
    const shown = [
      ...view.columns.flatMap((column) => column.workOrders.map((item) => item.id)),
      ...view.done.map((item) => item.id),
    ];
    expect(shown).not.toContain(WO_B_SOLO);
  });

  it('A-30: each card carries the label of the account of its current or most recent run, null when it never had one', async () => {
    const h = await seedBoardScenario(createHarness());
    await h.deps.accounts.save(accountRecord(ACCOUNT, 'Main'));
    await h.deps.accounts.save(accountRecord(ACCOUNT_SPARE, 'Spare'));
    // The implement card ran twice; the newest run decides the label, not the first.
    await seedRun(h, { ...activeRun(RUN_B_FIRST, WO_B_IMPL, PLAN, 260), endedAt: 290, outcome: 'succeeded' });
    await seedRun(h, {
      ...activeRun(RUN_B_SPARE, WO_B_IMPL, IMPLEMENT, 380),
      route: { accountId: ACCOUNT_SPARE },
      endedAt: 390,
      outcome: 'succeeded',
    });
    // A run whose account record no longer loads reads as null, same as never having run.
    await seedRun(h, { ...activeRun(RUN_B_GONE, WO_B_CLOSE, IMPLEMENT, 760), route: { accountId: ACCOUNT_GONE }, endedAt: 770, outcome: 'succeeded' });
    const view = (await createApi(h.deps).query({ type: 'repo.board', repo: 'acme' })) as BoardView;

    const cardOf = (id: WorkOrderId) => view.columns.flatMap((column) => column.workOrders).find((card) => card.id === id);
    expect(cardOf(WO_B_IMPL)?.account).toBe('Spare');
    expect(cardOf(WO_B_RUN)?.account).toBe('Main');
    expect(cardOf(WO_B_SIDE)?.account).toBeNull(); // never had a run
    expect(cardOf(WO_B_CLOSE)?.account).toBeNull(); // the run's account is gone
  });

  it('A-31: each card carries since — the ISO-8601 UTC instant of the last status change, never a clock read', async () => {
    const h = await seedBoardScenario(createHarness());
    // A card created at a real civil date, then an event that changes nothing: the instant must
    // stay at the last change, not follow the newest event.
    await seedWorkOrder(h, WO_B_LATE, BOARD_FLOW, 'Late entry', 1_759_278_000_000);
    await seedEvents(h, WO_B_LATE, [gatePassed(1_759_278_100_000, PLAN, CLOSURE)]);
    const view = (await createApi(h.deps).query({ type: 'repo.board', repo: 'acme' })) as BoardView;

    const cardOf = (id: WorkOrderId) => view.columns.flatMap((column) => column.workOrders).find((card) => card.id === id);
    expect(cardOf(WO_B_SIDE)?.since).toBe('1970-01-01T00:00:00.400Z'); // no event has changed the status: creation
    expect(cardOf(WO_B_PLAN)?.since).toBe('1970-01-01T00:00:00.200Z'); // run_finished turned it awaiting_human
    expect(cardOf(WO_B_RUN)?.since).toBe('1970-01-01T00:00:00.500Z'); // run_started turned it running
    expect(cardOf(WO_B_LATE)?.since).toBe('2025-10-01T00:20:00.000Z'); // the ignored event must not move it
  });

  it('returns invalid_id for a repo that is not a slug', async () => {
    const h = createHarness();

    const result = await createApi(h.deps).query({ type: 'repo.board', repo: 'Acme' });

    expect(result).toEqual({ ok: false, code: 'invalid_id' });
  });

  it('returns definitions_invalid when the repo has no loadable definitions', async () => {
    const h = createHarness();

    const result = await createApi(h.deps).query({ type: 'repo.board', repo: 'lonely' });

    expect(result).toEqual({ ok: false, code: 'definitions_invalid' });
  });
});

describe('workOrder.detail', () => {
  it('returns the derived view of a known work order', async () => {
    const h = await seedCockpitScenario(createHarness());

    const result = await createApi(h.deps).query({ type: 'workOrder.detail', id: WO_AWAIT_EARLY });

    expect(result).toMatchObject({
      record: { id: WO_AWAIT_EARLY, repo: 'acme', flow: 'board-flow', title: 'Waiting early' },
      state: { status: 'awaiting_human', stage: 'plan', attempt: 1, pendingGates: ['plan-approval'] },
      next: { kind: 'await_human', stage: 'plan', gates: ['plan-approval'] },
      runs: [],
      flow: { id: 'board-flow' },
      // The acme repo section carries no environments, so the list is empty, not absent.
      environments: [],
    });
  });

  it('carries the work order own flow definition and the repo environments, protection included', async () => {
    const h = createHarness();
    h.definitions.seed({ kind: 'repo', repo: RELEASE_REPO }, 'defs.json', RELEASE_DEFINITIONS_JSON);
    await seedWorkOrder(h, WO_RELEASE, RELEASE_FLOW, 'Ship it', 100, RELEASE_REPO);

    const result = await createApi(h.deps).query({ type: 'workOrder.detail', id: WO_RELEASE });

    expect(result).toMatchObject({
      flow: {
        id: 'release-flow',
        stages: [
          { id: 'build', exit: [] },
          {
            id: 'ship',
            exit: [
              { kind: 'human', id: 'ship-approval', label: 'Ship approval' },
              { kind: 'deploy', id: 'deploy-prod', environment: 'prod' },
            ],
          },
        ],
      },
      environments: [
        { id: 'dev', protected: false },
        { id: 'staging', protected: false, promoteFrom: 'dev' },
        { id: 'prod', protected: true, promoteFrom: 'staging' },
      ],
    });
  });

  it('fails soft with definitions_invalid for a work order whose definitions no longer parse', async () => {
    const h = await seedCockpitScenario(createHarness());

    const result = await createApi(h.deps).query({ type: 'workOrder.detail', id: WO_BROKEN });

    expect(result).toEqual({ ok: false, code: 'definitions_invalid' });
  });

  it('returns not_found for an unknown id', async () => {
    const h = createHarness();

    const result = await createApi(h.deps).query({ type: 'workOrder.detail', id: '01ARZ3NDEKTSV4RRFFQ69G5FZZ' });

    expect(result).toEqual({ ok: false, code: 'not_found' });
  });

  it('returns invalid_id for an unparseable id', async () => {
    const h = createHarness();

    const result = await createApi(h.deps).query({ type: 'workOrder.detail', id: 'nope' });

    expect(result).toEqual({ ok: false, code: 'invalid_id' });
  });
});

// --- settings.accounts and providers.discovered (U-13) ----------------------------------------------

const ACCOUNT_OTHER = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB8');
const POOL = ulidOf<'pool'>('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const METER_WINDOW = ulidOf<'meter'>('01ARZ3NDEKTSV4RRFFQ69G5FC2');
const METER_USD = ulidOf<'meter'>('01ARZ3NDEKTSV4RRFFQ69G5FC3');

/** Everything the settings surface lists: one full account, one bare account, bindings per level. */
const seedSettingsScenario = async (h: Harness): Promise<void> => {
  await h.deps.accounts.save({
    id: ACCOUNT,
    provider: 'acme-prov',
    label: 'Main',
    authMode: 'subscription',
    plan: 'pro',
    limitPolicy: 'wait_resume',
    caps: [],
  });
  await h.deps.accounts.save({
    id: ACCOUNT_OTHER,
    provider: 'beta-prov',
    label: 'Spare',
    authMode: 'api_key',
    limitPolicy: 'ask',
    caps: [],
  });
  await h.deps.accounts.savePools(ACCOUNT, [
    { id: POOL, accountId: ACCOUNT, label: 'Weekly allowance', kind: 'allowance', appliesTo: 'all' },
  ]);
  await h.deps.accounts.saveMeter({
    id: METER_WINDOW,
    poolId: POOL,
    label: 'Prompts',
    cadence: 'rolling_from_first_use',
    durationMs: 604_800_000,
    unit: 'prompts',
    used: 40,
    limit: 100,
    remaining: 60,
    resetsAt: 9_000,
    resetPrecision: 'exact',
    observedAt: 8_000,
    source: 'polled',
  });
  // The bare meter pins the null-normalisation: every absent optional reads null, not undefined.
  await h.deps.accounts.saveMeter({
    id: METER_USD,
    poolId: POOL,
    cadence: 'none',
    unit: 'usd',
    resetPrecision: 'unknown',
    observedAt: 8_500,
    source: 'pushed',
  });
  await h.deps.bindings.save(
    { level: 'global' },
    { role: slugOf<'role'>('worker'), accounts: [{ accountId: ACCOUNT, model: 'atlas-max' }] },
  );
  await h.deps.bindings.save(
    { level: 'repo', repo: REPO },
    { role: slugOf<'role'>('reviewer'), accounts: [{ accountId: ACCOUNT_OTHER }, { accountId: ACCOUNT }] },
  );
  await h.deps.bindings.save(
    { level: 'workOrder', workOrderId: WO_AWAIT_EARLY },
    { role: slugOf<'role'>('worker'), accounts: [{ accountId: ACCOUNT_OTHER }] },
  );
};

describe('settings.accounts', () => {
  it('U-13: returns every account with its pools and meters plus the per-role binding chains', async () => {
    const h = createHarness();
    await seedSettingsScenario(h);

    const view = (await createApi(h.deps).query({ type: 'settings.accounts' })) as SettingsAccountsView;

    expect(view.accounts).toEqual([
      {
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'subscription',
        plan: 'pro',
        pools: [{ id: POOL, label: 'Weekly allowance', kind: 'allowance', appliesTo: 'all' }],
        meters: [
          {
            id: METER_WINDOW,
            poolId: POOL,
            label: 'Prompts',
            cadence: 'rolling_from_first_use',
            durationMs: 604_800_000,
            unit: 'prompts',
            used: 40,
            limit: 100,
            remaining: 60,
            resetsAt: 9_000,
            resetPrecision: 'exact',
            observedAt: 8_000,
            source: 'polled',
            staleAfterMs: null,
          },
          {
            id: METER_USD,
            poolId: POOL,
            label: null,
            cadence: 'none',
            durationMs: null,
            unit: 'usd',
            used: null,
            limit: null,
            remaining: null,
            resetsAt: null,
            resetPrecision: 'unknown',
            observedAt: 8_500,
            source: 'pushed',
            staleAfterMs: null,
          },
        ],
      },
      {
        id: ACCOUNT_OTHER,
        provider: 'beta-prov',
        label: 'Spare',
        authMode: 'api_key',
        plan: null,
        pools: [],
        meters: [],
      },
    ]);
    expect(view.bindings).toEqual([
      { scope: { level: 'global' }, role: 'worker', accounts: [{ accountId: ACCOUNT, model: 'atlas-max' }] },
      {
        scope: { level: 'repo', repo: REPO },
        role: 'reviewer',
        accounts: [
          { accountId: ACCOUNT_OTHER, model: null },
          { accountId: ACCOUNT, model: null },
        ],
      },
      {
        scope: { level: 'workOrder', workOrderId: WO_AWAIT_EARLY },
        role: 'worker',
        accounts: [{ accountId: ACCOUNT_OTHER, model: null }],
      },
    ]);
  });

  it('U-13: a stale account naming a provider id with no definition still lists — the settings surface never fails on it', async () => {
    const h = createHarness();
    await h.deps.accounts.save({
      id: ACCOUNT,
      provider: 'gemini', // an id no composed def carries anymore
      label: 'Leftover',
      authMode: 'subscription',
      limitPolicy: 'wait_resume',
      caps: [],
    });

    const view = (await createApi(h.deps).query({ type: 'settings.accounts' })) as SettingsAccountsView;

    expect(view.accounts).toEqual([
      { id: ACCOUNT, provider: 'gemini', label: 'Leftover', authMode: 'subscription', plan: null, pools: [], meters: [] },
    ]);
  });

  it('U-13: an empty store yields empty account and binding lists', async () => {
    const h = createHarness();

    const view = (await createApi(h.deps).query({ type: 'settings.accounts' })) as SettingsAccountsView;

    expect(view).toEqual({ accounts: [], bindings: [] });
  });
});

// --- account.models: the merged catalog read back with the account's consents (P-29, P-40) ------

describe('account.models', () => {
  const saveAccount = async (h: Harness, consentedModels?: readonly string[]): Promise<void> => {
    await h.deps.accounts.save({
      id: ACCOUNT,
      provider: 'acme-prov',
      label: 'Main',
      authMode: 'subscription',
      limitPolicy: 'wait_resume',
      caps: [],
      ...(consentedModels !== undefined ? { consentedModels } : {}),
    });
  };

  it('P-29: included, metered and unknown each map through, with the thinking shape, source and flags', async () => {
    const h = createHarness();
    await saveAccount(h);
    const deps: AppDeps = {
      ...h.deps,
      modelCatalog: createFakeModelCatalog({
        [ACCOUNT]: [
          { id: 'atlas-max', displayName: 'Atlas Max', source: 'live', tier: 'strong', thinking: { kind: 'levels', levels: ['low', 'medium', 'high'] }, billing: 'included' },
          { id: 'atlas-mini', source: 'live', thinking: { kind: 'none' }, billing: 'metered' },
          // A kept-after-failure row whose tier came from a family-id pattern, not the registry.
          { id: 'atlas-fog', source: 'bundled', thinking: 'unknown', billing: 'unknown', autoClassified: true, stale: true },
        ],
      }),
    };

    const view = (await createApi(deps).query({ type: 'account.models', accountId: ACCOUNT })) as AccountModelsView;

    expect(view).toEqual({
      models: [
        { id: 'atlas-max', displayName: 'Atlas Max', tier: 'strong', thinking: { kind: 'levels', levels: ['low', 'medium', 'high'] }, billing: 'included', source: 'live', stale: false, autoClassified: false, consented: false },
        { id: 'atlas-mini', thinking: { kind: 'none' }, billing: 'metered', source: 'live', stale: false, autoClassified: false, consented: false },
        { id: 'atlas-fog', thinking: { kind: 'unknown' }, billing: 'unknown', source: 'bundled', stale: true, autoClassified: true, consented: false },
      ],
      // A subscription the registry says nothing about rides its plan.
      defaultConsented: false,
      defaultBilling: 'included',
    });
  });

  it('P-40: consented is membership in consentedModels; the * marker rides the envelope as defaultConsented, never a model row', async () => {
    const h = createHarness();
    await saveAccount(h, ['atlas-mini', '*']);
    const deps: AppDeps = {
      ...h.deps,
      modelCatalog: createFakeModelCatalog({
        [ACCOUNT]: [
          { id: 'atlas-max', source: 'live', thinking: { kind: 'none' }, billing: 'included' },
          { id: 'atlas-mini', source: 'live', thinking: { kind: 'none' }, billing: 'metered' },
        ],
      }),
    };

    const view = (await createApi(deps).query({ type: 'account.models', accountId: ACCOUNT })) as AccountModelsView;

    expect(view.models.map((model) => [model.id, model.consented])).toEqual([
      ['atlas-max', false],
      ['atlas-mini', true],
    ]);
    // '*' names the route's own default model, not a model: it is consent for the unpinned run.
    expect(view.defaultConsented).toBe(true);
    expect(view.models.some((model) => model.id === '*')).toBe(false);
  });

  it('P-40: a model the catalog leaves unknown reads included once the account reports an allowance bucket for it', async () => {
    const h = createHarness();
    await saveAccount(h);
    const deps: AppDeps = {
      ...h.deps,
      modelCatalog: createFakeModelCatalog({
        [ACCOUNT]: [
          { id: 'atlas-max', source: 'live', thinking: { kind: 'none' }, billing: 'unknown' },
          { id: 'atlas-mini', source: 'live', thinking: { kind: 'none' }, billing: 'metered' },
        ],
      }),
    };
    await deps.accounts.savePools(ACCOUNT, [
      { id: POOL, accountId: ACCOUNT, label: 'atlas-max weekly', kind: 'allowance', appliesTo: [{ exact: 'atlas-max' }] },
    ]);

    const view = (await createApi(deps).query({ type: 'account.models', accountId: ACCOUNT })) as AccountModelsView;

    // The bucket names only atlas-max, so it resolves only that model; metered passes through.
    expect(view.models.map((model) => [model.id, model.billing])).toEqual([
      ['atlas-max', 'included'],
      ['atlas-mini', 'metered'],
    ]);
  });

  it('P-40: defaultBilling is what an unpinned run would take — the route kind’s fixed value, else subscription included and the rest metered', async () => {
    const h = createHarness();
    await h.deps.accounts.save({ id: ACCOUNT, provider: 'acme-prov', label: 'Main', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] });
    await h.deps.accounts.save({ id: ACCOUNT_SPARE, provider: 'acme-prov', label: 'Key', authMode: 'api_key', limitPolicy: 'wait_resume', caps: [] });

    // The route kind fixes the unpinned-run billing; it wins over the auth-mode default.
    const fixed: AppDeps = {
      ...h.deps,
      capabilities: createFakeCapabilityCatalog([{ id: 'acme-sub', provider: 'acme-prov', authMode: 'subscription', defaultBilling: 'metered' }]),
    };
    const answer = (deps: AppDeps, accountId: string): Promise<unknown> =>
      createApi(deps).query({ type: 'account.models', accountId });
    expect(((await answer(fixed, ACCOUNT)) as AccountModelsView).defaultBilling).toBe('metered');

    // Without a fixed kind, only a subscription rides a plan; every other auth mode pays per use.
    expect(((await answer(h.deps, ACCOUNT)) as AccountModelsView).defaultBilling).toBe('included');
    expect(((await answer(h.deps, ACCOUNT_SPARE)) as AccountModelsView).defaultBilling).toBe('metered');
  });

  it('P-29: refresh reaches the catalog port, so it bypasses the cache', async () => {
    const h = createHarness();
    await saveAccount(h);
    const seen: (boolean | undefined)[] = [];
    const deps: AppDeps = {
      ...h.deps,
      modelCatalog: {
        list: async (accountId, options) => {
          seen.push(options?.refresh);
          return accountId === ACCOUNT ? [] : [];
        },
      } satisfies ModelCatalog,
    };
    const api = createApi(deps);

    await api.query({ type: 'account.models', accountId: ACCOUNT });
    await api.query({ type: 'account.models', accountId: ACCOUNT, refresh: true });

    // The cached read passes no refresh; the explicit one tells the port to bypass.
    expect(seen).toEqual([undefined, true]);
  });

  it('returns not_found for an unknown account', async () => {
    const h = createHarness();

    expect(await createApi(h.deps).query({ type: 'account.models', accountId: ACCOUNT })).toEqual({ ok: false, code: 'not_found' });
  });

  it('returns invalid_id for an unparseable accountId', async () => {
    const h = createHarness();

    expect(await createApi(h.deps).query({ type: 'account.models', accountId: 'not-a-ulid' })).toEqual({ ok: false, code: 'invalid_id' });
  });
});

/** A discovery pass the test drives by hand: results are held back until the pass is ended. */
const createScriptedDiscovery = (
  results: readonly DiscoveredProvider[],
): { readonly discovery: ProviderDiscovery; readonly passes: () => number; readonly endPass: () => void } => {
  let passes = 0;
  let endPass: () => void = () => {};
  const discovery: ProviderDiscovery = {
    discover: (onResult) =>
      new Promise<void>((resolve) => {
        passes += 1;
        endPass = () => {
          for (const result of results) onResult(result);
          resolve();
        };
      }),
  };
  return { discovery, passes: () => passes, endPass: () => endPass() };
};

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('providers.discovered', () => {
  it('U-13: kicks one pass per query and resolves only when the pass ends', async () => {
    const h = createHarness();
    const script = createScriptedDiscovery([
      { defId: 'alpha', binPath: '/usr/local/bin/alpha', version: '1.2.3', loggedIn: true, optionalFlags: ['--fast'] },
    ]);
    const api = createApi(h.deps, undefined, script.discovery);

    const pending = api.query({ type: 'providers.discovered' });
    let settled: boolean = false;
    void pending.then(() => {
      settled = true;
    });
    await drainMicrotasks();

    // The pass is still running: no result is reported before it ends.
    expect(settled).toBe(false);
    expect(script.passes()).toBe(1);

    script.endPass();
    expect(await pending).toEqual([
      { defId: 'alpha', binPath: '/usr/local/bin/alpha', version: '1.2.3', loggedIn: true, optionalFlags: ['--fast'] },
    ]);
    // One query, one pass: answering does not kick another.
    expect(script.passes()).toBe(1);
  });

  it('U-13: per-provider failures are null fields in the rows, not query failures', async () => {
    const h = createHarness();
    const script = createScriptedDiscovery([
      { defId: 'alpha', binPath: '/usr/local/bin/alpha', version: '1.2.3', loggedIn: true, optionalFlags: [] },
      { defId: 'beta', binPath: null, version: null, loggedIn: null, optionalFlags: [] },
    ]);
    const api = createApi(h.deps, undefined, script.discovery);

    const first = api.query({ type: 'providers.discovered' });
    script.endPass();
    expect(await first).toEqual([
      { defId: 'alpha', binPath: '/usr/local/bin/alpha', version: '1.2.3', loggedIn: true, optionalFlags: [] },
      { defId: 'beta', binPath: null, version: null, loggedIn: null, optionalFlags: [] },
    ]);

    // Every query kicks a fresh pass.
    const second = api.query({ type: 'providers.discovered' });
    script.endPass();
    await second;
    expect(script.passes()).toBe(2);
  });

  it('U-13: without a discovery port the query reports not_found instead of throwing', async () => {
    const h = createHarness();

    expect(await createApi(h.deps).query({ type: 'providers.discovered' })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('providers.marks', () => {
  it('A-41: answers the composed marks source verbatim — def id → mark, null when the provider has none', async () => {
    const h = createHarness();
    const marks = {
      marks: () => ({
        'provider-a': { viewBox: '0 0 24 24', path: 'M1 1', fillRule: 'nonzero' as const },
        'provider-b': null,
      }),
    };

    const reply = await createApi(h.deps, undefined, undefined, undefined, undefined, marks).query({ type: 'providers.marks' });

    expect(reply).toEqual({
      'provider-a': { viewBox: '0 0 24 24', path: 'M1 1', fillRule: 'nonzero' },
      'provider-b': null,
    });
  });

  it('A-42: a mark travels with its fill rule — evenodd reaches the reply untouched', async () => {
    const h = createHarness();
    const marks = {
      marks: () => ({ 'provider-a': { viewBox: '0 0 24 24', path: 'M1 1h2v2z', fillRule: 'evenodd' as const } }),
    };

    const reply = await createApi(h.deps, undefined, undefined, undefined, undefined, marks).query({ type: 'providers.marks' });

    expect(reply).toEqual({ 'provider-a': { viewBox: '0 0 24 24', path: 'M1 1h2v2z', fillRule: 'evenodd' } });
  });

  it('A-41: reports not_found without a marks source instead of inventing an empty record', async () => {
    const h = createHarness();

    expect(await createApi(h.deps).query({ type: 'providers.marks' })).toEqual({ ok: false, code: 'not_found' });
  });
});

// --- repos.list ----------------------------------------------------------------------------------

/** The registry's read side as the tests drive it: rows in slug order, exactly the machine
 *  registry's reply. */
const createFakeRegistry = (
  rows: readonly { readonly slug: RepoSlug; readonly path: string }[],
): RepoRegistryPort => ({
  list: async () => rows,
});

describe('repos.list', () => {
  it('lists every repo the machine knows, read straight off the registry', async () => {
    const h = createHarness();
    const registry = createFakeRegistry([
      { slug: REPO, path: '/repos/acme' },
      { slug: BROKEN_REPO, path: '/repos/bozuk' },
    ]);

    const view = (await createApi(h.deps, undefined, undefined, registry).query({
      type: 'repos.list',
    })) as RepoListItem[];

    expect(view).toEqual([
      { id: 'acme', path: '/repos/acme' },
      { id: 'bozuk', path: '/repos/bozuk' },
    ]);
  });

  it('returns an empty list when the machine knows no repo', async () => {
    const h = createHarness();

    const view = (await createApi(h.deps, undefined, undefined, createFakeRegistry([])).query({
      type: 'repos.list',
    })) as RepoListItem[];

    expect(view).toEqual([]);
  });

  it('reports not_found without a registry port instead of throwing', async () => {
    const h = createHarness();

    expect(await createApi(h.deps).query({ type: 'repos.list' })).toEqual({ ok: false, code: 'not_found' });
  });
});

// --- run.events ----------------------------------------------------------------------------------------

const WO_FEED = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GB7');
const RUN_FEED = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H31');
const RUN_LONG = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H32');
const RUN_GHOST = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H33');

describe('run.events', () => {
  it("returns the run's stored events in arrival order, newest last", async () => {
    const h = createHarness();
    await seedWorkOrder(h, WO_FEED, BOARD_FLOW, 'Feed me', 100);
    const events: readonly AgentEvent[] = [
      { type: 'session_started', at: 200, sessionRef: 'sess-1' },
      { type: 'text', at: 300, delta: 'working' },
      { type: 'tool_call', at: 400, id: 'tool-1', name: 'read', target: 'src/a.ts' },
      { type: 'finished', at: 500, reason: 'completed' },
    ];
    await seedRun(h, activeRun(RUN_FEED, WO_FEED, PLAN, 200), events);

    const view = (await createApi(h.deps).query({ type: 'run.events', runId: RUN_FEED })) as readonly AgentEvent[];

    expect(view).toEqual(events);
  });

  it('bounds the tail: a run longer than the limit answers with only its newest events', async () => {
    const h = createHarness();
    await seedWorkOrder(h, WO_FEED, BOARD_FLOW, 'Feed me', 100);
    const total = RUN_EVENTS_TAIL_LIMIT + 20;
    const events: readonly AgentEvent[] = Array.from({ length: total }, (_, index) => ({
      type: 'text' as const,
      at: 200 + index,
      delta: `line-${index}`,
    }));
    await seedRun(h, activeRun(RUN_LONG, WO_FEED, PLAN, 200), events);

    const view = (await createApi(h.deps).query({ type: 'run.events', runId: RUN_LONG })) as readonly AgentEvent[];

    expect(view.length).toBe(RUN_EVENTS_TAIL_LIMIT);
    // The tail keeps arrival order (newest last) and drops the oldest overflow.
    expect(view[0]).toEqual({ type: 'text', at: 200 + 20, delta: 'line-20' });
    expect(view[view.length - 1]).toEqual({ type: 'text', at: 200 + total - 1, delta: `line-${total - 1}` });
  });

  it('returns not_found for a well-formed id that names no run', async () => {
    const h = createHarness();

    expect(await createApi(h.deps).query({ type: 'run.events', runId: '01ARZ3NDEKTSV4RRFFQ69G5FZZ' })).toEqual({
      ok: false,
      code: 'not_found',
    });
  });

  it('returns invalid_id for an unparseable runId', async () => {
    const h = createHarness();

    expect(await createApi(h.deps).query({ type: 'run.events', runId: 'nope' })).toEqual({
      ok: false,
      code: 'invalid_id',
    });
  });
});

// --- permissions.open ----------------------------------------------------------------------------------

const askEvent = (id: string, at: number, tool: string): Extract<AgentEvent, { readonly type: 'permission_ask' }> => ({
  type: 'permission_ask',
  at,
  id,
  tool,
  options: ['allow', 'deny'],
});

describe('permissions.open', () => {
  it("lists the board's open asks oldest first with the owning work order's title joined in", async () => {
    const h = createHarness();
    const board = createPermissionBoard();
    await seedWorkOrder(h, WO_ASK, BOARD_FLOW, 'Waiting on a permission', 4_000);
    await seedRun(h, activeRun(RUN_ASK, WO_ASK, PLAN, 4_000));
    board.register(RUN_ASK);
    void board.onAsk(RUN_ASK, askEvent('ask-1', 5_000, 'write'));
    void board.onAsk(RUN_ASK, askEvent('ask-2', 5_500, 'shell'));

    const view = (await createApi(h.deps, board).query({ type: 'permissions.open' })) as readonly OpenAskView[];

    expect(view).toEqual([
      { runId: RUN_ASK, askId: 'ask-1', since: 5_000, title: 'Waiting on a permission' },
      { runId: RUN_ASK, askId: 'ask-2', since: 5_500, title: 'Waiting on a permission' },
    ]);
  });

  it('keeps only what still waits: an answered ask and an ended run drop off the listing', async () => {
    const h = createHarness();
    const board = createPermissionBoard();
    await seedWorkOrder(h, WO_ASK, BOARD_FLOW, 'Waiting on a permission', 4_000);
    await seedRun(h, activeRun(RUN_ASK, WO_ASK, PLAN, 4_000));
    await seedRun(h, activeRun(RUN_RUNNING, WO_ASK, PLAN, 4_500));
    board.register(RUN_ASK);
    board.register(RUN_RUNNING);
    void board.onAsk(RUN_ASK, askEvent('ask-1', 5_000, 'write'));
    void board.onAsk(RUN_RUNNING, askEvent('ask-2', 5_500, 'shell'));
    const api = createApi(h.deps, board);

    expect(board.answer('ask-1', 'deny')).toEqual({ ok: true, value: RUN_ASK });
    board.unregister(RUN_RUNNING);

    const view = (await api.query({ type: 'permissions.open' })) as readonly OpenAskView[];
    expect(view).toEqual([]);
  });

  it('carries title null when the asking run resolves to no work order', async () => {
    const h = createHarness();
    const board = createPermissionBoard();
    // The board holds the run, but no run record backs it, so no title can be attributed.
    board.register(RUN_GHOST);
    void board.onAsk(RUN_GHOST, askEvent('ask-1', 5_000, 'write'));

    const view = (await createApi(h.deps, board).query({ type: 'permissions.open' })) as readonly OpenAskView[];

    expect(view).toEqual([{ runId: RUN_GHOST, askId: 'ask-1', since: 5_000, title: null }]);
  });

  it('reports not_found without a board instead of throwing', async () => {
    const h = createHarness();

    expect(await createApi(h.deps).query({ type: 'permissions.open' })).toEqual({ ok: false, code: 'not_found' });
  });
});


// --- project.tree (A-27) and the cockpit's project layer (A-28) ----------------------------------

const OTHER_REPO = slugOf<'repo'>('beta-repo');
const PROJECT_ALPHA = slugOf<'project'>('alpha');
const PROJECT_BETA = slugOf<'project'>('beta');

const WO_P_AWAIT = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5PC1');
const WO_P_BLOCKED = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5PC2');
const WO_P_DONE_NEW = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5PC3');
const WO_P_DONE_OLD = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5PC4');
const RUN_P_AWAIT = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5PC5');

const seedProjectScenario = async (h: Harness, project: (repo: RepoSlug) => string = () => 'proj'): Promise<Harness> => {
  h.definitions.seed({ kind: 'repo', repo: OTHER_REPO }, 'defs.json', DEFINITIONS_JSON);
  await h.deps.projects.save({ id: PROJECT_ALPHA, name: 'Alpha', mainRepo: REPO, repos: [REPO] });
  await h.deps.projects.save({ id: PROJECT_BETA, name: 'Beta', mainRepo: OTHER_REPO, repos: [OTHER_REPO] });
  await seedCockpitScenario(h, project);

  // Alpha waits with one order and finished two; beta is blocked.
  await seedWorkOrder(h, WO_P_AWAIT, BOARD_FLOW, 'Alpha waits', 1_000, REPO, slugOf<'project'>(project(REPO)));
  await seedEvents(h, WO_P_AWAIT, [runStarted(1_100, RUN_P_AWAIT, PLAN), runFinished(1_200, RUN_P_AWAIT, 'succeeded')]);

  await seedWorkOrder(h, WO_P_DONE_NEW, BOARD_FLOW, 'Newer finish', 200, REPO, slugOf<'project'>(project(REPO)));
  await seedEvents(h, WO_P_DONE_NEW, [
    runStarted(250, RUN_EARLY, PLAN),
    runFinished(300, RUN_EARLY, 'succeeded'),
    gatePassed(350, PLAN, PLAN_APPROVAL),
    runStarted(400, RUN_LATE, IMPLEMENT),
    runFinished(850, RUN_LATE, 'succeeded'),
    gatePassed(900, CLOSE, CLOSURE),
  ]);
  await seedWorkOrder(h, WO_P_DONE_OLD, BOARD_FLOW, 'Older finish', 100, REPO, slugOf<'project'>(project(REPO)));
  await seedEvents(h, WO_P_DONE_OLD, [
    runStarted(120, RUN_EARLY, PLAN),
    runFinished(150, RUN_EARLY, 'succeeded'),
    gatePassed(180, PLAN, PLAN_APPROVAL),
    runStarted(200, RUN_LATE, IMPLEMENT),
    runFinished(750, RUN_LATE, 'succeeded'),
    gatePassed(800, CLOSE, CLOSURE),
  ]);

  await seedWorkOrder(h, WO_P_BLOCKED, BOARD_FLOW, 'Beta blocked', 3_000, OTHER_REPO, slugOf<'project'>(project(OTHER_REPO)));
  await seedEvents(h, WO_P_BLOCKED, [{ type: 'blocked', at: 3_100, by: ACTOR, reason: 'upstream' }]);
  return h;
};

describe('project.tree', () => {
  it('A-27: one item per attached project in id asc order, repos in project.repos order, with counted states', async () => {
    const owner = (repo: RepoSlug): string => (repo === REPO ? 'alpha' : 'beta');
    const h = await seedProjectScenario(createHarness(), owner);
    const tree = (await createApi(h.deps).query({ type: 'project.tree' })) as ProjectTree;

    expect(tree.map((item) => item.project)).toEqual(['alpha', 'beta']);

    const alpha = tree[0];
    expect(alpha?.name).toBe('Alpha');
    expect(alpha?.mainRepo).toBe('acme');
    expect(alpha?.repos.map((node) => node.repo)).toEqual(['acme']);
    expect(alpha?.repos[0]?.main).toBe(true);
    // Non-done work orders count as active: the whole cockpit scenario's acme orders (8) plus
    // this scenario's await (1); the two finished ones do not. Waiting is the attention kinds
    // (ask, two awaiting_human, blocked, this scenario's await) and three runs are live.
    expect(alpha?.active).toBe(9);
    expect(alpha?.waiting).toBe(5);
    expect(alpha?.running).toBe(3);
    expect(alpha?.status).toBe('waiting');

    const beta = tree[1];
    expect(beta?.repos.map((node) => node.repo)).toEqual(['beta-repo']);
    expect(beta?.repos[0]?.main).toBe(true);
    expect(beta?.active).toBe(1);
    expect(beta?.waiting).toBe(1);
    expect(beta?.running).toBe(0);
    expect(beta?.status).toBe('waiting');
  });

  it('A-27: status precedence is waiting > running > idle per repo and per project', async () => {
    const h = createHarness();
    h.definitions.seed({ kind: 'repo', repo: OTHER_REPO }, 'defs.json', DEFINITIONS_JSON);
    await h.deps.projects.save({
      id: PROJECT_ALPHA,
      name: 'Alpha',
      mainRepo: REPO,
      repos: [REPO, OTHER_REPO],
    });

    // One repo runs, the other only waits: the project aggregates both and reports waiting.
    await seedWorkOrder(h, WO_RUNNING, BOARD_FLOW, 'Busy running', 100);
    await seedEvents(h, WO_RUNNING, [runStarted(150, RUN_RUNNING, PLAN)]);
    await seedRun(h, activeRun(RUN_RUNNING, WO_RUNNING, PLAN, 200));

    await seedWorkOrder(h, WO_AWAIT_EARLY, BOARD_FLOW, 'Waiting', 300, OTHER_REPO);
    await seedEvents(h, WO_AWAIT_EARLY, [runStarted(350, RUN_EARLY, PLAN), runFinished(400, RUN_EARLY, 'succeeded')]);

    const tree = (await createApi(h.deps).query({ type: 'project.tree' })) as ProjectTree;

    expect(tree[0]?.repos.map((node) => node.status)).toEqual(['running', 'waiting']);
    expect(tree[0]?.status).toBe('waiting');
    expect(tree[0]?.active).toBe(2);
  });
});

describe('cockpit (project layer)', () => {
  it('A-28: the project filter narrows attention, running and recentlyClosed; the cards always list every project', async () => {
    const owner = (repo: RepoSlug): string => (repo === REPO ? 'alpha' : 'beta');
    const h = await seedProjectScenario(createHarness(), owner);

    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;
    // Attention in kind order: the permission ask, the awaiting_human ones (alpha's scenario
    // ones first by since, then beta's blocked-by-event item), then the limit waiter.
    expect(view.attention.filter((item) => item.project === 'beta').map((item) => item.workOrderId)).toEqual([WO_P_BLOCKED]);
    expect(view.attention.filter((item) => item.project === 'alpha').map((item) => item.kind)).toContain('awaiting_human');

    expect(view.projects.map((card) => card.project)).toEqual(['alpha', 'beta']);
    expect(view.projects[0]).toEqual({
      project: 'alpha',
      name: 'Alpha',
      mainRepo: 'acme',
      repoCount: 1,
      active: 9,
      waiting: 5,
      // Alpha's newest status change is the explicit block at 9_900; the beta-side block at
      // 3_100 belongs to the other card.
      lastActivityAt: 9_900,
    });
    // The newest finish first (its finishing gate is its last event), and the max is five.
    expect(view.recentlyClosed.map((entry) => entry.workOrderId).slice(0, 2)).toEqual([WO_P_DONE_NEW, WO_P_DONE_OLD]);
    expect(view.recentlyClosed[0]).toEqual({
      workOrderId: WO_P_DONE_NEW,
      number: 5,
      title: 'Newer finish',
      project: 'alpha',
      repo: 'acme',
      closedAt: 900,
      outcome: 'merged',
    });
    expect(view.recentlyClosed).toHaveLength(3);

    const narrowed = (await createApi(h.deps).query({ type: 'cockpit', project: 'beta' })) as CockpitView;
    expect(narrowed.attention.map((item) => item.workOrderId)).toEqual([WO_P_BLOCKED]);
    expect(narrowed.recentlyClosed).toEqual([]);
    expect(narrowed.projects.map((card) => card.project)).toEqual(['alpha', 'beta']);
  });
});

// --- roadmap.byProject --------------------------------------------------------------------------------

const ROAD_PROJECT = slugOf<'project'>('yol');
const WO_CROSS_MAIN = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5RD1');
const WO_CROSS_OTHER = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5RD2');
const WO_DONE_FIRST = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5RD3');
const WO_DONE_SECOND = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5RD4');
const RUN_CROSS_OTHER = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5RD5');
const RUN_DONE_FIRST = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5RD6');
const RUN_DONE_SECOND = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5RD7');

/** One project, two repos, a cross-repo task and a finished one; the roadmap file ties them. */
const seedRoadmapScenario = async (): Promise<Harness> => {
  const h = createHarness();
  h.definitions.seed({ kind: 'repo', repo: OTHER_REPO }, 'defs.json', DEFINITIONS_JSON);
  await h.deps.projects.save({ id: ROAD_PROJECT, name: 'Yol', mainRepo: REPO, repos: [REPO, OTHER_REPO] });
  h.definitions.seed(
    { kind: 'project', project: ROAD_PROJECT },
    FAKE_ROADMAP_TARGET,
    JSON.stringify({
      phases: [
        {
          id: 'faz-1',
          name: 'Faz 1',
          blockedBy: [],
          tasks: [
            // Cross-repo: the beta-repo order is the OLDER one, so its number is lower — the
            // targets order must still put acme first.
            { id: 'ciftyonu', title: 'Çapraz görev', dependsOn: [], acceptance: [], targets: [REPO, OTHER_REPO] },
            { id: 'hepsi', title: 'Bitti görev', dependsOn: [], acceptance: [], targets: [REPO] },
            { id: 'bos', title: 'Bağlı işi olmayan', dependsOn: [], acceptance: [], targets: [REPO] },
          ],
        },
      ],
    }),
  );

  // The seeded orders carry `task` straight on the record (A-25 opens them this way); the
  // finished one follows the same recipe as the cockpit scenario's done order.
  const seedTaskOrder = async (id: WorkOrderId, repo: RepoSlug, title: string, createdAt: number, task: TaskSlug): Promise<void> => {
    await h.deps.workOrders.create({ id, project: ROAD_PROJECT, repo, flow: BOARD_FLOW, title, createdAt, createdBy: ACTOR, task });
    await h.deps.workOrders.appendEvent(id, { type: 'created', at: createdAt, by: ACTOR, flow: BOARD_FLOW });
  };
  const finish = async (id: WorkOrderId, run: RunId, at: number): Promise<void> => {
    for (const event of [
      runStarted(at, run, PLAN),
      runFinished(at + 50, run, 'succeeded'),
      gatePassed(at + 100, PLAN, PLAN_APPROVAL),
      runStarted(at + 150, run, IMPLEMENT),
      runFinished(at + 200, run, 'succeeded'),
      gatePassed(at + 250, CLOSE, CLOSURE),
    ]) {
      await h.deps.workOrders.appendEvent(id, event);
    }
  };

  await seedTaskOrder(WO_CROSS_MAIN, REPO, 'Çapraz görev', 100, slugOf<'task'>('ciftyonu'));
  await seedTaskOrder(WO_CROSS_OTHER, OTHER_REPO, 'Çapraz görev', 50, slugOf<'task'>('ciftyonu'));
  await finish(WO_CROSS_OTHER, RUN_CROSS_OTHER, 60);
  await seedTaskOrder(WO_DONE_FIRST, REPO, 'Bitti görev', 300, slugOf<'task'>('hepsi'));
  await finish(WO_DONE_FIRST, RUN_DONE_FIRST, 310);
  await seedTaskOrder(WO_DONE_SECOND, REPO, 'Bitti görev', 400, slugOf<'task'>('hepsi'));
  await finish(WO_DONE_SECOND, RUN_DONE_SECOND, 410);
  return h;
};

describe('roadmap.byProject', () => {
  it('R-40: a task is done only when every linked work order is done', async () => {
    const h = await seedRoadmapScenario();
    const view = (await createApi(h.deps).query({ type: 'roadmap.byProject', project: ROAD_PROJECT })) as RoadmapPageView;

    const byTask = new Set(view.phases[0]?.tasks.map((task) => [task.id, task.status] as const));
    // One of the cross task's two orders is still ready: the task runs, it is not done.
    expect(byTask).toContainEqual(['ciftyonu', 'running']);
    expect(byTask).toContainEqual(['hepsi', 'done']);
    expect(byTask).toContainEqual(['bos', 'planned']);
  });

  it('R-40: a task with no linked work order lists none', async () => {
    const h = await seedRoadmapScenario();
    const view = (await createApi(h.deps).query({ type: 'roadmap.byProject', project: ROAD_PROJECT })) as RoadmapPageView;

    const task = view.phases[0]?.tasks.find((entry) => entry.id === 'bos');
    expect(task?.workOrders).toEqual([]);
  });

  it('a cross-repo task lists its work orders per repo in the task’s targets order', async () => {
    const h = await seedRoadmapScenario();
    const view = (await createApi(h.deps).query({ type: 'roadmap.byProject', project: ROAD_PROJECT })) as RoadmapPageView;

    const cross = view.phases[0]?.tasks.find((entry) => entry.id === 'ciftyonu');
    // beta-repo holds the lower number (1), yet targets puts acme first.
    expect(cross?.workOrders.map((order) => order.repo)).toEqual([REPO, OTHER_REPO]);
    expect(cross?.workOrders.map((order) => order.id)).toEqual([WO_CROSS_MAIN, WO_CROSS_OTHER]);
  });

  it('within a repo the work orders order by number ascending, the A-29 display numbers', async () => {
    const h = await seedRoadmapScenario();
    const view = (await createApi(h.deps).query({ type: 'roadmap.byProject', project: ROAD_PROJECT })) as RoadmapPageView;

    const done = view.phases[0]?.tasks.find((entry) => entry.id === 'hepsi');
    expect(done?.workOrders.map((order) => [order.number, order.status] as const)).toEqual([
      [3, 'done'],
      [4, 'done'],
    ]);
    expect(done?.workOrders[0]).toMatchObject({ repo: REPO, id: WO_DONE_FIRST, title: 'Bitti görev' });
  });
});
