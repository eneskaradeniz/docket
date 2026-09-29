// scenarios/environments.test.ts — the Phase 2c acceptance (docs/v2/application.md E-19): the
// standard flow extended with an environment stage, driven headless from open to done over the
// in-memory fakes. The stage deploys to stg, waits for a remote_checks gate the fake forge reports
// all green, and promotes the same commit to the protected prd. Opening and human gate decisions go
// through the api boundary (`createApi`), exactly as the UI will issue them; runs, machine gates,
// agent verdicts and the two deploy approvals call the application directly.
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  MINUTE,
  parseSlug,
  parseUlid,
  type AccountId,
  type Actor,
  type AgentEvent,
  type DispatchLimits,
  type EpochMs,
  type EnvSlug,
  type FlowDef,
  type GateSlug,
  type LimitPolicy,
  type QueueItem,
  type RepoRef,
  type RoleSlug,
  type Slug,
  type StageDef,
  type StageSlug,
  type Ulid,
  type WorkOrderEvent,
  type WorkOrderId,
  type RepoSlug,
} from '../../domain/index';

import { createApi } from '../index';
import type { AccountRecord, AppDeps, CheckRun, ForgeResolver } from '../../application/index';
import {
  approveAndDeploy,
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
  createFakeForge,
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

const REPO_SLUG: RepoSlug = slugOf('ws');
const T0: EpochMs = 1_700_000_000_000;

const MAIN: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

/** Opens a work order through the api boundary and returns its parsed id. */
const openViaApi = async (deps: AppDeps, title: string): Promise<WorkOrderId | undefined> => {
  const result = await createApi(deps).command(USER, { type: 'workOrder.open', project: slugOf<'project'>('ws-proj'), repo: REPO_SLUG, title });
  if (!result.ok || result.id === undefined) return undefined;
  const parsed = parseUlid<'work-order'>(result.id);
  return parsed.ok ? parsed.value : undefined;
};

/** Approves a human gate through the api boundary. */
const approveViaApi = (deps: AppDeps, id: WorkOrderId, gate: GateSlug) =>
  createApi(deps).command(USER, { type: 'gate.decide', workOrderId: id, gate, decision: 'approved' });

// The extended flow's stages and gates, as slugs the inputs below are typed with.
const PLAN: StageSlug = slugOf<'stage'>('plan');
const IMPLEMENT: StageSlug = slugOf<'stage'>('implement');
const REVIEW: StageSlug = slugOf<'stage'>('review');
const DEPLOY: StageSlug = slugOf<'stage'>('deploy');
const CLOSE: StageSlug = slugOf<'stage'>('close');
const PLAN_APPROVAL: GateSlug = slugOf<'gate'>('plan-approval');
const REVIEW_VERDICT: GateSlug = slugOf<'gate'>('review-verdict');
const REVIEW_APPROVAL: GateSlug = slugOf<'gate'>('review-approval');
const CLOSURE: GateSlug = slugOf<'gate'>('closure');
const DEPLOY_STG: GateSlug = slugOf<'gate'>('deploy-stg');
const REMOTE_CHECKS: GateSlug = slugOf<'gate'>('forge-checks');
const DEPLOY_PRD: GateSlug = slugOf<'gate'>('deploy-prd');

const STG: EnvSlug = slugOf<'env'>('stg');
const PRD: EnvSlug = slugOf<'env'>('prd');

const LIMITS: DispatchLimits = { global: 4, perRepo: 3, perAccount: {} };

const TEST_COMMAND = 'npm test';
const DEPLOY_STG_COMMAND = 'docket-deploy stg';
const VERIFY_STG_COMMAND = 'docket-verify stg';
const DEPLOY_PRD_COMMAND = 'docket-deploy prd';
const VERIFY_PRD_COMMAND = 'docket-verify prd';

const COMMIT = '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';
const OTHER_COMMIT = '0000000000000000000000000000000';

const REPO: RepoRef = { id: 'docket', remote: 'https://forge.fake/docket/docket.git', defaultBranch: 'main' };
const BRANCH_REF = 'feature/ship-environments';

const STG_TOKEN_REF = 'ws/stg/deploy-token';
const PRD_TOKEN_REF = 'ws/prd/api-token';
// Credential-shaped, assembled at runtime so the file itself never carries a secret-looking literal.
const STG_TOKEN = 'AKIA' + 'X'.repeat(16);
const PRD_TOKEN = 'sk-live-' + '9'.repeat(20);
const STG_CHANNEL = 'internal-canary';

/** The environment values the stg deploy commands must be handed: one literal, one vault secret. */
const STG_ENV = { RELEASE_CHANNEL: STG_CHANNEL, DEPLOY_TOKEN: STG_TOKEN };
const PRD_ENV = { API_TOKEN: PRD_TOKEN };

/** The branch's check runs, all green, as the fake forge reports them. */
const ALL_GREEN: readonly CheckRun[] = [
  { name: 'build', status: 'passed' },
  { name: 'e2e', status: 'passed' },
];

/** The environment stage the standard flow is extended with: stg, then remote checks, then prd. */
const DEPLOY_STAGE: StageDef = {
  id: DEPLOY,
  name: 'Deploy',
  role: slugOf<'role'>('developer'),
  exit: [
    { kind: 'deploy', id: DEPLOY_STG, environment: STG },
    { kind: 'remote_checks', id: REMOTE_CHECKS, required: 'all', timeoutMinutes: 30 },
    { kind: 'deploy', id: DEPLOY_PRD, environment: PRD },
  ],
};

/** The whole definitions body the fake store serves for the repo: the built-in `standard`
 *  flow with the environment stage inserted before close, plus a repo that enables it,
 *  defines the command sets, and declares the two environments prd promotes over. */
const definitionsBody = (): unknown => {
  const standard = BUILTIN_FLOWS.find((flow) => flow.id === 'standard');
  if (standard === undefined) throw new Error('expected a built-in flow "standard"');
  const close = standard.stages[standard.stages.length - 1];
  if (close === undefined) throw new Error('the standard flow must have a close stage');
  const flow: FlowDef = {
    ...standard,
    id: slugOf<'flow'>('standard-env'),
    name: 'Standard with environments',
    stages: [...standard.stages.slice(0, -1), DEPLOY_STAGE, close],
  };
  return {
    roles: BUILTIN_ROLES,
    flows: [flow],
    capabilities: [],
    repo: {
      id: 'ws',
      name: 'Repo',
      flows: ['standard-env'],
      defaultFlow: 'standard-env',
      commandSets: {
        tests: [TEST_COMMAND],
        'deploy-stg': [DEPLOY_STG_COMMAND],
        'verify-stg': [VERIFY_STG_COMMAND],
        'deploy-prd': [DEPLOY_PRD_COMMAND],
        'verify-prd': [VERIFY_PRD_COMMAND],
      },
      roleOverrides: [],
      docsRoot: 'docs',
      testGlobs: [],
      environments: [
        {
          id: STG,
          name: 'Staging',
          order: 1,
          deploy: 'deploy-stg',
          verify: 'verify-stg',
          env: { RELEASE_CHANNEL: { literal: STG_CHANNEL }, DEPLOY_TOKEN: { secretRef: STG_TOKEN_REF } },
          protected: false,
        },
        {
          id: PRD,
          name: 'Production',
          order: 2,
          deploy: 'deploy-prd',
          verify: 'verify-prd',
          env: { API_TOKEN: { secretRef: PRD_TOKEN_REF } },
          protected: true,
          promoteFrom: STG,
        },
      ],
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

// --- harness ----------------------------------------------------------------------------------------

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly definitions: FakeDefinitionStore;
  readonly commands: FakeCommandRunner;
  readonly evidence: FakeEvidenceChecker;
  readonly transports: FakeTransportResolver;
  readonly forges: ForgeResolver;
}

const makeHarness = (): Harness => {
  const clock = createFakeClock(T0);
  const log = createFakeEventLog();
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(definitionsBody()));
  const commands = createFakeCommandRunner();
  const evidence = createFakeEvidenceChecker();
  const transports = createFakeTransportResolver();
  const forge = createFakeForge({ checks: ALL_GREEN });
  const forges: ForgeResolver = { forRepo: async () => forge };
  definitions.setProject({ id: slugOf<'project'>('ws-proj'), name: 'Project', mainRepo: slugOf<'repo'>('ws'), repos: [slugOf<'repo'>('ws')] });
  const deps = createFakeDeps({ clock, log, definitions, commands, evidence, transports });
  deps.projects.save({ id: slugOf<'project'>('ws-proj'), name: 'Project', mainRepo: slugOf<'repo'>('ws'), repos: [slugOf<'repo'>('ws')] });
  return { deps, clock, log, definitions, commands, evidence, transports, forges };
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

  const routed = await resolveRoute(h.deps, { repo: REPO_SLUG, workOrderId: id, role: view.next.role });
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
    cwd: `/fake/worktrees/${REPO_SLUG}/${id}`,
    capabilities: [],
  });
};

