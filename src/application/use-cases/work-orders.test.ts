// use-cases/work-orders.test.ts — rules A-5, A-6, A-7 from docs/v2/application.md.
import { describe, expect, it } from 'vitest';

import type {
  Actor,
  FlowSlug,
  RepoDef,
  RoleDef,
  RunId,
  Slug,
  TaskSlug,
  Ulid,
  WorkOrderId,
  RepoSlug,
  RoleSlug,
  StageSlug,
} from '../../domain/index';
import { deriveWorkOrderState, err, nextAction, parseSlug, parseUlid } from '../../domain/index';

import type { ProjectDef, ProjectSlug } from '../../domain/index';
import type { RunRecord } from '../ports';
import type { FakeProjectRepo } from '../ports/fakes';
import type {
  FakeClock,
  FakeDefinitionStore,
  FakeEventLog,
  FakeRunRepo,
  FakeWorkOrderRepo,
} from '../ports/fakes';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeEventLog,
  createFakeIdGen,
  createFakeProjectRepo,
  createFakeRunRepo,
  createFakeWorkOrderRepo,
  repoFlowOf,
} from '../ports/fakes';

import { blockWorkOrder, closeWorkOrder, getWorkOrder, openWorkOrder, unblockWorkOrder } from './work-orders';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const REPO: RepoSlug = slugOf<'repo'>('acme');
const PROJECT: ProjectSlug = slugOf<'project'>('atolye');
const PROJECT_DEF: ProjectDef = { id: PROJECT, name: 'Atölye', repos: [REPO] };
const FLOW_A: FlowSlug = slugOf<'flow'>('flow-a');
const FLOW_FAIL: FlowSlug = slugOf<'flow'>('flow-fail');
const FLOW_DISABLED: FlowSlug = slugOf<'flow'>('flow-c');
const KNOWN_TASK: TaskSlug = slugOf<'task'>('known-task');
const RUN_1 = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const RUN_2 = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const RUN_3 = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAX');
const RUN_OTHER = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FB1');
const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAZ');

