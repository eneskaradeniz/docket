import { describe, expect, it } from 'vitest';

import type { AgentEvent, RoleDef } from '../../../domain/index';
import { parseSlug, parseUlid, type AccountId, type RunId } from '../../../domain/index';

import type { RunHandle, RunRequest, TransportError } from '../agent-transport';

import { createFakeTransport, createFakeTransportResolver } from './fake-transport';

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
    expect(await nextPromise).toEqual({ done: true, value: undefined });
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