/** The deployment_attempted events of the work order's history, in order. */
const deploymentAttempts = (events: readonly WorkOrderEvent[]) =>
  events.filter((event): event is Extract<WorkOrderEvent, { readonly type: 'deployment_attempted' }> => {
    return event.type === 'deployment_attempted';
  });

// --- the Phase 2c scenario --------------------------------------------------------------------------

describe('standard flow with environments, headless end to end', () => {
  it('E-19: deploys stg, passes the remote_checks gate on all-green forge checks, then promotes the same commit to the protected prd', async () => {
    const h = makeHarness();
    await h.deps.accounts.save(account(MAIN));
    h.transports.register(MAIN, createFakeTransport(completedScript()));
    await bindRole(h.deps, slugOf<'role'>('planner'), MAIN);
    await bindRole(h.deps, slugOf<'role'>('developer'), MAIN);
    await bindRole(h.deps, slugOf<'role'>('reviewer'), MAIN);
    // Both environments' secrets sit in the vault; the stg verify tail leaks them on purpose so
    // the recorded events must prove the redaction, and the scanner clears the secrets gate.
    await h.deps.secrets.put(STG_TOKEN_REF, STG_TOKEN);
    await h.deps.secrets.put(PRD_TOKEN_REF, PRD_TOKEN);
    h.commands.script(TEST_COMMAND, { exitCode: 0, durationMs: 12, outputTail: 'ok' });
    h.commands.script(VERIFY_STG_COMMAND, {
      exitCode: 0,
      durationMs: 8,
      outputTail: `verify saw channel=${STG_CHANNEL} token=${STG_TOKEN}`,
    });
    h.evidence.setResolvable(['src/main.ts:1']);

    // 1. open → plan/ready; run; approve → implement/ready; run → gating; machine gates → review.
    const id = await openViaApi(h.deps, 'Ship through the environments');
    expect(id).toBeDefined();
    if (id === undefined) return;
    h.clock.advance(1_000);
    let view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: PLAN, pendingGates: [PLAN_APPROVAL] });

    expect((await runCurrentStage(h, id)).kind).toBe('finished');
    expect((await approveViaApi(h.deps, id, PLAN_APPROVAL)).ok).toBe(true);
    h.clock.advance(1_000);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: IMPLEMENT, pendingGates: [slugOf<'gate'>('tests'), slugOf<'gate'>('secrets')] });

    expect((await runCurrentStage(h, id)).kind).toBe('finished');
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: IMPLEMENT, pendingGates: [slugOf<'gate'>('tests'), slugOf<'gate'>('secrets')] });
    expect((await evaluateMachineGates(h.deps, { id })).ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: REVIEW, pendingGates: [REVIEW_VERDICT, REVIEW_APPROVAL] });

    // 2. the reviewer's verdict and approval open the environment stage.
    expect((await runCurrentStage(h, id)).kind).toBe('finished');
    const reviewerRun = (await h.deps.runs.listForWorkOrder(id)).find((run) => run.stage === REVIEW);
    if (reviewerRun === undefined) throw new Error('the review run must exist');
    const REVIEWER: Actor = { kind: 'agent', runId: reviewerRun.id, role: slugOf<'role'>('reviewer') };
    expect(
      (
        await submitAgentVerdict(h.deps, {
          id,
          gate: REVIEW_VERDICT,
          approve: true,
          pointers: ['src/main.ts:1'],
          actor: REVIEWER,
        })
      ).ok,
    ).toBe(true);
    expect((await approveViaApi(h.deps, id, REVIEW_APPROVAL)).ok).toBe(true);
    h.clock.advance(1_000);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'ready', stage: DEPLOY, pendingGates: [DEPLOY_STG, REMOTE_CHECKS, DEPLOY_PRD] });
    expect(view.next.kind).toBe('start_run');

    // 3. the deploy stage's run completes → gating over the three machine-side gates.
    const deployRun = await runCurrentStage(h, id);
    expect(deployRun).toEqual({ kind: 'finished', outcome: 'succeeded' });
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: DEPLOY, pendingGates: [DEPLOY_STG, REMOTE_CHECKS, DEPLOY_PRD] });

    // 4. the stg deploy: a user approval runs the deploy and verify sets with the environment env.
    const stg = await approveAndDeploy(h.deps, { id, gate: DEPLOY_STG, approver: USER, commit: COMMIT });
    expect(stg.ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: DEPLOY, pendingGates: [REMOTE_CHECKS, DEPLOY_PRD] });

    // 5. the remote_checks gate: evaluateMachineGates polls the fake forge, all checks green.
    const gated = await evaluateMachineGates(h.deps, {
      id,
      remote: { forges: h.forges, repo: REPO, branchRef: BRANCH_REF },
    });
    expect(gated.ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: DEPLOY, pendingGates: [DEPLOY_PRD] });

    // 6. the prd deploy: protected, so confirmed with its own id and promoted from the stg success.
    const prd = await approveAndDeploy(h.deps, {
      id,
      gate: DEPLOY_PRD,
      approver: USER,
      commit: COMMIT,
      confirmedEnvironment: PRD,
    });
    expect(prd.ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'awaiting_human', stage: CLOSE, pendingGates: [CLOSURE] });

    // 7. the closure approval finishes the work order.
    expect((await approveViaApi(h.deps, id, CLOSURE)).ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'done', stage: null, pendingGates: [] });
    expect(view.next.kind).toBe('none');

    // Every command the machine ran, in order: the implement stage's test gate without env, then
    // each environment's deploy and verify sets with their resolved env handed to the runner.
    const WORKTREE = `/fake/worktrees/${REPO_SLUG}/${id}`;
    expect(h.commands.calls()).toEqual([
      { cwd: WORKTREE, command: TEST_COMMAND, timeoutMs: 10 * MINUTE },
      { cwd: WORKTREE, command: DEPLOY_STG_COMMAND, timeoutMs: 10 * MINUTE, env: STG_ENV },
      { cwd: WORKTREE, command: VERIFY_STG_COMMAND, timeoutMs: 10 * MINUTE, env: STG_ENV },
      { cwd: WORKTREE, command: DEPLOY_PRD_COMMAND, timeoutMs: 10 * MINUTE, env: PRD_ENV },
      { cwd: WORKTREE, command: VERIFY_PRD_COMMAND, timeoutMs: 10 * MINUTE, env: PRD_ENV },
    ]);

    // Exactly one deployment_attempted per environment, both successful, both for this commit.
    const events = await h.deps.workOrders.events(id);
    const attempts = deploymentAttempts(events);
    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt) => [attempt.environment, attempt.commit, attempt.result])).toEqual([
      [STG, COMMIT, 'success'],
      [PRD, COMMIT, 'success'],
    ]);
    // The leaky verify tail reached the event redacted, and no environment value or secret ever
    // appears in the events or the audit trail.
    const stgAttempt = attempts[0];
    if (stgAttempt === undefined) throw new Error('the stg attempt must exist');
    expect(stgAttempt.outputTail).toBe('verify saw channel=[env] token=[env]');
    const recorded = `${JSON.stringify(events)}${JSON.stringify(h.log.entries())}`;
    expect(recorded).not.toContain(STG_CHANNEL);
    expect(recorded).not.toContain(STG_TOKEN);
    expect(recorded).not.toContain(PRD_TOKEN);

    // The queue drained, every run closed with an outcome, and the audit trail tells the whole
    // story in order — the two deploy approvals gate.decided like any human gate.
    expect(await h.deps.queue.list()).toEqual([]);
    const runs = await h.deps.runs.listForWorkOrder(id);
    expect(runs.map((run) => run.stage)).toEqual([PLAN, IMPLEMENT, REVIEW, DEPLOY]);
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
      { gate: DEPLOY_STG, decision: 'approved' },
      { gate: DEPLOY_PRD, decision: 'approved' },
      { gate: CLOSURE, decision: 'approved' },
    ]);
  });

  it('E-19: the protected prd deploy refuses to run unconfirmed or without a same-commit stg success', async () => {
    const h = makeHarness();
    await h.deps.accounts.save(account(MAIN));
    h.transports.register(MAIN, createFakeTransport(completedScript()));
    await bindRole(h.deps, slugOf<'role'>('planner'), MAIN);
    await bindRole(h.deps, slugOf<'role'>('developer'), MAIN);
    await bindRole(h.deps, slugOf<'role'>('reviewer'), MAIN);
    await h.deps.secrets.put(STG_TOKEN_REF, STG_TOKEN);
    await h.deps.secrets.put(PRD_TOKEN_REF, PRD_TOKEN);
    h.commands.script(TEST_COMMAND, { exitCode: 0, durationMs: 12, outputTail: 'ok' });
    h.evidence.setResolvable(['src/main.ts:1']);

    // Walk to the environment stage's gating, compactly — the happy path above asserts each step.
    const id = await openViaApi(h.deps, 'Promotion guards');
    expect(id).toBeDefined();
    if (id === undefined) return;
    expect((await runCurrentStage(h, id)).kind).toBe('finished');
    expect((await approveViaApi(h.deps, id, PLAN_APPROVAL)).ok).toBe(true);
    expect((await runCurrentStage(h, id)).kind).toBe('finished');
    expect((await evaluateMachineGates(h.deps, { id })).ok).toBe(true);
    expect((await runCurrentStage(h, id)).kind).toBe('finished');
    const reviewerRun = (await h.deps.runs.listForWorkOrder(id)).find((run) => run.stage === REVIEW);
    if (reviewerRun === undefined) throw new Error('the review run must exist');
    const REVIEWER: Actor = { kind: 'agent', runId: reviewerRun.id, role: slugOf<'role'>('reviewer') };
    expect(
      (
        await submitAgentVerdict(h.deps, {
          id,
          gate: REVIEW_VERDICT,
          approve: true,
          pointers: ['src/main.ts:1'],
          actor: REVIEWER,
        })
      ).ok,
    ).toBe(true);
    expect((await approveViaApi(h.deps, id, REVIEW_APPROVAL)).ok).toBe(true);
    expect((await runCurrentStage(h, id)).kind).toBe('finished');
    let view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: DEPLOY, pendingGates: [DEPLOY_STG, REMOTE_CHECKS, DEPLOY_PRD] });

    // Without the typed confirmation — absent, or naming another environment — nothing runs.
    const unconfirmed = await approveAndDeploy(h.deps, { id, gate: DEPLOY_PRD, approver: USER, commit: COMMIT });
    expect(unconfirmed).toEqual({ ok: false, error: 'confirmation_mismatch' });
    const misconfirmed = await approveAndDeploy(h.deps, {
      id,
      gate: DEPLOY_PRD,
      approver: USER,
      commit: COMMIT,
      confirmedEnvironment: STG,
    });
    expect(misconfirmed).toEqual({ ok: false, error: 'confirmation_mismatch' });

    // Confirmed, but no successful stg deployment of this commit exists yet.
    const premature = await approveAndDeploy(h.deps, {
      id,
      gate: DEPLOY_PRD,
      approver: USER,
      commit: COMMIT,
      confirmedEnvironment: PRD,
    });
    expect(premature).toEqual({ ok: false, error: 'promote_prerequisite_missing' });
    // Only the implement stage's test command has run; the rejected attempts executed nothing.
    expect(h.commands.calls()).toHaveLength(1);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: DEPLOY, pendingGates: [DEPLOY_STG, REMOTE_CHECKS, DEPLOY_PRD] });

    // A stg success for a different commit does not unlock the promotion of this one.
    const stg = await approveAndDeploy(h.deps, { id, gate: DEPLOY_STG, approver: USER, commit: OTHER_COMMIT });
    expect(stg.ok).toBe(true);
    const otherCommit = await approveAndDeploy(h.deps, {
      id,
      gate: DEPLOY_PRD,
      approver: USER,
      commit: COMMIT,
      confirmedEnvironment: PRD,
    });
    expect(otherCommit).toEqual({ ok: false, error: 'promote_prerequisite_missing' });
    expect(h.commands.calls()).toHaveLength(3); // tests + the stg deploy and verify sets
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'gating', stage: DEPLOY, pendingGates: [REMOTE_CHECKS, DEPLOY_PRD] });

    // The same commit on stg is what the promotion accepts.
    const prd = await approveAndDeploy(h.deps, {
      id,
      gate: DEPLOY_PRD,
      approver: USER,
      commit: OTHER_COMMIT,
      confirmedEnvironment: PRD,
    });
    expect(prd.ok).toBe(true);
    // The promotion may land before the remote gate is polled; once the forge reports it green the
    // stage has passed all its gates and the flow moves on.
    const gated = await evaluateMachineGates(h.deps, {
      id,
      remote: { forges: h.forges, repo: REPO, branchRef: BRANCH_REF },
    });
    expect(gated.ok).toBe(true);
    view = await viewOf(h.deps, id);
    expectState(view, { status: 'awaiting_human', stage: CLOSE, pendingGates: [CLOSURE] });
  });
});
