// mcp/chat-kind.test.ts — rule I-83 (with A-204 and A-213): the token's kind is enforced by the APP
// over the real socket path, whatever the child lists or claims; a chat turn's MCP child lists and
// serves the chat tools end to end. Real sockets in a temporary directory, the in-memory fakes behind.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createActionApplier, createChatTurnLedger, createDocketTools } from '../../application/index';
import { createFakeDeps } from '../../application/ports/fakes/index';
import { parseSlug, parseUlid, type ConversationId, type EpochMs, type RoleSlug, type RunId, type WorkOrderId } from '../../domain/index';

import { createSocketCaller, mcpSocketPath, startMcpListener, type McpListener } from './ipc';
import { createNodeRunTokens } from './run-tokens';
import { createMcpServer } from './server';

const posix = process.platform !== 'win32';
const maybe = posix ? describe : describe.skip;

const ulid = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid');
  return parsed.value;
};
const slug = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug');
  return parsed.value;
};
const CONVERSATION = ulid<'conversation'>('01ARZ3NDEKTSV4RRFFQ69G5FC1') as ConversationId;
const TURN = ulid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA1') as RunId;
const RUN = ulid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA2') as RunId;
const WORK_ORDER = ulid<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV') as WorkOrderId;
const ROLE = slug<'role'>('asistan') as RoleSlug;
const PROJECT = slug<'project'>('alpha');

