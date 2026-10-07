// gates use cases — rules A-8 (decideHumanGate), A-9 (evaluateMachineGates), A-9a
// (submitAgentVerdict) and E-18 (evaluateMachineGates polling remote_checks gates; the GateContext
// environments invariant) from docs/v2/application.md, driven over the in-memory port fakes.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  isUlid,
  err,
  type Actor,
  type RepoRef,
  type Result,
  type RunId,
  type Slug,
  type StageSlug,
  type Ulid,
  type WorkOrderId,
  type RepoSlug,
} from '../../domain/index';

import type { AppDeps, CheckRun, Forge, ForgeResolver } from '../ports';
import {
  createFakeClock,
  createFakeCommandRunner,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeEvidenceChecker,
  createFakeForge,
  createFakeSecretScanner,
  createFakeWorktrees,
  type FakeCommandRunner,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeEvidenceChecker,
  type FakeSecretScanner,
  type FakeWorktrees,
} from '../ports/fakes';

import { approveAndDeploy } from './deploy-gate';
import { decideHumanGate, evaluateMachineGates, submitAgentVerdict } from './gates';

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
const WORK_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const RUN_ID: RunId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const WORKTREE_PATH = `/fake/worktrees/ws/${WORK_ORDER}`;

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const REVIEWER_AGENT: Actor = { kind: 'agent', runId: RUN_ID, role: slugOf<'role'>('reviewer') };
const WORKER_AGENT: Actor = { kind: 'agent', runId: RUN_ID, role: slugOf<'role'>('worker') };

const CHECK_COMMANDS = ['npm ci', 'npm test', 'npm run lint'] as const;

/** One definition file covering every gate kind, so each test picks the flow it needs. */
const DEFINITIONS_BODY = {
  roles: [
    { id: 'worker', name: 'Worker', instructions: 'worker instructions', writeScope: { kind: 'repo' }, capabilities: [], active: true },
    { id: 'reviewer', name: 'Reviewer', instructions: 'reviewer instructions', writeScope: { kind: 'none' }, capabilities: [], active: true },
  ],
  flows: [
    {
      id: 'human-flow',
      name: 'Human',
      stages: [{ id: 'check', name: 'Check', role: null, exit: [{ kind: 'human', id: 'approve-me', label: 'Approve me' }] }],
    },
    {
      id: 'two-gates',
      name: 'Two gates',
      stages: [{
        id: 'check',
        name: 'Check',
        role: null,
        exit: [
          { kind: 'human', id: 'first-gate', label: 'First' },
          { kind: 'human', id: 'second-gate', label: 'Second' },
        ],
      }],
    },
    {
      id: 'later-stage',
      name: 'Later stage',
      stages: [
        { id: 'first', name: 'First', role: null, exit: [{ kind: 'human', id: 'first-approval', label: 'First approval' }] },
        { id: 'second', name: 'Second', role: null, exit: [{ kind: 'human', id: 'second-approval', label: 'Second approval' }] },
      ],
    },
    {
      id: 'page-flow',
      name: 'Page',
      stages: [{ id: 'research', name: 'Research', role: null, exit: [{ kind: 'page_approval', id: 'findings', label: 'Findings' }] }],
    },
    {
      id: 'cmd-flow',
      name: 'Command',
      stages: [{ id: 'build', name: 'Build', role: 'worker', exit: [{ kind: 'command', id: 'run-checks', commandSet: 'checks' }] }],
    },
    {
      id: 'scan-flow',
      name: 'Scan',
      stages: [{ id: 'build', name: 'Build', role: 'worker', exit: [{ kind: 'secret_scan', id: 'secrets' }] }],
    },
    {
      id: 'both-flow',
      name: 'Both',
      stages: [{
        id: 'build',
        name: 'Build',
        role: 'worker',
        exit: [
          { kind: 'command', id: 'run-checks', commandSet: 'checks' },
          { kind: 'secret_scan', id: 'secrets' },
        ],
      }],
    },
    {
      id: 'verdict-flow',
      name: 'Verdict',
      stages: [{
        id: 'review',
        name: 'Review',
        role: 'reviewer',
        exit: [
          { kind: 'agent_verdict', id: 'review-verdict', role: 'reviewer' },
          { kind: 'human', id: 'review-approval', label: 'Review approval' },
        ],
      }],
    },
    {
      id: 'remote-flow',
      name: 'Remote checks',
      stages: [{
        id: 'verify',
        name: 'Verify',
        role: 'worker',
        exit: [{ kind: 'remote_checks', id: 'ci', required: 'all', timeoutMinutes: 10 }],
      }],
    },
    {
      id: 'remote-after-commands',
      name: 'Commands then remote checks',
      stages: [{
        id: 'build',
        name: 'Build',
        role: 'worker',
        exit: [
          { kind: 'command', id: 'run-checks', commandSet: 'checks' },
          { kind: 'remote_checks', id: 'ci', required: 'all', timeoutMinutes: 10 },
        ],
      }],
    },
    {
      id: 'two-remote-flow',
      name: 'Two remote checks',
      stages: [{
        id: 'verify',
        name: 'Verify',
        role: 'worker',
        exit: [
          { kind: 'remote_checks', id: 'ci', required: 'all', timeoutMinutes: 10 },
          { kind: 'remote_checks', id: 'qa', required: 'all', timeoutMinutes: 10 },
        ],
      }],
    },
    {
      id: 'deploy-mixed-flow',
      name: 'Command then deploy',
      stages: [{
        id: 'build',
        name: 'Build',
        role: 'worker',
        exit: [
          { kind: 'command', id: 'run-checks', commandSet: 'checks' },
          { kind: 'deploy', id: 'deploy-stg', environment: 'stg' },
        ],
      }],
    },
    {
      id: 'deploy-flow',
      name: 'Deploy',
      stages: [{ id: 'ship', name: 'Ship', role: 'worker', exit: [{ kind: 'deploy', id: 'ship-stg', environment: 'stg' }] }],
    },
  ],
  capabilities: [],
  repo: {
    id: 'ws',
    name: 'Repo',
    repos: [],
    flows: [
      'human-flow', 'two-gates', 'later-stage', 'page-flow', 'cmd-flow', 'scan-flow', 'both-flow',
      'verdict-flow', 'remote-flow', 'remote-after-commands', 'two-remote-flow', 'deploy-mixed-flow', 'deploy-flow',
    ],
    defaultFlow: 'human-flow',
    commandSets: { checks: [...CHECK_COMMANDS], 'deploy-stg': ['docket-deploy stg'] },
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
    environments: [
      { id: 'stg', name: 'Staging', order: 1, deploy: 'deploy-stg', env: {}, protected: false },
    ],
  },
};

