// use-cases/work-orders.test.ts — rules A-5, A-6, A-7 from docs/v2/application.md.
import { describe, expect, it } from 'vitest';

import type {
  Actor,
  AutonomyLevel,
  DefinitionIssue,
  Definitions,
  FlowPin,
  FlowSlug,
  RepoDef,
  Result,
  RoleDef,
  RunId,
  Slug,
  TaskSlug,
  Ulid,
  WorkOrderId,
  RepoSlug,
  RoleSlug,
  StageSlug,
  WorkOrderEvent,
} from '../../domain/index';
import { deriveWorkOrderState, err, nextAction, parseSlug, parseUlid, workOrderBranch } from '../../domain/index';

import type { ProjectDef, ProjectSlug } from '../../domain/index';
import type { AppDeps, ReadRepoFingerprint, RepoFingerprint, RepoRegistryEntry, RunRecord, WorkOrderRecord } from '../ports';
import type { FakeAppSettingsRepo, FakeProjectRepo, FakeRepoRegistry } from '../ports/fakes';
import type {
  FakeClock,
  FakeDefinitionStore,
  FakeEventLog,
  FakeRunRepo,
  FakeWorkOrderRepo,
} from '../ports/fakes';
import {
  createFakeAccountRepo,
  createFakeAppSettingsRepo,
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeDefinitionStore,
  createFakeEventLog,
  createFakeIdGen,
  createFakeModelCatalog,
  createFakeProjectRepo,
  createFakeRepoRegistry,
  createFakeRunRepo,
  createFakeWorkOrderRepo,
  repoFlowOf,
} from '../ports/fakes';

import { AUTONOMY_KEY, AUTONOMY_MAX_KEY } from './settings';
import {
  blockWorkOrder,
  closeWorkOrder,
  effectiveAutonomy,
  getWorkOrder,
  openWorkOrder,
  unblockWorkOrder,
  workOrderRunSummaries,
  workOrderStageSkipDecisionRows,
  type OpenError,
} from './work-orders';

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
  readonly repos: FakeRepoRegistry;
  /** The settings store the global autonomy layer reads (A-396). */
  readonly settings: FakeAppSettingsRepo;
  /** The folder fingerprints the harness's reader answers; a path absent from the map reads
   *  undefined — the folder_not_found standing. */
  readonly fingerprints: Map<string, RepoFingerprint>;
  readonly openDeps: Parameters<typeof openWorkOrder>[0];
  readonly viewDeps: Parameters<typeof getWorkOrder>[0];
  readonly blockDeps: Parameters<typeof blockWorkOrder>[0];
  readonly unblockDeps: Parameters<typeof unblockWorkOrder>[0];
  readonly autonomyDeps: Parameters<typeof effectiveAutonomy>[0];
}