const ROLE_JSON = {
  id: 'worker',
  name: 'Worker',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const FLOWS_JSON = [
  {
    id: 'flow-a',
    name: 'Flow A',
    stages: [
      {
        id: 'plan',
        name: 'Plan',
        role: 'worker',
        exit: [{ kind: 'human', id: 'plan-approval', label: 'Plan approval' }],
      },
      { id: 'implement', name: 'Implement', role: 'worker', exit: [] },
    ],
  },
  {
    id: 'flow-b',
    name: 'Flow B',
    stages: [
      { id: 'only', name: 'Only', role: null, exit: [{ kind: 'human', id: 'closure', label: 'Closure' }] },
    ],
  },
  {
    // One stage whose single human gate fails with no attempts left: deriving `blocked`
    // without any `blocked` event.
    id: 'flow-fail',
    name: 'Flow Fail',
    stages: [
      {
        id: 'work',
        name: 'Work',
        role: 'worker',
        exit: [{ kind: 'human', id: 'sign-off', label: 'Sign-off' }],
        onFail: { goto: 'work', maxAttempts: 1 },
      },
    ],
  },
  {
    id: 'flow-c',
    name: 'Flow C',
    stages: [{ id: 'solo', name: 'Solo', role: 'worker', exit: [] }],
  },
];

// The repo owns exactly one flow (D-1): flow-a, the library copy with one binding per stage.
const REPO_JSON = {
  id: 'acme',
  name: 'Acme',
  flow: repoFlowOf(FLOWS_JSON[0] as { id: string; stages: readonly { id: string; role: string | null }[] }),
  defaultLimitPolicy: 'wait_resume',
  commandSets: { 'deploy-dev': ['true'], 'deploy-staging': ['true'], 'deploy-prod': ['true'] },
  docsRoot: 'docs',
  testGlobs: [],
};

// dev ← staging ← prod: the protected prod promotes through staging, which promotes through dev (E-5).
const ENVIRONMENTS_JSON = [
  { id: 'dev', name: 'Dev', order: 1, deploy: 'deploy-dev', env: {}, protected: false },
  { id: 'staging', name: 'Staging', order: 2, deploy: 'deploy-staging', env: {}, protected: false, promoteFrom: 'dev' },
  { id: 'prod', name: 'Prod', order: 3, deploy: 'deploy-prod', env: {}, protected: true, promoteFrom: 'staging' },
];

const definitionsJson = (
  variants: {
    readonly withRepo?: boolean;
    readonly withEnvironments?: boolean;
    readonly flows?: readonly string[];
    /** The FLOWS_JSON index the repo owns (default 0: flow-a). */
    readonly ownFlow?: number;
  } = {},
): string =>
  JSON.stringify({
    roles: [ROLE_JSON],
    flows: FLOWS_JSON.filter((flow) => (variants.flows ?? FLOWS_JSON.map((candidate) => candidate.id)).includes(flow.id)),
    capabilities: [],
    ...(variants.withRepo === false
      ? {}
      : {
          repo: {
            ...REPO_JSON,
            ...(variants.ownFlow === undefined ? {} : { flow: repoFlowOf(FLOWS_JSON[variants.ownFlow]) }),
            ...(variants.withEnvironments ? { environments: ENVIRONMENTS_JSON } : {}),
          },
        }),
  });

/** Unparseable content, so `load` reports issues no matter what else the scope holds. */
const BROKEN_DEFS = '{not json';

const ROADMAP_JSON = JSON.stringify({
  phases: [
    {
      id: 'phase-1',
      name: 'Phase 1',
      blockedBy: [],
      tasks: [{ id: 'known-task', title: 'Known task', dependsOn: [], acceptance: [] }],
    },
  ],
});

interface Harness {
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly workOrders: FakeWorkOrderRepo;
  readonly runs: FakeRunRepo;
  readonly definitions: FakeDefinitionStore;
  readonly projects: FakeProjectRepo;
  readonly openDeps: Parameters<typeof openWorkOrder>[0];
  readonly viewDeps: Parameters<typeof getWorkOrder>[0];
  readonly blockDeps: Parameters<typeof blockWorkOrder>[0];
  readonly unblockDeps: Parameters<typeof unblockWorkOrder>[0];
}

const createHarness = (configure?: (definitions: FakeDefinitionStore) => void, withRoadmap = true): Harness => {
  const clock = createFakeClock(1_000);
  const ids = createFakeIdGen('work-orders-test');
  const log = createFakeEventLog();
  const workOrders = createFakeWorkOrderRepo();
  const runs = createFakeRunRepo();
  const definitions = createFakeDefinitionStore();
  const projects = createFakeProjectRepo();
  definitions.setProject(PROJECT_DEF);
  void projects.save(PROJECT_DEF);
  definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', definitionsJson());
  if (withRoadmap) definitions.seed({ kind: 'project', project: PROJECT }, 'roadmap.json', ROADMAP_JSON);
  configure?.(definitions);

  return {
    clock,
    log,
    workOrders,
    runs,
    definitions,
    projects,
    openDeps: { clock, ids, log, workOrders, definitions, projects },
    viewDeps: { workOrders, runs, definitions },
    blockDeps: { clock, ids, log, workOrders },
    unblockDeps: { clock, ids, log, workOrders, definitions },
  };
};

const openedWorkOrder = async (
  h: Harness,
  overrides: { readonly flow?: FlowSlug; readonly task?: TaskSlug; readonly title?: string } = {},
): Promise<WorkOrderId> => {
  const result = await openWorkOrder(h.openDeps, {
    project: PROJECT,
    repo: REPO,
    title: overrides.title ?? 'Fix the login flow',
    flow: overrides.flow,
    task: overrides.task,
    actor: ACTOR,
  });
  if (!result.ok) throw new Error('fixture open must succeed');
  return result.value;
};

const runRecord = (id: RunId, workOrderId: WorkOrderId, startedAt: number): RunRecord => ({
  id,
  workOrderId,
  stage: slugOf<'stage'>('plan'),
  attempt: 1,
  role: slugOf<'role'>('worker'),
  route: { accountId: ACCOUNT },
  startedAt,
  autoResumesUsed: 0,
});

/** Drives a flow-fail work order into the blocked state via a failed gate (no `blocked` event). */
const driveToGateBlock = async (h: Harness, id: WorkOrderId): Promise<void> => {
  const stage = slugOf<'stage'>('work');
  await h.workOrders.appendEvent(id, { type: 'run_started', at: 1_100, runId: RUN_1, stage, attempt: 1 });
  await h.workOrders.appendEvent(id, { type: 'run_finished', at: 1_200, runId: RUN_1, outcome: 'succeeded' });
  await h.workOrders.appendEvent(id, {
    type: 'gate_evaluated',
    at: 1_300,
    stage,
    gate: slugOf<'gate'>('sign-off'),
    verdict: { status: 'failed', reason: 'rejected' },
  });
};

describe('openWorkOrder', () => {
  it('A-5: a blank or whitespace-only title returns empty_title and writes nothing', async () => {
    const h = createHarness();

    for (const title of ['', '   ', ' \t ']) {
      const result = await openWorkOrder(h.openDeps, { project: PROJECT, repo: REPO, title, actor: ACTOR });
      expect(result).toEqual(err('empty_title'));
    }

    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-5: an unknown project returns unknown_project and writes nothing', async () => {
    const h = createHarness();
    const missing = slugOf<'project'>('no-such-project');

    const result = await openWorkOrder(h.openDeps, {
      project: missing,
      repo: REPO,
      title: 'Fix the login flow',
      actor: ACTOR,
    });

    expect(result).toEqual(err('unknown_project'));
    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-5: a repo the project does not list returns unknown_repo and writes nothing', async () => {
    const h = createHarness();
    const outsider = slugOf<'repo'>('not-in-project');

    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: outsider,
      title: 'Fix the login flow',
      actor: ACTOR,
    });

    expect(result).toEqual(err('unknown_repo'));
    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-5: the title is stored trimmed', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h, { title: '  Fix the login  ' });

    const record = await h.workOrders.get(id);
    expect(record?.title).toBe('Fix the login');
  });

  it('A-5: the flow defaults to the repo’s own flow (repo.flow.flowId)', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);

    const record = await h.workOrders.get(id);
    expect(record?.flow).toBe(FLOW_A);
    const events = await h.workOrders.events(id);
    expect(events).toEqual([{ type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A }]);
  });

  it('A-5: an explicitly given flow must name the repo’s own flow', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h, { flow: FLOW_A });

    const record = await h.workOrders.get(id);
    expect(record?.flow).toBe(FLOW_A);
  });

  it('A-5: an unknown flow returns unknown_flow and writes nothing', async () => {
    const h = createHarness();
    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix the login flow',
      flow: slugOf<'flow'>('no-such-flow'),
      actor: ACTOR,
    });

    expect(result).toEqual(err('unknown_flow'));
    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-5: a library flow the repo does not own returns flow_not_enabled and writes nothing', async () => {
    const h = createHarness();
    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix the login flow',
      flow: FLOW_DISABLED,
      actor: ACTOR,
    });

    expect(result).toEqual(err('flow_not_enabled'));
    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-5: definitions that do not validate return definitions_invalid and write nothing', async () => {
    const h = createHarness((definitions) => {
      definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', BROKEN_DEFS);
    });
    const result = await openWorkOrder(h.openDeps, { project: PROJECT, repo: REPO, title: 'Fix the login flow', actor: ACTOR });

    expect(result).toEqual(err('definitions_invalid'));
    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-5: definitions without a repo section return definitions_invalid', async () => {
    const h = createHarness((definitions) => {
      definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', definitionsJson({ withRepo: false }));
    });
    const result = await openWorkOrder(h.openDeps, { project: PROJECT, repo: REPO, title: 'Fix the login flow', actor: ACTOR });

    expect(result).toEqual(err('definitions_invalid'));
    expect(await h.workOrders.list({})).toEqual([]);
  });

  it('A-5: a task missing from the repo roadmap returns unknown_task and writes nothing', async () => {
    const h = createHarness();
    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix the login flow',
      task: slugOf<'task'>('no-such-task'),
      actor: ACTOR,
    });

    expect(result).toEqual(err('unknown_task'));
    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-5: a task given with no roadmap at all returns unknown_task', async () => {
    const h = createHarness(undefined, false);
    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix the login flow',
      task: KNOWN_TASK,
      actor: ACTOR,
    });

    expect(result).toEqual(err('unknown_task'));
    expect(await h.workOrders.list({})).toEqual([]);
  });

  it('A-5: a roadmap task is stored on the record', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h, { task: KNOWN_TASK });

    const record = await h.workOrders.get(id);
    expect(record?.task).toBe(KNOWN_TASK);
  });

  it('A-5: success creates the record, appends one created event and audits work_order.opened', async () => {
    const h = createHarness();
    const result = await openWorkOrder(h.openDeps, { project: PROJECT, repo: REPO, title: 'Fix the login flow', task: KNOWN_TASK, actor: ACTOR });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseUlid(result.value).ok).toBe(true);

    const record = await h.workOrders.get(result.value);
    expect(record).toEqual({
      id: result.value,
      project: PROJECT,
      repo: REPO,
      flow: FLOW_A,
      title: 'Fix the login flow',
      task: KNOWN_TASK,
      createdAt: 1_000,
      createdBy: ACTOR,
      // A-324: every opening pins the repo's flow — one entry per stage, the effective role
      // bodies (version 1, no overlay) and the default limit policy.
      pin: {
        flowId: FLOW_A,
        flowVersion: 1,
        stages: [
          {
            stage: FLOWS_JSON[0].stages[0],
            role: ROLE_JSON,
            roleVersion: 1,
            accounts: [],
            limitPolicy: 'wait_resume',
          },
          {
            stage: FLOWS_JSON[0].stages[1],
            role: ROLE_JSON,
            roleVersion: 1,
            accounts: [],
            limitPolicy: 'wait_resume',
          },
        ],
      },
    });

    expect(await h.workOrders.events(result.value)).toEqual([{ type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A }]);
    expect(h.log.entries()).toEqual([
      {
        id: expect.anything(),
        at: 1_000,
        actor: ACTOR,
        action: 'work_order.opened',
        subject: { kind: 'work_order', id: result.value },
      },
    ]);
  });

  it('A-318: a description is stored trimmed and redacted, a blank one is omitted, and an over-long one writes nothing', async () => {
    const h = createHarness();
    const token = `sk-${'k'.repeat(32)}`;

    const opened = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix the login flow',
      description: `  session drops after ${token}  `,
      actor: ACTOR,
    });
    if (!opened.ok) throw new Error('open must succeed');
    const stored = await h.workOrders.get(opened.value);
    expect(stored?.description).toBe('session drops after [redacted]');
    expect(stored?.description).not.toContain(token);

    const view = await getWorkOrder(h.viewDeps, opened.value);
    if (!view.ok) throw new Error('detail must succeed');
    expect(view.value.record.description).toBe('session drops after [redacted]');

    for (const description of ['', '   ', ' \n\t ']) {
      const blank = await openWorkOrder(h.openDeps, {
        project: PROJECT,
        repo: REPO,
        title: 'Fix the login flow',
        description,
        actor: ACTOR,
      });
      if (!blank.ok) throw new Error('a blank description must still open');
      expect(await h.workOrders.get(blank.value)).not.toHaveProperty('description');
    }

    const tooLong = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix the login flow',
      description: 'y'.repeat(4_001),
      actor: ACTOR,
    });
    expect(tooLong).toEqual(err('description_too_long'));
    expect(await h.workOrders.list({})).toHaveLength(4);
    expect(h.log.entries()).toHaveLength(4);
  });
});

