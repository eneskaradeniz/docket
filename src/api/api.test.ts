// api/api.test.ts — createApi's command side: rule A-21 (ids are parsed at the boundary and a
// parse failure runs nothing) plus the mapping of every command onto its use case
// (docs/v2/application.md § 4).
import { describe, expect, it, vi } from 'vitest';

import type { Actor, AgentEvent, RoleDef, RunId, Slug, Ulid } from '../domain/index';
import { ok, parseSlug, parseUlid } from '../domain/index';

import type { AppDeps, UpdateChecker, UpdateState } from '../application';
import { createPermissionBoard, executeRun } from '../application';
import {
  createFakeCommandRunner,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeTransport,
  createFakeTransportResolver,
  createFakeUpdateChecker,
  createFakeWorktrees,
  type FakeCommandRunner,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeWorktrees,
} from '../application/ports/fakes';

import { createApi, type UiEvent } from './api';
import type { Command } from './commands';

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
const AGENT: Actor = {
  kind: 'agent',
  runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FE1'),
  role: slugOf<'role'>('worker'),
};

const REPO = 'acme';
const PROJECT = 'atolye';
const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAZ');
const ACCOUNT_OTHER = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB8');
const PROPOSAL = ulidOf<'proposal'>('01ARZ3NDEKTSV4RRFFQ69G5FD1');
const PROPOSAL_OTHER = ulidOf<'proposal'>('01ARZ3NDEKTSV4RRFFQ69G5FD2');
const RUN = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FE2');
const UNKNOWN_WORK_ORDER = '01ARZ3NDEKTSV4RRFFQ69G5FB9';
const COMMIT = '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';

