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
  type WorkOrderId,
} from '../../../domain/index';

import type { RunHandle, RunRequest, TransportError } from '../agent-transport';
import { createRunControl } from '../../services/run-control';
import { executeRun } from '../../services/run-executor';

import {
  createFakeAccountRepo,
  createFakeClock,
  createFakeDeps,
  createFakeRunRepo,
  createFakeTransport,
  createFakeTransportResolver,
  createFakeWorkOrderRepo,
  createParkedFakeTransport,
} from './index';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

const runIdOf = (s: string): RunId => {
  const parsed = parseUlid<'run'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const accountIdOf = (s: string): AccountId => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const slugOf = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const ROLE: RoleDef = {
  id: slugOf<'role'>('implementer'),
  name: 'Implementer',
  instructions: 'implement the task',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const request: RunRequest = {
  runId: runIdOf(U1),
  cwd: '/fake/worktrees/acme/wo',
  runDir: '/fake/worktrees/acme/wo',
  role: ROLE,
  route: { accountId: accountIdOf(U2) },
  prompt: 'implement the task',
  capabilities: [],
};

const startOk = async (transport: ReturnType<typeof createFakeTransport>): Promise<RunHandle> => {
  const started = await transport.start(request);
  if (!started.ok) throw new Error('start must succeed');
  return started.value;
};

const collect = async (stream: AsyncIterable<AgentEvent>): Promise<readonly AgentEvent[]> => {
  const seen: AgentEvent[] = [];
  for await (const event of stream) seen.push(event);
  return seen;
};

const nextEvent = (result: IteratorResult<AgentEvent>): AgentEvent => {
  if (result.done) throw new Error('stream ended unexpectedly');
  return result.value;
};

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const ask = (id: string): AgentEvent => ({
  type: 'permission_ask',
  at: 1,
  id,
  tool: 'Write',
  options: ['allow', 'deny'],
});

describe('createFakeTransport', () => {
  it('A-3: emits the script in order and ends after the finished event', async () => {
    const transport = createFakeTransport([
      { type: 'session_started', at: 1, sessionRef: 's-1' },
      { type: 'text', at: 2, delta: 'working' },
      { type: 'finished', at: 3, reason: 'completed' },
      { type: 'text', at: 4, delta: 'after the finish' },
    ]);

    const seen = await collect((await startOk(transport)).events);
    expect(seen.map((event) => event.type)).toEqual(['session_started', 'text', 'finished']);
  });

  it('A-3: pauses on permission_ask until answerPermission is called, then continues the script', async () => {
    const transport = createFakeTransport([ask('p1'), { type: 'finished', at: 2, reason: 'completed' }]);
    const handle = await startOk(transport);
    const events = handle.events[Symbol.asyncIterator]();

    expect(nextEvent(await events.next()).type).toBe('permission_ask');

    let advanced = false;
    const nextPromise = events.next().then((result) => {
      advanced = true;
      return result;
    });
    await drainMicrotasks();
    expect(advanced).toBe(false);

    handle.answerPermission('p1', 'allow');
    expect(nextEvent(await nextPromise).type).toBe('finished');
    expect(await events.next()).toEqual({ done: true, value: undefined });
  });

  it('A-3: a denied permission also continues the script and the answer is recorded', async () => {
    const transport = createFakeTransport([ask('p1'), { type: 'finished', at: 2, reason: 'completed' }]);
    const handle = await startOk(transport);

    const seen = await (async () => {
      const out: AgentEvent[] = [];
      for await (const event of handle.events) {
        out.push(event);
        if (event.type === 'permission_ask') handle.answerPermission(event.id, 'deny');
      }
      return out;
    })();

    expect(seen.map((event) => event.type)).toEqual(['permission_ask', 'finished']);
    expect(transport.answers()).toEqual([{ askId: 'p1', decision: 'deny' }]);
  });

  it('A-3: an answer for another ask id is recorded but does not release the pause', async () => {
    const transport = createFakeTransport([ask('p1'), { type: 'finished', at: 2, reason: 'completed' }]);
    const handle = await startOk(transport);
    const events = handle.events[Symbol.asyncIterator]();
    expect(nextEvent(await events.next()).type).toBe('permission_ask');

    let advanced = false;
    const nextPromise = events.next().then((result) => {
      advanced = true;
      return result;
    });
    handle.answerPermission('other', 'allow');
    await drainMicrotasks();
    expect(advanced).toBe(false);

    handle.answerPermission('p1', 'allow');
    expect(nextEvent(await nextPromise).type).toBe('finished');
    expect(transport.answers()).toEqual([
      { askId: 'other', decision: 'allow' },
      { askId: 'p1', decision: 'allow' },
    ]);
  });

  it('A-3: pauses again at every further permission_ask in the script', async () => {
    const transport = createFakeTransport([
      ask('p1'),
      ask('p2'),
      { type: 'finished', at: 3, reason: 'completed' },
    ]);
    const handle = await startOk(transport);
    const events = handle.events[Symbol.asyncIterator]();

    expect(nextEvent(await events.next()).type).toBe('permission_ask');
    handle.answerPermission('p1', 'allow');
    expect(nextEvent(await events.next()).type).toBe('permission_ask');

    let advanced = false;
    const nextPromise = events.next().then((result) => {
      advanced = true;
      return result;
    });
    await drainMicrotasks();
    expect(advanced).toBe(false);

    handle.answerPermission('p2', 'deny');
    expect(nextEvent(await nextPromise).type).toBe('finished');
  });

  it('A-3: records steer and stop calls; stop ends the stream without the rest of the script', async () => {
    const transport = createFakeTransport([
      { type: 'text', at: 1, delta: 'a' },
      { type: 'text', at: 2, delta: 'b' },
      { type: 'finished', at: 3, reason: 'completed' },
    ]);
    const handle = await startOk(transport);
    const events = handle.events[Symbol.asyncIterator]();

    expect(nextEvent(await events.next()).type).toBe('text');
    handle.steer('focus on tests');
    await handle.stop();

    expect(nextEvent(await events.next())).toEqual({ type: 'finished', at: 2, reason: 'cancelled' });
    expect(await events.next()).toEqual({ done: true, value: undefined });
    expect(transport.steers()).toEqual(['focus on tests']);
    expect(transport.stopCount()).toBe(1);
  });

  it('stop also releases a pending permission pause', async () => {
    const transport = createFakeTransport([ask('p1'), { type: 'finished', at: 2, reason: 'completed' }]);
    const handle = await startOk(transport);
    const events = handle.events[Symbol.asyncIterator]();
    expect(nextEvent(await events.next()).type).toBe('permission_ask');

    let advanced = false;
    const nextPromise = events.next().then((result) => {
      advanced = true;
      return result;
    });
    await drainMicrotasks();
    expect(advanced).toBe(false);

    await handle.stop();
    expect(nextEvent(await nextPromise)).toEqual({ type: 'finished', at: 2, reason: 'cancelled' });
    expect(await events.next()).toEqual({ done: true, value: undefined });
  });

  it('I-30: stop() ends the stream with finished cancelled and executeRun closes the run as cancelled', async () => {
    const T0: EpochMs = 1_700_000_000_000;
    const workOrderParsed = parseUlid<'work-order'>(U1);
    if (!workOrderParsed.ok) throw new Error('fixture ulid must parse');
    const workOrderId: WorkOrderId = workOrderParsed.value;
    const accountId: AccountId = accountIdOf(U2);
    const repo = slugOf<'repo'>('ws');
    const role: RoleDef = ROLE;
    const queueItemParsed = parseUlid<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5FAD');
    if (!queueItemParsed.ok) throw new Error('fixture ulid must parse');
    const item: QueueItem = {
      id: queueItemParsed.value,
      workOrderId,
      repo,
      stage: slugOf<'stage'>('implement'),
      route: { accountId },
      priority: 0,
      enqueuedAt: T0,
    };
    const clock = createFakeClock(T0);
    const workOrders = createFakeWorkOrderRepo();
    const runs = createFakeRunRepo();
    const accounts = createFakeAccountRepo();
    const transports = createFakeTransportResolver();
    const parked = createParkedFakeTransport();
    transports.register(accountId, parked.transport);
    const deps = createFakeDeps({ clock, workOrders, runs, accounts, transports });
    await workOrders.create({
      id: workOrderId,
      project: slugOf<'project'>('proj'),
      repo,
      flow: slugOf<'flow'>('standard'),
      title: 'Stop me',
      createdAt: T0,
      createdBy: { kind: 'user', id: 'user-1', label: 'Operator' },
    });
    await accounts.save({
      id: accountId,
      provider: 'provider-x',
      label: 'Main',
      authMode: 'subscription',
      limitPolicy: 'wait_resume',
      caps: [],
    });
    const runControl = createRunControl();
    void executeRun(
      deps,
      { onAsk: async () => 'allow' },
      { item, role, prompt: 'work', cwd: `/wt/${repo}/${workOrderId}`, capabilities: [] },
      undefined,
      undefined,
      undefined,
      runControl,
    );
    let runId: RunId | undefined;
    for (let at = 0; at < 200; at += 1) {
      const active = (await runs.listForWorkOrder(workOrderId)).filter((run) => run.endedAt === undefined);
      const candidate = active[active.length - 1];
      if (candidate !== undefined && parked.transport.requests().length > 0 && runControl.active().includes(candidate.id)) {
        runId = candidate.id;
        break;
      }
      await Promise.resolve();
    }
    if (runId === undefined) throw new Error('the run never became live');

    expect(runControl.stop(runId)).toEqual({ ok: true, value: runId });
    for (let at = 0; at < 200; at += 1) {
      if ((await runs.get(runId))?.endedAt !== undefined) break;
      await Promise.resolve();
    }
    expect(await runs.get(runId)).toMatchObject({ outcome: 'cancelled' });
    expect(parked.stopCount()).toBe(1);
  });

  it('A-1: satisfies AgentTransport and records every start request', async () => {
    const transport = createFakeTransport([{ type: 'finished', at: 1, reason: 'completed' }]);
    await startOk(transport);
    await startOk(transport);
    expect(transport.requests()).toEqual([request, request]);
  });

  it('failStart makes later starts return the transport error', async () => {
    const transport = createFakeTransport([{ type: 'finished', at: 1, reason: 'completed' }]);
    const error: TransportError = { code: 'not_installed', message: 'cli missing' };
    transport.failStart(error);

    const started = await transport.start(request);
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error).toEqual(error);
  });

  it('an empty script ends immediately', async () => {
    const transport = createFakeTransport([]);
    const seen = await collect((await startOk(transport)).events);
    expect(seen).toEqual([]);
  });
});

describe('createFakeTransportResolver', () => {
  it('A-1: resolves registered accounts and undefined for unknown ones', async () => {
    const resolver = createFakeTransportResolver();
    const transport = createFakeTransport([{ type: 'finished', at: 1, reason: 'completed' }]);
    expect(await resolver.forAccount(accountIdOf(U2))).toBeUndefined();

    resolver.register(accountIdOf(U2), transport);
    expect(await resolver.forAccount(accountIdOf(U2))).toBe(transport);
    expect(await resolver.forAccount(accountIdOf(U1))).toBeUndefined();
  });
});