describe('getWorkOrder', () => {
  it('A-6: an unknown id returns not_found', async () => {
    const h = createHarness();
    const result = await getWorkOrder(h.viewDeps, ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB0'));

    expect(result).toEqual(err('not_found'));
  });

  it('A-6: definitions that do not validate return definitions_invalid', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', BROKEN_DEFS);

    const result = await getWorkOrder(h.viewDeps, id);
    expect(result).toEqual(err('definitions_invalid'));
  });

  it('A-6: a stored flow missing from the current definitions returns unknown_flow', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    // The repo now owns flow-b and the library no longer carries flow-a: the stored flow is
    // gone from every source the load answers.
    h.definitions.seed(
      { kind: 'repo', repo: REPO },
      'defs.json',
      JSON.stringify({
        roles: [ROLE_JSON],
        flows: FLOWS_JSON.filter((flow) => flow.id !== 'flow-a'),
        capabilities: [],
        repo: { ...REPO_JSON, flow: repoFlowOf(FLOWS_JSON[1]) },
      }),
    );

    const result = await getWorkOrder(h.viewDeps, id);
    expect(result).toEqual(err('unknown_flow'));
  });

  it('A-6: the view carries the work order own flow definition and the repo environments', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    h.definitions.seed(
      { kind: 'repo', repo: REPO },
      'defs.json',
      definitionsJson({ withEnvironments: true }),
    );

    const result = await getWorkOrder(h.viewDeps, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The flow is the whole definition the current definitions hold, gates included.
    expect(result.value.flow).toEqual(FLOWS_JSON[0]);
    // The environments keep their protection and promotion chain verbatim (E-5).
    expect(result.value.environments).toEqual(ENVIRONMENTS_JSON);
  });

  it('A-6: definitions without a repo section yield an empty environment list, flow intact', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', definitionsJson({ withRepo: false }));

    const result = await getWorkOrder(h.viewDeps, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.flow.id).toBe(FLOW_A);
    expect(result.value.environments).toEqual([]);
  });

  it('A-6: state and next equal the domain derivation over the stored events and the current definitions', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    await h.workOrders.appendEvent(id, { type: 'blocked', at: 1_200, by: ACTOR, reason: 'waiting on upstream' });

    const result = await getWorkOrder(h.viewDeps, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const loaded = await h.definitions.load(REPO);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const flow = loaded.value.flows.find((candidate) => candidate.id === FLOW_A);
    expect(flow).toBeDefined();
    if (flow === undefined) return;

    const expectedState = deriveWorkOrderState(flow, await h.workOrders.events(id));
    expect(result.value.state).toEqual(expectedState);
    expect(result.value.state.status).toBe('blocked');
    expect(result.value.state.blockedReason).toBe('waiting on upstream');
    expect(result.value.next).toEqual(nextAction(flow, expectedState));
    expect(result.value.record.id).toBe(id);
  });