/** The role a scripted run executes as; only its shape matters to the executor. */
const RUN_ROLE: RoleDef = {
  id: slugOf<'role'>('worker'),
  name: 'Worker',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const ROLE_JSON = {
  id: 'worker',
  name: 'Worker',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const FLOW_JSON = {
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
};

const SHIP_FLOW_JSON = {
  id: 'ship-flow',
  name: 'Ship',
  stages: [
    {
      id: 'ship',
      name: 'Ship',
      role: null,
      // The signoff keeps the stage current after the deploy gate is decided, so a decided deploy
      // gate is not_pending rather than a finished work order.
      exit: [
        { kind: 'deploy', id: 'ship-stg', environment: 'stg' },
        { kind: 'human', id: 'signoff', label: 'Signoff' },
      ],
    },
  ],
};

const SHIP_PRD_FLOW_JSON = {
  id: 'ship-prd-flow',
  name: 'Ship to production',
  stages: [{ id: 'ship', name: 'Ship', role: null, exit: [{ kind: 'deploy', id: 'ship-prd', environment: 'prd' }] }],
};

const DEFINITIONS_JSON = JSON.stringify({
  roles: [ROLE_JSON],
  flows: [FLOW_JSON, SHIP_FLOW_JSON, SHIP_PRD_FLOW_JSON],
  capabilities: [],
  repo: {
    id: REPO,
    name: 'Acme',
    repos: [],
    flows: ['board-flow', 'ship-flow', 'ship-prd-flow'],
    defaultFlow: 'board-flow',
    commandSets: {
      'deploy-stg': ['docket-deploy stg'],
      'deploy-prd': ['docket-deploy prd'],
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
        env: { RELEASE_CHANNEL: { literal: 'internal-canary' } },
        protected: false,
      },
      {
        id: 'prd',
        name: 'Production',
        order: 2,
        deploy: 'deploy-prd',
        env: { REGION: { literal: 'eu-west-1' } },
        protected: true,
        promoteFrom: 'stg',
      },
    ],
  },
});

interface Harness {
  readonly deps: AppDeps;
  readonly definitions: FakeDefinitionStore;
  readonly commands: FakeCommandRunner;
  readonly worktrees: FakeWorktrees;
  readonly log: FakeEventLog;
}

const createHarness = async (): Promise<Harness> => {
  const commands = createFakeCommandRunner();
  const worktrees = createFakeWorktrees();
  const definitions = createFakeDefinitionStore();
  const log = createFakeEventLog();
  definitions.setProject({ id: slugOf<'project'>(PROJECT), name: 'Project', mainRepo: slugOf<'repo'>(REPO), repos: [slugOf<'repo'>(REPO)] });
  definitions.seed({ kind: 'repo', repo: slugOf<'repo'>(REPO) }, 'defs.json', DEFINITIONS_JSON);
  const deps = createFakeDeps({ commands, worktrees, definitions, log });
  await deps.projects.save({ id: slugOf<'project'>(PROJECT), name: 'Project', mainRepo: slugOf<'repo'>(REPO), repos: [slugOf<'repo'>(REPO)] });
  return { deps, definitions, commands, worktrees, log };
};

/** Everything a routed command needs: one existing account and a global binding to it. The
 *  account is a subscription: the feed tests run the route unpinned, and an unpinned route on a
 *  metered-by-default mode is refused before it starts (P-40). */
const seedRouting = async (h: Harness): Promise<void> => {
  await h.deps.accounts.save({
    id: ACCOUNT,
    provider: 'acme-prov',
    label: 'Main',
    authMode: 'subscription',
    limitPolicy: 'wait_resume',
    caps: [],
  });
  await h.deps.bindings.save(
    { level: 'global' },
    { role: slugOf<'role'>('worker'), accounts: [{ accountId: ACCOUNT }] },
  );
};

const openViaApi = async (h: Harness, title = 'Fix the login flow', flow?: string): Promise<string> => {
  const result = await createApi(h.deps).command(ACTOR, {
    type: 'workOrder.open',
    project: PROJECT,
    repo: REPO,
    title,
    ...(flow === undefined ? {} : { flow }),
  });
  if (!result.ok || result.id === undefined) throw new Error('fixture open must succeed');
  return result.id;
};

/** Drives a freshly opened work order to `awaiting_human` on plan, the state gate.decide needs. */
const driveToAwaitingHuman = async (h: Harness, id: string): Promise<void> => {
  const workOrderId = ulidOf<'work-order'>(id);
  const stage = slugOf<'stage'>('plan');
  await h.deps.workOrders.appendEvent(workOrderId, { type: 'run_started', at: 1_100, runId: RUN, stage, attempt: 1 });
  await h.deps.workOrders.appendEvent(workOrderId, { type: 'run_finished', at: 1_200, runId: RUN, outcome: 'succeeded' });
};

/** A prior successful staging deploy of the exact commit — the promotion prerequisite for prd. */
const deployOnStg = async (h: Harness, id: string): Promise<void> => {
  await h.deps.workOrders.appendEvent(ulidOf<'work-order'>(id), {
    type: 'deployment_attempted',
    at: 1_300,
    stage: slugOf<'stage'>('ship'),
    gate: slugOf<'gate'>('ship-stg'),
    environment: slugOf<'env'>('stg'),
    commit: COMMIT,
    approvedBy: ACTOR,
    result: 'success',
  });
};

// Proposal fixtures must hold whole, valid definition files: an approved candidate is validated
// as the file's next content before anything is written.
const ROLES_BEFORE = JSON.stringify({ roles: [ROLE_JSON] });
const ROLES_AFTER = JSON.stringify({ roles: [ROLE_JSON, { ...ROLE_JSON, id: 'reviewer', name: 'Reviewer' }] });

const seedPendingProposal = async (h: Harness, id: Ulid<'proposal'>, target: string, after: string): Promise<void> => {
  const scope = { kind: 'repo', repo: slugOf<'repo'>(REPO) } as const;
  h.definitions.seed(scope, target, ROLES_BEFORE);
  const file = await h.definitions.readFile(scope, target);
  if (file === undefined) throw new Error('fixture file must exist');
  await h.deps.proposals.save({
    id,
    author: AGENT,
    createdAt: 1_000,
    target,
    baseHash: file.hash,
    before: file.content,
    after,
    summary: 'Grow the definitions',
    status: 'pending',
    scope,
  });
};

describe('createApi', () => {
  describe('command', () => {
    it('A-21: an invalid id in any command returns invalid_id and no port is called', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const spies = [
        vi.spyOn(h.deps.workOrders, 'get'),
        vi.spyOn(h.deps.workOrders, 'create'),
        vi.spyOn(h.deps.workOrders, 'appendEvent'),
        vi.spyOn(h.deps.definitions, 'load'),
        vi.spyOn(h.deps.definitions, 'loadRoadmap'),
        vi.spyOn(h.deps.log, 'append'),
        vi.spyOn(h.deps.queue, 'put'),
        vi.spyOn(h.deps.proposals, 'get'),
        vi.spyOn(h.deps.worktrees, 'ensure'),
        vi.spyOn(h.deps.commands, 'run'),
        vi.spyOn(h.deps.secrets, 'get'),
      ];

      const commands: readonly Command[] = [
        { type: 'workOrder.block', id: 'not-a-ulid', reason: 'waiting on upstream' },
        { type: 'workOrder.unblock', id: 'not-a-ulid' },
        { type: 'workOrder.close', id: 'not-a-ulid' },
        { type: 'workOrder.enqueue', id: 'not-a-ulid' },
        { type: 'gate.decide', workOrderId: 'not-a-ulid', gate: 'plan-approval', decision: 'approved' },
        { type: 'proposal.decide', id: 'not-a-ulid', decision: 'approved' },
        { type: 'deploy.approve', workOrderId: 'not-a-ulid', gate: 'ship-stg', commit: COMMIT },
      ];
      for (const command of commands) {
        expect(await api.command(ACTOR, command)).toEqual({ ok: false, code: 'invalid_id' });
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it('A-21: an invalid repo, flow or task slug in workOrder.open is rejected before any port call', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const spies = [
        vi.spyOn(h.deps.definitions, 'load'),
        vi.spyOn(h.deps.definitions, 'loadRoadmap'),
        vi.spyOn(h.deps.workOrders, 'create'),
      ];

      const commands: readonly Command[] = [
        { type: 'workOrder.open', project: 'Atolye', repo: 'Acme', title: 'Fix the login flow' },
        { type: 'workOrder.open', project: PROJECT, repo: REPO, title: 'Fix the login flow', flow: 'Board-Flow' },
        { type: 'workOrder.open', project: PROJECT, repo: REPO, title: 'Fix the login flow', task: 'no task!' },
      ];
      for (const command of commands) {
        expect(await api.command(ACTOR, command)).toEqual({ ok: false, code: 'invalid_id' });
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it('A-21: an invalid gate slug in gate.decide is rejected before any port call', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const get = vi.spyOn(h.deps.workOrders, 'get');

      const result = await api.command(ACTOR, {
        type: 'gate.decide',
        workOrderId: UNKNOWN_WORK_ORDER,
        gate: 'Plan-Approval',
        decision: 'approved',
      });

      expect(result).toEqual({ ok: false, code: 'invalid_id' });
      expect(get).not.toHaveBeenCalled();
    });

    it('maps workOrder.open onto openWorkOrder and returns the new work order id', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'workOrder.open', project: PROJECT, repo: REPO, title: '  Fix the login  ' });

      expect(result.ok).toBe(true);
      if (!result.ok || result.id === undefined) throw new Error('open must return an id');
      const id = ulidOf<'work-order'>(result.id);
      const record = await h.deps.workOrders.get(id);
      expect(record?.title).toBe('Fix the login');
      expect(record?.flow).toBe('board-flow');
      expect((await h.deps.workOrders.events(id))[0]?.type).toBe('created');
    });

    it('maps a use-case failure onto { ok: false, code }', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'workOrder.open', project: PROJECT, repo: REPO, title: '   ' });

      expect(result).toEqual({ ok: false, code: 'empty_title' });
    });

    it('maps an unknown work order onto not_found', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'workOrder.block', id: UNKNOWN_WORK_ORDER, reason: 'r' });

      expect(result).toEqual({ ok: false, code: 'not_found' });
    });

    it('maps workOrder.block / unblock / close onto the control use cases', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const id = await openViaApi(h);

      expect(await api.command(ACTOR, { type: 'workOrder.block', id, reason: 'waiting on upstream' })).toEqual({ ok: true });
      expect(await api.command(ACTOR, { type: 'workOrder.unblock', id })).toEqual({ ok: true });
      expect(await api.command(ACTOR, { type: 'workOrder.close', id })).toEqual({ ok: true });
      // Closing is final: a second close reports already_done instead of appending again.
      expect(await api.command(ACTOR, { type: 'workOrder.close', id })).toEqual({ ok: false, code: 'already_done' });

      const types = (await h.deps.workOrders.events(ulidOf<'work-order'>(id))).map((event) => event.type);
      expect(types).toEqual(['created', 'blocked', 'unblocked', 'closed']);
    });

    it('maps workOrder.enqueue onto enqueueStage and returns the queue item id', async () => {
      const h = await createHarness();
      await seedRouting(h);
      const api = createApi(h.deps);
      const id = await openViaApi(h);

      const result = await api.command(ACTOR, { type: 'workOrder.enqueue', id });

      expect(result.ok).toBe(true);
      if (!result.ok || result.id === undefined) throw new Error('enqueue must return an id');
      const queued = await h.deps.queue.list();
      expect(queued.length).toBe(1);
      expect(queued[0]?.id).toBe(result.id);
      expect(queued[0]?.stage).toBe('plan');
    });

    it('maps gate.decide onto decideHumanGate and records the verdict', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const id = await openViaApi(h);
      await driveToAwaitingHuman(h, id);

      // An agent never decides a human gate, and nothing is recorded for the refusal.
      expect(await api.command(AGENT, { type: 'gate.decide', workOrderId: id, gate: 'plan-approval', decision: 'approved' })).toEqual({
        ok: false,
        code: 'agent_cannot_decide',
      });

      const result = await api.command(ACTOR, {
        type: 'gate.decide',
        workOrderId: id,
        gate: 'plan-approval',
        decision: 'approved',
        note: 'looks sound',
      });

      expect(result).toEqual({ ok: true });
      const events = await h.deps.workOrders.events(ulidOf<'work-order'>(id));
      expect(events[events.length - 1]?.type).toBe('gate_evaluated');
    });

    it('maps proposal.decide onto decideProposalUseCase', async () => {
      const h = await createHarness();
      await seedPendingProposal(h, PROPOSAL, 'roles.json', ROLES_AFTER);
      await seedPendingProposal(h, PROPOSAL_OTHER, 'caps.json', ROLES_AFTER);
      const api = createApi(h.deps);
      const scope = { kind: 'repo', repo: slugOf<'repo'>(REPO) } as const;

      const approved = await api.command(ACTOR, { type: 'proposal.decide', id: PROPOSAL, decision: 'approved' });
      expect(approved).toEqual({ ok: true, id: PROPOSAL });
      expect((await h.definitions.readFile(scope, 'roles.json'))?.content).toBe(ROLES_AFTER);

      // An agent never approves its own proposal; the file is untouched.
      const refused = await api.command(AGENT, { type: 'proposal.decide', id: PROPOSAL_OTHER, decision: 'approved' });
      expect(refused).toEqual({ ok: false, code: 'self_approval' });
      expect((await h.definitions.readFile(scope, 'caps.json'))?.content).toBe(ROLES_BEFORE);

      const rejected = await api.command(ACTOR, { type: 'proposal.decide', id: PROPOSAL_OTHER, decision: 'rejected' });
      expect(rejected).toEqual({ ok: true, id: PROPOSAL_OTHER });
    });

    it('U-11: maps permission.answer onto the board and resolves the buffered ask', async () => {
      const h = await createHarness();
      const board = createPermissionBoard();
      const api = createApi(h.deps, board);
      board.register(RUN);
      // What the executor's gate wiring does while the run streams.
      const waiting = board.onAsk(RUN, { type: 'permission_ask', at: 1_500, id: 'ask-1', tool: 'shell', options: ['allow', 'deny'] });

      const result = await api.command(ACTOR, { type: 'permission.answer', runId: RUN, askId: 'ask-1', decision: 'allow' });

      expect(result).toEqual({ ok: true });
      expect(await waiting).toBe('allow');
      expect(board.openAsks()).toEqual([]);
      // The ask is answered and gone; answering it again is the not_found of an unknown askId.
      expect(await api.command(ACTOR, { type: 'permission.answer', runId: RUN, askId: 'ask-1', decision: 'allow' })).toEqual({
        ok: false,
        code: 'not_found',
      });
    });

    it('U-11: an unknown or ended askId answers not_found and never throws', async () => {
      const h = await createHarness();
      const board = createPermissionBoard();
      const api = createApi(h.deps, board);

      expect(await api.command(ACTOR, { type: 'permission.answer', runId: RUN, askId: 'ask-x', decision: 'deny' })).toEqual({
        ok: false,
        code: 'not_found',
      });

      // A run that has ended takes its asks with it.
      board.register(RUN);
      void board.onAsk(RUN, { type: 'permission_ask', at: 1_500, id: 'ask-1', tool: 'shell', options: ['allow', 'deny'] });
      board.unregister(RUN);
      expect(await api.command(ACTOR, { type: 'permission.answer', runId: RUN, askId: 'ask-1', decision: 'allow' })).toEqual({
        ok: false,
        code: 'not_found',
      });

      // An api built without a board has no open ask at all, so the answer stays a plain not_found.
      expect(await createApi(h.deps).command(ACTOR, { type: 'permission.answer', runId: RUN, askId: 'ask-1', decision: 'allow' })).toEqual({
        ok: false,
        code: 'not_found',
      });
    });

    it('U-11: an invalid runId returns invalid_id and leaves the buffered ask unanswered', async () => {
      const h = await createHarness();
      const board = createPermissionBoard();
      const api = createApi(h.deps, board);
      board.register(RUN);
      void board.onAsk(RUN, { type: 'permission_ask', at: 1_500, id: 'ask-1', tool: 'shell', options: ['allow', 'deny'] });

      expect(await api.command(ACTOR, { type: 'permission.answer', runId: 'not-a-ulid', askId: 'ask-1', decision: 'allow' })).toEqual({
        ok: false,
        code: 'invalid_id',
      });
      expect(board.openAsks()).toEqual([{ runId: RUN, askId: 'ask-1', since: 1_500 }]);
    });

    it('A-21: an invalid gate slug in deploy.approve is rejected before any port call', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const get = vi.spyOn(h.deps.workOrders, 'get');

      const result = await api.command(ACTOR, {
        type: 'deploy.approve',
        workOrderId: UNKNOWN_WORK_ORDER,
        gate: 'Ship-Stg',
        commit: COMMIT,
      });

      expect(result).toEqual({ ok: false, code: 'invalid_id' });
      expect(get).not.toHaveBeenCalled();
    });

    it('U-14: maps deploy.approve onto approveAndDeploy and deploys with the user actor', async () => {
      const h = await createHarness();
      const id = await openViaApi(h, 'Ship it', 'ship-flow');
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'deploy.approve', workOrderId: id, gate: 'ship-stg', commit: COMMIT });

      expect(result).toEqual({ ok: true });
      expect(h.commands.calls().map((call) => call.command)).toEqual(['docket-deploy stg']);
      const types = (await h.deps.workOrders.events(ulidOf<'work-order'>(id))).map((event) => event.type);
      expect(types.slice(-2)).toEqual(['deployment_attempted', 'gate_evaluated']);
    });

    it('U-14: an agent actor mirrors no_approval and nothing is executed', async () => {
      const h = await createHarness();
      const id = await openViaApi(h, 'Ship it', 'ship-flow');
      const api = createApi(h.deps);
      const auditBefore = h.log.entries().length;

      const result = await api.command(AGENT, { type: 'deploy.approve', workOrderId: id, gate: 'ship-stg', commit: COMMIT });

      expect(result).toEqual({ ok: false, code: 'no_approval' });
      expect(h.commands.calls()).toHaveLength(0);
      // The refusal leaves no audit trail of its own beyond the work order's creation entry.
      expect(h.log.entries().length).toBe(auditBefore);
    });

    it('U-14: confirmedEnvironment travels verbatim and unlocks a protected environment', async () => {
      const h = await createHarness();
      const id = await openViaApi(h, 'Promote to production', 'ship-prd-flow');
      await deployOnStg(h, id);
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, {
        type: 'deploy.approve',
        workOrderId: id,
        gate: 'ship-prd',
        commit: COMMIT,
        confirmedEnvironment: 'prd',
      });

      expect(result).toEqual({ ok: true });
      expect(h.commands.calls().map((call) => call.command)).toEqual(['docket-deploy prd']);
    });

    it('U-14: a protected environment without, with a wrong or an untypable confirmation is confirmation_mismatch', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);

      const without = await openViaApi(h, 'Promote to production', 'ship-prd-flow');
      await deployOnStg(h, without);
      expect(
        await api.command(ACTOR, { type: 'deploy.approve', workOrderId: without, gate: 'ship-prd', commit: COMMIT }),
      ).toEqual({ ok: false, code: 'confirmation_mismatch' });

      const wrong = await openViaApi(h, 'Promote to production', 'ship-prd-flow');
      await deployOnStg(h, wrong);
      expect(
        await api.command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: wrong,
          gate: 'ship-prd',
          commit: COMMIT,
          confirmedEnvironment: 'stg',
        }),
      ).toEqual({ ok: false, code: 'confirmation_mismatch' });

      // The confirmation is user-typed text compared for equality, not an id: a value that is not
      // even a slug cannot equal the environment, so the answer stays the E-8 surface.
      const untypable = await openViaApi(h, 'Promote to production', 'ship-prd-flow');
      await deployOnStg(h, untypable);
      expect(
        await api.command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: untypable,
          gate: 'ship-prd',
          commit: COMMIT,
          confirmedEnvironment: 'PRD',
        }),
      ).toEqual({ ok: false, code: 'confirmation_mismatch' });

      expect(h.commands.calls()).toHaveLength(0);
    });

    it('U-14: every DeployGateError kind maps to its own CommandResult code', async () => {
      // not_found — a well-formed id that names no work order.
      const missing = await createHarness();
      expect(
        await createApi(missing.deps).command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: UNKNOWN_WORK_ORDER,
          gate: 'ship-stg',
          commit: COMMIT,
        }),
      ).toEqual({ ok: false, code: 'not_found' });

      // not_current_stage — the gate id belongs to another flow's deploy stage.
      const otherStage = await createHarness();
      const otherId = await openViaApi(otherStage, 'Ship it', 'ship-flow');
      expect(
        await createApi(otherStage.deps).command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: otherId,
          gate: 'ship-prd',
          commit: COMMIT,
        }),
      ).toEqual({ ok: false, code: 'not_current_stage' });
      expect(otherStage.commands.calls()).toHaveLength(0);

      // not_pending — the gate already carries a verdict in the work order's history.
      const decided = await createHarness();
      const decidedId = await openViaApi(decided, 'Ship it', 'ship-flow');
      await decided.deps.workOrders.appendEvent(ulidOf<'work-order'>(decidedId), {
        type: 'gate_evaluated',
        at: 1_400,
        stage: slugOf<'stage'>('ship'),
        gate: slugOf<'gate'>('ship-stg'),
        verdict: { status: 'passed' },
      });
      expect(
        await createApi(decided.deps).command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: decidedId,
          gate: 'ship-stg',
          commit: COMMIT,
        }),
      ).toEqual({ ok: false, code: 'not_pending' });

      // not_a_deploy_gate — the current stage's pending gate is a human gate.
      const human = await createHarness();
      const humanId = await openViaApi(human);
      await driveToAwaitingHuman(human, humanId);
      expect(
        await createApi(human.deps).command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: humanId,
          gate: 'plan-approval',
          commit: COMMIT,
        }),
      ).toEqual({ ok: false, code: 'not_a_deploy_gate' });

      // no_approval — an agent may never approve a deploy (asserted in detail above).

      // confirmation_mismatch — a protected environment needs the typed confirmation (above).

      // promote_prerequisite_missing — the confirmation is right, but stg never saw this commit.
      const unpromoted = await createHarness();
      const unpromotedId = await openViaApi(unpromoted, 'Promote to production', 'ship-prd-flow');
      expect(
        await createApi(unpromoted.deps).command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: unpromotedId,
          gate: 'ship-prd',
          commit: COMMIT,
          confirmedEnvironment: 'prd',
        }),
      ).toEqual({ ok: false, code: 'promote_prerequisite_missing' });

      // definitions_invalid — the repo's definitions no longer load.
      const broken = await createHarness();
      const brokenId = await openViaApi(broken, 'Ship it', 'ship-flow');
      broken.definitions.seed(
        { kind: 'repo', repo: slugOf<'repo'>(REPO) },
        'broken.json',
        '{ not json',
      );
      expect(
        await createApi(broken.deps).command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: brokenId,
          gate: 'ship-stg',
          commit: COMMIT,
        }),
      ).toEqual({ ok: false, code: 'definitions_invalid' });

      // unknown_environment — validated definitions cannot name a missing environment, so this arm
      // is reached only with definitions that were never validated: a store stub answers with
      // hand-built ones.
      const ghost = await createHarness();
      const ghostId = await openViaApi(ghost, 'Ship it', 'ship-flow');
      const ghostDeps = {
        ...ghost.deps,
        definitions: {
          ...ghost.deps.definitions,
          load: async () =>
            ok({
              roles: [],
              flows: [
                {
                  id: slugOf<'flow'>('ship-flow'),
                  name: 'Ship',
                  stages: [
                    {
                      id: slugOf<'stage'>('ship'),
                      name: 'Ship',
                      role: null,
                      exit: [{ kind: 'deploy' as const, id: slugOf<'gate'>('ship-stg'), environment: slugOf<'env'>('ghost') }],
                    },
                  ],
                },
              ],
              capabilities: [],
              repo: {
                id: slugOf<'repo'>(REPO),
                name: 'Acme',
                repos: [],
                flows: [slugOf<'flow'>('ship-flow')],
                defaultFlow: slugOf<'flow'>('ship-flow'),
                commandSets: {},
                roleOverrides: [],
                docsRoot: 'docs',
                testGlobs: [],
                environments: [],
              },
            }),
        },
      };
      expect(
        await createApi(ghostDeps).command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: ghostId,
          gate: 'ship-stg',
          commit: COMMIT,
        }),
      ).toEqual({ ok: false, code: 'unknown_environment' });

      // no_repo — the machine has no checkout of this repo.
      const noCheckout = await createHarness();
      const noCheckoutId = await openViaApi(noCheckout, 'Ship it', 'ship-flow');
      noCheckout.worktrees.markNoRepo(slugOf<'repo'>(REPO));
      expect(
        await createApi(noCheckout.deps).command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: noCheckoutId,
          gate: 'ship-stg',
          commit: COMMIT,
        }),
      ).toEqual({ ok: false, code: 'no_repo' });
    });

    it('U-13: account.save creates an account with a fresh id, audited as account.saved', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, {
        type: 'account.save',
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'api_key',
        plan: 'pro',
      });

      expect(result.ok).toBe(true);
      if (!result.ok || result.id === undefined) throw new Error('account.save must return an id');
      expect(await h.deps.accounts.get(ulidOf<'account'>(result.id))).toEqual({
        id: result.id,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'api_key',
        plan: 'pro',
        limitPolicy: 'wait_resume',
        caps: [],
      });
      const audit = h.log.entries();
      expect(audit[audit.length - 1]).toMatchObject({ action: 'account.saved', subject: { kind: 'account', id: result.id } });
    });

    it('U-13: account.save stores a reserve, keeps it when absent on update, and answers invalid_reserve for an out-of-range share', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const base = { type: 'account.save', provider: 'acme-prov', label: 'Main', authMode: 'api_key' } as const;

      const created = await api.command(ACTOR, { ...base, reserve: { short: 0.1, long: 0.3 } });
      if (!created.ok || created.id === undefined) throw new Error('account.save must return an id');
      const id = ulidOf<'account'>(created.id);
      expect((await h.deps.accounts.get(id))?.reserve).toEqual({ short: 0.1, long: 0.3 });

      expect((await api.command(ACTOR, { ...base, id: created.id, label: 'Renamed' })).ok).toBe(true);
      expect((await h.deps.accounts.get(id))?.reserve).toEqual({ short: 0.1, long: 0.3 });

      expect(await api.command(ACTOR, { ...base, id: created.id, reserve: { long: 0.96 } })).toEqual({
        ok: false,
        code: 'invalid_reserve',
      });
      expect((await h.deps.accounts.get(id))?.reserve).toEqual({ short: 0.1, long: 0.3 });
    });

    it('U-13: account.save with an id updates the editable fields and keeps the stored policy, caps and secret ref', async () => {
      const h = await createHarness();
      const secretRef = `account/${ACCOUNT}/api-key`;
      await h.deps.accounts.save({
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'api_key',
        plan: 'starter',
        limitPolicy: 'ask',
        secretRef,
        caps: [{ scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } }],
      });
      await h.deps.secrets.put(secretRef, 'sk-keep-me');
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, {
        type: 'account.save',
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Renamed',
        authMode: 'subscription',
      });

      expect(result).toEqual({ ok: true, id: ACCOUNT });
      // The command owns only the editable surface; the rest of the record survives verbatim.
      expect(await h.deps.accounts.get(ACCOUNT)).toEqual({
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Renamed',
        authMode: 'subscription',
        plan: undefined,
        limitPolicy: 'ask',
        secretRef,
        caps: [{ scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } }],
      });
      expect(await h.deps.secrets.get(secretRef)).toBe('sk-keep-me');
    });

    it('A-44: an update through the API keeps the stored route fields (serialisation round-trip)', async () => {
      const h = await createHarness();
      const tierModels = { strong: 'm-strong', balanced: 'm-balanced', fast: 'm-fast' };
      await h.deps.accounts.save({
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'subscription',
        limitPolicy: 'wait_resume',
        routeKind: 'compatible-endpoint',
        endpoint: 'https://api.compatible.example/v1',
        identityDir: '/Users/op/.config/agent-a',
        tierModels,
        caps: [],
      });
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, {
        type: 'account.save',
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Renamed',
        authMode: 'subscription',
      });

      expect(result).toEqual({ ok: true, id: ACCOUNT });
      // The command's editable surface does not name the route fields, so an update carries them
      // over verbatim — an account saved with a route keeps riding it.
      expect(await h.deps.accounts.get(ACCOUNT)).toEqual({
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Renamed',
        authMode: 'subscription',
        plan: undefined,
        limitPolicy: 'wait_resume',
        caps: [],
        secretRef: undefined,
        routeKind: 'compatible-endpoint',
        endpoint: 'https://api.compatible.example/v1',
        identityDir: '/Users/op/.config/agent-a',
        tierModels,
      });
    });

    it('U-13: an unknown authMode is rejected at the boundary and nothing is written', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const save = vi.spyOn(h.deps.accounts, 'save');

      const result = await api.command(ACTOR, {
        type: 'account.save',
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'password',
      });

      expect(result).toEqual({ ok: false, code: 'invalid_id' });
      expect(save).not.toHaveBeenCalled();
    });

    it('U-13: account.remove removes an unreferenced account and its vault entry', async () => {
      const h = await createHarness();
      const secretRef = `account/${ACCOUNT}/api-key`;
      await h.deps.accounts.save({
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'api_key',
        limitPolicy: 'wait_resume',
        secretRef,
        caps: [],
      });
      await h.deps.secrets.put(secretRef, 'sk-remove-me');
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'account.remove', id: ACCOUNT });

      expect(result).toEqual({ ok: true });
      expect(await h.deps.accounts.get(ACCOUNT)).toBeUndefined();
      expect(await h.deps.secrets.get(secretRef)).toBeUndefined();
    });

    it('U-13: account.remove of a referenced account fails with binding_exists and the referencing roles', async () => {
      const h = await createHarness();
      await seedRouting(h); // a global worker binding to ACCOUNT
      await h.deps.bindings.save(
        { level: 'repo', repo: slugOf<'repo'>(REPO) },
        { role: slugOf<'role'>('reviewer'), accounts: [{ accountId: ACCOUNT }, { accountId: ACCOUNT_OTHER }] },
      );
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'account.remove', id: ACCOUNT });

      expect(result).toEqual({ ok: false, code: 'binding_exists', roles: ['worker', 'reviewer'] });
      expect(await h.deps.accounts.get(ACCOUNT)).toBeDefined();
    });

    it('U-13: binding.save maps onto saveBinding at the global scope; an empty chain reports empty_chain', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, {
        type: 'binding.save',
        role: 'worker',
        accounts: [{ accountId: ACCOUNT, model: 'atlas-max' }, { accountId: ACCOUNT_OTHER }],
      });

      expect(result).toEqual({ ok: true });
      const role = slugOf<'role'>('worker');
      expect(await h.deps.bindings.get({ level: 'global' }, role)).toEqual({
        role,
        accounts: [{ accountId: ACCOUNT, model: 'atlas-max' }, { accountId: ACCOUNT_OTHER }],
      });
      // The settings surface edits the machine-global baseline; no repo binding appears.
      expect(await h.deps.bindings.get({ level: 'repo', repo: slugOf<'repo'>(REPO) }, role)).toBeUndefined();

      expect(await api.command(ACTOR, { type: 'binding.save', role: 'worker', accounts: [] })).toEqual({
        ok: false,
        code: 'empty_chain',
      });
    });

    it('U-13: binding.save stores a valid thinking choice and rejects a malformed one with invalid_id', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const role = slugOf<'role'>('worker');
      const accounts = [{ accountId: ACCOUNT }];

      expect(await api.command(ACTOR, { type: 'binding.save', role: 'worker', accounts, thinking: { level: 'deep' } })).toEqual({ ok: true });
      expect((await h.deps.bindings.get({ level: 'global' }, role))?.thinking).toEqual({ level: 'deep' });
      expect(await api.command(ACTOR, { type: 'binding.save', role: 'worker', accounts, thinking: { effort: 'ultra' } })).toEqual({ ok: true });
      expect((await h.deps.bindings.get({ level: 'global' }, role))?.thinking).toEqual({ effort: 'ultra' });

      for (const thinking of [{}, { level: 'extreme' }, { effort: 'deep' }, { level: 'fast', effort: 'low' }]) {
        expect(await api.command(ACTOR, { type: 'binding.save', role: 'worker', accounts, thinking })).toEqual({ ok: false, code: 'invalid_id' });
      }
    });

    it('U-13: invalid ids or roles in the account and binding commands return invalid_id before any port call', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const spies = [
        vi.spyOn(h.deps.accounts, 'get'),
        vi.spyOn(h.deps.accounts, 'save'),
        vi.spyOn(h.deps.bindings, 'save'),
        vi.spyOn(h.deps.log, 'append'),
      ];

      const commands: readonly Command[] = [
        { type: 'account.save', id: 'not-a-ulid', provider: 'acme-prov', label: 'Main', authMode: 'api_key' },
        { type: 'account.remove', id: 'not-a-ulid' },
        { type: 'binding.save', role: 'Not A Role', accounts: [{ accountId: ACCOUNT }] },
        { type: 'binding.save', role: 'worker', accounts: [{ accountId: 'nope' }, { accountId: ACCOUNT }] },
      ];
      for (const command of commands) {
        expect(await api.command(ACTOR, command)).toEqual({ ok: false, code: 'invalid_id' });
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it('P-40: account.consent.grant records the model and the cap, audited as account.consent.granted', async () => {
      const h = await createHarness();
      await h.deps.accounts.save({
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'subscription',
        limitPolicy: 'wait_resume',
        caps: [],
      });
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, {
        type: 'account.consent.grant',
        id: ACCOUNT,
        model: 'model-x',
        cap: { scope: 'account_day', amountUsd: 5, warnPercent: 80 },
      });

      expect(result).toEqual({ ok: true });
      expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({
        consentedModels: ['model-x'],
        caps: [{ scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } }],
      });
      const audit = h.log.entries();
      expect(audit[audit.length - 1]).toMatchObject({
        action: 'account.consent.granted',
        subject: { kind: 'account', id: ACCOUNT },
      });
    });

    it('P-40: account.consent.grant without a cap touches only consentedModels; an unknown account reports not_found', async () => {
      const h = await createHarness();
      await h.deps.accounts.save({
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'subscription',
        limitPolicy: 'wait_resume',
        caps: [{ scope: 'account_month', cap: { amountUsd: 50, warnPercent: 80 } }],
      });
      const api = createApi(h.deps);

      const granted = await api.command(ACTOR, { type: 'account.consent.grant', id: ACCOUNT, model: 'model-x' });
      const missing = await api.command(ACTOR, {
        type: 'account.consent.grant',
        id: ACCOUNT_OTHER,
        model: 'model-x',
      });

      expect(granted).toEqual({ ok: true });
      expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({
        consentedModels: ['model-x'],
        caps: [{ scope: 'account_month', cap: { amountUsd: 50, warnPercent: 80 } }],
      });
      expect(missing).toEqual({ ok: false, code: 'not_found' });
    });

    it('P-40: account.consent.grant rejects a malformed id or an unknown cap scope at the boundary', async () => {
      const h = await createHarness();
      await h.deps.accounts.save({
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'subscription',
        limitPolicy: 'wait_resume',
        caps: [],
      });
      const api = createApi(h.deps);
      const save = vi.spyOn(h.deps.accounts, 'save');

      const badId = await api.command(ACTOR, { type: 'account.consent.grant', id: 'not-a-ulid', model: 'model-x' });
      const badScope = await api.command(ACTOR, {
        type: 'account.consent.grant',
        id: ACCOUNT,
        model: 'model-x',
        cap: { scope: 'account_year', amountUsd: 5, warnPercent: 80 },
      });

      expect(badId).toEqual({ ok: false, code: 'invalid_id' });
      expect(badScope).toEqual({ ok: false, code: 'invalid_id' });
      expect(save).not.toHaveBeenCalled();
    });

    it('P-40: account.consent.revoke removes the model and audits account.consent.revoked', async () => {
      const h = await createHarness();
      await h.deps.accounts.save({
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'subscription',
        limitPolicy: 'wait_resume',
        consentedModels: ['model-x', 'model-y'],
        caps: [{ scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } }],
      });
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'account.consent.revoke', id: ACCOUNT, model: 'model-x' });

      expect(result).toEqual({ ok: true });
      expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({
        consentedModels: ['model-y'],
        caps: [{ scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } }],
      });
      const audit = h.log.entries();
      expect(audit[audit.length - 1]).toMatchObject({
        action: 'account.consent.revoked',
        subject: { kind: 'account', id: ACCOUNT },
      });
    });

    it('P-40: an update through account.save keeps the recorded consent — the editable surface does not own it', async () => {
      const h = await createHarness();
      await h.deps.accounts.save({
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'subscription',
        limitPolicy: 'wait_resume',
        consentedModels: ['model-x'],
        caps: [{ scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } }],
      });
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, {
        type: 'account.save',
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Renamed',
        authMode: 'subscription',
      });

      expect(result).toEqual({ ok: true, id: ACCOUNT });
      expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({
        label: 'Renamed',
        consentedModels: ['model-x'],
        caps: [{ scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } }],
      });
    });
  });

  describe('subscribe', () => {
    it('U-12: a command that appends to the event log emits workOrders.changed after the append', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const id = await openViaApi(h);
      // A store re-queries the moment the event arrives, so the read that starts at delivery time
      // must already see the appended event.
      const logAtDelivery: Promise<readonly string[]>[] = [];
      api.subscribe((event) => {
        if (event.type !== 'workOrders.changed') return;
        logAtDelivery.push(
          h.deps.workOrders.events(ulidOf<'work-order'>(id)).then((events) => events.map((entry) => entry.type)),
        );
      });

      await api.command(ACTOR, { type: 'workOrder.block', id, reason: 'waiting on upstream' });

      expect(logAtDelivery.length).toBe(1);
      const first = logAtDelivery[0];
      if (first === undefined) throw new Error('workOrders.changed must have been delivered');
      expect(await first).toEqual(['created', 'blocked']);
    });

    it('U-12: a command that writes nothing emits nothing', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const seen: UiEvent[] = [];
      api.subscribe((event) => seen.push(event));

      // Failing commands append nothing anywhere: an unknown target and a malformed id stay silent,
      // while the very next appending command proves the listener was live all along.
      const id = await openViaApi(h);
      expect(await api.command(ACTOR, { type: 'workOrder.block', id: UNKNOWN_WORK_ORDER, reason: 'r' })).toEqual({
        ok: false,
        code: 'not_found',
      });
      expect(await api.command(ACTOR, { type: 'workOrder.close', id: 'not-a-ulid' })).toEqual({ ok: false, code: 'invalid_id' });
      expect(seen).toEqual([]);

      expect(await api.command(ACTOR, { type: 'workOrder.block', id, reason: 'waiting on upstream' })).toEqual({ ok: true });
      expect(seen).toEqual([{ type: 'workOrders.changed' }]);
    });

    it('U-12: an audit-only write emits nothing — the channel tracks the work order event log', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const seen: UiEvent[] = [];
      api.subscribe((event) => seen.push(event));

      const saved = await api.command(ACTOR, { type: 'account.save', provider: 'acme-prov', label: 'Main', authMode: 'api_key' });

      // The account is stored and audited, but no work order changed, so no event may fire.
      expect(saved.ok).toBe(true);
      expect(h.log.entries().length).toBeGreaterThan(0);
      expect(seen).toEqual([]);
    });

    it('U-12: run executor events arrive as run.updated with the runId through the injected notify hook', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      await seedRouting(h); // the executor's preflight needs an account the route can read
      const seen: UiEvent[] = [];
      api.subscribe((event) => seen.push(event));

      const transports = createFakeTransportResolver();
      transports.register(
        ACCOUNT,
        createFakeTransport([
          { type: 'session_started', at: 1_600, sessionRef: 'sess-1' },
          { type: 'text', at: 1_650, delta: 'working' },
          { type: 'finished', at: 1_700, reason: 'completed' },
        ]),
      );
      const workOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FE4');
      await h.deps.workOrders.create({
        id: workOrderId,
        project: slugOf<'project'>('proj'),
        repo: slugOf<'repo'>(REPO),
        flow: slugOf<'flow'>('board-flow'),
        title: 'Run it',
        createdAt: 1_000,
        createdBy: ACTOR,
      });

      // The composition wiring, verbatim: the executor's notify hook is the api's feed.
      const outcome = await executeRun(
        { ...h.deps, transports },
        { onAsk: async () => 'allow' },
        {
          item: {
            id: ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5FE5'),
            workOrderId,
            repo: slugOf<'repo'>(REPO),
            stage: slugOf<'stage'>('plan'),
            route: { accountId: ACCOUNT },
            priority: 0,
            enqueuedAt: 1_000,
          },
          role: RUN_ROLE,
          prompt: 'do the work',
          cwd: '/wt/acme/wo',
          capabilities: [],
        },
        undefined,
        api.runUpdated,
      );

      expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
      const runs = await h.deps.runs.listForWorkOrder(workOrderId);
      const run = runs[runs.length - 1];
      if (run === undefined) throw new Error('the executed run must exist');
      // One run.updated per appended event and only those: the executor's own run_started /
      // run_finished appends reach the work order log directly, never this channel.
      expect(seen).toEqual([
        { type: 'run.updated', runId: run.id },
        { type: 'run.updated', runId: run.id },
        { type: 'run.updated', runId: run.id },
      ]);
    });

    it('U-12: unsubscribe stops delivery', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const id = await openViaApi(h);
      const seenFirst: UiEvent[] = [];
      const seenSecond: UiEvent[] = [];
      const unsubscribe = api.subscribe((event) => seenFirst.push(event));
      api.subscribe((event) => seenSecond.push(event));

      await api.command(ACTOR, { type: 'workOrder.block', id, reason: 'waiting on upstream' });
      unsubscribe();
      await api.command(ACTOR, { type: 'workOrder.unblock', id });

      expect(seenFirst).toEqual([{ type: 'workOrders.changed' }]);
      expect(seenSecond).toEqual([{ type: 'workOrders.changed' }, { type: 'workOrders.changed' }]);
    });

    it('U-12: a throwing listener is skipped and does not break delivery to the others', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const id = await openViaApi(h);
      const seen: UiEvent[] = [];
      api.subscribe(() => {
        throw new Error('a broken listener');
      });
      api.subscribe((event) => seen.push(event));

      const result = await api.command(ACTOR, { type: 'workOrder.block', id, reason: 'waiting on upstream' });

      expect(result).toEqual({ ok: true });
      expect(seen).toEqual([{ type: 'workOrders.changed' }]);
    });
  });

  describe('the renderer feed queries', () => {
    /** The composition wiring for one scripted run: the work order exists, the transport plays the
     *  script, and the api's feed members ride along as the executor's notify hooks. */
    const executeScripted = async (
      h: Harness,
      feed: { runUpdated(runId: string): void; workOrdersChanged(): void } | undefined,
      script: readonly AgentEvent[],
      ids: { readonly workOrder: Ulid<'work-order'>; readonly queueItem: Ulid<'queue-item'> },
    ): Promise<RunId> => {
      await seedRouting(h); // the executor's preflight needs an account the route can read
      const transports = createFakeTransportResolver();
      transports.register(ACCOUNT, createFakeTransport([...script]));
      await h.deps.workOrders.create({
        id: ids.workOrder,
        project: slugOf<'project'>(PROJECT),
        repo: slugOf<'repo'>(REPO),
        flow: slugOf<'flow'>('board-flow'),
        title: 'Run it',
        createdAt: 1_000,
        createdBy: ACTOR,
      });
      await executeRun(
        { ...h.deps, transports },
        { onAsk: async () => 'allow' },
        {
          item: {
            id: ids.queueItem,
            workOrderId: ids.workOrder,
            repo: slugOf<'repo'>(REPO),
            stage: slugOf<'stage'>('plan'),
            route: { accountId: ACCOUNT },
            priority: 0,
            enqueuedAt: 1_000,
          },
          role: RUN_ROLE,
          prompt: 'do the work',
          cwd: '/wt/acme/wo',
          capabilities: [],
        },
        undefined,
        feed?.runUpdated,
        feed?.workOrdersChanged,
      );
      const runs = await h.deps.runs.listForWorkOrder(ids.workOrder);
      const run = runs[runs.length - 1];
      if (run === undefined) throw new Error('the executed run must exist');
      return run.id;
    };

    it('run.events reads back the events the executor stored, newest last', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const script: readonly AgentEvent[] = [
        { type: 'session_started', at: 1_600, sessionRef: 'sess-1' },
        { type: 'text', at: 1_650, delta: 'working' },
        { type: 'finished', at: 1_700, reason: 'completed' },
      ];

      const runId = await executeScripted(h, undefined, script, {
        workOrder: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FE6'),
        queueItem: ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5FE8'),
      });

      expect(await api.query({ type: 'run.events', runId })).toEqual(script);
    });

    it("permissions.open maps the board's parked asks with the owning work order's title", async () => {
      const h = await createHarness();
      const board = createPermissionBoard();
      const api = createApi(h.deps, board);
      const workOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FEA');
      await h.deps.workOrders.create({
        id: workOrderId,
        project: slugOf<'project'>('proj'),
        repo: slugOf<'repo'>(REPO),
        flow: slugOf<'flow'>('board-flow'),
        title: 'Run it',
        createdAt: 1_000,
        createdBy: ACTOR,
      });
      await h.deps.runs.create({
        id: RUN,
        workOrderId,
        stage: slugOf<'stage'>('plan'),
        attempt: 1,
        role: slugOf<'role'>('worker'),
        route: { accountId: ACCOUNT },
        startedAt: 1_400,
        autoResumesUsed: 0,
      });
      board.register(RUN);
      // What the executor's gate wiring does while the run streams.
      void board.onAsk(RUN, { type: 'permission_ask', at: 1_500, id: 'ask-1', tool: 'shell', options: ['allow', 'deny'] });

      expect(await api.query({ type: 'permissions.open' })).toEqual([
        { runId: RUN, askId: 'ask-1', since: 1_500, title: 'Run it' },
      ]);
    });

    it('the run-finished path also emits workOrders.changed through the feed', async () => {
      const h = await createHarness();
      const api = createApi(h.deps);
      const seen: UiEvent[] = [];
      api.subscribe((event) => seen.push(event));

      const runId = await executeScripted(
        h,
        api,
        [
          { type: 'session_started', at: 1_600, sessionRef: 'sess-1' },
          { type: 'text', at: 1_650, delta: 'working' },
          { type: 'finished', at: 1_700, reason: 'completed' },
        ],
        { workOrder: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FE7'), queueItem: ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5FE9') },
      );

      // One run.updated per appended event, then the work-order change of the run-finished append:
      // the re-query it triggers is what clears a badge that the preceding run.updated left stale.
      expect(seen).toEqual([
        { type: 'run.updated', runId },
        { type: 'run.updated', runId },
        { type: 'run.updated', runId },
        { type: 'workOrders.changed' },
      ]);
    });
  });

  describe('app update', () => {
    // The checker is composed beside deps at the root, so these tests hand it straight to the api
    // the way electron/main.ts does — no harness, no work orders, the port alone.
    const updateApi = (updates?: UpdateChecker) =>
      createApi(createFakeDeps(), undefined, undefined, undefined, updates);

    it("A-32: app.update answers the composed checker's state verbatim; without a checker, not_found", async () => {
      const error: UpdateState = { kind: 'error', current: '1.0.0', reason: 'offline' };
      const api = updateApi(createFakeUpdateChecker(error));
      await expect(api.query({ type: 'app.update' })).resolves.toEqual(error);

      // No checker composed: the query invents no state — the registry-less repos.list precedent.
      await expect(updateApi().query({ type: 'app.update' })).resolves.toEqual({ ok: false, code: 'not_found' });
    });

    it('A-33: app.update.check re-checks, the new state answers app.update, and update.changed fires', async () => {
      const updates = createFakeUpdateChecker({ kind: 'none', current: '1.0.0' });
      updates.queueCheck({ kind: 'available', current: '1.0.0', next: '1.1.0' });
      const api = updateApi(updates);
      const seen: UiEvent[] = [];
      api.subscribe((event) => seen.push(event));

      // CommandResult carries no payload: the new state travels out-of-band, through the event
      // and the re-query it triggers.
      expect(await api.command(ACTOR, { type: 'app.update.check' })).toEqual({ ok: true });
      expect(seen).toEqual([{ type: 'update.changed' }]);
      await expect(api.query({ type: 'app.update' })).resolves.toEqual({ kind: 'available', current: '1.0.0', next: '1.1.0' });
    });

    it('A-34: app.update.apply from available starts the download and emits update.changed', async () => {
      const updates = createFakeUpdateChecker({ kind: 'available', current: '1.0.0', next: '1.1.0' });
      const api = updateApi(updates);
      const seen: UiEvent[] = [];
      api.subscribe((event) => seen.push(event));

      expect(await api.command(ACTOR, { type: 'app.update.apply' })).toEqual({ ok: true });
      expect(seen).toEqual([{ type: 'update.changed' }]);
      await expect(api.query({ type: 'app.update' })).resolves.toEqual({
        kind: 'downloading',
        current: '1.0.0',
        next: '1.1.0',
        percent: 0,
      });
    });

    it('A-34: app.update.apply outside available/ready answers not_available and emits nothing', async () => {
      const refusing: readonly UpdateState[] = [
        { kind: 'none', current: '1.0.0' },
        { kind: 'downloading', current: '1.0.0', next: '1.1.0', percent: 40 },
        { kind: 'error', current: '1.0.0', reason: 'failed' },
      ];
      for (const initial of refusing) {
        const updates = createFakeUpdateChecker(initial);
        const api = updateApi(updates);
        const seen: UiEvent[] = [];
        api.subscribe((event) => seen.push(event));

        expect(await api.command(ACTOR, { type: 'app.update.apply' })).toEqual({ ok: false, code: 'not_available' });
        expect(seen).toEqual([]);
        // Refused means untouched: the state the query answers is still the state it started from.
        await expect(api.query({ type: 'app.update' })).resolves.toEqual(initial);
      }
    });

    it('without a composed checker the update intents answer not_found', async () => {
      const api = updateApi();
      expect(await api.command(ACTOR, { type: 'app.update.check' })).toEqual({ ok: false, code: 'not_found' });
      expect(await api.command(ACTOR, { type: 'app.update.apply' })).toEqual({ ok: false, code: 'not_found' });
    });
  });
});
