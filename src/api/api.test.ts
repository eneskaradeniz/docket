// api/api.test.ts — createApi's command side: rule A-21 (ids are parsed at the boundary and a
// parse failure runs nothing) plus the mapping of every command onto its use case
// (docs/v2/application.md § 4).
import { describe, expect, it, vi } from 'vitest';

import type { Actor, Slug, Ulid } from '../domain/index';
import { parseSlug, parseUlid } from '../domain/index';

import type { AppDeps } from '../application';
import { createPermissionBoard } from '../application';
import { createFakeDefinitionStore, createFakeDeps } from '../application/ports/fakes';

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

const DEFINITIONS_JSON = JSON.stringify({
  roles: [ROLE_JSON],
  flows: [FLOW_JSON],
  capabilities: [],
  workspace: {
    id: WORKSPACE,
    name: 'Acme',
    repos: [],
    flows: ['board-flow'],
    defaultFlow: 'board-flow',
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  },
});

interface Harness {
  readonly deps: AppDeps;
  readonly definitions: ReturnType<typeof createFakeDefinitionStore>;
}

const createHarness = (): Harness => {
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'workspace', workspace: slugOf<'workspace'>(WORKSPACE) }, 'defs.json', DEFINITIONS_JSON);
  return { deps: createFakeDeps({ definitions }), definitions };
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

const openViaApi = async (h: Harness, title = 'Fix the login flow'): Promise<string> => {
  const result = await createApi(h.deps).command(ACTOR, { type: 'workOrder.open', workspace: WORKSPACE, title });
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
      ];

      const commands: readonly Command[] = [
        { type: 'workOrder.block', id: 'not-a-ulid', reason: 'waiting on upstream' },
        { type: 'workOrder.unblock', id: 'not-a-ulid' },
        { type: 'workOrder.close', id: 'not-a-ulid' },
        { type: 'workOrder.enqueue', id: 'not-a-ulid' },
        { type: 'gate.decide', workOrderId: 'not-a-ulid', gate: 'plan-approval', decision: 'approved' },
        { type: 'proposal.decide', id: 'not-a-ulid', decision: 'approved' },
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
  });
});
