// scenarios/chat-turn.test.ts — rule A-242's headless scenario: one real chat turn on a project
// conversation. The scripted agent reads the project, publishes a page and proposes a roadmap
// change through the real createDocketTools under the turn's own chat token; the runner drains the
// ledger into the assistant message; the operator approves the proposal; a second turn runs on the
// same conversation; and deleting it leaves no token, run dir or ledger entry behind.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type Actor, type AgentEvent, type CatalogModel, type ProjectSlug, type RepoSlug, type RoleSlug, type Ulid } from '../../domain/index';

import { createFakeClock, createFakeDefinitionStore, createFakeDeps, createFakeEventLog, createFakeIdGen, createFakeModelCatalog, createFakeRunDirs, createFakeRunTokens, createFakeTransportResolver } from '../ports/fakes';
import { createActionApplier, createChatRunner, createChatTurnLedger, createDocketTools } from '../services/index';
import { decideActionUseCase, deleteConversation } from '../use-cases/index';
import type { AgentTransport, McpEndpoint, RunRequest } from '../ports';

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
const idOf = <B extends string>(n: number): Ulid<B> => ulidOf<B>(`01ARZ3NDEKTSV4RRFFQ69${String(n).padStart(5, '0')}`);

const ATOLYE = slugOf<'project'>('atolye') as ProjectSlug;
const ACME = slugOf<'repo'>('acme') as RepoSlug;
const ACCOUNT = idOf<'account'>(11);
const CONVERSATION = idOf<'conversation'>(12);
const ROLE = slugOf<'role'>('assistant') as RoleSlug;
const OPERATOR: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const T0 = 1_700_000_000_000;

const ENDPOINT: McpEndpoint = { socketPath: '/fake-socket/docket.sock', command: 'node', args: ['mcp-child.js'], env: {} };

