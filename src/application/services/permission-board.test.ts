// permission board — rule U-11 from docs/v2/ui.md: a run's unanswered asks stay listed until a
// human answers them or the run ends; answering resolves the waiting run; anything else answers
// not_found. The board-level tests drive the gate exactly as the executor's wiring does; the
// executor tests prove the register/unregister hooks and the parked run resuming.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type AccountId,
  type AgentEvent,
  type EpochMs,
  type QueueItem,
  type RoleDef,
  type RunId,
  type Slug,
  type Ulid,
  type WorkOrderId,
  type RepoSlug,
} from '../../domain/index';

import {
  createFakeAccountRepo,
  createFakeClock,
  createFakeDeps,
  createFakeIdGen,
  createFakeRunRepo,
  createFakeTransport,
  createFakeTransportResolver,
  createFakeWorkOrderRepo,
  type FakeTransport,
} from '../ports/fakes';

import { createPermissionBoard, type BoardHooks } from './permission-board';
import { executeRun } from './run-executor';

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
const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAA');
const RUN_A: RunId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const RUN_B: RunId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FC2');
const T0: EpochMs = 1_700_000_000_000;

const askOf = (id: string, at: EpochMs): Extract<AgentEvent, { readonly type: 'permission_ask' }> => ({
  type: 'permission_ask',
  at,
  id,
  tool: 'shell',
  options: ['allow', 'deny'],
});

