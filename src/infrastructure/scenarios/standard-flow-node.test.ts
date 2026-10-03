// scenarios/standard-flow-node.test.ts — the docs/v2/infrastructure.md section-9 acceptance: the
// Phase 2a standard-flow scenario replayed through createApi and the application services, but on
// createNodeDeps over a temporary data folder — SQLite storage, YAML definitions under the global
// root, a throw-away git repo, the real command runner, secret scanner and worktrees — then
// closed and reopened on the same folder to prove everything survived.
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  parseSlug,
  parseUlid,
  type AccountId,
  type Actor,
  type AgentEvent,
  type DispatchLimits,
  type EpochMs,
  type GateSlug,
  type QueueItem,
  type StageSlug,
  type WorkOrderId,
  type RepoSlug,
} from '../../domain/index';

import { createApi } from '../../api/index';
import type { AppDeps } from '../../application/index';
import {
  dispatcherTick,
  enqueueStage,
  evaluateMachineGates,
  executeRun,
  getWorkOrder,
  resolveRoute,
  submitAgentVerdict,
  type PermissionGate,
  type WorkOrderView,
} from '../../application/index';
import {
  createFakeNotifier,
  createFakeTransport,
  createFakeTransportResolver,
  type FakeNotifier,
  type FakeTransportResolver,
} from '../../application/ports/fakes/index';
import { runGit } from '../vcs/index';
import { createNodeDeps, type NodeDeps, type NodeDepsConfig } from '../compose/index';

// --- fixtures ---------------------------------------------------------------------------------------

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const REPO: RepoSlug = slugOf('ws');
const MAIN: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');
const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const PLAN: StageSlug = slugOf<'stage'>('plan');
const IMPLEMENT: StageSlug = slugOf<'stage'>('implement');
const REVIEW: StageSlug = slugOf<'stage'>('review');
const PLAN_APPROVAL: GateSlug = slugOf<'gate'>('plan-approval');
const REVIEW_VERDICT: GateSlug = slugOf<'gate'>('review-verdict');
const REVIEW_APPROVAL: GateSlug = slugOf<'gate'>('review-approval');
const CLOSURE: GateSlug = slugOf<'gate'>('closure');

const LIMITS: DispatchLimits = { global: 4, perRepo: 3, perAccount: {} };

/** The implement stage's command gate runs this through the real command runner. */
const TEST_COMMAND = 'node -e "process.exit(0)"';

const allowAll: PermissionGate = { onAsk: async () => 'allow' };

/** Reversible test cipher standing in for the OS keychain: per-byte XOR with a nonzero key. */
const CIPHER_KEY = 0x5a;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const testCipher = (): NodeDepsConfig['cipher'] => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain: string): Uint8Array => {
    const bytes = encoder.encode(plain);
    return Uint8Array.from(bytes, (byte) => (byte ^ CIPHER_KEY) & 0xff);
  },
  decryptString: (blob: Uint8Array): string => {
    const plain = Uint8Array.from(blob, (byte) => (byte ^ CIPHER_KEY) & 0xff);
    return decoder.decode(plain);
  },
});

// Environment keys these tests overwrite; every test gets its original value back.
const ENV_KEYS = ['PATH', 'HOME'] as const;

let scratch = '';
let dataDir = '';
let repoDir = '';
let homeDir = '';
let savedEnv: Map<string, string | undefined>;
let transports: FakeTransportResolver;
let notifier: FakeNotifier;

const openNodeDeps = (): NodeDeps => {
  const result = createNodeDeps({
    dataDir,
    cipher: testCipher(),
    transports,
    notifier,
    commandEnv: { PATH: process.env.PATH ?? '' },
  });
  if (!result.ok) throw new Error(`createNodeDeps must open: ${JSON.stringify(result.error)}`);
  return result.value;
};

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'docket-scenario-'));
  dataDir = join(scratch, 'data');
  repoDir = join(scratch, 'repo');
  homeDir = join(scratch, 'home');
  await mkdir(homeDir, { recursive: true });
  savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  // The throw-away git repo must not read or write the user's git config.
  process.env.HOME = homeDir;
  transports = createFakeTransportResolver();
  notifier = createFakeNotifier();
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(scratch, { recursive: true, force: true });
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) throw new Error(`fixture git failed (exit ${result.exitCode}): ${args.join(' ')}`);
  return result.stdout;
}

