// scenarios/standard-flow.test.ts — the docs/v2/application.md section-5 acceptance: the built-in
// `standard` flow driven headless from open to done over the in-memory fakes, plus the wait_resume
// limit path. Opening and human gate decisions go through the api boundary (`createApi`), exactly as
// the UI will issue them; runs, machine gates and agent verdicts call the application directly.
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  MINUTE,
  RESUME_JITTER_MS,
  parseSlug,
  parseUlid,
  type AccountId,
  type Actor,
  type AgentEvent,
  type DispatchLimits,
  type EpochMs,
  type GateSlug,
  type LimitClass,
  type LimitPolicy,
  type QueueItem,
  type RunId,
  type RunOutcome,
  type RoleSlug,
  type Slug,
  type StageSlug,
  type Ulid,
  type WorkOrderId,
  type RepoSlug,
} from '../../domain/index';

import { createApi } from '../index';
import type { AccountRecord, AppDeps } from '../../application/index';
import {
  applyLimitDecision,
  dispatcherTick,
  enqueueStage,
  evaluateMachineGates,
  executeRun,
  getWorkOrder,
  resolveRoute,
  submitAgentVerdict,
  type ExecuteOutcome,
  type PermissionGate,
} from '../../application/index';
import {
  createFakeClock,
  createFakeCommandRunner,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeEvidenceChecker,
  createFakeTransport,
  createFakeTransportResolver,
  type FakeClock,
  type FakeCommandRunner,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeEvidenceChecker,
  type FakeTransportResolver,
} from '../../application/ports/fakes/index';

// --- fixtures ---------------------------------------------------------------------------------------

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

const REPO: RepoSlug = slugOf('ws');
const T0: EpochMs = 1_700_000_000_000;

const MAIN: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');
const PLANNER_ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCW');
const DEVELOPER_ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCX');

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

/** Opens a work order through the api boundary and returns its parsed id. */
const openViaApi = async (deps: AppDeps, title: string): Promise<WorkOrderId | undefined> => {
  const result = await createApi(deps).command(USER, { type: 'workOrder.open', project: slugOf<'project'>('ws-proj'), repo: REPO, title });
  if (!result.ok || result.id === undefined) return undefined;
  const parsed = parseUlid<'work-order'>(result.id);
  return parsed.ok ? parsed.value : undefined;
};

/** Approves a human gate through the api boundary. */
const approveViaApi = (deps: AppDeps, id: WorkOrderId, gate: GateSlug) =>
  createApi(deps).command(USER, { type: 'gate.decide', workOrderId: id, gate, decision: 'approved' });

/** The standard flow's stages and gates, as slugs the inputs below are typed with. */
const PLAN: StageSlug = slugOf<'stage'>('plan');
const IMPLEMENT: StageSlug = slugOf<'stage'>('implement');
const REVIEW: StageSlug = slugOf<'stage'>('review');
const CLOSE: StageSlug = slugOf<'stage'>('close');
const PLAN_APPROVAL: GateSlug = slugOf<'gate'>('plan-approval');
const REVIEW_VERDICT: GateSlug = slugOf<'gate'>('review-verdict');
const REVIEW_APPROVAL: GateSlug = slugOf<'gate'>('review-approval');
const CLOSURE: GateSlug = slugOf<'gate'>('closure');

const LIMITS: DispatchLimits = { global: 4, perRepo: 3, perAccount: {} };

const TEST_COMMAND = 'npm test';

/** The whole definitions body the fake store serves for the repo: the built-in library's
 *  `standard` flow plus a repo that enables it and defines the `tests` command set. */
const definitionsBody = (): unknown => {
  const standard = BUILTIN_FLOWS.find((flow) => flow.id === 'standard');
  if (standard === undefined) throw new Error('expected a built-in flow "standard"');
  return {
    roles: BUILTIN_ROLES,
    flows: [standard],
    capabilities: [],
    repo: {
      id: 'ws',
      name: 'Repo',
      repos: [],
      flows: ['standard'],
      defaultFlow: 'standard',
      commandSets: { tests: [TEST_COMMAND] },
      roleOverrides: [],
      docsRoot: 'docs',
      testGlobs: [],
    },
  };
};

const account = (id: AccountId, limitPolicy: LimitPolicy = 'wait_resume'): AccountRecord => ({
  id,
  provider: 'provider-x',
  label: `account ${id}`,
  authMode: 'subscription',
  limitPolicy,
  caps: [],
});