/** flow-a with one extra human gate on its first stage — the "current definitions" the A-6
 *  derivation test reseeds after the work order was opened. */
const redefinedFlows = () => [
  {
    id: 'flow-a',
    name: 'Flow A',
    stages: [
      {
        id: 'plan',
        name: 'Plan',
        role: 'worker',
        exit: [
          { kind: 'human', id: 'plan-approval', label: 'Plan approval' },
          { kind: 'human', id: 'plan-extra', label: 'Extra approval' },
        ],
      },
      { id: 'implement', name: 'Implement', role: 'worker', exit: [] },
    ],
  },
];

  it('A-6: derivation follows the current definitions, not those at open time', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    h.definitions.seed(
      { kind: 'repo', repo: REPO },
      'defs.json',
      JSON.stringify({
        roles: [ROLE_JSON],
        flows: redefinedFlows(),
        capabilities: [],
        repo: { ...REPO_JSON, flow: repoFlowOf(redefinedFlows()[0]) },
      }),
    );

    const result = await getWorkOrder(h.viewDeps, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.state.stage).toBe(slugOf<'stage'>('plan'));
    expect(result.value.state.pendingGates).toEqual([slugOf<'gate'>('plan-approval'), slugOf<'gate'>('plan-extra')]);
  });

  it('A-6: nothing derived is stored', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    const recordBefore = await h.workOrders.get(id);

    const result = await getWorkOrder(h.viewDeps, id);
    expect(result.ok).toBe(true);

    expect(await h.workOrders.events(id)).toEqual([{ type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A }]);
    expect(await h.workOrders.get(id)).toEqual(recordBefore);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['work_order.opened']);
  });

  it('A-6: runs are the work order’s runs ordered by startedAt', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    const other = await openedWorkOrder(h, { title: 'Other' });
    await h.runs.create(runRecord(RUN_3, id, 30));
    await h.runs.create(runRecord(RUN_1, id, 10));
    await h.runs.create(runRecord(RUN_OTHER, other, 999));
    await h.runs.create(runRecord(RUN_2, id, 20));

    const result = await getWorkOrder(h.viewDeps, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.runs.map((run) => run.startedAt)).toEqual([10, 20, 30]);
    expect(result.value.runs.every((run) => run.workOrderId === id)).toBe(true);
  });
});