/** A throw-away git repository with one committed file the reviewer's evidence can point at. */
async function seedGitRepo(): Promise<void> {
  await mkdir(join(repoDir, 'src'), { recursive: true });
  await writeFile(join(repoDir, 'src', 'main.ts'), 'export const version = 1;\n', 'utf8');
  await git(repoDir, ['init', '-b', 'main']);
  await git(repoDir, ['add', 'src/main.ts']);
  await git(repoDir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'seed']);
}

/** The built-in roles and the standard flow, written as YAML files under the global root. */
async function seedGlobalDefinitions(): Promise<void> {
  const standard = BUILTIN_FLOWS.find((flow) => flow.id === 'standard');
  if (standard === undefined) throw new Error('expected a built-in flow "standard"');
  await mkdir(join(dataDir, 'roles'), { recursive: true });
  for (const role of BUILTIN_ROLES) {
    await writeFile(join(dataDir, 'roles', `${role.id}.yaml`), stringify(role), 'utf8');
  }
  await mkdir(join(dataDir, 'flows'), { recursive: true });
  await writeFile(join(dataDir, 'flows', 'standard.yaml'), stringify(standard), 'utf8');
}

/** The repo's own definitions: a project≡repo project.yaml naming itself mainRepo, and a
 *  repo.yaml enabling standard with a command set that runs a real command. */
async function seedRepoDefinitions(): Promise<void> {
  await mkdir(join(repoDir, '.docket'), { recursive: true });
  await writeFile(
    join(repoDir, '.docket', 'project.yaml'),
    stringify({ id: 'ws', name: 'Repo', mainRepo: 'ws', repos: ['ws'] }),
    'utf8',
  );
  await writeFile(
    join(repoDir, '.docket', 'repo.yaml'),
    stringify({
      id: 'ws',
      name: 'Repo',
      flows: ['standard'],
      defaultFlow: 'standard',
      commandSets: { tests: [TEST_COMMAND] },
      roleOverrides: [],
      docsRoot: 'docs',
      testGlobs: [],
    }),
    'utf8',
  );
}

// --- harness ----------------------------------------------------------------------------------------

const viewOf = async (deps: AppDeps, id: WorkOrderId) => {
  const view = await getWorkOrder(deps, id);
  if (!view.ok) throw new Error(`work order must load: ${view.error}`);
  return view.value;
};

const expectState = (
  view: WorkOrderView,
  expected: { readonly status: string; readonly stage: string | null; readonly pendingGates?: readonly string[] },
): void => {
  expect(view.state.status).toBe(expected.status);
  expect(view.state.stage).toBe(expected.stage);
  if (expected.pendingGates !== undefined) expect([...view.state.pendingGates]).toEqual(expected.pendingGates);
};

const openViaApi = async (deps: AppDeps, title: string): Promise<WorkOrderId | undefined> => {
  const result = await createApi(deps).command(USER, {
    type: 'workOrder.open',
    project: slugOf<'project'>('ws'),
    repo: REPO,
    title,
  });
  if (!result.ok || result.id === undefined) return undefined;
  const parsed = parseUlid<'work-order'>(result.id);
  return parsed.ok ? parsed.value : undefined;
};

const approveViaApi = (deps: AppDeps, id: WorkOrderId, gate: GateSlug) =>
  createApi(deps).command(USER, { type: 'gate.decide', workOrderId: id, gate, decision: 'approved' });

/** Enqueues the current stage, ticks the dispatcher so it starts, and runs the started item in the
 *  work order's real worktree to completion. */