const bindRole = async (deps: AppDeps, role: RoleSlug, accountId: AccountId): Promise<void> => {
  await deps.bindings.save({ level: 'global' }, { role, accounts: [{ accountId }] });
};

const sessionStarted = (at: EpochMs): AgentEvent => ({ type: 'session_started', at, sessionRef: 'sess-run' });
const finished = (at: EpochMs): AgentEvent => ({ type: 'finished', at, reason: 'completed' });
const completedScript = (): readonly AgentEvent[] => [sessionStarted(T0), finished(T0 + 1_000)];
const limitScript = (resetsAt: EpochMs): readonly AgentEvent[] => [
  {
    type: 'limit_hit',
    at: T0,
    hit: { class: 'window_exhausted' as LimitClass, remedies: ['wait'], resetsAt },
  },
];

// --- harness ----------------------------------------------------------------------------------------

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly definitions: FakeDefinitionStore;
  readonly commands: FakeCommandRunner;
  readonly evidence: FakeEvidenceChecker;
  readonly transports: FakeTransportResolver;
}

const makeHarness = (): Harness => {
  const clock = createFakeClock(T0);
  const log = createFakeEventLog();
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(definitionsBody()));
  const commands = createFakeCommandRunner();
  const evidence = createFakeEvidenceChecker();
  const transports = createFakeTransportResolver();
  definitions.setProject({ id: slugOf<'project'>('ws-proj'), name: 'Project', mainRepo: slugOf<'repo'>('ws'), repos: [slugOf<'repo'>('ws')] });
  const deps = createFakeDeps({ clock, log, definitions, commands, evidence, transports });
  deps.projects.save({ id: slugOf<'project'>('ws-proj'), name: 'Project', mainRepo: slugOf<'repo'>('ws'), repos: [slugOf<'repo'>('ws')] });
  return { deps, clock, log, definitions, commands, evidence, transports };
};

const allowAll: PermissionGate = { onAsk: async () => 'allow' };

const viewOf = async (deps: AppDeps, id: WorkOrderId) => {
  const view = await getWorkOrder(deps, id);
  if (!view.ok) throw new Error(`work order must load: ${view.error}`);
  return view.value;
};

/** The state assertions every step of the scenario repeats. */
const expectState = (
  view: Awaited<ReturnType<typeof viewOf>>,
  expected: { readonly status: string; readonly stage: string | null; readonly pendingGates?: readonly string[] },
): void => {
  expect(view.state.status).toBe(expected.status);
  expect(view.state.stage).toBe(expected.stage);
  if (expected.pendingGates !== undefined) expect([...view.state.pendingGates]).toEqual(expected.pendingGates);
};

/** Enqueues the current stage, ticks the dispatcher so it starts, and runs the started item to
 *  completion — the caller asserts the outcome and the state it left behind. */
const runCurrentStage = async (h: Harness, id: WorkOrderId): Promise<ExecuteOutcome> => {
  const view = await viewOf(h.deps, id);
  if (view.next.kind !== 'start_run') throw new Error(`expected start_run, got ${view.next.kind}`);

  const routed = await resolveRoute(h.deps, { repo: REPO, workOrderId: id, role: view.next.role });
  if (!routed.ok) throw new Error(`route must resolve: ${JSON.stringify(routed.error)}`);

  const queued = await enqueueStage(h.deps, { id });
  if (!queued.ok) throw new Error(`enqueue must succeed: ${queued.error}`);

  const started: QueueItem[] = [];
  const tick = await dispatcherTick(h.deps, { limits: LIMITS }, (item) => {
    started.push(item);
  });
  expect(tick.started).toHaveLength(1);
  const item = started[0];
  if (item === undefined) throw new Error('the tick must hand over the started item');

  return executeRun(h.deps, allowAll, {
    item,
    role: routed.value.role,
    prompt: `run stage ${item.stage}`,
    cwd: `/fake/worktrees/${REPO}/${id}`,
    capabilities: [],
  });
};

interface StageRunSummary {
  readonly id: RunId;
  readonly outcome: RunOutcome | undefined;
  readonly autoResumesUsed: number;
}