interface Harness {
  readonly deps: AppDeps;
  readonly clock: ReturnType<typeof createFakeClock>;
  readonly commands: FakeCommandRunner;
  readonly scanner: FakeSecretScanner;
  readonly worktrees: FakeWorktrees;
  readonly evidence: FakeEvidenceChecker;
  readonly definitions: FakeDefinitionStore;
  readonly log: FakeEventLog;
}

const makeHarness = (): Harness => {
  const clock = createFakeClock(1_000);
  const commands = createFakeCommandRunner();
  const scanner = createFakeSecretScanner();
  const worktrees = createFakeWorktrees();
  const evidence = createFakeEvidenceChecker();
  const definitions = createFakeDefinitionStore();
  const log = createFakeEventLog();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(DEFINITIONS_BODY));
  const deps = createFakeDeps({ clock, commands, secretScanner: scanner, worktrees, evidence, definitions, log });
  return { deps, clock, commands, scanner, worktrees, evidence, definitions, log };
};

/** Creates the work order with its `created` event, the way openWorkOrder would have. */
const createIn = async (h: Harness, flow: string): Promise<void> => {
  const flowId = slugOf<'flow'>(flow);
  await h.deps.workOrders.create({
    id: WORK_ORDER,
    project: slugOf<'project'>('proj'),
    repo: REPO_SLUG,
    flow: flowId,
    title: 'Fixture',
    createdAt: h.clock.now(),
    createdBy: USER,
  });
  await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'created', at: h.clock.now(), by: USER, flow: flowId });
};

/** Drives the current stage to `gating` the way a succeeded stage run would have. */
const runSucceededIn = async (h: Harness, stage: StageSlug): Promise<void> => {
  await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'run_started', at: h.clock.now(), runId: RUN_ID, stage, attempt: 1 });
  await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'run_finished', at: h.clock.now(), runId: RUN_ID, outcome: 'succeeded' });
};