describe('blockWorkOrder', () => {
  it('A-7: blocking appends one blocked event and one audit entry', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);

    const result = await blockWorkOrder(h.blockDeps, { id, reason: 'waiting on upstream', actor: ACTOR });
    expect(result).toEqual({ ok: true, value: undefined });

    expect(await h.workOrders.events(id)).toEqual([
      { type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A },
      { type: 'blocked', at: 1_000, by: ACTOR, reason: 'waiting on upstream' },
    ]);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['work_order.opened', 'work_order.blocked']);
    expect(h.log.entries()[1]).toEqual({
      id: expect.anything(),
      at: 1_000,
      actor: ACTOR,
      action: 'work_order.blocked',
      subject: { kind: 'work_order', id },
    });

    const view = await getWorkOrder(h.viewDeps, id);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.state.status).toBe('blocked');
    expect(view.value.state.blockedReason).toBe('waiting on upstream');
  });

  it('A-7: blocking an unknown work order returns not_found', async () => {
    const h = createHarness();
    const result = await blockWorkOrder(h.blockDeps, {
      id: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB0'),
      reason: 'why',
      actor: ACTOR,
    });

    expect(result).toEqual(err('not_found'));
    expect(h.log.entries()).toEqual([]);
  });

  it('A-7: blocking a closed work order returns already_done and writes nothing', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    await h.workOrders.appendEvent(id, { type: 'closed', at: 1_100, by: ACTOR });

    const result = await blockWorkOrder(h.blockDeps, { id, reason: 'late block', actor: ACTOR });
    expect(result).toEqual(err('already_done'));

    expect(await h.workOrders.events(id)).toEqual([
      { type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A },
      { type: 'closed', at: 1_100, by: ACTOR },
    ]);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['work_order.opened']);
  });
});