const createHarness = (configure?: (definitions: FakeDefinitionStore) => void, withRoadmap = true): Harness => {
  const clock = createFakeClock(1_000);
  const ids = createFakeIdGen('work-orders-test');
  const log = createFakeEventLog();
  const workOrders = createFakeWorkOrderRepo();
  const runs = createFakeRunRepo();
  const definitions = createFakeDefinitionStore();
  const projects = createFakeProjectRepo();
  const settings = createFakeAppSettingsRepo();
  const fingerprints = new Map<string, RepoFingerprint>();
  const readFingerprint: ReadRepoFingerprint = async (path) => fingerprints.get(path);
  const repos = createFakeRepoRegistry(readFingerprint);
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
    repos,
    settings,
    fingerprints,
    openDeps: { clock, ids, log, workOrders, definitions, projects, settings },
    viewDeps: { workOrders, runs, definitions, projects, repos, readFingerprint, settings },
    blockDeps: { clock, ids, log, workOrders },
    unblockDeps: { clock, ids, log, workOrders, definitions },
    autonomyDeps: { workOrders, definitions, settings },
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

  it('A-407: the detail carries the effective level with its source, the layer standing and the auto refusal', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);

    // Nothing set anywhere: builtin manual, no layer, and `auto` would refuse — flow-a's stages
    // carry no onFail and no cap governs the order.
    let view = await getWorkOrder(h.viewDeps, id);
    expect(view.ok && view.value.autonomy).toEqual({
      level: 'manual',
      source: 'builtin',
      layerSet: false,
      autoUnavailable: 'auto_requires_spend_cap',
    });

    seedRepoAutonomy(h, 'auto', BUDGET);
    view = await getWorkOrder(h.viewDeps, id);
    expect(view.ok && view.value.autonomy).toEqual({
      level: 'manual',
      source: 'repo',
      layerSet: false,
      autoUnavailable: 'auto_requires_max_attempts',
    });

    // The record's own layer outranks the repo's and flips the standing.
    const record = await h.workOrders.get(id);
    if (record === undefined) throw new Error('fixture record must exist');
    await h.workOrders.setAutonomy(id, 'manual');
    view = await getWorkOrder(h.viewDeps, id);
    expect(view.ok && view.value.autonomy).toEqual({
      level: 'manual',
      source: 'workOrder',
      layerSet: true,
      autoUnavailable: 'auto_requires_max_attempts',
    });
    await h.workOrders.setAutonomy(id, undefined);
  });

  it('A-407: a damaged stored level keeps the autonomy block absent — never a wrong level on the detail', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    await h.settings.set(AUTONOMY_KEY, 'turbo');

    const view = await getWorkOrder(h.viewDeps, id);
    expect(view.ok && view.value.autonomy).toBeUndefined();
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

  it('A-390: a work order without git events carries an empty git lifecycle — nothing invented', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);

    const result = await getWorkOrder(h.viewDeps, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.git).toEqual({});
  });

  it('A-390: git follows branch_pushed / pr_opened / pr_merged / branch_released event sequences', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    const branch = workOrderBranch(id);

    await h.workOrders.appendEvent(id, { type: 'branch_pushed', at: 1_100, branch, head: 'a1' });
    const pushed = await getWorkOrder(h.viewDeps, id);
    expect(pushed.ok).toBe(true);
    if (!pushed.ok) return;
    expect(pushed.value.git).toEqual({ branch: { name: branch, head: 'a1', pushedAt: 1_100 } });

    await h.workOrders.appendEvent(id, {
      type: 'pr_opened', at: 1_200, number: 3, url: 'https://forge.fake/acme/pull/3', head: branch, base: 'main',
    });
    const opened = await getWorkOrder(h.viewDeps, id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.git.pr).toEqual({ number: 3, url: 'https://forge.fake/acme/pull/3', head: branch, base: 'main', merged: false });

    await h.workOrders.appendEvent(id, { type: 'pr_merged', at: 1_300, number: 3 });
    const merged = await getWorkOrder(h.viewDeps, id);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.value.git.pr?.merged).toBe(true);
    expect(merged.value.git.released).toBeUndefined();

    await h.workOrders.appendEvent(id, { type: 'branch_released', at: 1_400 });
    const released = await getWorkOrder(h.viewDeps, id);
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.value.git.released).toBe(true);
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

  it('A-379: the detail read starts no poll and writes no event — the rows are a read of what the dispatcher recorded', async () => {
    const h = createHarness();
    const ciFlow = {
      id: 'ci-flow',
      name: 'CI',
      stages: [
        { id: 'verify', name: 'Verify', role: null, exit: [{ kind: 'remote_checks', id: 'ci', required: 'all', timeoutMinutes: 10 }] },
      ],
    };
    h.definitions.seed(
      { kind: 'repo', repo: REPO },
      'defs.json',
      JSON.stringify({ roles: [ROLE_JSON], flows: [ciFlow], capabilities: [], repo: { ...REPO_JSON, flow: repoFlowOf(ciFlow) } }),
    );
    const opened = await openWorkOrder(h.openDeps, { project: PROJECT, repo: REPO, title: 'CI rows', actor: ACTOR });
    if (!opened.ok) throw new Error('open must succeed');
    // The dispatcher's own poll already recorded one evaluation with its evidence.
    await h.workOrders.appendEvent(opened.value, {
      type: 'gate_evaluated',
      at: 1_050,
      stage: slugOf<'stage'>('verify'),
      gate: slugOf<'gate'>('ci'),
      verdict: { status: 'passed' },
      remoteChecks: { checks: [{ name: 'lint', status: 'passed' }] },
    });
    const recorded = await h.workOrders.events(opened.value);

    const view = await getWorkOrder(h.viewDeps, opened.value);

    expect(view.ok).toBe(true);
    if (!view.ok) return;
    // The read reaches no forge and appends nothing: the stream is exactly what the dispatcher left.
    expect(await h.workOrders.events(opened.value)).toEqual(recorded);
    // And the rows are that recorded fact verbatim, not a fresh poll's answer.
    expect(view.value.gates).toEqual([
      {
        gate: slugOf<'gate'>('ci'),
        stage: slugOf<'stage'>('verify'),
        verdict: { status: 'passed' },
        at: 1_050,
        checks: [{ name: 'lint', status: 'passed' }],
      },
    ]);
  });
});

