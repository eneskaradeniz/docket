// api/api.test.ts — createApi's command side: rule A-21 (ids are parsed at the boundary and a
// parse failure runs nothing) plus the mapping of every command onto its use case
// (docs/v2/application.md § 4).
import { describe, expect, it, vi } from 'vitest';

import type { Actor, Slug, Ulid } from '../domain/index';
import { ok, parseSlug, parseUlid } from '../domain/index';

import type { AppDeps } from '../application';
import { createPermissionBoard } from '../application';
import {
  createFakeCommandRunner,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeWorktrees,
  type FakeCommandRunner,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeWorktrees,
} from '../application/ports/fakes';

import { createApi } from './api';
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

const WORKSPACE = 'acme';
const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAZ');
const PROPOSAL = ulidOf<'proposal'>('01ARZ3NDEKTSV4RRFFQ69G5FD1');
const PROPOSAL_OTHER = ulidOf<'proposal'>('01ARZ3NDEKTSV4RRFFQ69G5FD2');
const RUN = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FE2');
const UNKNOWN_WORK_ORDER = '01ARZ3NDEKTSV4RRFFQ69G5FB9';
const COMMIT = '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';

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
  workspace: {
    id: WORKSPACE,
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

const createHarness = (): Harness => {
  const commands = createFakeCommandRunner();
  const worktrees = createFakeWorktrees();
  const definitions = createFakeDefinitionStore();
  const log = createFakeEventLog();
  definitions.seed({ kind: 'workspace', workspace: slugOf<'workspace'>(WORKSPACE) }, 'defs.json', DEFINITIONS_JSON);
  const deps = createFakeDeps({ commands, worktrees, definitions, log });
  return { deps, definitions, commands, worktrees, log };
};

/** Everything a routed command needs: one existing account and a global binding to it. */
const seedRouting = async (h: Harness): Promise<void> => {
  await h.deps.accounts.save({
    id: ACCOUNT,
    provider: 'acme-prov',
    label: 'Main',
    authMode: 'api_key',
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
    workspace: WORKSPACE,
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
  const scope = { kind: 'workspace', workspace: slugOf<'workspace'>(WORKSPACE) } as const;
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
      const h = createHarness();
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

    it('A-21: an invalid workspace, flow or task slug in workOrder.open is rejected before any port call', async () => {
      const h = createHarness();
      const api = createApi(h.deps);
      const spies = [
        vi.spyOn(h.deps.definitions, 'load'),
        vi.spyOn(h.deps.definitions, 'loadRoadmap'),
        vi.spyOn(h.deps.workOrders, 'create'),
      ];

      const commands: readonly Command[] = [
        { type: 'workOrder.open', workspace: 'Acme', title: 'Fix the login flow' },
        { type: 'workOrder.open', workspace: WORKSPACE, title: 'Fix the login flow', flow: 'Board-Flow' },
        { type: 'workOrder.open', workspace: WORKSPACE, title: 'Fix the login flow', task: 'no task!' },
      ];
      for (const command of commands) {
        expect(await api.command(ACTOR, command)).toEqual({ ok: false, code: 'invalid_id' });
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it('A-21: an invalid gate slug in gate.decide is rejected before any port call', async () => {
      const h = createHarness();
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
      const h = createHarness();
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'workOrder.open', workspace: WORKSPACE, title: '  Fix the login  ' });

      expect(result.ok).toBe(true);
      if (!result.ok || result.id === undefined) throw new Error('open must return an id');
      const id = ulidOf<'work-order'>(result.id);
      const record = await h.deps.workOrders.get(id);
      expect(record?.title).toBe('Fix the login');
      expect(record?.flow).toBe('board-flow');
      expect((await h.deps.workOrders.events(id))[0]?.type).toBe('created');
    });

    it('maps a use-case failure onto { ok: false, code }', async () => {
      const h = createHarness();
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'workOrder.open', workspace: WORKSPACE, title: '   ' });

      expect(result).toEqual({ ok: false, code: 'empty_title' });
    });

    it('maps an unknown work order onto not_found', async () => {
      const h = createHarness();
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'workOrder.block', id: UNKNOWN_WORK_ORDER, reason: 'r' });

      expect(result).toEqual({ ok: false, code: 'not_found' });
    });

    it('maps workOrder.block / unblock / close onto the control use cases', async () => {
      const h = createHarness();
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
      const h = createHarness();
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
      const h = createHarness();
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
      const h = createHarness();
      await seedPendingProposal(h, PROPOSAL, 'roles.json', ROLES_AFTER);
      await seedPendingProposal(h, PROPOSAL_OTHER, 'caps.json', ROLES_AFTER);
      const api = createApi(h.deps);
      const scope = { kind: 'workspace', workspace: slugOf<'workspace'>(WORKSPACE) } as const;

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
      const h = createHarness();
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
      const h = createHarness();
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
      const h = createHarness();
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
      const h = createHarness();
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
      const h = createHarness();
      const id = await openViaApi(h, 'Ship it', 'ship-flow');
      const api = createApi(h.deps);

      const result = await api.command(ACTOR, { type: 'deploy.approve', workOrderId: id, gate: 'ship-stg', commit: COMMIT });

      expect(result).toEqual({ ok: true });
      expect(h.commands.calls().map((call) => call.command)).toEqual(['docket-deploy stg']);
      const types = (await h.deps.workOrders.events(ulidOf<'work-order'>(id))).map((event) => event.type);
      expect(types.slice(-2)).toEqual(['deployment_attempted', 'gate_evaluated']);
    });

    it('U-14: an agent actor mirrors no_approval and nothing is executed', async () => {
      const h = createHarness();
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
      const h = createHarness();
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
      const h = createHarness();
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
      const missing = createHarness();
      expect(
        await createApi(missing.deps).command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: UNKNOWN_WORK_ORDER,
          gate: 'ship-stg',
          commit: COMMIT,
        }),
      ).toEqual({ ok: false, code: 'not_found' });

      // not_current_stage — the gate id belongs to another flow's deploy stage.
      const otherStage = createHarness();
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
      const decided = createHarness();
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
      const human = createHarness();
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
      const unpromoted = createHarness();
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

      // definitions_invalid — the workspace's definitions no longer load.
      const broken = createHarness();
      const brokenId = await openViaApi(broken, 'Ship it', 'ship-flow');
      broken.definitions.seed(
        { kind: 'workspace', workspace: slugOf<'workspace'>(WORKSPACE) },
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
      const ghost = createHarness();
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
              workspace: {
                id: slugOf<'workspace'>(WORKSPACE),
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

      // no_repo — the machine has no checkout of this workspace.
      const noCheckout = createHarness();
      const noCheckoutId = await openViaApi(noCheckout, 'Ship it', 'ship-flow');
      noCheckout.worktrees.markNoRepo(slugOf<'workspace'>(WORKSPACE));
      expect(
        await createApi(noCheckout.deps).command(ACTOR, {
          type: 'deploy.approve',
          workOrderId: noCheckoutId,
          gate: 'ship-stg',
          commit: COMMIT,
        }),
      ).toEqual({ ok: false, code: 'no_repo' });
    });
  });
});