const roots: string[] = [];
const listeners: McpListener[] = [];
afterEach(async () => {
  for (const listener of listeners.splice(0)) await listener.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const setup = async (): Promise<{ readonly runToken: string; readonly chatToken: string; readonly socketPath: string; readonly tokens: ReturnType<typeof createNodeRunTokens> }> => {
  const dir = await mkdtemp(join(tmpdir(), 'dkt-'));
  roots.push(dir);
  const tokens = createNodeRunTokens();
  const deps = createFakeDeps({ runTokens: tokens });
  await deps.projects.save({ id: PROJECT, name: 'Alpha', mainRepo: slug<'repo'>('alpha-app'), repos: [slug<'repo'>('alpha-app')] });
  await deps.conversations.save({
    id: CONVERSATION,
    scope: { kind: 'project', project: PROJECT },
    title: 'chat',
    createdAt: 1 as EpochMs,
    updatedAt: 1 as EpochMs,
    pinned: false,
    messages: [],
  });
  const tools = createDocketTools(deps, { applyAction: createActionApplier(deps), turnLedger: createChatTurnLedger() });
  const socketPath = mcpSocketPath(dir, process.platform);
  const started = await startMcpListener({ socketPath, handler: (request) => tools.call(request) });
  if (!started.ok) throw new Error(`listener must start: ${started.error}`);
  listeners.push(started.value);
  return {
    tokens,
    socketPath,
    runToken: tokens.mint({ kind: 'run', runId: RUN, workOrderId: WORK_ORDER, role: ROLE }),
    chatToken: tokens.mint({ kind: 'chat', turn: TURN, conversation: CONVERSATION, role: ROLE }),
  };
};

maybe('the token kind over the real socket', () => {
  it('I-83: a run token calling any chat tool is forbidden by the app', async () => {
    const { runToken, socketPath } = await setup();
    const call = createSocketCaller({ socketPath, token: runToken });
    for (const [tool, args] of [
      ['docket_get', { kind: 'project', id: PROJECT }],
      ['docket_search', { query: 'alpha' }],
      ['docket_read_file', { repo: 'alpha-app', path: 'a.txt' }],
      ['page_comments_read', { pageId: '01ARZ3NDEKTSV4RRFFQ69G5FP1' }],
      ['draft_work_order', { project: PROJECT, repo: 'alpha-app', title: 'T' }],
      ['propose_change', { target: 'roadmap', scope: { kind: 'project', project: PROJECT }, file: 'roadmap.yaml', after: '{}', summary: 's', source: 'operator request' }],
      ['propose_setting', { key: 'dispatch.mode', value: 'fixed' }],
    ] as const) {
      expect(await call(tool, args), tool).toEqual({ ok: false, code: 'forbidden' });
    }
  });

  it('I-83: a chat token calling the run-only page_comments is forbidden by the app; the shared page tools serve its chat semantics', async () => {
    const { chatToken, socketPath } = await setup();
    const call = createSocketCaller({ socketPath, token: chatToken });
    expect(await call('page_comments', { pageId: '01ARZ3NDEKTSV4RRFFQ69G5FP1' })).toEqual({ ok: false, code: 'forbidden' });
    const published = await call('page_publish', { title: 'Soalık', kind: 'markdown', content: '# x' });
    expect(published.ok).toBe(true);
    const pageId = published.ok ? (published.result as { pageId: string }).pageId : '';
    const updated = await call('page_update', { pageId, content: '# y' });
    expect(updated.ok && (updated.result as { version: number }).version).toBe(2);
  });

  it('I-83: a chat-kind MCP child lists the chat tools and serves them end to end with a chat token', async () => {
    const { chatToken, socketPath } = await setup();
    const server = createMcpServer({ kind: 'chat', call: createSocketCaller({ socketPath, token: chatToken }) });
    const [listed] = await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect((JSON.parse(listed ?? '{}') as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name)).toEqual([
      'docket_get',
      'docket_search',
      'docket_read_file',
      'page_publish',
      'page_update',
      'page_comments_read',
      'draft_work_order',
      'propose_change',
      'propose_setting',
    ]);
    const [called] = await server.handle(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'docket_get', arguments: { kind: 'project', id: PROJECT } } }),
    );
    const content = (JSON.parse(called ?? '{}') as { result: { isError?: boolean; content: { text: string }[] } }).result;
    expect(content.isError).toBeUndefined();
    expect(JSON.parse(content.content[0]?.text ?? '{}')).toMatchObject({ kind: 'data', name: 'Alpha', mainRepo: 'alpha-app' });
  });

  it('A-213: a child that lists chat tools but holds a run token (a forged DOCKET_MCP_KIND) is refused on every chat-only call', async () => {
    const { runToken, socketPath } = await setup();
    const forged = createMcpServer({ kind: 'chat', call: createSocketCaller({ socketPath, token: runToken }) });
    for (const [tool, args] of [
      ['docket_get', { kind: 'project', id: PROJECT }],
      ['docket_search', { query: 'alpha' }],
      ['page_comments_read', { pageId: '01ARZ3NDEKTSV4RRFFQ69G5FP1' }],
      ['draft_work_order', { project: PROJECT, repo: 'alpha-app', title: 'T' }],
      ['propose_setting', { key: 'dispatch.mode', value: 'fixed' }],
    ] as const) {
      const [reply] = await forged.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }));
      expect(JSON.parse(reply ?? '{}'), tool).toMatchObject({ result: { isError: true, content: [{ text: JSON.stringify({ code: 'forbidden' }) }] } });
    }
  });

  it('A-213: a chat-kind child creates a pending proposal through the real socket, and the page round trip works', async () => {
    const { chatToken, socketPath } = await setup();
    const server = createMcpServer({ kind: 'chat', call: createSocketCaller({ socketPath, token: chatToken }) });
    // The content text is the tool outcome's own payload: the result object, or { code } on isError.
    const call = async (tool: string, args: unknown): Promise<Record<string, unknown>> => {
      const [reply] = await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool, arguments: args } }));
      const parsed = JSON.parse(reply ?? '{}') as { result: { isError?: boolean; content: { text: string }[] } };
      return JSON.parse(parsed.result.content[0]?.text ?? '{}') as Record<string, unknown>;
    };
    expect(await call('propose_setting', { key: 'dispatch.mode', value: 'fixed' })).toMatchObject({ kind: 'receipt', status: 'pending_approval' });
    const page = await call('page_publish', { title: 'Tablo', kind: 'markdown', content: 'x' });
    expect(page).toMatchObject({ version: 1 });
    expect(await call('page_update', { pageId: page['pageId'], content: 'y' })).toMatchObject({ version: 2 });
  });

  it('I-83: a chat token is unauthorized once its turn is revoked', async () => {
    const { chatToken, socketPath, tokens } = await setup();
    const call = createSocketCaller({ socketPath, token: chatToken });
    expect((await call('docket_get', { kind: 'project', id: PROJECT })).ok).toBe(true);
    tokens.revoke(TURN);
    expect(await call('docket_get', { kind: 'project', id: PROJECT })).toEqual({ ok: false, code: 'unauthorized' });
  });
});
