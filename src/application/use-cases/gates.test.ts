// gates use cases — rules A-8 (decideHumanGate), A-9 (evaluateMachineGates), A-9a
// (submitAgentVerdict) from docs/v2/application.md, driven over the in-memory port fakes.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  isUlid,
  type Actor,
  type Result,
  type RunId,
  type Slug,
  type StageSlug,
  type Ulid,
  type WorkOrderId,
  type WorkspaceSlug,
} from '../../domain/index';

import type { AppDeps } from '../ports';
import {
  createFakeClock,
  createFakeCommandRunner,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeEvidenceChecker,
  createFakeSecretScanner,
  createFakeWorktrees,
  type FakeCommandRunner,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeEvidenceChecker,
  type FakeSecretScanner,
  type FakeWorktrees,
} from '../ports/fakes';

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

const WORKSPACE: WorkspaceSlug = slugOf('ws');
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
  ],
  capabilities: [],
  workspace: {
    id: 'ws',
    name: 'Workspace',
    repos: [],
    flows: ['human-flow', 'two-gates', 'later-stage', 'page-flow', 'cmd-flow', 'scan-flow', 'both-flow', 'verdict-flow'],
    defaultFlow: 'human-flow',
    commandSets: { checks: [...CHECK_COMMANDS] },
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
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
    workspace: WORKSPACE,
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

  it('A-9: a workspace without a checkout on this machine is no_repo', async () => {
    const h = makeHarness();
    h.worktrees.markNoRepo(WORKSPACE);
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

  it('A-9a: a workspace without a checkout on this machine is no_repo', async () => {
    const h = makeHarness();
    h.worktrees.markNoRepo(WORKSPACE);
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