const eventsOf = (h: Harness): Promise<readonly unknown[]> => h.deps.workOrders.events(WORK_ORDER);

const failingCommand = { exitCode: 1, durationMs: 4, outputTail: 'broken' };

// --- remote-checks fixtures (E-18) -------------------------------------------------------------------

const REPO: RepoRef = { id: 'repo-1', remote: 'https://forge.example/ws/app.git', defaultBranch: 'main' };
const BRANCH_REF = 'feature/shine';

const check = (name: string, status: CheckRun['status']): CheckRun => ({ name, status });

/** The fake forge with its `checks` wrapped, so a test can see the repo and ref it was polled with. */
const trackingForge = (checks: readonly CheckRun[]): {
  readonly forge: Forge;
  readonly seen: readonly { readonly repo: RepoRef; readonly ref: string }[];
} => {
  const base = createFakeForge({ checks });
  const seen: { repo: RepoRef; ref: string }[] = [];
  return {
    seen,
    forge: {
      ...base,
      checks: async (repo, ref) => {
        seen.push({ repo, ref });
        return base.checks(repo, ref);
      },
    },
  };
};

/** A resolver that hands out `forge` for every repo and records what it was asked to resolve. */
const resolverFor = (forge: Forge | undefined): {
  readonly resolver: ForgeResolver;
  readonly asked: readonly RepoRef[];
} => {
  const asked: RepoRef[] = [];
  return { asked, resolver: { forRepo: async (repo) => { asked.push(repo); return forge; } } };
};

/** A forge whose checks call errors — any errored call reads as an unreachable forge. */
const failingForge = (): Forge => ({ ...createFakeForge(), checks: async () => err('network') });

// --- decideHumanGate (A-8) --------------------------------------------------------------------------

describe('decideHumanGate', () => {
  it('A-8: approves a pending human gate of the current stage, appending one gate_evaluated event and one audit entry', async () => {
    const h = makeHarness();
    await createIn(h, 'human-flow');
    h.clock.advance(50);

    const result = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('approve-me'),
      decision: 'approved',
      note: 'looks good',
      actor: USER,
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    const events = await eventsOf(h);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: 'gate_evaluated',
      at: 1_050,
      stage: slugOf('check'),
      gate: slugOf('approve-me'),
      verdict: { status: 'passed' },
    });
    expect(h.log.entries()).toHaveLength(1);
    const [audit] = h.log.entries();
    expect(audit).toMatchObject({
      at: 1_050,
      actor: USER,
      action: 'gate.decided',
      subject: { kind: 'work_order', id: WORK_ORDER },
      detail: { gate: 'approve-me', decision: 'approved' },
    });
    expect(isUlid(audit.id)).toBe(true);
  });

  it('A-8: rejecting fails the gate with the note as the reason and blocks the work order', async () => {
    const h = makeHarness();
    await createIn(h, 'human-flow');

    const result = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('approve-me'),
      decision: 'rejected',
      note: 'needs more detail',
      actor: USER,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(result.value.blockedReason).toBe('gate "approve-me" failed: needs more detail');
    const events = await eventsOf(h);
    expect(events[1]).toMatchObject({ verdict: { status: 'failed', reason: 'needs more detail' } });
  });

  it('A-8: rejecting without a note fails with the reason "rejected"', async () => {
    const h = makeHarness();
    await createIn(h, 'human-flow');

    const result = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('approve-me'),
      decision: 'rejected',
      actor: USER,
    });

    expect(result.ok).toBe(true);
    const events = await eventsOf(h);
    expect(events[1]).toMatchObject({ verdict: { status: 'failed', reason: 'rejected' } });
  });

  it('A-8: decides a page_approval gate of the current stage through page approval evidence', async () => {
    const h = makeHarness();
    await createIn(h, 'page-flow');

    const result = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('findings'),
      decision: 'approved',
      actor: USER,
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    const events = await eventsOf(h);
    expect(events[1]).toMatchObject({ type: 'gate_evaluated', gate: 'findings', verdict: { status: 'passed' } });
  });

  it('A-8: a gate that does not belong to the current stage is not_current_stage', async () => {
    const h = makeHarness();
    await createIn(h, 'later-stage');

    const result = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('second-approval'),
      decision: 'approved',
      actor: USER,
    });

    expect(result).toEqual({ ok: false, error: 'not_current_stage' });
    expect(await eventsOf(h)).toHaveLength(1);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-8: a pending human gate while the stage merely waits to start (ready) is not_pending and appends nothing', async () => {
    const h = makeHarness();
    // The review stage has a role, so entry settles at ready with every exit gate pre-filled as
    // pending — the exact standing a fresh work order's detail screen renders.
    await createIn(h, 'verdict-flow');

    const result = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-approval'),
      decision: 'approved',
      actor: USER,
    });

    expect(result).toEqual({ ok: false, error: 'not_pending' });
    // Only `created` remains: a decision the fold cannot apply yet must not become a dead fact.
    expect(await eventsOf(h)).toHaveLength(1);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-8: a gate that is no longer pending is not_pending', async () => {
    const h = makeHarness();
    await createIn(h, 'two-gates');
    const first = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('first-gate'),
      decision: 'approved',
      actor: USER,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value).toMatchObject({ status: 'awaiting_human', pendingGates: ['second-gate'] });

    const again = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('first-gate'),
      decision: 'approved',
      actor: USER,
    });

    expect(again).toEqual({ ok: false, error: 'not_pending' });
  });

  it('A-8: a machine gate of the current stage is not_a_human_gate', async () => {
    const h = makeHarness();
    await createIn(h, 'cmd-flow');
    await runSucceededIn(h, slugOf('build'));

    const result = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('run-checks'),
      decision: 'approved',
      actor: USER,
    });

    expect(result).toEqual({ ok: false, error: 'not_a_human_gate' });
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-8: an agent actor cannot decide a human gate', async () => {
    const h = makeHarness();
    await createIn(h, 'human-flow');

    const result = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('approve-me'),
      decision: 'approved',
      actor: WORKER_AGENT,
    });

    expect(result).toEqual({ ok: false, error: 'agent_cannot_decide' });
    expect(await eventsOf(h)).toHaveLength(1);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-8: an unknown work order is not_found', async () => {
    const h = makeHarness();

    const result = await decideHumanGate(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('approve-me'),
      decision: 'approved',
      actor: USER,
    });

    expect(result).toEqual({ ok: false, error: 'not_found' });
  });
});