describe('workOrder.repoContext', () => {
  const PATH = '/clones/acme';
  const REPO_ID = '01ARZ3NDEKTSV4RRFFQ69G5FR1';
  const FOLDER_READ: RepoFingerprint = { rootCommit: 'commit-a', remote: 'git@forge.example:acme.git' };

  const registerRow = async (h: Harness, rootCommit: string): Promise<void> => {
    const entry: RepoRegistryEntry = { repoId: REPO_ID, slug: REPO, path: PATH, fingerprint: { rootCommit } };
    await h.repos.register(entry);
  };

  /** Opens the fixture work order with its repo registered and its folder readable — the ok
   *  standing unless the stored root commit or the folder's own read says otherwise. */
  const openWithRepo = async (h: Harness, storedRootCommit = 'commit-a'): Promise<WorkOrderId> => {
    await registerRow(h, storedRootCommit);
    h.fingerprints.set(PATH, FOLDER_READ);
    return openedWorkOrder(h);
  };

  it('A-392: a registered repo whose folder reads its own root commit is ok — path, project and no siblings', async () => {
    const h = createHarness();
    const id = await openWithRepo(h);

    const view = await getWorkOrder(h.viewDeps, id);

    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.repoContext).toEqual({
      path: PATH,
      status: 'ok',
      project: { slug: PROJECT, name: 'Atölye' },
      siblingCount: 0,
    });
  });

  it('A-392: a multi-repo project counts only the repos beside the work order’s own', async () => {
    const h = createHarness();
    await h.projects.save({
      id: PROJECT,
      name: 'Atölye',
      repos: [REPO, slugOf<'repo'>('beta'), slugOf<'repo'>('gamma')],
    });
    const id = await openWithRepo(h);

    const view = await getWorkOrder(h.viewDeps, id);

    if (!view.ok) return;
    expect(view.value.repoContext?.siblingCount).toBe(2);
  });

  it('A-392: a folder whose root commit differs is relink_offered, a folder that reads nothing is folder_not_found', async () => {
    const h = createHarness();
    const moved = await openWithRepo(h, 'commit-old');
    const movedView = await getWorkOrder(h.viewDeps, moved);
    expect(movedView.ok).toBe(true);
    if (!movedView.ok) return;
    expect(movedView.value.repoContext?.status).toBe('relink_offered');
    // The path stays the registered one — the read never re-points a row (A-341's discipline).
    expect(movedView.value.repoContext?.path).toBe(PATH);

    const gone = createHarness();
    await registerRow(gone, 'commit-a');
    const goneId = await openedWorkOrder(gone);
    const goneView = await getWorkOrder(gone.viewDeps, goneId);
    expect(goneView.ok).toBe(true);
    if (!goneView.ok) return;
    expect(goneView.value.repoContext?.status).toBe('folder_not_found');
  });

  it('A-392: a stored empty root commit never offers a relink — an unscanned row reads ok', async () => {
    const h = createHarness();
    await registerRow(h, '');
    h.fingerprints.set(PATH, FOLDER_READ);
    const id = await openedWorkOrder(h);

    const view = await getWorkOrder(h.viewDeps, id);

    if (!view.ok) return;
    expect(view.value.repoContext?.status).toBe('ok');
  });

  it('A-392: a repo the registry does not list answers unregistered with an empty path — never an exception', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);

    const view = await getWorkOrder(h.viewDeps, id);

    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.repoContext).toEqual({
      path: '',
      status: 'unregistered',
      project: { slug: PROJECT, name: 'Atölye' },
      siblingCount: 0,
    });
  });

  it('A-392: a project that no longer loads names itself by its slug and counts no siblings', async () => {
    const h = createHarness();
    const id = await openWithRepo(h);
    await h.projects.remove(PROJECT);

    const view = await getWorkOrder(h.viewDeps, id);

    if (!view.ok) return;
    expect(view.value.repoContext?.project).toEqual({ slug: PROJECT, name: PROJECT });
    expect(view.value.repoContext?.siblingCount).toBe(0);
  });

  it('A-393: the repo context read appends no audit entry, no work-order event and re-points no registry row', async () => {
    const h = createHarness();
    const id = await openWithRepo(h, 'commit-old');
    const auditsBefore = h.log.entries().length;
    const eventsBefore = await h.workOrders.events(id);
    const rowsBefore = await h.repos.list();

    const view = await getWorkOrder(h.viewDeps, id);

    expect(view.ok).toBe(true);
    expect(h.log.entries()).toHaveLength(auditsBefore);
    expect(await h.workOrders.events(id)).toEqual(eventsBefore);
    expect(await h.repos.list()).toEqual(rowsBefore);
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

describe('workOrderRunSummaries canSteer (A-367)', () => {
  const ACCOUNT_LIVE = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FC0');
  const ACCOUNT_GONE = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FC1');
  const WO = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FC2');

  it('A-367: canSteer follows steeringSupport; a gone account reads unknown', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save({
      id: ACCOUNT_LIVE,
      provider: 'cursor',
      label: 'Cursor',
      authMode: 'subscription',
      limitPolicy: 'wait_resume',
      caps: [],
    });
    const capabilities = createFakeCapabilityCatalog([
      { id: 'cursor-subscription', provider: 'cursor', authMode: 'subscription', steering: false },
    ]);
    const runs = createFakeRunRepo();
    await runs.create({
      ...runRecord(RUN_1, WO, 10),
      route: { accountId: ACCOUNT_LIVE },
    });
    await runs.create({
      ...runRecord(RUN_2, WO, 20),
      route: { accountId: ACCOUNT_GONE },
    });

    const rows = await workOrderRunSummaries(
      { runs, accounts, capabilities, modelCatalog: createFakeModelCatalog() },
      await runs.listForWorkOrder(WO),
    );

    expect(rows.find((row) => row.runId === RUN_1)?.canSteer).toBe(false);
    expect(rows.find((row) => row.runId === RUN_2)?.canSteer).toBe('unknown');
  });
});

// --- autonomy: the work-order layer of the chain (A-394/A-395, D-10) -----------------------------------

/** Re-seeds the repo section with an autonomy level and an optional budget. */
const seedRepoAutonomy = (
  h: Harness,
  autonomy: string,
  budget?: { readonly amountUsd: number; readonly warnPercent: number },
): void => {
  const base = JSON.parse(definitionsJson()) as { readonly repo: Record<string, unknown> };
  h.definitions.seed(
    { kind: 'repo', repo: REPO },
    'defs.json',
    JSON.stringify({
      ...base,
      repo: { ...base.repo, autonomy, ...(budget !== undefined ? { budget } : {}) },
    }),
  );
};

/** Wraps the harness's definition store so `load` also answers a project section — the fake's own
 *  load never builds one, and the project layers (budget, autonomy) must flow through the real
 *  code path. */
const withProjectSection = (h: Harness, project: ProjectDef): Pick<AppDeps, 'definitions'> => {
  const load = h.definitions.load.bind(h.definitions);
  return {
    definitions: {
      ...h.definitions,
      load: async (repo: RepoSlug): Promise<Result<Definitions, readonly DefinitionIssue[]>> => {
        const loaded = await load(repo);
        return loaded.ok ? { ok: true, value: { ...loaded.value, project } } : loaded;
      },
    },
  };
};

const BUDGET = { amountUsd: 25, warnPercent: 80 };

/** The record a successful open wrote, or a throw that fails the fixture. */
const recordOf = async (h: Harness, result: Result<WorkOrderId, OpenError>): Promise<WorkOrderRecord> => {
  if (!result.ok) throw new Error(`fixture open must succeed, got ${result.error}`);
  const record = await h.workOrders.get(result.value);
  if (record === undefined) throw new Error('fixture record must exist');
  return record;
};

describe('openWorkOrder (autonomy)', () => {
  it('A-394: a given level is stored verbatim on the record; an absent one stays absent', async () => {
    const h = createHarness();

    const manual = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Verbatim manual',
      autonomy: 'manual',
      actor: ACTOR,
    });
    expect((await recordOf(h, manual)).autonomy).toBe('manual');

    const none = await openWorkOrder(h.openDeps, { project: PROJECT, repo: REPO, title: 'No level', actor: ACTOR });
    expect('autonomy' in (await recordOf(h, none))).toBe(false);
  });

  it('A-394: a value outside AUTONOMY_LEVELS answers invalid_autonomy_level and writes nothing', async () => {
    const h = createHarness();

    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Broken level',
      autonomy: 'turbo' as AutonomyLevel,
      actor: ACTOR,
    });

    expect(result).toEqual(err('invalid_autonomy_level'));
    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-395: auto without any governing cap answers auto_requires_spend_cap and writes nothing', async () => {
    const h = createHarness();

    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Capless auto',
      autonomy: 'auto',
      actor: ACTOR,
    });

    expect(result).toEqual(err('auto_requires_spend_cap'));
    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-395: the cap refusal wins over a missing onFail — the fixed R-169 order', async () => {
    const h = createHarness();

    // No cap anywhere and the default flow-a has stages without onFail: the cap answers first.
    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Both missing',
      autonomy: 'auto',
      actor: ACTOR,
    });

    expect(result).toEqual(err('auto_requires_spend_cap'));
  });

  it('A-395: a cap over a flow with a stage missing onFail answers auto_requires_max_attempts', async () => {
    const h = createHarness();
    seedRepoAutonomy(h, 'manual', BUDGET);

    // The repo owns flow-a (stages without onFail) and carries a budget: the bound is the refusal.
    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Unbounded auto',
      autonomy: 'auto',
      actor: ACTOR,
    });

    expect(result).toEqual(err('auto_requires_max_attempts'));
    expect(await h.workOrders.list({})).toEqual([]);
  });

  it('A-395: the repo budget is the nearest cap — a bounded flow opens at auto', async () => {
    const h = createHarness();
    // The repo owns flow-fail, whose single stage declares its onFail: the bound is written.
    const base = JSON.parse(definitionsJson({ ownFlow: 2 })) as { readonly repo: Record<string, unknown> };
    h.definitions.seed(
      { kind: 'repo', repo: REPO },
      'defs.json',
      JSON.stringify({ ...base, repo: { ...base.repo, budget: BUDGET } }),
    );

    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Bounded auto',
      autonomy: 'auto',
      actor: ACTOR,
    });

    expect((await recordOf(h, result)).autonomy).toBe('auto');
  });

  it('A-395: without a repo budget the project definition’s budget governs the order', async () => {
    const h = createHarness();
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', definitionsJson({ ownFlow: 2 }));
    const openDeps = { ...h.openDeps, ...withProjectSection(h, { ...PROJECT_DEF, budget: BUDGET }) };

    const viaProjectBudget = await openWorkOrder(openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Project-capped auto',
      autonomy: 'auto',
      actor: ACTOR,
    });

    expect((await recordOf(h, viaProjectBudget)).autonomy).toBe('auto');
  });

  it('A-395: manual and balanced never run the auto check', async () => {
    const h = createHarness();

    for (const level of ['manual', 'balanced'] as const) {
      const result = await openWorkOrder(h.openDeps, {
        project: PROJECT,
        repo: REPO,
        title: `Unchecked ${level}`,
        autonomy: level,
        actor: ACTOR,
      });
      expect((await recordOf(h, result)).autonomy).toBe(level);
    }
  });
});