describe('unblockWorkOrder', () => {
  it('A-7: unblocking a blocked work order appends one unblocked event and one audit entry', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    await blockWorkOrder(h.blockDeps, { id, reason: 'waiting on upstream', actor: ACTOR });

    const result = await unblockWorkOrder(h.unblockDeps, { id, actor: ACTOR });
    expect(result).toEqual({ ok: true, value: undefined });

    expect(await h.workOrders.events(id)).toEqual([
      { type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A },
      { type: 'blocked', at: 1_000, by: ACTOR, reason: 'waiting on upstream' },
      { type: 'unblocked', at: 1_000, by: ACTOR },
    ]);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['work_order.opened', 'work_order.blocked', 'work_order.unblocked']);
    expect(h.log.entries()[2]?.subject).toEqual({ kind: 'work_order', id });

    const view = await getWorkOrder(h.viewDeps, id);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.state.status).toBe('ready');
  });

  it('A-7: unblocking a work order that is not blocked returns not_blocked and writes nothing', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);

    const result = await unblockWorkOrder(h.unblockDeps, { id, actor: ACTOR });
    expect(result).toEqual(err('not_blocked'));

    expect(await h.workOrders.events(id)).toEqual([{ type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A }]);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['work_order.opened']);
  });

  it('A-7: a work order blocked by a failed gate (no blocked event) can be unblocked', async () => {
    const h = createHarness((definitions) => {
      definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', definitionsJson({ ownFlow: 2 }));
    });
    const id = await openedWorkOrder(h, { flow: FLOW_FAIL });
    await driveToGateBlock(h, id);

    const before = await getWorkOrder(h.viewDeps, id);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.state.status).toBe('blocked');

    const result = await unblockWorkOrder(h.unblockDeps, { id, actor: ACTOR });
    expect(result).toEqual({ ok: true, value: undefined });

    const after = await getWorkOrder(h.viewDeps, id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.state.status).toBe('awaiting_human');
    expect(after.value.state.pendingGates).toEqual([slugOf<'gate'>('sign-off')]);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['work_order.opened', 'work_order.unblocked']);
  });

  it('A-7: unblocking an unknown work order returns not_found', async () => {
    const h = createHarness();
    const result = await unblockWorkOrder(h.unblockDeps, { id: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB0'), actor: ACTOR });

    expect(result).toEqual(err('not_found'));
    expect(h.log.entries()).toEqual([]);
  });

  it('A-7: a state that cannot be derived writes nothing', async () => {
    // The control picks carry no error code for broken definitions; the `blocked` precondition
    // simply cannot be established, so unblock refuses to write.
    const h = createHarness();
    const id = await openedWorkOrder(h);
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', BROKEN_DEFS);

    const result = await unblockWorkOrder(h.unblockDeps, { id, actor: ACTOR });
    expect(result).toEqual(err('not_blocked'));

    expect(await h.workOrders.events(id)).toEqual([{ type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A }]);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['work_order.opened']);
  });
});