// --- evaluateMachineGates (A-9) ---------------------------------------------------------------------

describe('evaluateMachineGates', () => {
  it('A-9: only evaluates when the status is gating', async () => {
    const h = makeHarness();
    await createIn(h, 'cmd-flow');

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({ ok: false, error: 'not_gating' });
    expect(h.commands.calls()).toHaveLength(0);
    expect(await eventsOf(h)).toHaveLength(1);
  });

  it('A-9: an unknown work order is not_found', async () => {
    const h = makeHarness();

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('A-9: definitions that do not load are definitions_invalid', async () => {
    const h = makeHarness();
    h.definitions.seed({ kind: 'global' }, 'broken.json', '{ not json');
    await createIn(h, 'cmd-flow');
    await runSucceededIn(h, slugOf('build'));

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({ ok: false, error: 'definitions_invalid' });
    expect(h.commands.calls()).toHaveLength(0);
  });

  it('A-9: a repo without a checkout on this machine is no_repo', async () => {
    const h = makeHarness();
    h.worktrees.markNoRepo(REPO_SLUG);
    await createIn(h, 'cmd-flow');
    await runSucceededIn(h, slugOf('build'));

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({ ok: false, error: 'no_repo' });
    expect(h.commands.calls()).toHaveLength(0);
    expect(h.scanner.calls()).toHaveLength(0);
  });

  it('A-9: runs every command of the set in order in the work order worktree and passes when all exit zero', async () => {
    const h = makeHarness();
    await createIn(h, 'cmd-flow');
    await runSucceededIn(h, slugOf('build'));

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    expect(h.commands.calls()).toEqual(CHECK_COMMANDS.map((command) => ({
      cwd: WORKTREE_PATH,
      command,
      timeoutMs: 600_000,
    })));
    const events = await eventsOf(h);
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual({
      type: 'gate_evaluated',
      at: 1_000,
      stage: slugOf('build'),
      gate: slugOf('run-checks'),
      verdict: { status: 'passed' },
    });
  });

  it('A-9: a command set of 3 where the 2nd exits 1 records one gate_evaluated naming that command, and all 3 commands ran', async () => {
    const h = makeHarness();
    h.commands.script('npm test', failingCommand);
    await createIn(h, 'cmd-flow');
    await runSucceededIn(h, slugOf('build'));

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(result.value.blockedReason).toBe('gate "run-checks" failed: command failed (exit 1): npm test');
    expect(h.commands.calls()).toHaveLength(3);
    const events = await eventsOf(h);
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual({
      type: 'gate_evaluated',
      at: 1_000,
      stage: slugOf('build'),
      gate: slugOf('run-checks'),
      verdict: { status: 'failed', reason: 'command failed (exit 1): npm test' },
    });
  });

  it('A-9: a clean secret scan passes the gate', async () => {
    const h = makeHarness();
    await createIn(h, 'scan-flow');
    await runSucceededIn(h, slugOf('build'));

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    expect(h.scanner.calls()).toEqual([WORKTREE_PATH]);
    const events = await eventsOf(h);
    expect(events[3]).toMatchObject({ gate: 'secrets', verdict: { status: 'passed' } });
  });

  it('A-9: a secret scan with findings fails the gate', async () => {
    const h = makeHarness();
    h.scanner.setFindings(2);
    await createIn(h, 'scan-flow');
    await runSucceededIn(h, slugOf('build'));

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    const events = await eventsOf(h);
    expect(events[3]).toMatchObject({
      gate: 'secrets',
      verdict: { status: 'failed', reason: 'secret scan found 2 findings' },
    });
  });

  it('A-9: evaluates the pending machine gates in stage order, appending one gate_evaluated per gate', async () => {
    const h = makeHarness();
    await createIn(h, 'both-flow');
    await runSucceededIn(h, slugOf('build'));

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    const events = await eventsOf(h);
    expect(events).toHaveLength(5);
    expect(events[3]).toMatchObject({ type: 'gate_evaluated', gate: 'run-checks', verdict: { status: 'passed' } });
    expect(events[4]).toMatchObject({ type: 'gate_evaluated', gate: 'secrets', verdict: { status: 'passed' } });
  });

  it('A-9: leaves agent_verdict gates of the current stage untouched', async () => {
    const h = makeHarness();
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'gating',
        stage: slugOf('review'),
        attempt: 1,
        pendingGates: ['review-verdict', 'review-approval'],
      },
    });
    expect(await eventsOf(h)).toHaveLength(3);
    expect(h.commands.calls()).toHaveLength(0);
    expect(h.scanner.calls()).toHaveLength(0);
  });

  it('A-9: stops evaluating once a failed gate leaves the stage, so later machine gates stay pending', async () => {
    const h = makeHarness();
    h.commands.script('npm test', failingCommand);
    await createIn(h, 'both-flow');
    await runSucceededIn(h, slugOf('build'));

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    // The failed command gate blocks the work order; the secret scan never runs and no dead
    // gate_evaluated event is appended for a gate that is no longer pending.
    expect(h.scanner.calls()).toHaveLength(0);
    const events = await eventsOf(h);
    expect(events).toHaveLength(4);
    expect(events[3]).toMatchObject({ gate: 'run-checks' });
  });

  // --- E-18: remote_checks gates through evaluateMachineGates ---------------------------------------

  it('E-18: processes a pending remote_checks gate through pollRemoteChecks when the input carries remote', async () => {
    const h = makeHarness();
    await createIn(h, 'remote-flow');
    await runSucceededIn(h, slugOf('verify'));
    const { forge, seen } = trackingForge([check('lint', 'passed'), check('test', 'passed')]);
    const { resolver, asked } = resolverFor(forge);

    const result = await evaluateMachineGates(h.deps, {
      id: WORK_ORDER,
      remote: { forges: resolver, repo: REPO, branchRef: BRANCH_REF },
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    expect(asked).toEqual([REPO]);
    expect(seen).toEqual([{ repo: REPO, ref: BRANCH_REF }]);
    const events = await eventsOf(h);
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual({
      type: 'gate_evaluated',
      at: 1_000,
      stage: slugOf('verify'),
      gate: slugOf('ci'),
      verdict: { status: 'passed' },
    });
  });

  it('E-18: leaves remote_checks gates pending when the input carries no remote', async () => {
    const h = makeHarness();
    await createIn(h, 'remote-flow');
    await runSucceededIn(h, slugOf('verify'));
    const { forge, seen } = trackingForge([check('lint', 'passed')]);
    const { asked } = resolverFor(forge);

    const result = await evaluateMachineGates(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({
      ok: true,
      value: { status: 'gating', stage: slugOf('verify'), attempt: 1, pendingGates: ['ci'] },
    });
    expect(asked).toHaveLength(0);
    expect(seen).toHaveLength(0);
    expect(await eventsOf(h)).toHaveLength(3);
  });

  it('E-18: never evaluates deploy gates — they stay pending for approveAndDeploy even when every other gate passed', async () => {
    const h = makeHarness();
    await createIn(h, 'deploy-mixed-flow');
    await runSucceededIn(h, slugOf('build'));
    const { forge, seen } = trackingForge([check('lint', 'passed')]);
    const { resolver, asked } = resolverFor(forge);

    const result = await evaluateMachineGates(h.deps, {
      id: WORK_ORDER,
      remote: { forges: resolver, repo: REPO, branchRef: BRANCH_REF },
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'gating', stage: slugOf('build'), attempt: 1, pendingGates: ['deploy-stg'] },
    });
    expect(h.commands.calls()).toHaveLength(3); // the command gate's set ran; no deploy command did
    expect(asked).toHaveLength(0);
    expect(seen).toHaveLength(0);
    const events = await eventsOf(h);
    expect(events).toHaveLength(4);
    expect(events[3]).toMatchObject({ type: 'gate_evaluated', gate: 'run-checks', verdict: { status: 'passed' } });
  });

  it('E-18: processes command and secret_scan gates before polling the stage’s remote_checks gate', async () => {
    const h = makeHarness();
    await createIn(h, 'remote-after-commands');
    await runSucceededIn(h, slugOf('build'));
    const { resolver } = resolverFor(trackingForge([check('lint', 'passed')]).forge);

    const result = await evaluateMachineGates(h.deps, {
      id: WORK_ORDER,
      remote: { forges: resolver, repo: REPO, branchRef: BRANCH_REF },
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    const events = await eventsOf(h);
    expect(events).toHaveLength(5);
    expect(events[3]).toMatchObject({ type: 'gate_evaluated', gate: 'run-checks', verdict: { status: 'passed' } });
    expect(events[4]).toMatchObject({ type: 'gate_evaluated', gate: 'ci', verdict: { status: 'passed' } });
  });

  it('E-18: polls every pending remote_checks gate of the stage once, in stage order', async () => {
    const h = makeHarness();
    await createIn(h, 'two-remote-flow');
    await runSucceededIn(h, slugOf('verify'));
    const { forge, seen } = trackingForge([check('lint', 'passed'), check('e2e', 'passed')]);
    const { resolver, asked } = resolverFor(forge);

    const result = await evaluateMachineGates(h.deps, {
      id: WORK_ORDER,
      remote: { forges: resolver, repo: REPO, branchRef: BRANCH_REF },
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    expect(asked).toEqual([REPO, REPO]);
    expect(seen).toEqual([{ repo: REPO, ref: BRANCH_REF }, { repo: REPO, ref: BRANCH_REF }]);
    const events = await eventsOf(h);
    expect(events).toHaveLength(5);
    expect(events[3]).toMatchObject({ gate: 'ci', verdict: { status: 'passed' } });
    expect(events[4]).toMatchObject({ gate: 'qa', verdict: { status: 'passed' } });
  });

  it('E-18: a poll that cannot conclude yet leaves the remote gate pending without failing the evaluation', async () => {
    const h = makeHarness();
    await createIn(h, 'remote-flow');
    await runSucceededIn(h, slugOf('verify'));
    const { forge, seen } = trackingForge([check('lint', 'running')]);
    const { resolver, asked } = resolverFor(forge);

    const result = await evaluateMachineGates(h.deps, {
      id: WORK_ORDER,
      remote: { forges: resolver, repo: REPO, branchRef: BRANCH_REF },
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'gating', stage: slugOf('verify'), attempt: 1, pendingGates: ['ci'] },
    });
    expect(asked).toEqual([REPO]); // polled exactly once — the dispatcher re-polls later
    expect(seen).toHaveLength(1);
    expect(await eventsOf(h)).toHaveLength(3);
  });

  it('E-18: a forge the poll cannot reach leaves the remote gate pending', async () => {
    const h = makeHarness();
    await createIn(h, 'remote-flow');
    await runSucceededIn(h, slugOf('verify'));
    const { resolver, asked } = resolverFor(failingForge());

    const result = await evaluateMachineGates(h.deps, {
      id: WORK_ORDER,
      remote: { forges: resolver, repo: REPO, branchRef: BRANCH_REF },
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'gating', stage: slugOf('verify'), attempt: 1, pendingGates: ['ci'] },
    });
    expect(asked).toEqual([REPO]);
    expect(await eventsOf(h)).toHaveLength(3);
  });

  it('E-18: a failed remote check fails its gate through the delegated poll', async () => {
    const h = makeHarness();
    await createIn(h, 'remote-flow');
    await runSucceededIn(h, slugOf('verify'));
    const { resolver } = resolverFor(trackingForge([check('lint', 'failed')]).forge);

    const result = await evaluateMachineGates(h.deps, {
      id: WORK_ORDER,
      remote: { forges: resolver, repo: REPO, branchRef: BRANCH_REF },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(result.value.blockedReason).toBe('gate "ci" failed: remote check failed: lint');
  });
});

// --- GateContext environments (E-18) ----------------------------------------------------------------

describe('GateContext environments (E-18)', () => {
  it('E-18: GateContext built by use cases carries environments from the repo definition', async () => {
    const h = makeHarness();
    await createIn(h, 'deploy-flow');
    await runSucceededIn(h, slugOf('ship'));

    const result = await approveAndDeploy(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('ship-stg'),
      approver: USER,
      commit: '9f86d081',
    });

    // A context without the repo environments would judge the deploy gate unknown and block
    // the work order instead of recording the deployment and advancing it.
    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    const events = await eventsOf(h);
    expect(events).toHaveLength(5);
    expect(events[3]).toMatchObject({ type: 'deployment_attempted', environment: 'stg', result: 'success' });
    expect(events[4]).toMatchObject({ type: 'gate_evaluated', gate: 'ship-stg', verdict: { status: 'passed' } });
  });
});

// --- submitAgentVerdict (A-9a) ----------------------------------------------------------------------

describe('submitAgentVerdict', () => {
  it('A-9a: the gate role approving with resolving pointers passes the verdict gate and audits the decision', async () => {
    const h = makeHarness();
    h.evidence.setResolvable(['src/a.ts:12']);
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));
    h.clock.advance(30);

    const result = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-verdict'),
      approve: true,
      pointers: ['src/a.ts:12'],
      actor: REVIEWER_AGENT,
    });

    expect(result).toEqual({
      ok: true,
      value: { status: 'awaiting_human', stage: slugOf('review'), attempt: 1, pendingGates: ['review-approval'] },
    });
    const events = await eventsOf(h);
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual({
      type: 'gate_evaluated',
      at: 1_030,
      stage: slugOf('review'),
      gate: slugOf('review-verdict'),
      verdict: { status: 'passed' },
    });
    expect(h.log.entries()).toHaveLength(1);
    const [audit] = h.log.entries();
    expect(audit).toMatchObject({
      at: 1_030,
      actor: REVIEWER_AGENT,
      action: 'gate.decided',
      subject: { kind: 'work_order', id: WORK_ORDER },
      detail: { gate: 'review-verdict', decision: 'approved' },
    });
    expect(isUlid(audit.id)).toBe(true);
  });

  it('A-9a: an empty pointer list never counts as resolved evidence', async () => {
    const h = makeHarness();
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));

    const result = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-verdict'),
      approve: true,
      pointers: [],
      actor: REVIEWER_AGENT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(result.value.blockedReason).toBe('evidence pointers did not resolve');
    const events = await eventsOf(h);
    expect(events[3]).toMatchObject({ verdict: { status: 'unknown', reason: 'evidence pointers did not resolve' } });
  });

  it('A-9a: pointers that do not resolve make the verdict unknown', async () => {
    const h = makeHarness();
    h.evidence.setResolvable(['src/exists.ts:1']);
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));

    const result = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-verdict'),
      approve: true,
      pointers: ['src/missing.ts:3'],
      actor: REVIEWER_AGENT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
  });

  it('A-9a: rejecting fails the gate and audits a rejected decision', async () => {
    const h = makeHarness();
    h.evidence.setResolvable(['src/a.ts:12']);
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));

    const result = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-verdict'),
      approve: false,
      pointers: ['src/a.ts:12'],
      actor: REVIEWER_AGENT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(result.value.blockedReason).toBe('gate "review-verdict" failed: agent did not approve');
    const [audit] = h.log.entries();
    expect(audit).toMatchObject({ action: 'gate.decided', detail: { gate: 'review-verdict', decision: 'rejected' } });
  });

  it('A-9a: a user actor gets wrong_role', async () => {
    const h = makeHarness();
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));

    const result = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-verdict'),
      approve: true,
      pointers: ['src/a.ts:12'],
      actor: USER,
    });

    expect(result).toEqual({ ok: false, error: 'wrong_role' });
    expect(await eventsOf(h)).toHaveLength(3);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-9a: an agent whose role is not the gate role gets wrong_role', async () => {
    const h = makeHarness();
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));

    const result = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-verdict'),
      approve: true,
      pointers: ['src/a.ts:12'],
      actor: WORKER_AGENT,
    });

    expect(result).toEqual({ ok: false, error: 'wrong_role' });
  });

  it('A-9a: a gate that is not an agent_verdict gate is not_an_agent_gate', async () => {
    const h = makeHarness();
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));

    const result = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-approval'),
      approve: true,
      pointers: ['src/a.ts:12'],
      actor: REVIEWER_AGENT,
    });

    expect(result).toEqual({ ok: false, error: 'not_an_agent_gate' });
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-9a: a verdict gate that is no longer pending is not_pending', async () => {
    const h = makeHarness();
    h.evidence.setResolvable(['src/a.ts:12']);
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));
    const first = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-verdict'),
      approve: true,
      pointers: ['src/a.ts:12'],
      actor: REVIEWER_AGENT,
    });
    expect(first.ok).toBe(true);

    const again = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-verdict'),
      approve: true,
      pointers: ['src/a.ts:12'],
      actor: REVIEWER_AGENT,
    });

    expect(again).toEqual({ ok: false, error: 'not_pending' });
  });

  it('A-9a: a gate that does not belong to the current stage is not_current_stage', async () => {
    const h = makeHarness();
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));

    const result = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('approve-me'),
      approve: true,
      pointers: ['src/a.ts:12'],
      actor: REVIEWER_AGENT,
    });

    expect(result).toEqual({ ok: false, error: 'not_current_stage' });
  });

  it('A-9a: an unknown work order is not_found', async () => {
    const h = makeHarness();

    const result = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-verdict'),
      approve: true,
      pointers: ['src/a.ts:12'],
      actor: REVIEWER_AGENT,
    });

    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('A-9a: a repo without a checkout on this machine is no_repo', async () => {
    const h = makeHarness();
    h.worktrees.markNoRepo(REPO_SLUG);
    h.evidence.setResolvable(['src/a.ts:12']);
    await createIn(h, 'verdict-flow');
    await runSucceededIn(h, slugOf('review'));

    const result = await submitAgentVerdict(h.deps, {
      id: WORK_ORDER,
      gate: slugOf('review-verdict'),
      approve: true,
      pointers: ['src/a.ts:12'],
      actor: REVIEWER_AGENT,
    });

    expect(result).toEqual({ ok: false, error: 'no_repo' });
    expect(await eventsOf(h)).toHaveLength(3);
    expect(h.log.entries()).toHaveLength(0);
  });
});

// Guards against accidental shape drift of the Result values the use cases return.
describe('gate use case results', () => {
  it('returns Result values only (ok true with a value, or ok false with a code)', async () => {
    const h = makeHarness();
    await createIn(h, 'human-flow');
    const results: readonly Result<unknown, string>[] = [
      await decideHumanGate(h.deps, { id: WORK_ORDER, gate: slugOf('approve-me'), decision: 'approved', actor: USER }),
      await evaluateMachineGates(h.deps, { id: WORK_ORDER }),
      await submitAgentVerdict(h.deps, { id: WORK_ORDER, gate: slugOf('approve-me'), approve: true, pointers: [], actor: USER }),
    ];
    for (const result of results) {
      expect(result.ok).toBeTypeOf('boolean');
      if (result.ok) expect(Object.keys(result)).toEqual(['ok', 'value']);
      else expect(Object.keys(result)).toEqual(['ok', 'error']);
    }
  });
});
