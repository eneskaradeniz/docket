// scenarios/docket-ai-chat-flow.test.ts — one Docket AI conversation walked through its green and
// red paths with a scripted provider: the delta stream that folds into one stored message, the
// setup read ask answered both ways, the operator's proposal decisions, and the refusals the
// runner answers before anything starts. The agent is scripted; everything else — the tool
// dispatch under the turn's own chat token, the action applier, the proposal gates, the setup
// registry — is the real application code over the in-memory fakes.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type AccountId,
  type Actor,
  type AgentEvent,
  type CatalogModel,
  type ConversationId,
  type EpochMs,
  type MessageId,
  type ProjectSlug,
  type RepoSlug,
  type RoleSlug,
  type RunId,
  type Ulid,
} from '../../domain/index';

import type { AccountRecord, AgentTransport, McpEndpoint, RunRequest } from '../ports';
import {
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeIdGen,
  createFakeModelCatalog,
  createFakeRunDirs,
  createFakeRunTokens,
  createFakeTransport,
  createFakeTransportResolver,
  repoFlowOf,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeRunDirs,
  type FakeRunTokens,
  type FakeTransport,
  type FakeTransportResolver,
} from '../ports/fakes';
import {
  CHAT_NOTICE_TEXT_KEY,
  createActionApplier,
  createChatRunner,
  createChatTurnLedger,
  createDocketTools,
  createSetupContexts,
  type ChatNotice,
  type ChatRunner,
  type ChatTurnEvent,
  type ChatTurnLedger,
  type ChatTurnOutcome,
  type DocketTools,
  type SetupConversations,
  type SetupPathReader,
} from '../services/index';
import { decideActionUseCase, decideProposalUseCase, type ActionApplier, type SetupDraft, type SetupDraftStore } from '../use-cases/index';

// --- fixtures ----------------------------------------------------------------------------------------

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
const actionIdOf = (input: string) => {
  const parsed = parseUlid<'action'>(input);
  if (!parsed.ok) throw new Error(`fixture action id must parse: ${input}`);
  return parsed.value;
};
const proposalIdOf = (input: string) => {
  const parsed = parseUlid<'proposal'>(input);
  if (!parsed.ok) throw new Error(`fixture proposal id must parse: ${input}`);
  return parsed.value;
};

const ATOLYE = slugOf<'project'>('atolye') as ProjectSlug;
const ACME = slugOf<'repo'>('acme') as RepoSlug;
const ACCOUNT: AccountId = idOf<'account'>(11);
const OTHER_ACCOUNT: AccountId = idOf<'account'>(71);
const THIRD_ACCOUNT: AccountId = idOf<'account'>(72);
const DEAD_ACCOUNT: AccountId = idOf<'account'>(77);
const CONVERSATION = idOf<'conversation'>(12);
const ROLE = slugOf<'role'>('assistant') as RoleSlug;
const OPERATOR: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: idOf<'run'>(99), role: slugOf<'role'>('helper') };
const T0: EpochMs = 1_700_000_000_000;

const ENDPOINT: McpEndpoint = { socketPath: '/fake-socket/docket.sock', command: 'node', args: ['mcp-child.js'], env: {} };

const INCLUDED_MODEL: CatalogModel = { id: 'm-bal', source: 'bundled', tier: 'balanced', thinking: 'unknown', billing: 'included', contextWindow: null };
const METERED_MODEL: CatalogModel = { id: 'm-metered', source: 'bundled', tier: 'balanced', thinking: 'unknown', billing: 'metered', contextWindow: null };

const SETUP_REPO = '/Users/op/work/acme';
const SETUP_DATA = '/Users/op/.docket';
const SETUP_OUTSIDE = '/Users/op/notes/plan.md';
const SETUP_README = '/Users/op/work/acme/README.md';

const ROADMAP_V1 = JSON.stringify({ phases: [] });
const ROADMAP_V2 = JSON.stringify({ phases: [], note: 'asistan notu' });
const ROADMAP_V3 = JSON.stringify({ phases: [], note: 'operatör elle yazdı' });
const ROADMAP_V4 = JSON.stringify({ phases: [], note: 'ikinci öneri' });
const ROADMAP_V5 = JSON.stringify({ phases: [], note: 'yeniden elle yazdı' });

const MAIN_FLOW = { id: 'main', name: 'Main', stages: [{ id: 'plan', name: 'Plan', role: null, exit: [{ kind: 'human', id: 'ok', label: 'Ok' }] }] };
const defs = (repo: string): string =>
  JSON.stringify({
    roles: [],
    flows: [MAIN_FLOW],
    capabilities: [],
    repo: {
      id: repo,
      name: repo,
      flow: repoFlowOf(MAIN_FLOW),
      defaultLimitPolicy: 'wait_resume',
      commandSets: {},
      docsRoot: 'docs',
      testGlobs: [],
    },
  });