describe('closeWorkOrder', () => {
  it('A-7: closing appends one closed event and one audit entry', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);

    const result = await closeWorkOrder(h.blockDeps, { id, actor: ACTOR });
    expect(result).toEqual({ ok: true, value: undefined });

    expect(await h.workOrders.events(id)).toEqual([
      { type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A },
      { type: 'closed', at: 1_000, by: ACTOR },
    ]);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['work_order.opened', 'work_order.closed']);
    expect(h.log.entries()[1]).toEqual({
      id: expect.anything(),
      at: 1_000,
      actor: ACTOR,
      action: 'work_order.closed',
      subject: { kind: 'work_order', id },
    });

    const view = await getWorkOrder(h.viewDeps, id);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.state.status).toBe('done');
    expect(view.value.state.stage).toBe(null);
  });

  it('A-7: closing a done work order returns already_done and writes nothing', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);

    const first = await closeWorkOrder(h.blockDeps, { id, actor: ACTOR });
    expect(first).toEqual({ ok: true, value: undefined });

    const second = await closeWorkOrder(h.blockDeps, { id, actor: ACTOR });
    expect(second).toEqual(err('already_done'));

    expect(await h.workOrders.events(id)).toEqual([
      { type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A },
      { type: 'closed', at: 1_000, by: ACTOR },
    ]);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['work_order.opened', 'work_order.closed']);
  });

  it('A-7: closing a blocked work order still closes it', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    await blockWorkOrder(h.blockDeps, { id, reason: 'waiting on upstream', actor: ACTOR });

    const result = await closeWorkOrder(h.blockDeps, { id, actor: ACTOR });
    expect(result).toEqual({ ok: true, value: undefined });

    const view = await getWorkOrder(h.viewDeps, id);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.state.status).toBe('done');
  });

  it('A-7: closing an unknown work order returns not_found', async () => {
    const h = createHarness();
    const result = await closeWorkOrder(h.blockDeps, { id: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB0'), actor: ACTOR });

    expect(result).toEqual(err('not_found'));
    expect(h.log.entries()).toEqual([]);
  });
});

// --- Phase 7: the work-order pin (A-324, A-325, A-344) ---------------------------------------------

const WORKER: RoleSlug = slugOf<'role'>('worker');
const PIN_STAGE: StageSlug = slugOf<'stage'>('implement');
const PIN_ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB3');

const WORKER_V1: RoleDef = {
  id: WORKER,
  name: 'Worker',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};
const WORKER_V2: RoleDef = { ...WORKER_V1, instructions: 'Do the work, carefully.' };

/** A repo-owned flow binding the worker role at the given library version. */
const pinnedRepoDef = (version: number, flowVersion = 4): RepoDef => ({
  id: REPO,
  name: 'Acme',
  commandSets: {},
  docsRoot: 'docs',
  testGlobs: [],
  defaultLimitPolicy: 'fallback_account',
  flow: {
    flowId: FLOW_A,
    version: flowVersion,
    stages: [{ id: PIN_STAGE, name: 'Implement', role: WORKER, exit: [] }],
    bindings: [
      {
        stage: PIN_STAGE,
        role: { roleId: WORKER, version, overlay: { instructions: 'Local instructions.' } },
        accounts: [{ accountId: PIN_ACCOUNT }],
        limitPolicy: 'ask',
      },
    ],
  },
});

