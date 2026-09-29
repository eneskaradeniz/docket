// deploy-gate use case — rules E-11 (approval checks), E-12 (deploy execution) and E-13 (the two
// events a deploy leaves behind) from docs/v2/application.md, driven over the in-memory fakes.
import { describe, expect, it } from 'vitest';

import {
  isUlid,
  parseSlug,
  parseUlid,
  ok,
  type Actor,
  type Definitions,
  type Result,
  type RunId,
  type Slug,
  type Ulid,
  type WorkOrderId,
  type RepoSlug,
} from '../../domain/index';

import type { AppDeps } from '../ports';
import {
  createFakeClock,
  createFakeCommandRunner,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeWorktrees,
  type FakeCommandRunner,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeWorktrees,
} from '../ports/fakes';

import { approveAndDeploy } from './deploy-gate';

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
const WORK_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const RUN_ID: RunId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const WORKTREE_PATH = `/fake/worktrees/ws/${WORK_ORDER}`;

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: RUN_ID, role: slugOf<'role'>('worker') };
const SYSTEM: Actor = { kind: 'system', component: 'dispatcher' };

const COMMIT = '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';

const STG_TOKEN_REF = 'ws/stg/deploy-token';
const PRD_TOKEN_REF = 'ws/prd/api-token';
// Credential-shaped, assembled at runtime so the file itself never carries a secret-looking literal.
const STG_TOKEN = 'AKIA' + 'X'.repeat(16);
const PRD_TOKEN = 'sk-live-' + '9'.repeat(20);

/** One definition file covering every deploy scenario, valid per the domain validators. */
const DEFINITIONS_BODY = {
  roles: [
    { id: 'worker', name: 'Worker', instructions: 'worker instructions', writeScope: { kind: 'repo' }, capabilities: [], active: true },
  ],
  flows: [
    {
      id: 'stg-flow',
      name: 'Staging',
      stages: [{ id: 'ship', name: 'Ship', role: null, exit: [{ kind: 'deploy', id: 'ship-stg', environment: 'stg' }] }],
    },
    {
      id: 'prd-flow',
      name: 'Production',
      stages: [{ id: 'ship', name: 'Ship', role: null, exit: [{ kind: 'deploy', id: 'ship-prd', environment: 'prd' }] }],
    },
    {
      id: 'dev-flow',
      name: 'Development',
      stages: [{ id: 'ship', name: 'Ship', role: null, exit: [{ kind: 'deploy', id: 'ship-dev', environment: 'dev' }] }],
    },
    {
      id: 'promote-flow',
      name: 'Promotion',
      stages: [
        { id: 'stage-stg', name: 'To staging', role: null, exit: [{ kind: 'deploy', id: 'to-stg', environment: 'stg' }] },
        { id: 'stage-prd', name: 'To production', role: null, exit: [{ kind: 'deploy', id: 'to-prd', environment: 'prd' }] },
      ],
    },
    {
      id: 'mixed-flow',
      name: 'Mixed exits',
      stages: [{
        id: 'ship',
        name: 'Ship',
        role: null,
        exit: [
          { kind: 'deploy', id: 'ship-stg', environment: 'stg' },
          { kind: 'human', id: 'signoff', label: 'Signoff' },
        ],
      }],
    },
  ],
  capabilities: [],
  repo: {
    id: 'ws',
    name: 'Repo',
    repos: [],
    flows: ['stg-flow', 'prd-flow', 'dev-flow', 'promote-flow', 'mixed-flow'],
    defaultFlow: 'stg-flow',
    commandSets: {
      'deploy-stg': ['docket-deploy stg'],
      'verify-stg': ['docket-verify stg'],
      'deploy-prd': ['docket-deploy prd'],
      'verify-prd': ['docket-verify prd'],
      'deploy-dev': ['dev-step-one', 'dev-step-two'],
    },
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
    environments: [
      {
        id: 'stg',
        name: 'Staging',
        order: 1,
        deploy: 'deploy-stg',
        verify: 'verify-stg',
        env: { RELEASE_CHANNEL: { literal: 'internal-canary' }, DEPLOY_TOKEN: { secretRef: STG_TOKEN_REF } },
        protected: false,
      },
      {
        id: 'prd',
        name: 'Production',
        order: 2,
        deploy: 'deploy-prd',
        verify: 'verify-prd',
        env: { API_TOKEN: { secretRef: PRD_TOKEN_REF } },
        protected: true,
        promoteFrom: 'stg',
      },
      {
        id: 'dev',
        name: 'Development',
        order: 0,
        deploy: 'deploy-dev',
        env: { REGION: { literal: 'eu-west-1' } },
        protected: false,
      },
    ],
  },
};