const at = (ms: number): EpochMs => T0 + ms;
const text = (delta: string): AgentEvent => ({ type: 'text', at: at(2), delta });
const thinking = (delta: string): AgentEvent => ({ type: 'thinking', at: at(1), delta });
const toolCall = (id: string, name: string, target?: string): AgentEvent => ({
  type: 'tool_call',
  at: at(3),
  id,
  name,
  ...(target === undefined ? {} : { target }),
});
const toolResult = (id: string, ok: boolean): AgentEvent => ({ type: 'tool_result', at: at(4), id, ok });
const usage = (): AgentEvent => ({ type: 'usage', at: at(4), inputTokens: 200, outputTokens: 150 });
const finished = (reason: 'completed' | 'failed' | 'cancelled' | 'limit'): AgentEvent => ({ type: 'finished', at: at(9), reason });
const limitHit = (): AgentEvent => ({ type: 'limit_hit', at: at(5), hit: { remedies: ['wait'], class: 'window_exhausted' } });
const errorEvent = (cls: Extract<AgentEvent, { readonly type: 'error' }>['class']): AgentEvent => ({ type: 'error', at: at(5), class: cls, message: 'boom' });

// --- the parked transport: a stream that rests before its finished event ----------------------------

/** A transport whose stream parks right before `finished` until `release()` (or `stop()`), so a
 *  scenario can act as the MCP child would while the turn is genuinely mid-stream. */
const parkedTransport = (script: readonly AgentEvent[]): {
  readonly transport: AgentTransport;
  readonly release: () => void;
  readonly requests: () => readonly RunRequest[];
  readonly stops: () => number;
} => {
  const requests: RunRequest[] = [];
  let stops = 0;
  let released = false;
  let stopped = false;
  const waiters: (() => void)[] = [];
  const park = (): Promise<void> => (released ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve)));
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
              if (stopped) return;
              if (event.type === 'finished') await park();
              if (stopped) return;
              yield event;
            }
          })(),
          answerPermission: (): void => undefined,
          steer: (): void => undefined,
          stop: async (): Promise<void> => {
            stops += 1;
            stopped = true;
            open();
          },
        },
      };
    },
  };
  return { transport, release: () => { released = true; open(); }, requests: () => [...requests], stops: () => stops };
};

// --- setup fixtures: the path reader and the draft store --------------------------------------------

const memoryReader = (files: Readonly<Record<string, string>>): SetupPathReader => ({
  resolve: (path) => path,
  read: async (path) => {
    const content = files[path];
    return content === undefined ? { kind: 'missing' } : { kind: 'file', content };
  },
});

const recordingDrafts = (): SetupDraftStore & { readonly saved: readonly SetupDraft[] } => {
  const saved: SetupDraft[] = [];
  const byId = new Map<string, SetupDraft>();
  return {
    saved,
    save: async (draft) => {
      saved.push(draft);
      byId.set(draft.id, draft);
    },
    load: async (id) => byId.get(id),
    newest: async () => [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0],
  };
};

// --- the world ----------------------------------------------------------------------------------------

interface World {
  readonly deps: ReturnType<typeof createFakeDeps>;
  readonly conversation: ConversationId;
  readonly runner: ChatRunner;
  readonly tools: DocketTools;
  readonly ledger: ChatTurnLedger;
  readonly apply: ActionApplier;
  readonly transports: FakeTransportResolver;
  readonly transport: FakeTransport;
  /** Transports registered for the other live accounts, to prove no fallback route ever starts. */
  readonly otherTransports: readonly FakeTransport[];
  readonly tokens: FakeRunTokens;
  readonly runDirs: FakeRunDirs;
  readonly log: FakeEventLog;
  readonly definitions: FakeDefinitionStore;
  readonly registry: SetupConversations | undefined;
}

const accountRecord = (id: AccountId, overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id,
  provider: 'provider-x',
  label: 'Main',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  tierModels: { strong: 'm-bal', balanced: 'm-bal', fast: 'm-bal' },
  ...overrides,
});