const runCurrentStage = async (deps: AppDeps, id: WorkOrderId) => {
  const view = await viewOf(deps, id);
  if (view.next.kind !== 'start_run') throw new Error(`expected start_run, got ${view.next.kind}`);

  const routed = await resolveRoute(deps, { repo: REPO, workOrderId: id, role: view.next.role });
  if (!routed.ok) throw new Error(`route must resolve: ${JSON.stringify(routed.error)}`);

  const queued = await enqueueStage(deps, { id });
  if (!queued.ok) throw new Error(`enqueue must succeed: ${queued.error}`);

  const started: QueueItem[] = [];
  const tick = await dispatcherTick(deps, { limits: LIMITS }, (item) => {
    started.push(item);
  });
  expect(tick.started).toHaveLength(1);
  const item = started[0];
  if (item === undefined) throw new Error('the tick must hand over the started item');

  const worktree = await deps.worktrees.ensure(REPO, id);
  if (!worktree.ok) throw new Error(`the worktree must exist: ${worktree.error}`);

  return {
    outcome: await executeRun(deps, allowAll, {
      item,
      role: routed.value.role,
      prompt: `run stage ${item.stage}`,
      cwd: worktree.value.path,
      capabilities: [],
    }),
    worktreePath: worktree.value.path,
  };
};

// --- the section-9 scenario -------------------------------------------------------------------------

