// scenarios/chat-api.test.ts — the headless scenario of slice 6e-5: one whole chat round trip
// through the API boundary on a fake transport scripted mid-stream. The turn is started with a
// message through `chat.start`, its events arrive over the push channel, the test itself plays
// the MCP child through the real createDocketTools under the turn's own chat token (a page and a
// roadmap proposal), and the operator then drives the proposal card through the api: approve,
// see it applied, undo it while the window is open.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type Actor, type AgentEvent, type CatalogModel, type ProjectSlug, type RepoSlug, type RoleSlug, type Ulid } from '../../domain/index';

import {
  createActionApplier,
  createActionUndoer,
  createChatRunner,
  createChatTurnLedger,
  createDocketTools,
} from '../../application/services/index';
import type { AgentTransport, McpEndpoint, RunRequest } from '../../application/ports/index';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeIdGen,
  createFakeModelCatalog,
  createFakeRunDirs,
  createFakeRunTokens,
  createFakeTransportResolver,
} from '../../application/ports/fakes/index';

import { createApi, type ChatWiring, type UiEvent } from '../api';
import type { ChatConversationView } from '../chat-views';

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

const ATOLYE = slugOf<'project'>('atolye') as ProjectSlug;
const ACME = slugOf<'repo'>('acme') as RepoSlug;
const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5F0B');
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
 * MCP child would while the turn is mid-stream. */
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