interface Harness {
  readonly deps: AppDeps;
  readonly clock: ReturnType<typeof createFakeClock>;
  readonly commands: FakeCommandRunner;
  readonly worktrees: FakeWorktrees;
  readonly definitions: FakeDefinitionStore;
  readonly log: FakeEventLog;
}

const makeHarness = (): Harness => {
  const clock = createFakeClock(1_000);
  const commands = createFakeCommandRunner();
  const worktrees = createFakeWorktrees();
  const definitions = createFakeDefinitionStore();
  const log = createFakeEventLog();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(DEFINITIONS_BODY));
  const deps = createFakeDeps({ clock, commands, worktrees, definitions, log });
  return { deps, clock, commands, worktrees, definitions, log };
};

/** Creates the work order with its `created` event, the way openWorkOrder would have. */
const createIn = async (h: Harness, flow: string): Promise<void> => {
  const flowId = slugOf<'flow'>(flow);
  await h.deps.workOrders.create({
    id: WORK_ORDER,
    repo: REPO,
    flow: flowId,
    title: 'Fixture',
    createdAt: h.clock.now(),
    createdBy: USER,
  });
  await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'created', at: h.clock.now(), by: USER, flow: flowId });
};

const putStgToken = async (h: Harness): Promise<void> => {
  await h.deps.secrets.put(STG_TOKEN_REF, STG_TOKEN);
};

const putPrdToken = async (h: Harness): Promise<void> => {
  await h.deps.secrets.put(PRD_TOKEN_REF, PRD_TOKEN);
};

/** A prior deployment attempt in the work order's history — the promote prerequisite. */
const deployedOn = async (
  h: Harness,
  environment: string,
  commit: string,
  result: 'success' | 'failed',
): Promise<void> => {
  await h.deps.workOrders.appendEvent(WORK_ORDER, {
    type: 'deployment_attempted',
    at: h.clock.now(),
    stage: slugOf('ship'),
    gate: slugOf('ship-stg'),
    environment: slugOf<'env'>(environment),
    commit,
    approvedBy: USER,
    result,
  });
};

const eventsOf = (h: Harness): Promise<readonly unknown[]> => h.deps.workOrders.events(WORK_ORDER);

// --- approveAndDeploy (E-11, E-12, E-13) -------------------------------------------------------------