describe('openWorkOrder (Phase 7 pin)', () => {
  it('A-324: stores the FlowPin (via pinFlow) on the work order record at creation', async () => {
    const h = createHarness();
    await h.definitions.appendVersion('roles', 'worker', WORKER_V1, 900);
    await h.definitions.appendVersion('roles', 'worker', WORKER_V2, 950);
    h.definitions.setRepoDef(REPO, pinnedRepoDef(2));

    const id = await openedWorkOrder(h);

    const record = await h.workOrders.get(id);
    expect(record?.pin).toEqual({
      flowId: FLOW_A,
      flowVersion: 4,
      stages: [
        {
          stage: { id: PIN_STAGE, name: 'Implement', role: WORKER, exit: [] },
          // The effective role body: v2 with the repo overlay's instructions, copied.
          role: { ...WORKER_V2, instructions: 'Local instructions.' },
          roleVersion: 2,
          accounts: [{ accountId: PIN_ACCOUNT }],
          limitPolicy: 'ask',
        },
      ],
    });
  });

  it('A-344: a pinFlow failure maps to definitions_invalid and writes nothing — no record, no event', async () => {
    const h = createHarness();
    await h.definitions.appendVersion('roles', 'worker', WORKER_V1, 900);
    // The binding names version 7, which the library does not carry.
    h.definitions.setRepoDef(REPO, pinnedRepoDef(7));

    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix the login flow',
      actor: ACTOR,
    });

    expect(result).toEqual(err('definitions_invalid'));
    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-325: later library edits and repo flow changes never rewrite the stored pin', async () => {
    const h = createHarness();
    await h.definitions.appendVersion('roles', 'worker', WORKER_V1, 900);
    await h.definitions.appendVersion('roles', 'worker', WORKER_V2, 950);
    h.definitions.setRepoDef(REPO, pinnedRepoDef(2));

    const id = await openedWorkOrder(h);
    const pinned = (await h.workOrders.get(id))?.pin;
    expect(pinned).toBeDefined();
    const snapshot = JSON.parse(JSON.stringify(pinned));

    // A later library edit: v3 lands. A later repo change: the flow moves on to version 5.
    await h.definitions.appendVersion('roles', 'worker', { ...WORKER_V2, name: 'Engineer' }, 1_400);
    h.definitions.setRepoDef(REPO, pinnedRepoDef(3, 5));

    // Reads serve the stored pin, never a re-derivation from the live repo flow.
    expect((await h.workOrders.get(id))?.pin).toEqual(snapshot);
    const view = await getWorkOrder(h.viewDeps, id);
    expect(view.ok && view.value.record.pin).toEqual(snapshot);

    // A work order opened after the change pins the new flow; the old one keeps its own.
    const later = await openedWorkOrder(h);
    const laterPin = (await h.workOrders.get(later))?.pin;
    expect(laterPin?.flowVersion).toBe(5);
    expect(laterPin?.stages[0].roleVersion).toBe(3);
    expect((await h.workOrders.get(id))?.pin).toEqual(snapshot);
  });

  it('A-325: a run of the pinned stage records the pin’s flow and role versions', async () => {
    const h = createHarness();
    await h.definitions.appendVersion('roles', 'worker', WORKER_V1, 900);
    await h.definitions.appendVersion('roles', 'worker', WORKER_V2, 950);
    h.definitions.setRepoDef(REPO, pinnedRepoDef(2));

    const id = await openedWorkOrder(h);
    const pin = (await h.workOrders.get(id))?.pin;
    expect(pin).toBeDefined();

    // What a stage run/resume/retry reads: the versions of the stored pin, not the live flow.
    const run = { ...runRecord(RUN_1, id, 1_000), stage: PIN_STAGE, flowVersion: pin?.flowVersion, roleVersion: pin?.stages[0].roleVersion ?? undefined };
    await h.runs.create(run);
    expect(await h.runs.get(RUN_1)).toEqual(run);
  });
});