describe('standard flow, headless end to end on real Node storage', () => {
  it(
    'section 9: open to done on createNodeDeps, then a fresh open reads the same state and runs',
    { timeout: 60_000 },
    async () => {
      await seedGitRepo();
      await seedGlobalDefinitions();
      await seedRepoDefinitions();

      const node = openNodeDeps();
      const deps = node.deps;
      const attached = await createApi(deps).command(USER, { type: 'project.attach', path: repoDir });
      expect(attached).toEqual({ ok: true, id: REPO });
      expect(await node.repos.path(REPO)).toBe(repoDir);

      // One account carries every role; one scripted transport completes each run.
      await deps.accounts.save({
        id: MAIN,
        provider: 'provider-x',
        label: 'main',
        authMode: 'subscription',
        limitPolicy: 'wait_resume',
        caps: [],
      });
      const START: EpochMs = Date.now();
      const completedScript = (): readonly AgentEvent[] => [
        { type: 'session_started', at: START, sessionRef: 'sess-node' },
        { type: 'finished', at: START + 1_000, reason: 'completed' },
      ];
      transports.register(MAIN, createFakeTransport(completedScript()));
      for (const role of ['planner', 'developer', 'reviewer'] as const) {
        await deps.bindings.save({ level: 'global' }, { role: slugOf<'role'>(role), accounts: [{ accountId: MAIN }] });
      }

      // 1. open → plan/ready.
      const id = await openViaApi(deps, '  Ship the standard flow for real  ');
      expect(id).toBeDefined();
      if (id === undefined) return;
      let view = await viewOf(deps, id);
      expectState(view, { status: 'ready', stage: PLAN, pendingGates: [PLAN_APPROVAL] });
      expect(view.next.kind).toBe('start_run');
      expect(view.record.title).toBe('Ship the standard flow for real');

      // The plan run completes → plan/awaiting_human.
      const planRun = await runCurrentStage(deps, id);
      expect(planRun.outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
      view = await viewOf(deps, id);
      expectState(view, { status: 'awaiting_human', stage: PLAN, pendingGates: [PLAN_APPROVAL] });
      expect(view.next.kind).toBe('await_human');

      // 2. the plan approval moves the flow to implement/ready.
      expect((await approveViaApi(deps, id, PLAN_APPROVAL)).ok).toBe(true);
      view = await viewOf(deps, id);
      expectState(view, {
        status: 'ready',
        stage: IMPLEMENT,
        pendingGates: [slugOf<'gate'>('tests'), slugOf<'gate'>('secrets')],
      });
      expect(view.state.attempt).toBe(1);

      // 3. the implement run completes → gating; the real machine gates pass → review/ready.
      const implementRun = await runCurrentStage(deps, id);
      expect(implementRun.outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
      const worktreePath = join(dataDir, 'worktrees', 'ws', id);
      expect(implementRun.worktreePath).toBe(worktreePath);
      expect((await stat(worktreePath)).isDirectory()).toBe(true);

      view = await viewOf(deps, id);
      expectState(view, {
        status: 'gating',
        stage: IMPLEMENT,
        pendingGates: [slugOf<'gate'>('tests'), slugOf<'gate'>('secrets')],
      });

      const gated = await evaluateMachineGates(deps, { id });
      expect(gated.ok).toBe(true);
      view = await viewOf(deps, id);
      expectState(view, { status: 'ready', stage: REVIEW, pendingGates: [REVIEW_VERDICT, REVIEW_APPROVAL] });

      // 4. the reviewer run completes → gating; its verdict → awaiting_human; approval → close.
      const reviewRun = await runCurrentStage(deps, id);
      expect(reviewRun.outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
      view = await viewOf(deps, id);
      expectState(view, { status: 'gating', stage: REVIEW, pendingGates: [REVIEW_VERDICT, REVIEW_APPROVAL] });

      const reviewerRun = (await deps.runs.listForWorkOrder(id)).find((run) => run.stage === REVIEW);
      if (reviewerRun === undefined) throw new Error('the review run must exist');
      const REVIEWER: Actor = { kind: 'agent', runId: reviewerRun.id, role: slugOf<'role'>('reviewer') };
      const afterVerdict = await submitAgentVerdict(deps, {
        id,
        gate: REVIEW_VERDICT,
        approve: true,
        pointers: ['src/main.ts:1'],
        actor: REVIEWER,
      });
      expect(afterVerdict.ok).toBe(true);
      view = await viewOf(deps, id);
      expectState(view, { status: 'awaiting_human', stage: REVIEW, pendingGates: [REVIEW_APPROVAL] });

      expect((await approveViaApi(deps, id, REVIEW_APPROVAL)).ok).toBe(true);
      view = await viewOf(deps, id);
      expectState(view, { status: 'awaiting_human', stage: 'close', pendingGates: [CLOSURE] });

      // 5. the closure approval finishes the work order.
      expect((await approveViaApi(deps, id, CLOSURE)).ok).toBe(true);
      view = await viewOf(deps, id);
      expectState(view, { status: 'done', stage: null, pendingGates: [] });
      expect(view.next.kind).toBe('none');

      // The queue drained, every run closed with an outcome, and the audit tells the story in order.
      expect(await deps.queue.list()).toEqual([]);
      const runs = await deps.runs.listForWorkOrder(id);
      expect(runs.map((run) => run.stage)).toEqual([PLAN, IMPLEMENT, REVIEW]);
      for (const run of runs) {
        expect(run.outcome).toBe('succeeded');
        expect(run.endedAt).toBeDefined();
      }
      const history = await deps.log.list({ kind: 'work_order', id }, 100);
      expect(history.map((entry) => entry.action).reverse()).toEqual([
        'work_order.opened',
        'gate.decided',
        'gate.decided',
        'gate.decided',
        'gate.decided',
      ]);
      expect(history.map((entry) => entry.detail).reverse()).toEqual([
        undefined,
        { gate: PLAN_APPROVAL, decision: 'approved' },
        { gate: REVIEW_VERDICT, decision: 'approved' },
        { gate: REVIEW_APPROVAL, decision: 'approved' },
        { gate: CLOSURE, decision: 'approved' },
      ]);
      for (const run of runs) {
        const runAudit = await deps.log.list({ kind: 'run', id: run.id }, 10);
        expect(runAudit.map((entry) => entry.action).reverse()).toEqual(['run.started', 'run.finished']);
      }

      // Reopen: close(), then a fresh createNodeDeps over the same folder reads the same state.
      const beforeClose = view;
      node.close();
      const reopened = openNodeDeps();
      expect(await reopened.repos.list()).toEqual([{ slug: REPO, path: repoDir }]);

      const detail = (await createApi(reopened.deps).query({ type: 'workOrder.detail', id })) as WorkOrderView;
      expect(detail.state).toEqual(beforeClose.state);
      expect(detail.runs).toEqual(beforeClose.runs);
      expect(detail.runs.map((run) => run.outcome)).toEqual(['succeeded', 'succeeded', 'succeeded']);
      reopened.close();
    },
  );
});