const world = async (options: {
  readonly mcpUnsupported?: boolean;
  readonly models?: readonly CatalogModel[];
  readonly account?: Partial<AccountRecord>;
  readonly bindingAccounts?: readonly AccountId[];
  readonly setup?: { readonly repoPath: string; readonly files: Readonly<Record<string, string>> };
} = {}): Promise<World> => {
  const clock = createFakeClock(T0);
  const ids = createFakeIdGen();
  const log = createFakeEventLog();
  const tokens = createFakeRunTokens();
  const runDirs = createFakeRunDirs();
  const definitions = createFakeDefinitionStore();
  definitions.setProject({ id: ATOLYE, name: 'Atölye', repos: [ACME] });
  definitions.seed({ kind: 'repo', repo: ACME }, 'defs.json', defs('acme'));
  definitions.seed({ kind: 'project', project: ATOLYE }, 'roadmap.yaml', ROADMAP_V1);
  const transports = createFakeTransportResolver();
  const transport = createFakeTransport([finished('completed')]);
  transports.register(ACCOUNT, transport);
  const otherTransports: FakeTransport[] = [];
  for (const account of [OTHER_ACCOUNT, THIRD_ACCOUNT]) {
    const extra = createFakeTransport([finished('completed')]);
    transports.register(account, extra);
    otherTransports.push(extra);
  }

  const deps = createFakeDeps({
    clock,
    ids,
    log,
    runTokens: tokens,
    runDirs,
    definitions,
    transports,
    capabilities: createFakeCapabilityCatalog(
      options.mcpUnsupported === true ? [{ id: 'rk-x', provider: 'provider-x', authMode: 'subscription', mcp: false }] : [],
    ),
    modelCatalog: createFakeModelCatalog({
      [ACCOUNT]: options.models ?? [INCLUDED_MODEL],
      [OTHER_ACCOUNT]: [INCLUDED_MODEL],
      [THIRD_ACCOUNT]: [INCLUDED_MODEL],
    }),
    mcpEndpoint: ENDPOINT,
  });
  await deps.projects.save({ id: ATOLYE, name: 'Atölye', repos: [ACME] });
  await deps.accounts.save(accountRecord(ACCOUNT, options.account));
  await deps.accounts.save(accountRecord(OTHER_ACCOUNT));
  await deps.accounts.save(accountRecord(THIRD_ACCOUNT));
  await deps.bindings.save({ level: 'global' }, { role: ROLE, accounts: (options.bindingAccounts ?? [ACCOUNT]).map((accountId) => ({ accountId })) });

  const conversation: ConversationId = options.setup === undefined ? CONVERSATION : idOf<'conversation'>(13);
  await deps.conversations.save({
    id: conversation,
    scope: options.setup === undefined ? { kind: 'project', project: ATOLYE } : { kind: 'global' },
    title: 'plan',
    createdAt: T0 - 60_000,
    updatedAt: T0 - 60_000,
    pinned: false,
    messages: [],
  });

  let registry: SetupConversations | undefined;
  if (options.setup !== undefined) {
    registry = createSetupContexts({ clock, ids }, { dataDir: SETUP_DATA, drafts: recordingDrafts(), reader: memoryReader(options.setup.files) });
    registry.register({ conversation, repoPath: options.setup.repoPath });
  }

  const ledger = createChatTurnLedger();
  const apply = createActionApplier(deps);
  const tools = createDocketTools(deps, {
    applyAction: apply,
    turnLedger: ledger,
    ...(registry === undefined ? {} : { setupContextOf: registry.contextOf }),
  });
  const runner = createChatRunner(deps, { turnLedger: ledger, ...(registry === undefined ? {} : { setupContexts: registry }) });
  return { deps, conversation, runner, tools, ledger, apply, transports, transport, otherTransports, tokens, runDirs, log, definitions, registry };
};

// --- turn drivers --------------------------------------------------------------------------------------

interface TurnResult {
  readonly turn: RunId;
  readonly outcome: ChatTurnOutcome;
  readonly notice: ChatNotice | undefined;
  readonly message: MessageId | undefined;
  readonly deltas: readonly string[];
}

const finishedOf = (w: World, turn: RunId): Promise<TurnResult> =>
  new Promise((resolve) => {
    const deltas: string[] = [];
    let notice: ChatNotice | undefined;
    const off = w.runner.subscribe(w.conversation, (event) => {
      if (event.type === 'text') deltas.push(event.delta);
      if (event.type === 'notice') notice = event.code;
      if (event.type === 'finished' && event.turn === turn) {
        off();
        resolve({ turn, outcome: event.outcome, notice, message: event.message, deltas });
      }
    });
  });

const deltasOf = (w: World, turn: RunId): { readonly deltas: () => readonly string[]; readonly off: () => void } => {
  const deltas: string[] = [];
  const off = w.runner.subscribe(w.conversation, (event) => {
    if (event.type === 'text' && event.turn === turn) deltas.push(event.delta);
  });
  return { deltas: () => [...deltas], off };
};

/** A turn whose scripted stream runs to its end on its own. */
const runTurn = async (w: World, script: readonly AgentEvent[], message: string): Promise<TurnResult> => {
  w.transports.register(ACCOUNT, createFakeTransport(script));
  const started = await w.runner.startTurn({ conversation: w.conversation, message: { text: message }, by: OPERATOR });
  if (!started.ok) throw new Error(`fixture start: ${started.error.code}`);
  return finishedOf(w, started.value.turn);
};

/** A turn that parks before its `finished` event: the scenario holds the turn's own chat token and
 *  acts as the MCP child would, then releases the stream. */
const parkedTurn = async (
  w: World,
  script: readonly AgentEvent[],
  message: string,
): Promise<{
  readonly turn: RunId;
  readonly token: string;
  readonly release: () => void;
  readonly requests: () => readonly RunRequest[];
  readonly stops: () => number;
  readonly done: Promise<TurnResult>;
}> => {
  const parked = parkedTransport(script);
  w.transports.register(ACCOUNT, parked.transport);
  const started = await w.runner.startTurn({ conversation: w.conversation, message: { text: message }, by: OPERATOR });
  if (!started.ok) throw new Error(`fixture start: ${started.error.code}`);
  const turn = started.value.turn;
  for (let spin = 0; parked.requests().length === 0; spin += 1) {
    if (spin > 100_000) throw new Error('the turn never reached its transport');
    await Promise.resolve();
  }
  const minted = w.tokens.minted().find((entry) => entry.binding.kind === 'chat' && entry.binding.turn === turn);
  if (minted === undefined) throw new Error('the turn must have minted a chat token');
  return { turn, token: minted.token, release: parked.release, requests: parked.requests, stops: parked.stops, done: finishedOf(w, turn) };
};

