// scenarios/docket-mcp.test.ts — rule A-150: Docket's MCP tools headless. A scripted run (fake
// transport) learns its token from the capability it was handed, publishes a page through the
// tool dispatch (the stand-in for the socket), the operator comments through the use case, the run
// reads the comment through page_comments and publishes version 2; once the run has ended the
// token is gone and a call with it is unauthorized. Nothing the run left behind carries the token.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type Actor,
  type AgentEvent,
  type QueueItem,
  type RoleDef,
  type Ulid,
  type WorkOrderId,
} from '../../domain/index';

import type { AgentTransport, RunRequest } from '../ports';
import {
  createFakeAccountRepo,
  createFakeClock,
  createFakeDeps,
  createFakeEventLog,
  createFakeRunTokens,
  createFakeTransportResolver,
  createFakeWorkOrderRepo,
} from '../ports/fakes/index';
import { createActionApplier, createChatTurnLedger, createDocketTools, executeRun, type DocketToolResponse } from '../services/index';
import { commentOnPage } from '../use-cases/index';

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};
const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const WORK_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAA');
const T0 = 1_700_000_000_000;
const OPERATOR: Actor = { kind: 'user', id: 'operator', label: 'Operator' };

const ROLE: RoleDef = {
  id: slugOf<'role'>('designer'),
  name: 'Designer',
  instructions: 'design the screen',
  writeScope: { kind: 'none' },
  capabilities: [],
  active: true,
};

const ITEM: QueueItem = {
  id: ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5FAD'),
  workOrderId: WORK_ORDER,
  repo: slugOf('ws'),
  stage: slugOf<'stage'>('design'),
  route: { accountId: ACCOUNT },
  priority: 0,
  enqueuedAt: T0,
};