describe('approveAndDeploy', () => {
  it('E-11: approves and deploys a pending deploy gate of the current stage when the approver is a user', async () => {
    const h = makeHarness();
    await putStgToken(h);
    await createIn(h, 'stg-flow');
    h.clock.advance(100);

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    expect(h.commands.calls()).toEqual([
      {
        cwd: WORKTREE_PATH,
        command: 'docket-deploy stg',
        timeoutMs: 600_000,
        env: { RELEASE_CHANNEL: 'internal-canary', DEPLOY_TOKEN: STG_TOKEN },
      },
      {
        cwd: WORKTREE_PATH,
        command: 'docket-verify stg',
        timeoutMs: 600_000,
        env: { RELEASE_CHANNEL: 'internal-canary', DEPLOY_TOKEN: STG_TOKEN },
      },
    ]);
    expect(await eventsOf(h)).toHaveLength(3);
    expect(h.log.entries()).toHaveLength(1);
    const [audit] = h.log.entries();
    expect(audit).toMatchObject({
      at: 1_100,
      actor: USER,
      action: 'gate.decided',
      subject: { kind: 'work_order', id: WORK_ORDER },
      detail: { gate: 'ship-stg', decision: 'approved' },
    });
    expect(isUlid(audit.id)).toBe(true);
  });

  it('E-11: an unknown work order is not_found', async () => {
    const h = makeHarness();

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(h.commands.calls()).toHaveLength(0);
  });

  it('E-11: definitions that do not load are definitions_invalid', async () => {
    const h = makeHarness();
    h.definitions.seed({ kind: 'global' }, 'broken.json', '{ not json');
    await createIn(h, 'stg-flow');

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result).toEqual({ ok: false, error: 'definitions_invalid' });
    expect(h.commands.calls()).toHaveLength(0);
  });

  it('E-11: a deploy gate of a stage that is not the current stage is not_current_stage', async () => {
    const h = makeHarness();
    await putStgToken(h);
    await putPrdToken(h);
    await createIn(h, 'promote-flow');

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('to-prd'),
      approver: USER,
      commit: COMMIT,
      confirmedEnvironment: slugOf<'env'>('prd'),
    });

    expect(result).toEqual({ ok: false, error: 'not_current_stage' });
    expect(h.commands.calls()).toHaveLength(0);
    expect(await eventsOf(h)).toHaveLength(1);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('E-11: a deploy gate of the current stage that is no longer pending is not_pending', async () => {
    const h = makeHarness();
    await createIn(h, 'mixed-flow');
    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'gate_evaluated',
      at: h.clock.now(),
      stage: slugOf('ship'),
      gate: slugOf('ship-stg'),
      verdict: { status: 'passed' },
    });

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result).toEqual({ ok: false, error: 'not_pending' });
    expect(h.commands.calls()).toHaveLength(0);
  });

  it('E-11: a gate that is not a deploy gate is not_a_deploy_gate', async () => {
    const h = makeHarness();
    await createIn(h, 'mixed-flow');

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('signoff'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result).toEqual({ ok: false, error: 'not_a_deploy_gate' });
    expect(h.commands.calls()).toHaveLength(0);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('E-11: an approver that is not a user gets no_approval', async () => {
    const h = makeHarness();
    await putStgToken(h);
    await createIn(h, 'stg-flow');

    const byAgent = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: AGENT,
      commit: COMMIT,
    });
    const bySystem = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: SYSTEM,
      commit: COMMIT,
    });

    expect(byAgent).toEqual({ ok: false, error: 'no_approval' });
    expect(bySystem).toEqual({ ok: false, error: 'no_approval' });
    expect(h.commands.calls()).toHaveLength(0);
    expect(await eventsOf(h)).toHaveLength(1);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('E-11: a protected environment without the matching confirmedEnvironment is confirmation_mismatch', async () => {
    const h = makeHarness();
    await putPrdToken(h);
    await createIn(h, 'prd-flow');
    await deployedOn(h, 'stg', COMMIT, 'success');

    const absent = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-prd'),
      approver: USER,
      commit: COMMIT,
    });
    const wrong = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-prd'),
      approver: USER,
      commit: COMMIT,
      confirmedEnvironment: slugOf<'env'>('stg'),
    });

    expect(absent).toEqual({ ok: false, error: 'confirmation_mismatch' });
    expect(wrong).toEqual({ ok: false, error: 'confirmation_mismatch' });
    expect(h.commands.calls()).toHaveLength(0);
    expect(await eventsOf(h)).toHaveLength(2); // created + the seeded prerequisite attempt
  });

  it('E-11: a protected environment deploys when the confirmation matches and the same commit succeeded on the prerequisite', async () => {
    const h = makeHarness();
    await putPrdToken(h);
    await createIn(h, 'prd-flow');
    await deployedOn(h, 'stg', COMMIT, 'success');
    h.clock.advance(40);

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-prd'),
      approver: USER,
      commit: COMMIT,
      confirmedEnvironment: slugOf<'env'>('prd'),
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    expect(h.commands.calls()).toEqual([
      {
        cwd: WORKTREE_PATH,
        command: 'docket-deploy prd',
        timeoutMs: 600_000,
        env: { API_TOKEN: PRD_TOKEN },
      },
      {
        cwd: WORKTREE_PATH,
        command: 'docket-verify prd',
        timeoutMs: 600_000,
        env: { API_TOKEN: PRD_TOKEN },
      },
    ]);
  });

  it('E-11: an environment missing from the repo definition is unknown_environment', async () => {
    const h = makeHarness();
    // Validated definitions cannot name an unknown environment, so this arm is reached only with
    // definitions that were never validated: a store stub answers with hand-built ones.
    const ghost: Definitions = {
      roles: [],
      flows: [{
        id: slugOf<'flow'>('ghost-flow'),
        name: 'Ghost',
        stages: [{
          id: slugOf<'stage'>('ship'),
          name: 'Ship',
          role: null,
          exit: [{ kind: 'deploy', id: slugOf<'gate'>('ship-ghost'), environment: slugOf<'env'>('ghost') }],
        }],
      }],
      capabilities: [],
      repo: {
        id: REPO,
        name: 'Repo',
        flows: [slugOf<'flow'>('ghost-flow')],
        defaultFlow: slugOf<'flow'>('ghost-flow'),
        commandSets: {},
        roleOverrides: [],
        docsRoot: 'docs',
        testGlobs: [],
        environments: [],
      },
    };
    const deps: AppDeps = { ...h.deps, definitions: { ...h.deps.definitions, load: async () => ok(ghost) } };
    await createIn(h, 'ghost-flow');

    const result = await approveAndDeploy(deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-ghost'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result).toEqual({ ok: false, error: 'unknown_environment' });
    expect(h.commands.calls()).toHaveLength(0);
  });

  it('E-11: a repo without a checkout on this machine is no_repo', async () => {
    const h = makeHarness();
    await putStgToken(h);
    h.worktrees.markNoRepo(REPO);
    await createIn(h, 'stg-flow');

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result).toEqual({ ok: false, error: 'no_repo' });
    expect(h.commands.calls()).toHaveLength(0);
    expect(await eventsOf(h)).toHaveLength(1);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('E-11: promoting without a same-commit success on the prerequisite environment is promote_prerequisite_missing', async () => {
    const h = makeHarness();
    await putPrdToken(h);
    await createIn(h, 'prd-flow');

    const withoutHistory = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-prd'),
      approver: USER,
      commit: COMMIT,
      confirmedEnvironment: slugOf<'env'>('prd'),
    });
    expect(withoutHistory).toEqual({ ok: false, error: 'promote_prerequisite_missing' });

    await deployedOn(h, 'stg', '0000000000000000000000000000000', 'success');
    const otherCommit = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-prd'),
      approver: USER,
      commit: COMMIT,
      confirmedEnvironment: slugOf<'env'>('prd'),
    });
    expect(otherCommit).toEqual({ ok: false, error: 'promote_prerequisite_missing' });

    await deployedOn(h, 'stg', COMMIT, 'failed');
    const failedAttempt = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-prd'),
      approver: USER,
      commit: COMMIT,
      confirmedEnvironment: slugOf<'env'>('prd'),
    });
    expect(failedAttempt).toEqual({ ok: false, error: 'promote_prerequisite_missing' });

    expect(h.commands.calls()).toHaveLength(0);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('E-12: runs every command of the deploy set in order with the environment env, succeeding without a verify set', async () => {
    const h = makeHarness();
    await createIn(h, 'dev-flow');

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-dev'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    expect(h.commands.calls()).toEqual([
      { cwd: WORKTREE_PATH, command: 'dev-step-one', timeoutMs: 600_000, env: { REGION: 'eu-west-1' } },
      { cwd: WORKTREE_PATH, command: 'dev-step-two', timeoutMs: 600_000, env: { REGION: 'eu-west-1' } },
    ]);
    const events = await eventsOf(h);
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({ type: 'gate_evaluated', verdict: { status: 'passed' } });
  });

  it('E-12: an unresolvable secretRef fails the deployment without running any command', async () => {
    const h = makeHarness();
    await createIn(h, 'stg-flow');

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(result.value.blockedReason).toBe('gate "ship-stg" failed: deploy to "stg" failed');
    expect(h.commands.calls()).toHaveLength(0);
    const events = await eventsOf(h);
    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({ type: 'deployment_attempted', result: 'failed' });
    expect(events[2]).toMatchObject({
      type: 'gate_evaluated',
      verdict: { status: 'failed', reason: 'deploy to "stg" failed' },
    });
  });

  it('E-12: verify runs only after the deploy command set exited zero', async () => {
    const h = makeHarness();
    await putStgToken(h);
    h.commands.script('docket-deploy stg', { exitCode: 1, durationMs: 3, outputTail: 'deploy exploded' });
    await createIn(h, 'stg-flow');

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(h.commands.calls()).toEqual([{
      cwd: WORKTREE_PATH,
      command: 'docket-deploy stg',
      timeoutMs: 600_000,
      env: { RELEASE_CHANNEL: 'internal-canary', DEPLOY_TOKEN: STG_TOKEN },
    }]);
    const events = await eventsOf(h);
    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({ type: 'deployment_attempted', result: 'failed', outputTail: 'deploy exploded' });
  });

  it('E-12: a failed command in the deploy set fails the deployment after the whole set ran', async () => {
    const h = makeHarness();
    h.commands.script('dev-step-one', { exitCode: 1, durationMs: 2, outputTail: 'nope' });
    await createIn(h, 'dev-flow');

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-dev'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(result.value.blockedReason).toBe('gate "ship-dev" failed: deploy to "dev" failed');
    expect(h.commands.calls().map((call) => call.command)).toEqual(['dev-step-one', 'dev-step-two']);
    const events = await eventsOf(h);
    expect(events[1]).toMatchObject({ type: 'deployment_attempted', result: 'failed', outputTail: 'nope' });
  });

  it('E-12: a failing verify fails the deployment even though deploy exited zero', async () => {
    const h = makeHarness();
    await putStgToken(h);
    h.commands.script('docket-verify stg', { exitCode: 1, durationMs: 5, outputTail: 'health check red' });
    await createIn(h, 'stg-flow');

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(result.value.blockedReason).toBe('gate "ship-stg" failed: deploy to "stg" failed');
    expect(h.commands.calls().map((call) => call.command)).toEqual(['docket-deploy stg', 'docket-verify stg']);
    const events = await eventsOf(h);
    expect(events[1]).toMatchObject({ type: 'deployment_attempted', result: 'failed', outputTail: 'health check red' });
  });

  it('E-13: appends exactly one deployment_attempted and one gate_evaluated event after a successful deploy', async () => {
    const h = makeHarness();
    await putStgToken(h);
    await createIn(h, 'stg-flow');
    h.clock.advance(100);

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result.ok).toBe(true);
    const events = await eventsOf(h);
    expect(events).toHaveLength(3);
    expect(events[1]).toEqual({
      type: 'deployment_attempted',
      at: 1_100,
      stage: slugOf('ship'),
      gate: slugOf('ship-stg'),
      environment: slugOf<'env'>('stg'),
      commit: COMMIT,
      approvedBy: USER,
      result: 'success',
      outputTail: '',
    });
    expect(events[2]).toEqual({
      type: 'gate_evaluated',
      at: 1_100,
      stage: slugOf('ship'),
      gate: slugOf('ship-stg'),
      verdict: { status: 'passed' },
    });
  });

  it('E-13: environment values and secrets never appear in the deployment_attempted event or its output tail', async () => {
    const h = makeHarness();
    await putStgToken(h);
    const leakyTail = `verify saw channel=internal-canary token=${STG_TOKEN}`;
    h.commands.script('docket-verify stg', { exitCode: 0, durationMs: 1, outputTail: leakyTail });
    await createIn(h, 'stg-flow');

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: COMMIT,
    });

    expect(result.ok).toBe(true);
    const events = await eventsOf(h);
    expect(events).toHaveLength(3);
    const serialized = JSON.stringify(events[1]);
    expect(serialized).not.toContain('internal-canary');
    expect(serialized).not.toContain(STG_TOKEN);
    expect(JSON.stringify(h.log.entries())).not.toContain(STG_TOKEN);
  });
});

// Guards against accidental shape drift of the Result values the use case returns.
describe('deploy gate use case results', () => {
  it('returns Result values only (ok true with a value, or ok false with a code)', async () => {
    const h = makeHarness();
    await createIn(h, 'stg-flow');
    const results: readonly Result<unknown, string>[] = [
      await approveAndDeploy(h.deps, { id: WORK_ORDER, gate: slugOf('ship-stg'), approver: USER, commit: COMMIT }),
      await approveAndDeploy(h.deps, { id: WORK_ORDER, gate: slugOf('signoff'), approver: USER, commit: COMMIT }),
    ];
    for (const result of results) {
      expect(result.ok).toBeTypeOf('boolean');
      if (result.ok) expect(Object.keys(result)).toEqual(['ok', 'value']);
      else expect(Object.keys(result)).toEqual(['ok', 'error']);
    }
  });
});