describe('chat api scenario', () => {
  it('starts with a message, streams its turn, and drives the proposal card to applied and undone', async () => {
    const clock = createFakeClock(T0);
    const tokens = createFakeRunTokens();
    const runDirs = createFakeRunDirs();
    const definitions = createFakeDefinitionStore();
    definitions.setProject({ id: ATOLYE, name: 'Atölye', mainRepo: ACME, repos: [ACME] });
    definitions.seed({ kind: 'repo', repo: ACME }, 'defs.json', defs('acme'));
    definitions.seed({ kind: 'project', project: ATOLYE }, 'roadmap.yaml', ROADMAP_BEFORE);
    const transports = createFakeTransportResolver();
    const parked = parkedTransport([
      { type: 'text', at: T0 + 2, delta: 'Projeye baktım, ' },
      { type: 'tool_call', at: T0 + 3, id: 't1', name: 'page_publish' },
      { type: 'tool_result', at: T0 + 3, id: 't1', ok: true },
      { type: 'tool_call', at: T0 + 4, id: 't2', name: 'propose_change' },
      { type: 'tool_result', at: T0 + 4, id: 't2', ok: true },
      { type: 'text', at: T0 + 5, delta: 'sayfayı ve öneriyi hazırladım.' },
      { type: 'finished', at: T0 + 9, reason: 'completed' },
    ]);
    transports.register(ACCOUNT, parked.transport);

    const MODEL: CatalogModel = { id: 'm-bal', source: 'bundled', tier: 'balanced', thinking: 'unknown', billing: 'included', contextWindow: null };
    const deps = createFakeDeps({
      clock,
      ids: createFakeIdGen(),
      log: createFakeEventLog(),
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
      label: 'Ana hesap',
      authMode: 'subscription',
      limitPolicy: 'wait_resume',
      caps: [],
      tierModels: { strong: 'm-bal', balanced: 'm-bal', fast: 'm-bal' },
    });
    await deps.bindings.save({ level: 'global' }, { role: ROLE, accounts: [{ accountId: ACCOUNT }] });

    // The one ledger the write tools fill and the runner drains; the api rides the same runner.
    const ledger = createChatTurnLedger();
    const apply = createActionApplier(deps);
    const wiring: ChatWiring = { runner: createChatRunner(deps, { turnLedger: ledger }), apply, undo: createActionUndoer(deps) };
    const tools = createDocketTools(deps, { applyAction: apply, turnLedger: ledger });
    const api = createApi(deps, undefined, undefined, undefined, undefined, undefined, undefined, undefined, wiring);

    const events: UiEvent[] = [];
    let settle: ((outcome: string) => void) | undefined;
    const done = new Promise<string>((resolve) => {
      settle = resolve;
    });
    api.subscribe((event) => {
      events.push(event);
      if (event.type === 'chat.turn' && event.phase === 'finished' && settle !== undefined) settle(event.outcome ?? '');
    });

    // Start with a message: the conversation and its first turn answer together.
    const started = await api.command(OPERATOR, { type: 'chat.start', scope: { kind: 'project', project: ATOLYE }, message: 'Projeye bak, bir tablo sayfası çıkar ve yol haritasına not öner.' });
    if (!started.ok || started.conversation === undefined || started.turn === undefined) throw new Error(`fixture start: ${JSON.stringify(started)}`);
    const conversationId = ulidOf<'conversation'>(started.conversation);
    const turn = started.turn;
    while (parked.requests().length === 0) await Promise.resolve();

    // The test plays the MCP child: the token the runner minted drives the real tool dispatch.
    const minted = tokens.minted().find((entry) => entry.binding.kind === 'chat' && entry.binding.turn === turn);
    if (minted === undefined) throw new Error('the turn must have minted a chat token');
    const page = await tools.call({ token: minted.token, tool: 'page_publish', args: { title: 'Sprint tablosu', kind: 'table', content: 'iş,şehir\n1,Ankara\n' } });
    if (!page.ok) throw new Error(`fixture page: ${page.code}`);
    const pageId = (page.result as { readonly pageId: string }).pageId;
    const roadmapAfter = JSON.stringify({ phases: [], note: 'onaylandı' });
    const change = await tools.call({
      token: minted.token,
      tool: 'propose_change',
      args: { target: 'roadmap', scope: { kind: 'project', project: ATOLYE }, file: 'roadmap.yaml', after: roadmapAfter, summary: 'Yol haritasına not', source: 'operator request' },
    });
    if (!change.ok) throw new Error(`fixture change: ${change.code}`);
    const receipt = change.result as { readonly action: string; readonly status: string };

    parked.release();
    expect(await done).toBe('completed');
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('chat.turn');
    expect(types.filter((type) => type === 'chat.delta').length).toBe(2);
    expect(types[types.length - 1]).toBe('chat.turn');
    const deltas = events.filter((event): event is Extract<UiEvent, { type: 'chat.delta' }> => event.type === 'chat.delta');
    expect(deltas.map((delta) => delta.text).join('')).toBe('Projeye baktım, sayfayı ve öneriyi hazırladım.');

    // The conversation shows the assistant message with its page artifact and the pending action.
    const viewAfter = (await api.query({ type: 'chat.conversation', id: conversationId })) as ChatConversationView;
    const assistant = viewAfter.messages[viewAfter.messages.length - 1];
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.artifacts).toEqual([
      { kind: 'page', id: pageId, version: 1, title: 'Sprint tablosu', pageKind: 'table' },
      { kind: 'proposal', id: expect.any(String), label: 'Yol haritasına not', action: receipt.action },
    ]);
    expect(assistant?.sources).toEqual(['operator request']);
    const pending = viewAfter.actions.find((record) => record.id === receipt.action);
    expect(pending).toMatchObject({ class: 'roadmap_edit', status: 'pending', undoable: false });
    expect('activeTurn' in viewAfter && viewAfter.activeTurn).toBeFalsy(); // the turn is over

    // The operator approves; the roadmap really changed and the card turned applied + undoable.
    expect(receipt.status).toBe('pending_approval');
    expect(await api.command(OPERATOR, { type: 'chat.action.decide', id: receipt.action, decision: 'approved' })).toEqual({ ok: true });
    expect((await definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(roadmapAfter);
    const viewApplied = (await api.query({ type: 'chat.conversation', id: conversationId })) as ChatConversationView;
    const applied = viewApplied.actions.find((record) => record.id === receipt.action);
    expect(applied).toMatchObject({ status: 'applied', undoable: true, authority: 'user' });
    expect(typeof applied?.undoExpiresAt).toBe('number');

    // Undo while the window is open: the card turns undone and the roadmap is itself again.
    expect(await api.command(OPERATOR, { type: 'chat.action.undo', id: receipt.action })).toEqual({ ok: true });
    const viewUndone = (await api.query({ type: 'chat.conversation', id: conversationId })) as ChatConversationView;
    expect(viewUndone.actions.find((record) => record.id === receipt.action)).toMatchObject({ status: 'undone', undoable: false });
    expect((await definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(ROADMAP_BEFORE);
  });
});