const stageRun = async (h: Harness, id: WorkOrderId, stage: StageSlug): Promise<readonly StageRunSummary[]> => {
  const ofStage = (await h.deps.runs.listForWorkOrder(id)).filter((run) => run.stage === stage);
  return ofStage.map((run) => ({ id: run.id, outcome: run.outcome, autoResumesUsed: run.autoResumesUsed }));
};

// --- the two section-5 scenarios --------------------------------------------------------------------

describe('standard flow, headless end to end', () => {
  it('section 5: open to done — plan approval, machine gates, agent verdict, review and closure', async () => {
    const h = makeHarness();
    await h.deps.accounts.save(account(MAIN));
    h.transports.register(MAIN, createFakeTransport(completedScript()));
    await bindRole(h.deps, slugOf<'role'>('planner'), MAIN);
    await bindRole(h.deps, slugOf<'role'>('developer'), MAIN);
    await bindRole(h.deps, slugOf<'role'>('reviewer'), MAIN);
    // The implement stage's command gate passes: the command set's one command exits 0, and the
    // scanner (0 findings by default) clears the secret scan gate.
    h.commands.script(TEST_COMMAND, { exitCode: 0, durationMs: 12, outputTail: 'ok' });
    h.evidence.setResolvable(['src/main.ts:1']);

    // 1. open → plan/ready.
    const id = await openViaApi(h.deps, '  Ship the standard flow  ');
    expect(id).toBeDefined();
    if (id === undefined) return;
    h.clock.advance(1_000);
    let view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: PLAN, pendingGates: [PLAN_APPROVAL] });
    expect(view.next.kind).toBe('start_run');
    expect(view.record.title).toBe('Ship the standard flow');

    // enqueue + tick → started; the run completes → plan/awaiting_human.
    const planRun = await runCurrentStage(h, id);
    expect(planRun).toEqual({ kind: 'finished', outcome: 'succeeded' });
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'awaiting_human', stage: PLAN, pendingGates: [PLAN_APPROVAL] });
    expect(view.next.kind).toBe('await_human');

    // 2. the plan approval moves the flow to implement/ready.
    expect((await approveViaApi(h.deps, id, PLAN_APPROVAL)).ok).toBe(true);
    h.clock.advance(1_000);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: IMPLEMENT, pendingGates: [slugOf<'gate'>('tests'), slugOf<'gate'>('secrets')] });
    expect(view.state.attempt).toBe(1);

    // 3. the implement run completes → gating; the machine gates pass → review/ready.
    const implementRun = await runCurrentStage(h, id);
    expect(implementRun).toEqual({ kind: 'finished', outcome: 'succeeded' });
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: IMPLEMENT, pendingGates: [slugOf<'gate'>('tests'), slugOf<'gate'>('secrets')] });

    const gated = await evaluateMachineGates(h.deps, { id });
    expect(gated.ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: REVIEW, pendingGates: [REVIEW_VERDICT, REVIEW_APPROVAL] });
    // The command gate ran its set in the work order's worktree, ten minutes per command.
    expect(h.commands.calls()).toEqual([
      { cwd: `/fake/worktrees/${REPO}/${id}`, command: TEST_COMMAND, timeoutMs: 10 * MINUTE },
    ]);

    // 4. the reviewer run completes → gating; its verdict → awaiting_human; approval → close.
    const reviewRun = await runCurrentStage(h, id);
    expect(reviewRun).toEqual({ kind: 'finished', outcome: 'succeeded' });
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: REVIEW, pendingGates: [REVIEW_VERDICT, REVIEW_APPROVAL] });

    const reviewerRuns = await stageRun(h, id, REVIEW);
    expect(reviewerRuns).toHaveLength(1);
    const reviewer = reviewerRuns[0];
    if (reviewer === undefined) throw new Error('the review run must exist');
    const REVIEWER: Actor = { kind: 'agent', runId: reviewer.id, role: slugOf<'role'>('reviewer') };
    const afterVerdict = await submitAgentVerdict(h.deps, {
      id,
      gate: REVIEW_VERDICT,
      approve: true,
      pointers: ['src/main.ts:1'],
      actor: REVIEWER,
    });
    expect(afterVerdict.ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'awaiting_human', stage: REVIEW, pendingGates: [REVIEW_APPROVAL] });

    expect((await approveViaApi(h.deps, id, REVIEW_APPROVAL)).ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'awaiting_human', stage: CLOSE, pendingGates: [CLOSURE] });

    // 5. the closure approval finishes the work order.
    expect((await approveViaApi(h.deps, id, CLOSURE)).ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'done', stage: null, pendingGates: [] });
    expect(view.next.kind).toBe('none');

    // The queue drained, every run closed with an outcome, and the audit trail tells the whole
    // story in order.
    expect(await h.deps.queue.list()).toEqual([]);
    const runs = await h.deps.runs.listForWorkOrder(id);
    expect(runs.map((run) => run.stage)).toEqual([PLAN, IMPLEMENT, REVIEW]);
    for (const run of runs) {
      expect(run.outcome).toBe('succeeded');
      expect(run.endedAt).toBeDefined();
    }
    expect(h.log.entries().map((entry) => entry.action)).toEqual([
      'work_order.opened',
      'run.started',
      'run.finished',
      'gate.decided',
      'run.started',
      'run.finished',
      'run.started',
      'run.finished',
      'gate.decided',
      'gate.decided',
      'gate.decided',
    ]);
    const decided = h.log.entries().filter((entry) => entry.action === 'gate.decided');
    expect(decided.map((entry) => entry.detail)).toEqual([
      { gate: PLAN_APPROVAL, decision: 'approved' },
      { gate: REVIEW_VERDICT, decision: 'approved' },
      { gate: REVIEW_APPROVAL, decision: 'approved' },
      { gate: CLOSURE, decision: 'approved' },
    ]);
  });

  it('section 5: a wait_resume limit parks the work order and schedules a resume at resetsAt + 60 s', async () => {
    const RESETS_AT = T0 + 3_600_000;
    const h = makeHarness();
    await h.deps.accounts.save(account(PLANNER_ACCOUNT));
    await h.deps.accounts.save(account(DEVELOPER_ACCOUNT, 'wait_resume'));
    h.transports.register(PLANNER_ACCOUNT, createFakeTransport(completedScript()));
    h.transports.register(DEVELOPER_ACCOUNT, createFakeTransport(limitScript(RESETS_AT)));
    await bindRole(h.deps, slugOf<'role'>('planner'), PLANNER_ACCOUNT);
    await bindRole(h.deps, slugOf<'role'>('developer'), DEVELOPER_ACCOUNT);

    // Walk to implement/ready: open, run the plan, approve it.
    const id = await openViaApi(h.deps, 'Hit the window limit');
    expect(id).toBeDefined();
    if (id === undefined) return;
    expect((await runCurrentStage(h, id)).kind).toBe('finished');
    expect((await approveViaApi(h.deps, id, PLAN_APPROVAL)).ok).toBe(true);
    let view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: IMPLEMENT });

    // The implement run hits the limit: the run ends with outcome limit and the work order parks.
    const outcome = await runCurrentStage(h, id);
    expect(outcome.kind).toBe('limit');
    if (outcome.kind !== 'limit') return;
    expect(outcome.decision).toEqual({
      kind: 'schedule_resume',
      at: RESETS_AT + RESUME_JITTER_MS,
      requeryFirst: true,
    });
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'limit_waiting', stage: IMPLEMENT });
    expect(view.next.kind).toBe('wait_limit');

    // The caller schedules the decision: the queue holds a resume for the same stage and route,
    // parked until just past the reset.
    const implementRuns = await stageRun(h, id, IMPLEMENT);
    expect(implementRuns).toHaveLength(1);
    const limitRun = implementRuns[0];
    if (limitRun === undefined) throw new Error('the implement run must exist');
    expect(limitRun.outcome).toBe('limit');

    const applied = await applyLimitDecision(h.deps, { runId: limitRun.id, decision: outcome.decision });
    expect(applied.ok).toBe(true);

    const items = await h.deps.queue.list();
    expect(items).toHaveLength(1);
    const resume = items[0];
    if (resume === undefined) throw new Error('the resume item must exist');
    expect(resume.notBefore).toBe(RESETS_AT + RESUME_JITTER_MS);
    expect(resume.stage).toBe(IMPLEMENT);
    expect(resume.route.accountId).toBe(DEVELOPER_ACCOUNT);
    expect(resume.workOrderId).toBe(id);

    // Scheduling the resume spends one of the run's auto-resumes.
    const afterSchedule = await stageRun(h, id, IMPLEMENT);
    expect(afterSchedule[0]?.autoResumesUsed).toBe(1);
  });
});