describe('effectiveAutonomy', () => {
  it('A-394: the work-order record outranks repo, project and global', async () => {
    const h = createHarness();
    seedRepoAutonomy(h, 'manual');
    await h.settings.set(AUTONOMY_KEY, 'manual');
    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Own level',
      autonomy: 'manual',
      actor: ACTOR,
    });
    const id = (await recordOf(h, result)).id;

    expect(await effectiveAutonomy(h.autonomyDeps, { workOrder: id })).toEqual({
      ok: true,
      value: { level: 'manual', source: 'workOrder' },
    });
  });

  it('R-158/A-394: a repo auto the preconditions cannot carry answers manual with the typed reason — never a silent auto', async () => {
    const h = createHarness();
    // The repo layer says auto and carries the cap, but the pinned flow's stages carry no onFail:
    // the read fails closed (R-158) with the max-attempts reason.
    seedRepoAutonomy(h, 'auto', BUDGET);
    const id = await openedWorkOrder(h);

    expect(await effectiveAutonomy(h.autonomyDeps, { workOrder: id })).toEqual({
      ok: true,
      value: { level: 'manual', source: 'repo', autoUnavailable: 'auto_requires_max_attempts' },
    });
  });

  it('A-394: a repo-level balanced resolves as manual with the repo layer as its source (R-167)', async () => {
    const h = createHarness();
    seedRepoAutonomy(h, 'balanced');
    const id = await openedWorkOrder(h);

    expect(await effectiveAutonomy(h.autonomyDeps, { workOrder: id })).toEqual({
      ok: true,
      value: { level: 'manual', source: 'repo' },
    });
  });

  it('A-394: the project layer answers when the repo carries no level — an auto without a cap fails closed (R-158)', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    const autonomyDeps = {
      ...h.autonomyDeps,
      ...withProjectSection(h, { ...PROJECT_DEF, autonomy: 'auto' as AutonomyLevel, budget: BUDGET }),
    };

    expect(await effectiveAutonomy(autonomyDeps, { workOrder: id })).toEqual({
      ok: true,
      value: { level: 'manual', source: 'project', autoUnavailable: 'auto_requires_max_attempts' },
    });
  });

  it('A-394: the global settings key is the last defined layer; nothing anywhere is the builtin manual', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);

    await h.settings.set(AUTONOMY_KEY, 'auto');
    expect(await effectiveAutonomy(h.autonomyDeps, { workOrder: id })).toEqual({
      ok: true,
      value: { level: 'manual', source: 'global', autoUnavailable: 'auto_requires_spend_cap' },
    });

    const fresh = createHarness();
    const other = await openedWorkOrder(fresh);
    expect(await effectiveAutonomy(fresh.autonomyDeps, { workOrder: other })).toEqual({
      ok: true,
      value: { level: 'manual', source: 'builtin' },
    });
  });

  it('A-394: a damaged stored global level answers the typed error, never a silent manual', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    await h.settings.set(AUTONOMY_KEY, 'turbo');

    expect(await effectiveAutonomy(h.autonomyDeps, { workOrder: id })).toEqual({
      ok: false,
      error: 'invalid_autonomy_level',
    });
  });

  it('A-394: a damaged value on the stored record answers the typed error — the blob’s cast is never trusted', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    const record = await h.workOrders.get(id);
    if (record === undefined) throw new Error('fixture record must exist');
    await h.workOrders.create({
      ...record,
      id: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB2'),
      autonomy: 'turbo' as AutonomyLevel,
    });

    expect(
      await effectiveAutonomy(h.autonomyDeps, {
        workOrder: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB2'),
      }),
    ).toEqual({ ok: false, error: 'invalid_autonomy_level' });
  });

  it('A-394: a definitions load that fails leaves its layers absent — the chain falls on', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    seedRepoAutonomy(h, 'balanced');
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', '{not json');

    expect(await effectiveAutonomy(h.autonomyDeps, { workOrder: id })).toEqual({
      ok: true,
      value: { level: 'manual', source: 'builtin' },
    });
  });

  it('R-158: an auto whose preconditions hold stands — the read carries no reason', async () => {
    // flow-fail's single stage carries an onFail and the repo carries the cap: the repo layer's
    // auto survives the fail-closed read exactly as it resolved.
    const base = JSON.parse(definitionsJson({ ownFlow: 2 })) as { readonly repo: Record<string, unknown> };
    const h = createHarness();
    h.definitions.seed(
      { kind: 'repo', repo: REPO },
      'defs.json',
      JSON.stringify({ ...base, repo: { ...base.repo, autonomy: 'auto', budget: BUDGET } }),
    );
    const id = await openedWorkOrder(h);

    expect(await effectiveAutonomy(h.autonomyDeps, { workOrder: id })).toEqual({
      ok: true,
      value: { level: 'auto', source: 'repo' },
    });
  });

  it('A-404: reads the flow layer from the work order pin (FlowPin); auto suggests auto without resolving it; manual/balanced pass through', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    const baseRecord = await h.workOrders.get(id);
    if (!baseRecord || !baseRecord.pin) throw new Error('record must have pin');

    // Flow pin with autonomy: 'auto'
    const autoId = h.openDeps.ids.next<'work-order'>();
    const autoPin: FlowPin = { ...baseRecord.pin, autonomy: 'auto' };
    await h.workOrders.create({ ...baseRecord, id: autoId, pin: autoPin });

    const effective = await effectiveAutonomy(h.autonomyDeps, { workOrder: autoId });
    expect(effective).toEqual({
      ok: true,
      value: {
        level: 'manual',
        source: 'builtin',
        suggestion: 'auto',
      },
    });

    // Flow pin with autonomy: 'manual' passes through as source 'flow'
    const manualId = h.openDeps.ids.next<'work-order'>();
    const manualPin: FlowPin = { ...baseRecord.pin, autonomy: 'manual' };
    await h.workOrders.create({ ...baseRecord, id: manualId, pin: manualPin });
    const manualEffective = await effectiveAutonomy(h.autonomyDeps, { workOrder: manualId });
    expect(manualEffective).toEqual({
      ok: true,
      value: {
        level: 'manual',
        source: 'flow',
      },
    });

    // Pinned version behaviour: editing the live flow after the order pinned it does not change this order's chain
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', definitionsJson({ ownFlow: 0 }));
    const afterLiveEdit = await effectiveAutonomy(h.autonomyDeps, { workOrder: manualId });
    expect(afterLiveEdit).toEqual({
      ok: true,
      value: {
        level: 'manual',
        source: 'flow',
      },
    });
  });

  it('A-404: a damaged autonomy level stored in the work-order pin returns invalid_autonomy_level', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    const baseRecord = await h.workOrders.get(id);
    if (!baseRecord || !baseRecord.pin) throw new Error('record must have pin');

    const corruptId = h.openDeps.ids.next<'work-order'>();
    const corruptPin = { ...baseRecord.pin, autonomy: 'turbo' as unknown as AutonomyLevel };
    await h.workOrders.create({ ...baseRecord, id: corruptId, pin: corruptPin });

    const result = await effectiveAutonomy(h.autonomyDeps, { workOrder: corruptId });
    expect(result).toEqual({ ok: false, error: 'invalid_autonomy_level' });
  });

  it('A-405: suggestion flow — opening work order with flow suggesting auto writes no layer; workOrderDetail carries suggestion: auto', async () => {
    const h = createHarness();
    // Repo flow with autonomy: 'auto'
    const repoWithAutoFlow = {
      ...REPO_JSON,
      flow: {
        ...repoFlowOf(FLOWS_JSON[0]),
        autonomy: 'auto' as const,
      },
    };
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', JSON.stringify({
      roles: [ROLE_JSON],
      flows: FLOWS_JSON,
      capabilities: [],
      repo: repoWithAutoFlow,
    }));

    // Opening work order does not write an autonomy layer
    const opened = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Suggested order',
      actor: ACTOR,
    });
    if (!opened.ok) throw new Error('openWorkOrder must succeed');
    const rec = await h.workOrders.get(opened.value);
    expect(rec?.autonomy).toBeUndefined(); // Nothing written at open
    expect(rec?.pin?.autonomy).toBe('auto');

    // Detail view reads the suggestion
    const detail = await getWorkOrder(h.viewDeps, opened.value);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.autonomy?.level).toBe('manual');
    expect(detail.value.autonomy?.suggestion).toBe('auto');
    expect(detail.value.autonomy?.layerSet).toBe(false);
  });

  it('A-404: stage arm resolves per stage at decision time; manual and balanced pass through; auto suggests auto; ceiling clamps and populates ceiling', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);
    const baseRecord = await h.workOrders.get(id);
    if (!baseRecord || !baseRecord.pin) throw new Error('record must have pin');

    // Create a pin where stage 'plan' has autonomy: 'manual', and stage 'implement' has autonomy: 'auto'
    const stageId = h.openDeps.ids.next<'work-order'>();
    const stagePin: FlowPin = {
      ...baseRecord.pin,
      stages: [
        {
          ...baseRecord.pin.stages[0],
          stage: {
            ...baseRecord.pin.stages[0].stage,
            autonomy: 'manual',
          },
        },
        {
          ...baseRecord.pin.stages[1],
          stage: {
            ...baseRecord.pin.stages[1].stage,
            autonomy: 'auto',
          },
        },
      ],
    };
    await h.workOrders.create({ ...baseRecord, id: stageId, pin: stagePin });

    // Resolving for stage 'plan': stage level 'manual' passes through as source 'stage',
    // and suggestion 'auto' is present because stage 'implement' has autonomy 'auto'
    const planEffective = await effectiveAutonomy(h.autonomyDeps, {
      workOrder: stageId,
      stage: slugOf<'stage'>('plan'),
    });
    expect(planEffective).toEqual({
      ok: true,
      value: {
        level: 'manual',
        source: 'stage',
        suggestion: 'auto',
      },
    });

    // Resolving for stage 'implement': auto from stage does not resolve (R-153), falls to builtin 'manual' with suggestion: 'auto'
    const implementEffective = await effectiveAutonomy(h.autonomyDeps, {
      workOrder: stageId,
      stage: slugOf<'stage'>('implement'),
    });
    expect(implementEffective).toEqual({
      ok: true,
      value: {
        level: 'manual',
        source: 'builtin',
        suggestion: 'auto',
      },
    });

    // With a repo ceiling in force: ceiling is always populated
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', JSON.stringify({
      roles: [ROLE_JSON],
      flows: FLOWS_JSON,
      capabilities: [],
      repo: {
        ...REPO_JSON,
        maxLevel: 'balanced',
      },
    }));
    const withCeiling = await effectiveAutonomy(h.autonomyDeps, {
      workOrder: stageId,
      stage: slugOf<'stage'>('plan'),
    });
    expect(withCeiling).toEqual({
      ok: true,
      value: {
        level: 'manual',
        source: 'stage',
        ceiling: 'balanced',
        suggestion: 'auto',
      },
    });
  });

  it('A-406: openWorkOrder refuses level above effective ceiling with above_ceiling before anything is written', async () => {
    const h = createHarness();
    // Repo ceiling set to 'balanced'
    h.definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', JSON.stringify({
      roles: [ROLE_JSON],
      flows: FLOWS_JSON,
      capabilities: [],
      repo: {
        ...REPO_JSON,
        maxLevel: 'balanced',
      },
    }));

    // Opening with autonomy 'auto' is refused with above_ceiling
    const result = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Above ceiling order',
      autonomy: 'auto',
      actor: ACTOR,
    });
    expect(result).toEqual({ ok: false, error: 'above_ceiling' });

    // Global ceiling: setting autonomy.max to 'manual'
    await h.settings.set(AUTONOMY_MAX_KEY, 'manual');
    const globalCeilingResult = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Above global ceiling',
      autonomy: 'balanced',
      actor: ACTOR,
    });
    expect(globalCeilingResult).toEqual({ ok: false, error: 'above_ceiling' });

    // Opening with level within ceiling succeeds
    const okResult = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Within ceiling',
      autonomy: 'manual',
      actor: ACTOR,
    });
    expect(okResult.ok).toBe(true);
  });

  it('A-431: openWorkOrder validates stageSkip and refuses bad input before writing', async () => {
    const h = createHarness();

    // 1. Empty reason
    const emptyReason = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix issue',
      actor: ACTOR,
      stageSkip: { stages: ['implement'], reason: '   ' },
    });
    expect(emptyReason).toEqual({ ok: false, error: { code: 'bad_input', message: 'stageSkip reason must not be empty' } });
    expect(await h.workOrders.list({})).toEqual([]);

    // 2. Empty stages
    const emptyStages = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix issue',
      actor: ACTOR,
      stageSkip: { stages: [], reason: 'valid reason' },
    });
    expect(emptyStages).toEqual({ ok: false, error: { code: 'bad_input', message: 'stageSkip stages must be a non-empty array' } });

    // 3. Invalid slug
    const invalidSlug = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix issue',
      actor: ACTOR,
      stageSkip: { stages: ['Not-A-Valid-Slug!'], reason: 'valid reason' },
    });
    expect(invalidSlug).toEqual({ ok: false, error: { code: 'bad_input', message: 'invalid stage slug: Not-A-Valid-Slug!' } });

    // 4. Unknown stage
    const unknownStage = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix issue',
      actor: ACTOR,
      stageSkip: { stages: ['nonexistent-stage'], reason: 'valid reason' },
    });
    expect(unknownStage).toEqual({ ok: false, error: { code: 'bad_input', message: 'stage "nonexistent-stage" does not exist in flow "flow-a"' } });

    // 5. Unskippable stage (plan has human exit gate in flow-a)
    const unskippable = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Fix issue',
      actor: ACTOR,
      stageSkip: { stages: ['plan'], reason: 'valid reason' },
    });
    expect(unskippable).toEqual({ ok: false, error: { code: 'bad_input', message: 'stage "plan" exit gates block skipping' } });
    expect(await h.workOrders.list({})).toEqual([]);
  });

  it('A-431: openWorkOrder appends stage_skip_proposed and stage_skip_decided on success', async () => {
    const h = createHarness();

    const withDecision = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Order with approved skip',
      actor: ACTOR,
      stageSkip: { stages: ['implement'], reason: '  already implemented  ', approved: true },
    });
    expect(withDecision.ok).toBe(true);
    if (!withDecision.ok) throw new Error('must succeed');

    expect(await h.workOrders.events(withDecision.value)).toEqual([
      { type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A },
      { type: 'stage_skip_proposed', at: 1_000, stages: ['implement'], reason: 'already implemented' },
      { type: 'stage_skip_decided', at: 1_000, approved: true },
    ]);

    const withoutDecision = await openWorkOrder(h.openDeps, {
      project: PROJECT,
      repo: REPO,
      title: 'Order with undecided skip',
      actor: ACTOR,
      stageSkip: { stages: ['implement'], reason: 'proposal only' },
    });
    expect(withoutDecision.ok).toBe(true);
    if (!withoutDecision.ok) throw new Error('must succeed');

    expect(await h.workOrders.events(withoutDecision.value)).toEqual([
      { type: 'created', at: 1_000, by: ACTOR, flow: FLOW_A },
      { type: 'stage_skip_proposed', at: 1_000, stages: ['implement'], reason: 'proposal only' },
    ]);
  });
});