const ROLE: RoleDef = {
  id: slugOf<'role'>('implementer'),
  name: 'Implementer',
  instructions: 'implement the stage',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const ITEM: QueueItem = {
  id: ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5FAD'),
  workOrderId: WORK_ORDER,
  repo: REPO,
  stage: slugOf<'stage'>('implement'),
  route: { accountId: ACCOUNT },
  priority: 0,
  enqueuedAt: T0,
};

const INPUT = {
  item: ITEM,
  role: ROLE,
  prompt: 'implement the stage',
  cwd: `/wt/${REPO}/${WORK_ORDER}`,
  capabilities: [],
};

interface ExecutorHarness {
  readonly deps: Parameters<typeof executeRun>[0];
  readonly transport: FakeTransport;
}

const executorHarness = async (options: {
  readonly script?: readonly AgentEvent[];
  readonly withTransport?: boolean;
} = {}): Promise<ExecutorHarness> => {
  const transports = createFakeTransportResolver();
  const transport = createFakeTransport(options.script ?? [{ type: 'finished', at: T0 + 9, reason: 'completed' }]);
  if (options.withTransport !== false) transports.register(ACCOUNT, transport);
  const workOrders = createFakeWorkOrderRepo();
  const deps = createFakeDeps({
    clock: createFakeClock(T0),
    ids: createFakeIdGen(),
    workOrders,
    runs: createFakeRunRepo(),
    accounts: createFakeAccountRepo(),
    transports,
  });
  await workOrders.create({
    id: WORK_ORDER,
    project: slugOf<'project'>('proj'),
    repo: REPO,
    flow: slugOf<'flow'>('standard'),
    title: 'The work order',
    createdAt: T0,
    createdBy: { kind: 'user', id: 'user-1', label: 'Operator' },
  });
  await deps.accounts.save({
    id: ACCOUNT,
    provider: 'provider-x',
    label: 'Main',
    authMode: 'subscription',
    limitPolicy: 'ask',
    caps: [],
  });
  return { deps, transport };
};

/** The recording hooks stand in for what the electron composition will wire: they observe the
 *  executor's lifetime calls while delegating to a real board. */
const recordingHooks = (board: BoardHooks): { readonly hooks: BoardHooks; readonly lifecycle: readonly string[] } => {
  const lifecycle: string[] = [];
  return {
    lifecycle,
    hooks: {
      register: (runId) => {
        lifecycle.push(`register ${runId}`);
        board.register(runId);
      },
      unregister: (runId) => {
        lifecycle.push(`unregister ${runId}`);
        board.unregister(runId);
      },
    },
  };
};

/** Every fake settles on the next microtask, so pumping microtasks is enough to let the executor
 *  reach the point where the ask is listed. */
const pumpUntil = async (holds: () => boolean): Promise<void> => {
  for (let i = 0; i < 10_000 && !holds(); i += 1) await Promise.resolve();
};

// --- the board itself --------------------------------------------------------------------------------

describe('createPermissionBoard', () => {
  it('U-11: lists a buffered ask with its run, id and arrival time until it is answered', () => {
    const board = createPermissionBoard();
    board.register(RUN_A);
    board.register(RUN_B);

    void board.onAsk(RUN_A, askOf('ask-1', T0));
    void board.onAsk(RUN_B, askOf('ask-2', T0 + 5));

    expect(board.openAsks()).toEqual([
      { runId: RUN_A, askId: 'ask-1', since: T0 },
      { runId: RUN_B, askId: 'ask-2', since: T0 + 5 },
    ]);
  });

  it('U-11: answering resolves the waiting ask with the decision and unlists it', async () => {
    const board = createPermissionBoard();
    board.register(RUN_A);
    const waiting = board.onAsk(RUN_A, askOf('ask-1', T0));

    expect(board.answer('ask-1', 'deny')).toEqual({ ok: true, value: RUN_A });
    expect(await waiting).toBe('deny');
    expect(board.openAsks()).toEqual([]);
    // The ask is answered and gone: a second answer for it is as unknown as any other id.
    expect(board.answer('ask-1', 'allow')).toEqual({ ok: false, error: 'not_found' });
  });

  it('U-11: a run ending drops its still-open asks and answering them reports not_found', () => {
    const board = createPermissionBoard();
    board.register(RUN_A);
    board.register(RUN_B);
    void board.onAsk(RUN_A, askOf('ask-1', T0));
    void board.onAsk(RUN_B, askOf('ask-2', T0 + 5));

    board.unregister(RUN_A);

    expect(board.openAsks()).toEqual([{ runId: RUN_B, askId: 'ask-2', since: T0 + 5 }]);
    expect(board.answer('ask-1', 'allow')).toEqual({ ok: false, error: 'not_found' });
  });

  it('U-11: answering an unknown askId or ending an unknown run reports not_found, never throws', () => {
    const board = createPermissionBoard();

    expect(board.answer('never-asked', 'allow')).toEqual({ ok: false, error: 'not_found' });
    expect(() => board.unregister(RUN_A)).not.toThrow();
    expect(board.openAsks()).toEqual([]);
  });

  it('U-11: an ask of a run the executor never registered fails closed and is never listed', async () => {
    const board = createPermissionBoard();

    expect(await board.onAsk(RUN_A, askOf('ask-1', T0))).toBe('deny');
    expect(board.openAsks()).toEqual([]);
    expect(board.answer('ask-1', 'allow')).toEqual({ ok: false, error: 'not_found' });
  });
});

// --- the executor's wiring ---------------------------------------------------------------------------

describe('executeRun with a permission board', () => {
  it('U-11: registers the run, parks it on the ask and answering resumes the run to its end', async () => {
    const board = createPermissionBoard();
    const h = await executorHarness({
      script: [
        { type: 'session_started', at: T0 + 1, sessionRef: 'sess-1' },
        askOf('ask-1', T0 + 2),
        { type: 'finished', at: T0 + 9, reason: 'completed' },
      ],
    });
    const { hooks, lifecycle } = recordingHooks(board);

    const running = executeRun(h.deps, board, INPUT, hooks);
    await pumpUntil(() => board.openAsks().length === 1);

    const ask = board.openAsks()[0];
    if (ask === undefined) throw new Error('the ask must be listed before answering');
    expect(ask.askId).toBe('ask-1');
    expect(ask.since).toBe(T0 + 2);

    expect(board.answer('ask-1', 'allow')).toEqual({ ok: true, value: ask.runId });
    expect(await running).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(h.transport.answers()).toEqual([{ askId: 'ask-1', decision: 'allow' }]);
    expect(board.openAsks()).toEqual([]);
    expect(lifecycle).toEqual([`register ${ask.runId}`, `unregister ${ask.runId}`]);
  });

  it('U-11: a run that ends before any transport arrives is still unregistered from the board', async () => {
    const board = createPermissionBoard();
    const h = await executorHarness({ withTransport: false });
    const { hooks, lifecycle } = recordingHooks(board);

    const outcome = await executeRun(h.deps, board, INPUT, hooks);

    expect(outcome.kind).toBe('transport_error');
    const all = await h.deps.runs.listForWorkOrder(WORK_ORDER);
    const record = all[all.length - 1];
    if (record === undefined) throw new Error('the executed run must exist');
    expect(lifecycle).toEqual([`register ${record.id}`, `unregister ${record.id}`]);
    expect(board.openAsks()).toEqual([]);
  });
});