const lastMessage = async (w: World) => {
  const conversation = await w.deps.conversations.get(w.conversation);
  const last = conversation?.messages[conversation.messages.length - 1];
  if (last === undefined) throw new Error('the conversation must hold a message');
  return last;
};

// --- the thinking/step scenarios' own drivers (A-442) ---------------------------------------------------

type StepSeen = Extract<ChatTurnEvent, { readonly type: 'step' }>;
type NoticeSeen = Extract<ChatTurnEvent, { readonly type: 'notice' }>;

/** One turn watched for its whole event stream — text, thinking and steps in arrival order — and
 *  resolved when it finishes. */
const watchedTurn = (
  w: World,
  script: readonly AgentEvent[],
  message: string,
): Promise<TurnResult & { readonly events: () => readonly ChatTurnEvent[]; readonly steps: readonly StepSeen[] }> => {
  w.transports.register(ACCOUNT, createFakeTransport(script));
  const events: ChatTurnEvent[] = [];
  return new Promise((resolve) => {
    const off = w.runner.subscribe(w.conversation, (event) => {
      events.push(event);
      if (event.type !== 'finished') return;
      off();
      const notice = events.find((entry): entry is NoticeSeen => entry.type === 'notice')?.code;
      const deltas = events.filter((entry) => entry.type === 'text').map((entry) => (entry.type === 'text' ? entry.delta : ''));
      resolve({
        turn: event.turn,
        outcome: event.outcome,
        notice,
        message: event.message,
        deltas,
        events: () => [...events],
        steps: events.filter((entry): entry is StepSeen => entry.type === 'step'),
      });
    });
    void w.runner.startTurn({ conversation: w.conversation, message: { text: message }, by: OPERATOR }).then((started) => {
      if (!started.ok) throw new Error(`fixture start: ${started.error.code}`);
    });
  });
};

/** After a scenario: the serialized audit trail, the stored messages and the conversation record —
 *  the store the `chat.conversation` read serves — hold none of the distinctive strings. */
const assertNothingPersisted = async (w: World, distinctive: readonly string[]): Promise<void> => {
  const conversation = await w.deps.conversations.get(w.conversation);
  const dumps = [
    JSON.stringify(w.log.entries()),
    JSON.stringify(conversation?.messages ?? []),
    JSON.stringify(conversation ?? {}),
  ];
  for (const mark of distinctive) {
    for (const dump of dumps) expect(dump, mark).not.toContain(mark);
  }
};

const proposeRoadmap = async (w: World, token: string, after: string, summary: string) => {
  const change = await w.tools.call({
    token,
    tool: 'propose_change',
    args: { target: 'roadmap', scope: { kind: 'project', project: ATOLYE }, file: 'roadmap.yaml', after, summary, source: 'operator request' },
  });
  if (!change.ok) throw new Error(`fixture propose: ${change.code}`);
  const receipt = change.result as { readonly proposal: string; readonly action: string; readonly status: string };
  return { proposal: proposalIdOf(receipt.proposal), action: actionIdOf(receipt.action), status: receipt.status };
};

// --- the scenarios ------------------------------------------------------------------------------------