describe('docket MCP scenario', () => {
  it('A-150: publish, operator comment, pull it with page_comments, publish v2; the token dies with the run', async () => {
    const clock = createFakeClock(T0);
    const log = createFakeEventLog();
    const runTokens = createFakeRunTokens();
    const workOrders = createFakeWorkOrderRepo();
    const accounts = createFakeAccountRepo();
    const transports = createFakeTransportResolver();
    const deps = createFakeDeps({
      clock,
      log,
      runTokens,
      workOrders,
      accounts,
      transports,
      mcpEndpoint: { socketPath: '/data/run/mcp.sock', command: '/app/docket', args: ['/app/docket-mcp.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } },
    });
    await workOrders.create({
      id: WORK_ORDER,
      project: slugOf('proj'),
      repo: slugOf('ws'),
      flow: slugOf('standard'),
      title: 'Login screen',
      createdAt: T0,
      createdBy: OPERATOR,
    });
    await accounts.save({ id: ACCOUNT, provider: 'provider-x', label: 'Main', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] });
    const tools = createDocketTools(deps, { applyAction: createActionApplier(deps), turnLedger: createChatTurnLedger() });

    // The scripted agent: reads DOCKET_MCP_TOKEN from the capability it was launched with and
    // talks to the tools the way the stdio child does — one request per call.
    const calls: { readonly tool: string; readonly response: DocketToolResponse }[] = [];
    let token = '';
    const agent: AgentTransport = {
      start: async (request: RunRequest) => {
        const docket = request.capabilities.find((capability) => capability.id === 'docket-pages');
        if (docket === undefined || docket.kind !== 'mcp') throw new Error('the run must carry the docket-pages capability');
        const value = docket.env['DOCKET_MCP_TOKEN'];
        token = value !== undefined && 'literal' in value ? value.literal : '';
        const call = async (tool: string, args: unknown): Promise<DocketToolResponse> => {
          const response = await tools.call({ token, tool, args });
          calls.push({ tool, response });
          return response;
        };
        const events = (async function* (): AsyncGenerator<AgentEvent, void> {
          yield { type: 'session_started', at: T0 + 1, sessionRef: 's-1' };
          const published = await call('page_publish', { title: 'Login mockup', kind: 'html', content: '<h1>v1</h1>' });
          const pageId = published.ok ? (published.result as { pageId: string }).pageId : '';
          yield { type: 'text', at: T0 + 2, delta: 'published' };

          // The operator comments while the run is still going.
          clock.advance(1_000);
          const commented = await commentOnPage(deps, {
            page: pageId as never,
            version: 1,
            by: OPERATOR,
            text: 'Make the button blue',
            anchor: 'cta',
          });
          if (!commented.ok) throw new Error('operator comment must succeed');

          const pulled = await call('page_comments', { pageId });
          const first = pulled.ok ? (pulled.result as { comments: { text: string }[] }).comments : [];
          yield { type: 'text', at: T0 + 3, delta: `comment: ${first[0]?.text ?? '-'}` };
          await call('page_update', { pageId, content: '<h1 style="color:blue">v2</h1>' });
          await call('page_comments', { pageId }); // nothing new any more
          yield { type: 'finished', at: T0 + 9, reason: 'completed' };
        })();
        return { ok: true, value: { events, answerPermission: () => undefined, steer: () => undefined, stop: async () => undefined } };
      },
    };
    transports.register(ACCOUNT, agent);

    const outcome = await executeRun(deps, { onAsk: async () => 'allow' }, { item: ITEM, role: ROLE, prompt: 'go', cwd: '/wt', capabilities: [] });
    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });

    // The calls and their results.
    expect(calls.map((c) => [c.tool, c.response.ok])).toEqual([
      ['page_publish', true],
      ['page_comments', true],
      ['page_update', true],
      ['page_comments', true],
    ]);
    const pageId = (calls[0]?.response as { result: { pageId: string } }).result.pageId;
    expect((calls[2]?.response as { result: unknown }).result).toEqual({ pageId, version: 2 });
    const firstPull = (calls[1]?.response as { result: { comments: unknown[] } }).result.comments;
    expect(firstPull).toEqual([
      { kind: 'operator_comment', id: expect.any(String), version: 1, text: 'Make the button blue', anchor: 'cta', at: T0 + 1_000 },
    ]);
    expect((calls[3]?.response as { result: { comments: unknown[] } }).result.comments).toEqual([]);

    // The page: two versions of the run's work order, authored by the run's agent.
    const page = await deps.pages.get(pageId as never);
    expect(page).toMatchObject({ workOrder: WORK_ORDER, project: 'proj', title: 'Login mockup' });
    expect(page?.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(page?.versions.every((v) => v.by.kind === 'agent' && v.by.role === ROLE.id)).toBe(true);
    expect((await deps.pages.comments(pageId as never, {}))[0]?.deliveredAt).toBe(T0 + 1_000);

    // The token died with the run; a call with it is unauthorized and changes nothing.
    expect(token).not.toBe('');
    expect(runTokens.live()).toEqual([]);
    expect(await tools.call({ token, tool: 'page_update', args: { pageId, content: 'late' } })).toEqual({ ok: false, code: 'unauthorized' });
    expect((await deps.pages.get(pageId as never))?.versions).toHaveLength(2);

    // Nothing the run left behind carries the token.
    const record = (await deps.runs.listForWorkOrder(WORK_ORDER))[0];
    const everything = JSON.stringify({
      record,
      events: record === undefined ? [] : await deps.runs.events(record.id),
      workOrderEvents: await workOrders.events(WORK_ORDER),
      audit: log.entries(),
      page,
      comments: await deps.pages.comments(pageId as never, {}),
    });
    expect(everything).not.toContain(token);
  });
  it('A-150: a run that crashes mid-way also loses its token — a call with it afterwards is unauthorized and writes nothing', async () => {
    const runTokens = createFakeRunTokens();
    const transports = createFakeTransportResolver();
    const accounts = createFakeAccountRepo();
    const workOrders = createFakeWorkOrderRepo();
    const deps = createFakeDeps({
      runTokens,
      transports,
      accounts,
      workOrders,
      mcpEndpoint: { socketPath: '/s', command: '/c', args: [], env: {} },
    });
    await workOrders.create({ id: WORK_ORDER, project: slugOf('proj'), repo: slugOf('ws'), flow: slugOf('standard'), title: 'T', createdAt: T0, createdBy: OPERATOR });
    await accounts.save({ id: ACCOUNT, provider: 'provider-x', label: 'Main', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] });
    const tools = createDocketTools(deps, { applyAction: createActionApplier(deps), turnLedger: createChatTurnLedger() });
    let token = '';
    transports.register(ACCOUNT, {
      start: async (request: RunRequest) => {
        const docket = request.capabilities.find((capability) => capability.id === 'docket-pages');
        const value = docket !== undefined && docket.kind === 'mcp' ? docket.env['DOCKET_MCP_TOKEN'] : undefined;
        token = value !== undefined && 'literal' in value ? value.literal : '';
        const events = (async function* (): AsyncGenerator<AgentEvent, void> {
          yield { type: 'text', at: T0 + 1, delta: 'working' };
          throw new Error('the agent process blew up');
        })();
        return { ok: true, value: { events, answerPermission: () => undefined, steer: () => undefined, stop: async () => undefined } };
      },
    });

    await expect(executeRun(deps, { onAsk: async () => 'allow' }, { item: ITEM, role: ROLE, prompt: 'go', cwd: '/wt', capabilities: [] })).rejects.toThrow('blew up');

    expect(token).not.toBe('');
    expect(await tools.call({ token, tool: 'page_publish', args: { title: 'late', kind: 'markdown', content: 'x' } })).toEqual({ ok: false, code: 'unauthorized' });
    expect(await deps.pages.list({})).toEqual([]);
  });
});