describe('stage-skip decision rows (A-433)', () => {
  it('A-433: getWorkOrder includes skipDecisions walking proposals and decisions in event order with policy evidence', async () => {
    const h = createHarness();
    const id = await openedWorkOrder(h);

    // Append human rejection, then policy approval
    await h.workOrders.appendEvent(id, {
      type: 'stage_skip_proposed',
      at: 10,
      stages: [slugOf<'stage'>('implement')],
      reason: 'human skip attempt',
    });
    await h.workOrders.appendEvent(id, {
      type: 'stage_skip_decided',
      at: 20,
      approved: false,
    });
    await h.workOrders.appendEvent(id, {
      type: 'stage_skip_proposed',
      at: 30,
      stages: [slugOf<'stage'>('review')],
      reason: 'auto skip attempt',
    });
    await h.workOrders.appendEvent(id, {
      type: 'stage_skip_decided',
      at: 40,
      approved: true,
      decidedByPolicy: { policy: slugOf<'policy'>('stage-skip-auto'), level: 'auto' },
    });

    const view = await getWorkOrder(h.viewDeps, id);
    expect(view.ok).toBe(true);
    if (!view.ok) return;

    expect(view.value.skipDecisions).toEqual([
      {
        stages: ['implement'],
        decision: 'rejected',
        at: 20,
        reason: 'human skip attempt',
      },
      {
        stages: ['review'],
        decision: 'approved',
        at: 40,
        reason: 'auto skip attempt',
        decidedByPolicy: { policy: 'stage-skip-auto', level: 'auto' },
      },
    ]);
  });

  it('A-433: workOrderStageSkipDecisionRows ignores proposals with no decisions, decisions without proposals, and omits blank reasons', () => {
    const events: readonly WorkOrderEvent[] = [
      { type: 'stage_skip_decided', at: 5, approved: true },
      { type: 'stage_skip_proposed', at: 10, stages: [slugOf<'stage'>('implement')], reason: 'undecided' },
      { type: 'stage_skip_proposed', at: 15, stages: [slugOf<'stage'>('build')], reason: '   ' },
      { type: 'stage_skip_decided', at: 20, approved: true },
    ];
    expect(workOrderStageSkipDecisionRows(events)).toEqual([
      {
        stages: ['build'],
        decision: 'approved',
        at: 20,
      },
    ]);
  });
});