describe('docket ai chat flow scenarios', () => {
  it('A-231: one conversation through green and red — one stored message per turn, an operator-approved proposal (R-36), a limit hit, an error class and a mid-turn cancel (A-237, A-240)', async () => {
    const w = await world();

    // Green: the delta stream folds into exactly one assistant message, and the proposal the agent
    // made mid-turn rides that message as its artifact.
    const first = await parkedTurn(w, [text('Bir baktım, '), text('öneriyi '), text('hazırladım.'), usage(), finished('completed')], 'Projeye bak ve bir not öner.');
    const receipt = await proposeRoadmap(w, first.token, ROADMAP_V2, 'Yol haritasına not');
    expect(receipt.status).toBe('pending_approval');
    first.release();
    const green = await first.done;
    expect(green.outcome).toBe('completed');
    expect(green.deltas).toEqual(['Bir baktım, ', 'öneriyi ', 'hazırladım.']);
    const conversation = await w.deps.conversations.get(w.conversation);
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[1]).toMatchObject({
      role: 'assistant',
      text: 'Bir baktım, öneriyi hazırladım.',
      artifacts: [{ kind: 'proposal', proposal: receipt.proposal }],
      sources: ['operator request'],
      usage: { inputTokens: 200, outputTokens: 150 },
    });
    const greenMessage = conversation?.messages[1];
    if (greenMessage === undefined) throw new Error('the green turn must have stored its message');
    expect(green.message).toBe(greenMessage.id);
    expect(w.runner.active(w.conversation)).toBeUndefined();
    expect(w.tokens.live()).toEqual([]);
    expect(w.runDirs.live()).toEqual([]);

    // The operator approves through the one decision path: the file changes, both records settle.
    const approved = await decideActionUseCase(w.deps, { id: receipt.action, decision: 'approved', by: OPERATOR }, w.apply);
    if (!approved.ok) throw new Error(`fixture approve: ${approved.error.code}`);
    expect(approved.value.status).toBe('applied');
    expect(await w.deps.proposals.get(receipt.proposal)).toMatchObject({ status: 'approved' });
    expect((await w.definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(ROADMAP_V2);

    // Red: a limit hit ends the turn with the limit notice message — no handoff, no second attempt.
    const limit = await runTurn(w, [limitHit()], 'Bir soru daha.');
    expect(limit.outcome).toBe('limit');
    expect(limit.notice).toBe('limit');
    expect(await lastMessage(w)).toMatchObject({ role: 'assistant', text: CHAT_NOTICE_TEXT_KEY.limit });

    // Red: an error class names the notice of a failed turn.
    const failed = await runTurn(w, [errorEvent('auth'), finished('failed')], 'Devam et.');
    expect(failed.outcome).toBe('failed');
    expect(failed.notice).toBe('auth');
    expect(await lastMessage(w)).toMatchObject({ role: 'assistant', text: CHAT_NOTICE_TEXT_KEY.auth });

    // Red: the operator cancels mid-turn; the partial text is still the turn's one message.
    const cancelled = await parkedTurn(w, [text('Yarım kalan cevap'), finished('completed')], 'Uzun bir iş yap.');
    const seen = deltasOf(w, cancelled.turn);
    while (seen.deltas().length < 1) await Promise.resolve();
    seen.off();
    const stopAgain = await w.runner.cancel(w.conversation, OPERATOR);
    if (!stopAgain.ok) throw new Error(`fixture cancel: ${stopAgain.error.code}`);
    const red = await cancelled.done;
    expect(red.outcome).toBe('cancelled');
    expect(cancelled.stops()).toBe(1);
    expect(await lastMessage(w)).toMatchObject({ role: 'assistant', text: 'Yarım kalan cevap' });
    // A cancel after the turn ended is an ok no-op that stops nothing.
    const idle = await w.runner.cancel(w.conversation, OPERATOR);
    expect(idle.ok).toBe(true);
    expect(cancelled.stops()).toBe(1);
    expect(w.runner.active(w.conversation)).toBeUndefined();
    expect(w.tokens.live()).toEqual([]);
    expect(w.runDirs.live()).toEqual([]);

    // One conversation, four turns: exactly one stored message each.
    const afterAll = await w.deps.conversations.get(w.conversation);
    expect(afterAll?.messages).toHaveLength(8);
  });

  it('A-358: a setup conversation\'s read ask answered allow becomes a session grant the agent\'s retry reads through', async () => {
    const w = await world({
      setup: { repoPath: SETUP_REPO, files: { [SETUP_OUTSIDE]: 'the migration plan', [SETUP_README]: 'acme readme' } },
    });
    const registry = w.registry;
    if (registry === undefined) throw new Error('fixture registry');

    // An in-scope path reads without any ask; the out-of-scope path asks once, with the reason line.
    const events: ConversationId[] = [];
    registry.subscribeAsk((asked) => events.push(asked));
    const turn = await parkedTurn(w, [text('Planı okuyorum.'), finished('completed')], 'Kurulumu başlat ve planı oku.');
    // The setup conversation's token is minted with the setup kind.
    expect(w.tokens.minted().some((entry) => entry.binding.kind === 'chat' && entry.binding.conversationKind === 'setup' && entry.binding.turn === turn.turn)).toBe(true);

    const readme = await w.tools.call({ token: turn.token, tool: 'docket_read_path', args: { path: SETUP_README, reason: 'read the readme' } });
    expect(readme).toMatchObject({ ok: true, result: { kind: 'data', source: 'docket_read_path', excerpt: 'acme readme' } });
    expect(registry.askOf(w.conversation)).toBeUndefined();
    expect(events).toEqual([]);

    // The out-of-scope path asks once, with the agent's reason line.
    const asked = await w.tools.call({ token: turn.token, tool: 'docket_read_path', args: { path: SETUP_OUTSIDE, reason: 'read the migration plan' } });
    expect(asked).toMatchObject({ ok: true, result: { kind: 'ask', path: SETUP_OUTSIDE } });
    expect(registry.askOf(w.conversation)).toEqual({ path: SETUP_OUTSIDE, reason: 'read the migration plan' });
    expect(events).toEqual([w.conversation]);

    // The operator allows: the ask clears into a session grant and the retry reads through it.
    expect(registry.answer(w.conversation, SETUP_OUTSIDE, true)).toBe(true);
    expect(registry.askOf(w.conversation)).toBeUndefined();
    const retry = await w.tools.call({ token: turn.token, tool: 'docket_read_path', args: { path: SETUP_OUTSIDE, reason: 'retry after allow' } });
    expect(retry).toMatchObject({ ok: true, result: { kind: 'data', source: 'docket_read_path', excerpt: 'the migration plan' } });

    turn.release();
    const done = await turn.done;
    expect(done.outcome).toBe('completed');
    expect(await lastMessage(w)).toMatchObject({ role: 'assistant', text: 'Planı okuyorum.' });
    // The turn ends clean, like every other one.
    expect(w.tokens.live()).toEqual([]);
    expect(w.runDirs.live()).toEqual([]);
  });

  it('A-358: a denied read ask is remembered — the retry is a typed refusal, never a second ask', async () => {
    const w = await world({ setup: { repoPath: SETUP_REPO, files: { [SETUP_OUTSIDE]: 'the migration plan' } } });
    const registry = w.registry;
    if (registry === undefined) throw new Error('fixture registry');
    const events: ConversationId[] = [];
    registry.subscribeAsk((asked) => events.push(asked));

    const turn = await parkedTurn(w, [text('Planı istiyorum.'), finished('completed')], 'Planı oku.');
    const asked = await w.tools.call({ token: turn.token, tool: 'docket_read_path', args: { path: SETUP_OUTSIDE, reason: 'read the plan' } });
    expect(asked).toMatchObject({ ok: true, result: { kind: 'ask', path: SETUP_OUTSIDE } });
    expect(events).toEqual([w.conversation]);

    expect(registry.answer(w.conversation, SETUP_OUTSIDE, false)).toBe(true);
    expect(registry.askOf(w.conversation)).toBeUndefined();

    const retry = await w.tools.call({ token: turn.token, tool: 'docket_read_path', args: { path: SETUP_OUTSIDE, reason: 'try again' } });
    expect(retry).toMatchObject({ ok: false, code: 'forbidden' });
    // The refusal asked nothing: no second prompt, no pending ask left behind.
    expect(events).toEqual([w.conversation]);
    expect(registry.askOf(w.conversation)).toBeUndefined();

    turn.release();
    expect((await turn.done).outcome).toBe('completed');
  });

  it('A-235: an unanswered spend-consent ask refuses the turn before anything starts — the chat flow\'s start_refused', async () => {
    // The consent the account never received is the ask that went unanswered: the turn refuses
    // with the consent notice, nothing starts, and the durable trace is the audit's refused outcome.
    const w = await world({
      models: [METERED_MODEL],
      account: { tierModels: { strong: 'm-metered', balanced: 'm-metered', fast: 'm-metered' } },
    });
    const refused = await runTurn(w, [finished('completed')], 'Bir soru sorayım.');
    expect(refused.outcome).toBe('refused');
    expect(refused.notice).toBe('consent');
    expect(await lastMessage(w)).toMatchObject({ role: 'assistant', text: CHAT_NOTICE_TEXT_KEY.consent });
    // Nothing started: no model call, no token, no run dir, and the slot is free again.
    expect(w.transport.requests()).toEqual([]);
    expect(w.tokens.minted()).toEqual([]);
    expect(w.runDirs.live()).toEqual([]);
    expect(w.runner.active(w.conversation)).toBeUndefined();
    const audit = w.log
      .entries()
      .filter((entry) => entry.action === 'chat.turn_finished')
      .map((entry) => entry.detail?.outcome);
    expect(audit).toEqual(['refused']);
  });

  it('A-300: a binding whose accounts are all gone refuses with no_binding — no fallback onto another live route', async () => {
    const w = await world({ bindingAccounts: [DEAD_ACCOUNT] });
    const refused = await runTurn(w, [finished('completed')], 'Bir soru sorayım.');
    expect(refused.outcome).toBe('refused');
    expect(refused.notice).toBe('no_binding');
    expect(await lastMessage(w)).toMatchObject({ role: 'assistant', text: CHAT_NOTICE_TEXT_KEY.no_binding });
    // Two other accounts are alive and registered, but the runner never widens the route by itself.
    expect(w.transport.requests()).toEqual([]);
    expect(w.otherTransports.flatMap((transport) => transport.requests())).toEqual([]);
    expect(w.tokens.minted()).toEqual([]);
    expect(w.runDirs.live()).toEqual([]);
  });

  it('A-235: a provider that cannot attach MCP refuses the turn with tools_unavailable', async () => {
    const w = await world({ mcpUnsupported: true });
    const refused = await runTurn(w, [finished('completed')], 'Bir soru sorayım.');
    expect(refused.outcome).toBe('refused');
    expect(refused.notice).toBe('tools_unavailable');
    expect(await lastMessage(w)).toMatchObject({ role: 'assistant', text: CHAT_NOTICE_TEXT_KEY.tools_unavailable });
    expect(w.transport.requests()).toEqual([]);
    expect(w.tokens.minted()).toEqual([]);
    expect(w.runDirs.live()).toEqual([]);
  });

  it('R-37: approving a proposal whose file moved is stale — the proposal is marked stale and nothing is written; rejecting an equally moved one is allowed', async () => {
    const w = await world();

    // The agent proposes against the file as it is; the operator edits it by hand afterwards.
    const first = await parkedTurn(w, [text('Öneriyi yazdım.'), finished('completed')], 'Bir not öner.');
    const p1 = await proposeRoadmap(w, first.token, ROADMAP_V2, 'Birinci öneri');
    first.release();
    expect((await first.done).outcome).toBe('completed');
    w.definitions.seed({ kind: 'project', project: ATOLYE }, 'roadmap.yaml', ROADMAP_V3);

    const stale = await decideActionUseCase(w.deps, { id: p1.action, decision: 'approved', by: OPERATOR }, w.apply);
    if (!stale.ok) throw new Error(`fixture decide: ${stale.error.code}`);
    expect(stale.value.status).toBe('failed');
    expect(stale.value.failure).toBe('stale');
    expect(await w.deps.proposals.get(p1.proposal)).toMatchObject({ status: 'stale' });
    expect((await w.definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(ROADMAP_V3);

    // A second proposal on the moved file, then the file moves again: rejection still succeeds.
    // The operator's rejection of the action card settles the action and never applies anything;
    // the proposal's own decision path also allows rejecting a proposal whose file moved.
    const second = await parkedTurn(w, [text('İkinci öneri.'), finished('completed')], 'Başka bir not öner.');
    const p2 = await proposeRoadmap(w, second.token, ROADMAP_V4, 'İkinci öneri');
    second.release();
    expect((await second.done).outcome).toBe('completed');
    w.definitions.seed({ kind: 'project', project: ATOLYE }, 'roadmap.yaml', ROADMAP_V5);

    const rejected = await decideActionUseCase(w.deps, { id: p2.action, decision: 'rejected', by: OPERATOR }, w.apply);
    if (!rejected.ok) throw new Error(`fixture reject: ${rejected.error.code}`);
    expect(rejected.value.status).toBe('rejected');
    expect((await w.definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(ROADMAP_V5);

    const proposalRejected = await decideProposalUseCase(w.deps, { id: p2.proposal, decision: 'rejected', actor: OPERATOR });
    if (!proposalRejected.ok) throw new Error(`fixture proposal reject: ${proposalRejected.error}`);
    expect(proposalRejected.value.status).toBe('rejected');
    expect(await w.deps.proposals.get(p2.proposal)).toMatchObject({ status: 'rejected' });
    expect((await w.definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(ROADMAP_V5);
  });

  it('R-38: an agent actor never approves — self_approval at the proposal, not_user at the action, and the operator still can', async () => {
    const w = await world();
    const turn = await parkedTurn(w, [text('Öneriyi yazdım.'), finished('completed')], 'Bir not öner.');
    const made = await proposeRoadmap(w, turn.token, ROADMAP_V2, 'Asistan önerisi');
    turn.release();
    expect((await turn.done).outcome).toBe('completed');

    // The proposal gate refuses the agent by its own name.
    const selfApproval = await decideProposalUseCase(w.deps, { id: made.proposal, decision: 'approved', actor: AGENT });
    expect(selfApproval.ok).toBe(false);
    if (selfApproval.ok) throw new Error('unreachable');
    expect(selfApproval.error).toBe('self_approval');
    expect(await w.deps.proposals.get(made.proposal)).toMatchObject({ status: 'pending' });

    // The action path refuses the agent before it reaches any proposal.
    const agentDecision = await decideActionUseCase(w.deps, { id: made.action, decision: 'approved', by: AGENT }, w.apply);
    expect(agentDecision.ok).toBe(false);
    if (agentDecision.ok) throw new Error('unreachable');
    expect(agentDecision.error.code).toBe('not_user');
    expect((await w.deps.actions.get(made.action))?.status).toBe('pending');
    expect((await w.definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(ROADMAP_V1);

    // The state was never the obstacle: the operator's approval applies the same proposal.
    const approved = await decideActionUseCase(w.deps, { id: made.action, decision: 'approved', by: OPERATOR }, w.apply);
    if (!approved.ok) throw new Error(`fixture approve: ${approved.error.code}`);
    expect(approved.value.status).toBe('applied');
    expect((await w.definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(ROADMAP_V2);
  });

  it('A-237: each error class names its notice — auth, network, timeout as network, the rest crash', async () => {
    const w = await world();
    const cases: readonly { readonly cls: Extract<AgentEvent, { readonly type: 'error' }>['class']; readonly notice: ChatNotice }[] = [
      { cls: 'auth', notice: 'auth' },
      { cls: 'network', notice: 'network' },
      { cls: 'timeout', notice: 'network' },
      { cls: 'protocol', notice: 'crash' },
    ];
    for (const { cls, notice } of cases) {
      const failed = await runTurn(w, [errorEvent(cls), finished('failed')], `Soru: ${cls}`);
      expect(failed.outcome).toBe('failed');
      expect(failed.notice).toBe(notice);
      expect(await lastMessage(w)).toMatchObject({ role: 'assistant', text: CHAT_NOTICE_TEXT_KEY[notice] });
    }
    // Four failed turns, one stored message each.
    const conversation = await w.deps.conversations.get(w.conversation);
    expect(conversation?.messages).toHaveLength(8);
    expect(w.runner.active(w.conversation)).toBeUndefined();
  });

  // --- thinking and tool steps (A-442; the rules are A-438 … A-441) ------------------------------------

  it('A-442: (a) thinking given — the stream shows thinking, step called, step done and text in order, and the stored message is the text alone', async () => {
    const w = await world();
    const THINK = 'GIZLI-DUSUNCE-8f3a';
    const TARGET = 'docs/gizli-plan-8f3a.md';
    const TOOL = 'mcp__docket-pages__docket_get';
    const turn = await watchedTurn(
      w,
      [thinking(`Önce ${THINK} ile dosyaya bakayım.`), toolCall('t1', TOOL, TARGET), toolResult('t1', true), text('Baktım, tamam.'), finished('completed')],
      'Dosyaya bak.',
    );
    expect(turn.events().map((event) => event.type)).toEqual(['started', 'thinking', 'step', 'step', 'text', 'finished']);
    expect(turn.steps[0]).toMatchObject({ id: 't1', phase: 'called', tool: 'docket_get', server: 'docket-pages', target: TARGET });
    expect(turn.steps[1]).toMatchObject({ id: 't1', phase: 'done', tool: 'docket_get', target: TARGET });
    expect(turn.deltas).toEqual(['Baktım, tamam.']);
    expect((await lastMessage(w)).text).toBe('Baktım, tamam.');
    await assertNothingPersisted(w, [THINK, TARGET, TOOL]);
  });

  it('A-442: (b) thinking absent — a tool-only turn announces its steps and no thinking event at all', async () => {
    const w = await world();
    const TARGET = 'docs/arama-8f3b.md';
    const turn = await watchedTurn(
      w,
      [toolCall('u1', 'docket_search', TARGET), toolResult('u1', true), text('Aramayı yaptım.'), finished('completed')],
      'Ara.',
    );
    expect(turn.events().filter((event) => event.type === 'thinking')).toEqual([]);
    expect(turn.steps.map((step) => [step.id, step.phase])).toEqual([['u1', 'called'], ['u1', 'done']]);
    expect((await lastMessage(w)).text).toBe('Aramayı yaptım.');
    await assertNothingPersisted(w, [TARGET, 'docket_search']);
  });

  it('A-442: (c) tool step — secrets, an outside absolute path, a URL\'s userinfo and query, and a secret-named file never ride; a two-line target is one line cut at 120', async () => {
    const w = await world();
    const TOKEN = ['ghp', 'KiNoY5tAnMoDe3'.repeat(3)].join('_');
    const OUTSIDE = '/Users/op/gizli-dizin-8f3c/plan.md';
    const USER = 'kullanici';
    const PW = ['sifre', '8f3d'].join('-');
    const AUTH = [USER, PW].join(String.fromCharCode(58));
    const URL = ['https', '://', AUTH, '@example.com/rapor?gizli=1'].join('');
    const SECRET_FILE = 'keys/id_rsa';
    const LONG_WORD = 'komut-8f3e'.padEnd(126, 'u');
    const turn = await watchedTurn(
      w,
      [
        toolCall('s1', 'Bash', `echo ${TOKEN}`),
        toolCall('s2', 'Read', OUTSIDE),
        toolCall('s3', 'WebFetch', URL),
        toolCall('s4', 'Read', SECRET_FILE),
        toolCall('s5', 'Bash', `${LONG_WORD}\nikinci satır 8f3f`),
        text('Baktım.'),
        finished('completed'),
      ],
      'Çeşitli araçları çağır.',
    );
    expect(turn.steps.map((step) => step.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(turn.steps.map((step) => step.target)).toEqual([undefined, undefined, 'example.com', undefined, LONG_WORD.slice(0, 120)]);
    for (const step of turn.steps) expect(step.tool.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(turn.events());
    for (const mark of [TOKEN, 'gizli-dizin-8f3c', 'kullanici', 'sifre-8f3d', 'gizli=1', 'id_rsa', 'ikinci satır']) {
      expect(serialized).not.toContain(mark);
    }
    expect((await lastMessage(w)).text).toBe('Baktım.');
    await assertNothingPersisted(w, [TOKEN, 'gizli-dizin-8f3c', 'sifre-8f3d', 'id_rsa', 'ikinci satır']);
  });

  it('A-442: (d) error step — a failed result is a step failed while the turn still ends as the script decides, and an error event is a notice with no step', async () => {
    const w = await world();
    const failedStep = await watchedTurn(
      w,
      [toolCall('e1', 'Bash', 'git'), toolResult('e1', false), text('Kısmi cevap.'), finished('completed')],
      'Bir şey dene.',
    );
    expect(failedStep.steps.map((step) => [step.id, step.phase])).toEqual([['e1', 'called'], ['e1', 'failed']]);
    expect(failedStep.outcome).toBe('completed');
    expect((await lastMessage(w)).text).toBe('Kısmi cevap.');
    await assertNothingPersisted(w, ['Bash']);

    const errored = await watchedTurn(w, [text('Başladım.'), errorEvent('auth'), finished('failed')], 'Devam et.');
    expect(errored.steps).toEqual([]);
    expect(errored.notice).toBe('auth');
    expect(errored.outcome).toBe('failed');
    expect((await lastMessage(w)).text).toBe('Başladım.');
  });
});