const defs = (repo: string): string =>
  JSON.stringify({
    roles: [],
    flows: [{ id: 'main', name: 'Main', stages: [{ id: 'plan', name: 'Plan', role: null, exit: [{ kind: 'human', id: 'ok', label: 'Ok' }] }] }],
    capabilities: [],
    repo: { id: repo, name: repo, repos: [], flows: ['main'], defaultFlow: 'main', commandSets: {}, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
  });
const ROADMAP_BEFORE = JSON.stringify({ phases: [] });

/** A transport that parks before its finished event until released, so the scenario can act as the
 *  MCP child would while the turn is mid-stream. */
const parkedTransport = (script: readonly AgentEvent[]): { readonly transport: AgentTransport; readonly release: () => void; readonly requests: () => readonly RunRequest[] } => {
  const requests: RunRequest[] = [];
  let released = false;
  const waiters: (() => void)[] = [];
  const open = (): void => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  const transport: AgentTransport = {
    start: async (request) => {
      requests.push(request);
      return {
        ok: true,
        value: {
          events: (async function* (): AsyncGenerator<AgentEvent, void> {
            for (const event of script) {
              if (event.type === 'finished' && !released) await new Promise<void>((resolve) => waiters.push(resolve));
              yield event;
            }
          })(),
          answerPermission: (): void => undefined,
          steer: (): void => undefined,
          stop: async (): Promise<void> => open(),
        },
      };
    },
  };
  return { transport, release: () => { released = true; open(); }, requests: () => [...requests] };
};

describe('chat turn scenario', () => {
  it('A-242: a project conversation turn reads, publishes and proposes through the real tools; the operator decides; a second turn runs; deletion leaves nothing behind', async () => {
    const clock = createFakeClock(T0);
    const ids = createFakeIdGen();
    const log = createFakeEventLog();
    const tokens = createFakeRunTokens();
    const runDirs = createFakeRunDirs();
    const definitions = createFakeDefinitionStore();
    definitions.setProject({ id: ATOLYE, name: 'Atölye', mainRepo: ACME, repos: [ACME] });
    definitions.seed({ kind: 'repo', repo: ACME }, 'defs.json', defs('acme'));
    definitions.seed({ kind: 'project', project: ATOLYE }, 'roadmap.yaml', ROADMAP_BEFORE);
    const transports = createFakeTransportResolver();
    const parked = parkedTransport([
      { type: 'text', at: T0 + 2, delta: 'Projeye baktım, ' },
      { type: 'tool_call', at: T0 + 3, id: 't1', name: 'docket_get', target: ATOLYE },
      { type: 'tool_result', at: T0 + 3, id: 't1', ok: true },
      { type: 'tool_call', at: T0 + 4, id: 't2', name: 'page_publish' },
      { type: 'tool_result', at: T0 + 4, id: 't2', ok: true },
      { type: 'tool_call', at: T0 + 5, id: 't3', name: 'propose_change' },
      { type: 'tool_result', at: T0 + 5, id: 't3', ok: true },
      { type: 'text', at: T0 + 6, delta: 'sayfayı ve öneriyi hazırladım.' },
      { type: 'usage', at: T0 + 7, inputTokens: 200, outputTokens: 150 },
      { type: 'finished', at: T0 + 9, reason: 'completed' },
    ]);
    transports.register(ACCOUNT, parked.transport);

    const MODEL: CatalogModel = { id: 'm-bal', source: 'bundled', tier: 'balanced', thinking: 'unknown', billing: 'included', contextWindow: null };
    const deps = createFakeDeps({
      clock,
      ids,
      log,
      runTokens: tokens,
      runDirs,
      definitions,
      transports,
      modelCatalog: createFakeModelCatalog({ [ACCOUNT]: [MODEL] }),
      mcpEndpoint: ENDPOINT,
    });
    await deps.projects.save({ id: ATOLYE, name: 'Atölye', mainRepo: ACME, repos: [ACME] });
    await deps.accounts.save({
      id: ACCOUNT,
      provider: 'provider-x',
      label: 'Main',
      authMode: 'subscription',
      limitPolicy: 'wait_resume',
      caps: [],
      tierModels: { strong: 'm-bal', balanced: 'm-bal', fast: 'm-bal' },
    });
    await deps.bindings.save({ level: 'global' }, { role: ROLE, accounts: [{ accountId: ACCOUNT }] });
    await deps.conversations.save({
      id: CONVERSATION,
      scope: { kind: 'project', project: ATOLYE },
      title: 'plan',
      createdAt: T0 - 60_000,
      updatedAt: T0 - 60_000,
      pinned: false,
      messages: [],
    });

    // The real tool dispatch, the one action applier, and the one ledger the runner drains.
    const ledger = createChatTurnLedger();
    const apply = createActionApplier(deps);
    const tools = createDocketTools(deps, { applyAction: apply, turnLedger: ledger });
    const runner = createChatRunner(deps, { turnLedger: ledger });

    const seen: string[] = [];
    let settle: ((outcome: string) => void) | undefined;
    const done = new Promise<string>((resolve) => {
      settle = resolve;
    });
    runner.subscribe(CONVERSATION, (event) => {
      if (event.type === 'text') seen.push(event.delta);
      if (event.type === 'finished' && settle !== undefined) settle(event.outcome);
    });

    const started = await runner.startTurn({ conversation: CONVERSATION, message: { text: 'Projeye bak, bir tablo sayfası çıkar ve yol haritasına not öner.' }, by: OPERATOR });
    if (!started.ok) throw new Error(`fixture start: ${started.error.code}`);
    const turn = started.value.turn;
    while (parked.requests().length === 0) await Promise.resolve();
    expect(runner.active(CONVERSATION)).toBe(turn);

    // The chat token the runner minted is the one the child would hold.
    const minted = tokens.minted().find((entry) => entry.binding.kind === 'chat' && entry.binding.turn === turn);
    if (minted === undefined) throw new Error('the turn must have minted a chat token');
    const chat = minted.token;

    const read = await tools.call({ token: chat, tool: 'docket_get', args: { kind: 'project', id: ATOLYE } });
    expect(read).toMatchObject({ ok: true, result: { kind: 'data', source: 'docket_get project', name: 'Atölye', repos: [ACME] } });
    const page = await tools.call({ token: chat, tool: 'page_publish', args: { title: 'Sprint tablosu', kind: 'table', content: 'iş,şehir\n1,Ankara\n' } });
    if (!page.ok) throw new Error(`fixture page: ${page.code}`);
    const pageId = (page.result as { readonly pageId: string }).pageId;
    const roadmapAfter = JSON.stringify({ phases: [], note: 'onaylandı' });
    const change = await tools.call({
      token: chat,
      tool: 'propose_change',
      args: { target: 'roadmap', scope: { kind: 'project', project: ATOLYE }, file: 'roadmap.yaml', after: roadmapAfter, summary: 'Yol haritasına not', source: 'operator request' },
    });
    if (!change.ok) throw new Error(`fixture change: ${change.code}`);
    const receipt = change.result as { readonly action: string; readonly status: string };

    parked.release();
    expect(await done).toBe('completed');
    expect(seen.join('')).toBe('Projeye baktım, sayfayı ve öneriyi hazırladım.');

    // The assistant message is the record: text, the page artifact, the pending proposal artifact.
    const conversation = await deps.conversations.get(CONVERSATION);
    if (conversation === undefined) throw new Error('the conversation must exist');
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0]).toMatchObject({ role: 'user', text: 'Projeye bak, bir tablo sayfası çıkar ve yol haritasına not öner.' });
    expect(conversation.messages[1]).toMatchObject({
      role: 'assistant',
      text: 'Projeye baktım, sayfayı ve öneriyi hazırladım.',
      artifacts: [{ kind: 'page', page: pageId, version: 1 }, { kind: 'proposal', proposal: expect.any(String) }],
      sources: ['operator request'],
      usage: { inputTokens: 200, outputTokens: 150 },
    });

    // The operator approves the pending proposal through the one decision path.
    expect(receipt.status).toBe('pending_approval');
    const approved = await decideActionUseCase(deps, { id: receipt.action as never, decision: 'approved', by: OPERATOR }, apply);
    if (!approved.ok) throw new Error(`fixture approve: ${approved.error.code}`);
    expect((await definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(roadmapAfter);

    // A second turn on the same conversation works and leaves the first intact.
    let settleSecond: ((outcome: string) => void) | undefined;
    const doneSecond = new Promise<string>((resolve) => {
      settleSecond = resolve;
    });
    const off = runner.subscribe(CONVERSATION, (event) => {
      if (event.type === 'finished' && event.turn !== turn && settleSecond !== undefined) settleSecond(event.outcome);
    });
    const secondStarted = await runner.startTurn({ conversation: CONVERSATION, message: { text: 'İkinci soru' }, by: OPERATOR });
    if (!secondStarted.ok) throw new Error(`fixture second start: ${secondStarted.error.code}`);
    const secondTurn = secondStarted.value.turn;
    expect(await doneSecond).toBe('completed');
    off();
    const afterSecond = await deps.conversations.get(CONVERSATION);
    expect(afterSecond?.messages).toHaveLength(4);
    expect(afterSecond?.messages[3]).toMatchObject({ role: 'assistant' });

    // Deleting the conversation leaves no live token, run dir or ledger entry.
    const deleted = await deleteConversation(deps, { conversation: CONVERSATION, by: OPERATOR });
    if (!deleted.ok) throw new Error(`fixture delete: ${deleted.error.code}`);
    expect(tokens.live()).toEqual([]);
    expect(runDirs.live()).toEqual([]);
    expect(ledger.take(turn)).toEqual([]);
    expect(ledger.take(secondTurn)).toEqual([]);
  });
});
