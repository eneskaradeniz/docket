// chat runner — rules A-231 … A-241 from docs/v2/application.md, driven over the in-memory fakes.
import { describe, expect, it, vi } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type AccountId,
  type Actor,
  type AgentEvent,
  type CatalogModel,
  type Conversation,
  type ConversationId,
  type EpochMs,
  type Message,
  type Meter,
  type MeterId,
  type Pool,
  type PoolId,
  type ProjectSlug,
  type RunId,
  type Slug,
  type Ulid,
  type WorkOrderId,
} from '../../domain/index';

import type {
  AccountRecord,
  AccountTestSpendEntry,
  AgentTransport,
  ChatSpendEntry,
  McpEndpoint,
  RunRequest,
  RunSpendEntry,
} from '../ports';
import {
  createFakeAccountRepo,
  createFakeBindingRepo,
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeConversationRepo,
  createFakeDeps,
  createFakeEventLog,
  createFakeIdGen,
  createFakeModelCatalog,
  createFakeRunDirs,
  createFakeRunTokens,
  createFakeTransport,
  createFakeTransportResolver,
  type FakeAccountRepo,
  type FakeBindingRepo,
  type FakeClock,
  type FakeConversationRepo,
  type FakeEventLog,
  type FakeIdGen,
  type FakeRunDirs,
  type FakeRunTokens,
  type FakeTransport,
  type FakeTransportResolver,
} from '../ports/fakes';

import { assistantBrief } from './assistant-brief';
import { createChatRunner, CHAT_NOTICE_TEXT_KEY, CHAT_TURN_HISTORY_LIMITS, type ChatRunner, type ChatTurnEvent } from './chat-runner';
import { createChatTurnLedger, type ChatTurnLedger } from './chat-turn-ledger';
import type { UserMessageInput } from '../use-cases';

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

const idOf = <B extends string>(n: number): Ulid<B> => ulidOf<B>(`01ARZ3NDEKTSV4RRFFQ69${String(n).padStart(5, '0')}`);

const PROJECT: ProjectSlug = slugOf('atolye');
const REPO = slugOf<'repo'>('acme');
const WORK_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAA');
const POOL: PoolId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAB');
const METER: MeterId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAC');
const CONVERSATION = idOf<'conversation'>(41);
const T0: EpochMs = 1_700_000_000_000;

const ASSISTANT = slugOf<'role'>('assistant');
const OPERATOR: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const AGENT_ACTOR: Actor = { kind: 'agent', runId: idOf<'run'>(99), role: slugOf<'role'>('helper') };
const SYSTEM_ACTOR: Actor = { kind: 'system', component: 'test' };

const ENDPOINT: McpEndpoint = {
  socketPath: '/fake-socket/docket.sock',
  command: 'node',
  args: ['mcp-child.js'],
  env: { DOCKET_LAUNCH_SECRET: 'launch-secret-value-x7' },
};

const INCLUDED_MODEL: CatalogModel = {
  id: 'm-bal',
  source: 'bundled',
  tier: 'balanced',
  thinking: 'unknown',
  billing: 'included',
  contextWindow: null,
};

const METERED_MODEL: CatalogModel = {
  id: 'm-metered',
  source: 'bundled',
  tier: 'balanced',
  thinking: 'unknown',
  billing: 'metered',
  contextWindow: null,
};

const accountRecord = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id: ACCOUNT,
  provider: 'provider-x',
  label: 'Main',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  tierModels: { strong: 'm-bal', balanced: 'm-bal', fast: 'm-bal' },
  ...overrides,
});

const POOLS: readonly Pool[] = [{ id: POOL, accountId: ACCOUNT, label: 'pro', kind: 'allowance', appliesTo: 'all' }];

const openMeter = (remaining = 90): Meter => ({
  id: METER,
  poolId: POOL,
  label: 'pro',
  cadence: 'fixed',
  durationMs: 3_600_000,
  unit: 'percent',
  used: 100 - remaining,
  limit: 100,
  remaining,
  resetPrecision: 'exact',
  observedAt: T0 - 5_000,
  source: 'polled',
});

const conversationRecord = (id: ConversationId, overrides: Partial<Conversation> = {}): Conversation => ({
  id,
  scope: { kind: 'project', project: PROJECT },
  title: 'plan',
  createdAt: T0 - 60_000,
  updatedAt: T0 - 60_000,
  pinned: false,
  messages: [],
  ...overrides,
});

const at = (ms: number): EpochMs => T0 + ms;
const text = (delta: string): AgentEvent => ({ type: 'text', at: at(2), delta });
const ask = (id: string): AgentEvent => ({
  type: 'permission_ask',
  at: at(3),
  id,
  tool: 'bash',
  target: '/tmp/x',
  options: ['allow', 'deny'],
});
const usage = (costUsd?: number): AgentEvent => ({
  type: 'usage',
  at: at(4),
  inputTokens: 120,
  outputTokens: 80,
  cachedInputTokens: 20,
  ...(costUsd !== undefined ? { costUsd, costKind: 'reported' as const } : {}),
});
const quotaSignal = (): AgentEvent => ({
  type: 'quota_signal',
  at: at(4),
  meter: {
    poolLabel: 'pro',
    cadence: 'rolling_continuous',
    durationMs: 3_600_000,
    unit: 'percent',
    used: 40,
    limit: 100,
    remaining: 60,
    resetPrecision: 'clock_only',
    observedAt: at(4),
    source: 'pushed',
  },
});
const limitHit = (): AgentEvent => ({ type: 'limit_hit', at: at(5), hit: { remedies: ['wait'], class: 'window_exhausted' } });
const errorEvent = (cls: 'auth' | 'network' | 'crash'): AgentEvent => ({ type: 'error', at: at(5), class: cls, message: 'boom' });
const finished = (reason: 'completed' | 'failed' | 'cancelled' | 'limit'): AgentEvent => ({ type: 'finished', at: at(9), reason });

// --- the parked transport: a stream that rests before its finished event ----------------------------

/** A transport whose stream parks right before `finished` until `release()` (or `stop()`), so a test
 *  can act while the turn is genuinely mid-stream. Every start parks its own stream. */
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

/** A transport whose stream throws after its first event, for the crash path. */
const throwingTransport = (): { readonly transport: AgentTransport; readonly requests: () => readonly RunRequest[] } => {
  const requests: RunRequest[] = [];
  return {
    transport: {
      start: async (request) => {
        requests.push(request);
        return {
          ok: true,
          value: {
            events: (async function* (): AsyncGenerator<AgentEvent, void> {
              yield text('par');
              throw new Error('stream exploded');
            })(),
            answerPermission: (): void => undefined,
            steer: (): void => undefined,
            stop: async (): Promise<void> => undefined,
          },
        };
      },
    },
    requests: () => [...requests],
  };
};

// --- harness ----------------------------------------------------------------------------------------

interface Harness {
  readonly deps: ReturnType<typeof createFakeDeps>;
  readonly runner: ChatRunner;
  readonly ledger: ChatTurnLedger;
  readonly clock: FakeClock;
  readonly ids: FakeIdGen;
  readonly log: FakeEventLog;
  readonly conversations: FakeConversationRepo;
  readonly accounts: FakeAccountRepo;
  readonly bindings: FakeBindingRepo;
  readonly transports: FakeTransportResolver;
  readonly transport: FakeTransport;
  readonly tokens: FakeRunTokens;
  readonly runDirs: FakeRunDirs;
}

const harness = async (options: {
  readonly script?: readonly AgentEvent[];
  readonly withAccount?: boolean;
  readonly withBinding?: boolean;
  readonly withTransport?: boolean;
  readonly withEndpoint?: boolean;
  readonly mcpUnsupported?: boolean;
  readonly models?: readonly CatalogModel[];
  readonly tierModels?: Readonly<Record<'strong' | 'balanced' | 'fast', string>>;
  readonly caps?: AccountRecord['caps'];
  readonly pools?: readonly Pool[];
  readonly meters?: readonly Meter[];
  readonly conversation?: Conversation;
  readonly extraConversations?: readonly ConversationId[];
  readonly workOrderBindingAccount?: AccountId;
  readonly transport?: AgentTransport;
  readonly spend?: number;
} = {}): Promise<Harness> => {
  const clock = createFakeClock(T0);
  const ids = createFakeIdGen();
  const log = createFakeEventLog();
  const conversations = createFakeConversationRepo();
  const accounts = createFakeAccountRepo();
  const bindings = createFakeBindingRepo();
  const tokens = createFakeRunTokens();
  const runDirs = createFakeRunDirs();
  const capabilities = createFakeCapabilityCatalog(
    options.mcpUnsupported === true ? [{ id: 'rk-x', provider: 'provider-x', authMode: 'subscription', mcp: false }] : [],
  );
  const modelCatalog = createFakeModelCatalog({ [ACCOUNT]: options.models ?? [INCLUDED_MODEL] });
  const transports = createFakeTransportResolver();
  const transport = createFakeTransport(options.script ?? [finished('completed')]);
  if (options.transport !== undefined) transports.register(ACCOUNT, options.transport);
  else if (options.withTransport !== false) transports.register(ACCOUNT, transport);

  const deps = createFakeDeps({
    clock,
    ids,
    log,
    conversations,
    accounts,
    bindings,
    runTokens: tokens,
    runDirs,
    capabilities,
    modelCatalog,
    transports,
    ...(options.withEndpoint === false ? {} : { mcpEndpoint: ENDPOINT }),
  });

  await deps.projects.save({ id: PROJECT, name: 'Atölye', mainRepo: REPO, repos: [REPO] });
  await deps.workOrders.create({
    id: WORK_ORDER,
    project: PROJECT,
    repo: REPO,
    flow: slugOf<'flow'>('standard'),
    title: 'The work order',
    createdAt: T0,
    createdBy: OPERATOR,
  });
  await conversations.save(options.conversation ?? conversationRecord(CONVERSATION));
  for (const id of options.extraConversations ?? []) await conversations.save(conversationRecord(id));
  if (options.withAccount !== false) {
    await accounts.save(
      accountRecord({
        ...(options.tierModels !== undefined ? { tierModels: options.tierModels } : {}),
        ...(options.caps !== undefined ? { caps: options.caps } : {}),
      }),
    );
  }
  if (options.pools !== undefined) await accounts.savePools(ACCOUNT, options.pools);
  for (const meter of options.meters ?? []) await accounts.saveMeter(meter);
  if (options.spend !== undefined) {
    await accounts.recordSpend({ accountId: ACCOUNT, project: PROJECT, repo: REPO, workOrderId: WORK_ORDER, at: T0, usd: options.spend });
  }
  if (options.withBinding !== false) {
    await bindings.save({ level: 'global' }, { role: slugOf<'role'>('assistant'), accounts: [{ accountId: ACCOUNT }] });
  }
  if (options.workOrderBindingAccount !== undefined) {
    await bindings.save({ level: 'workOrder', workOrderId: WORK_ORDER }, { role: slugOf<'role'>('assistant'), accounts: [{ accountId: options.workOrderBindingAccount }] });
  }

  const ledger = createChatTurnLedger();
  const runner = createChatRunner(deps, { turnLedger: ledger });
  return { deps, runner, ledger, clock, ids, log, conversations, accounts, bindings, transports, transport, tokens, runDirs };
};

/** Every event the conversation's listeners saw, plus a promise for the finished one. */
const watching = (runner: ChatRunner, conversation: ConversationId): {
  readonly events: ChatTurnEvent[];
  readonly finished: Promise<ChatTurnEvent>;
} => {
  const events: ChatTurnEvent[] = [];
  let resolve: ((event: ChatTurnEvent) => void) | undefined;
  const done = new Promise<ChatTurnEvent>((settled) => {
    resolve = settled;
  });
  runner.subscribe(conversation, (event) => {
    events.push(event);
    if (event.type === 'finished' && resolve !== undefined) resolve(event);
  });
  return { events, finished: done };
};

/** Starts a turn and hands back its id; a refused start is a fixture error. */
const send = async (runner: ChatRunner, conversation: ConversationId, message: UserMessageInput): Promise<RunId> => {
  const started = await runner.startTurn({ conversation, message, by: OPERATOR });
  if (!started.ok) throw new Error(`fixture start failed: ${started.error.code}`);
  return started.value.turn;
};

/** Spins microtasks until `check` holds; the fakes resolve immediately, so this is only a hop count. */
const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 10_000 && !check(); i += 1) await Promise.resolve();
};

const messagesOf = async (h: Harness, id: ConversationId): Promise<readonly Message[]> => (await h.conversations.get(id))?.messages ?? [];

const lastMessage = async (h: Harness, id: ConversationId): Promise<Message> => {
  const messages = await messagesOf(h, id);
  const message = messages[messages.length - 1];
  if (message === undefined) throw new Error('the conversation must hold a message');
  return message;
};

// --- tests ------------------------------------------------------------------------------------------

describe('createChatRunner', () => {
  it('A-231: a turn streams its text in order and stores exactly one assistant message with usage, then revokes the token and removes the run dir', async () => {
    const h = await harness({ script: [text('Mer'), text('haba'), usage(0.15), finished('completed')] });
    const watch = watching(h.runner, CONVERSATION);

    const turn = await send(h.runner, CONVERSATION, { text: 'Selam' });
    expect(h.runner.active(CONVERSATION)).toBe(turn);

    const done = await watch.finished;
    expect(watch.events[0]).toMatchObject({ type: 'started', turn });
    expect(watch.events.filter((event) => event.type === 'text').map((event) => (event.type === 'text' ? event.delta : ''))).toEqual(['Mer', 'haba']);
    expect(done).toMatchObject({ type: 'finished', turn, outcome: 'completed' });

    const messages = await messagesOf(h, CONVERSATION);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', text: 'Selam' });
    expect(messages[1]).toMatchObject({ role: 'assistant', text: 'Merhaba', artifacts: [], sources: [] });
    expect(messages[1]?.usage).toEqual({ inputTokens: 120, outputTokens: 80, costMicros: 150_000 });
    expect((done as { readonly message?: Message['id'] }).message).toBe(messages[1]?.id);
    expect(h.tokens.live()).toEqual([]);
    expect(h.runDirs.live()).toEqual([]);
    expect(h.runner.active(CONVERSATION)).toBeUndefined();
  });

  it('A-231: a listener that throws never breaks the turn, and no run record is ever written', async () => {
    const h = await harness({ script: [text('ok'), finished('completed')] });
    const broken = vi.fn(() => {
      throw new Error('listener exploded');
    });
    h.runner.subscribe(CONVERSATION, broken);
    const watch = watching(h.runner, CONVERSATION);

    await send(h.runner, CONVERSATION, { text: 'Selam' });
    await watch.finished;

    expect(broken).toHaveBeenCalled();
    expect(await messagesOf(h, CONVERSATION)).toHaveLength(2);
    expect(await h.deps.runs.listForWorkOrder(WORK_ORDER)).toEqual([]);
  });

  it('A-232: a second turn on a busy conversation is refused with busy, the message staying stored and nothing started', async () => {
    const parked = parkedTransport([text('a'), finished('completed')]);
    const h = await harness({ transport: parked.transport });
    const watch = watching(h.runner, CONVERSATION);

    await send(h.runner, CONVERSATION, { text: 'bir' });
    await until(() => parked.requests().length === 1);
    expect(parked.requests()).toHaveLength(1);

    const again = await h.runner.startTurn({ conversation: CONVERSATION, message: { text: 'iki' }, by: OPERATOR });
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('unreachable');
    expect(again.error).toEqual({ code: 'busy' });
    expect((await messagesOf(h, CONVERSATION)).map((message) => message.role)).toEqual(['user', 'user']);
    expect(parked.requests()).toHaveLength(1);
    expect(watch.events.filter((event) => event.type === 'started')).toHaveLength(1);
  });

  it('A-232: the 4th concurrent turn app-wide is too_many_turns, its message stored and nothing run', async () => {
    const parked = parkedTransport([text('a'), finished('completed')]);
    const c1 = idOf<'conversation'>(51);
    const c2 = idOf<'conversation'>(52);
    const c3 = idOf<'conversation'>(53);
    const h = await harness({ transport: parked.transport, extraConversations: [c1, c2, c3] });

    for (const id of [c1, c2, c3]) await send(h.runner, id, { text: 'selam' });
    await until(() => parked.requests().length === 3);
    expect(parked.requests()).toHaveLength(3);

    const fourth = await h.runner.startTurn({ conversation: CONVERSATION, message: { text: 'dört' }, by: OPERATOR });
    expect(fourth.ok).toBe(false);
    if (fourth.ok) throw new Error('unreachable');
    expect(fourth.error).toEqual({ code: 'too_many_turns' });
    expect((await messagesOf(h, CONVERSATION))).toHaveLength(1);
    expect(parked.requests()).toHaveLength(3);
  });

  it('A-232: only a user may start or cancel; a conversation deleted mid-turn ends cancelled with no assistant message', async () => {
    const parked = parkedTransport([text('par'), finished('completed')]);
    const h = await harness({ transport: parked.transport });
    const watch = watching(h.runner, CONVERSATION);

    const byAgent = await h.runner.startTurn({ conversation: CONVERSATION, message: { text: 'no' }, by: AGENT_ACTOR });
    expect(byAgent.ok).toBe(false);
    if (byAgent.ok) throw new Error('unreachable');
    expect(byAgent.error).toEqual({ code: 'not_user' });
    expect(await messagesOf(h, CONVERSATION)).toHaveLength(0);

    const bySystem = await h.runner.cancel(CONVERSATION, SYSTEM_ACTOR);
    expect(bySystem.ok).toBe(false);

    await send(h.runner, CONVERSATION, { text: 'Selam' });
    await until(() => parked.requests().length === 1);
    await h.conversations.delete(CONVERSATION);
    parked.release();

    const done = await watch.finished;
    expect(done).toMatchObject({ type: 'finished', outcome: 'cancelled' });
    expect((done as { readonly message?: Message['id'] }).message).toBeUndefined();
    expect(await h.conversations.get(CONVERSATION)).toBeUndefined();
    expect(h.tokens.live()).toEqual([]);
    expect(h.runDirs.live()).toEqual([]);
  });

  it('A-233: with no account bound the turn is refused with notice auth and a notice message; a work-order conversation prefers its own binding', async () => {
    const parked = parkedTransport([text('a'), finished('completed')]);
    const h = await harness({ transport: parked.transport, withBinding: false });
    const watch = watching(h.runner, CONVERSATION);

    const turn = await send(h.runner, CONVERSATION, { text: 'Selam' });
    const done = await watch.finished;
    expect(done).toMatchObject({ type: 'finished', turn, outcome: 'refused' });
    expect(watch.events.some((event) => event.type === 'notice' && event.code === 'auth')).toBe(true);
    expect(parked.requests()).toHaveLength(0);
    expect(h.tokens.minted()).toEqual([]);
    expect(h.runDirs.created()).toEqual([]);
    const message = await lastMessage(h, CONVERSATION);
    expect(message).toMatchObject({ role: 'assistant', text: CHAT_NOTICE_TEXT_KEY.auth, artifacts: [], sources: [] });
    expect((done as { readonly message?: Message['id'] }).message).toBe(message.id);

    // The work-order layer of the chain wins over the project and global layers.
    const scoped = parkedTransport([text('b'), finished('completed')]);
    const OTHER_ACCOUNT = idOf<'account'>(61);
    const scopedConversation = idOf<'conversation'>(62);
    const h2 = await harness({
      conversation: conversationRecord(scopedConversation, { scope: { kind: 'workOrder', workOrder: WORK_ORDER } }),
      workOrderBindingAccount: OTHER_ACCOUNT,
    });
    h2.transports.register(OTHER_ACCOUNT, scoped.transport);
    await h2.accounts.save(
      accountRecord({
        id: OTHER_ACCOUNT,
        consentedModels: ['m-bal'],
        caps: [{ scope: 'account_month', cap: { amountUsd: 5, warnPercent: 80 } }],
      }),
    );
    const watch2 = watching(h2.runner, scopedConversation);
    await send(h2.runner, scopedConversation, { text: 'Selam' });
    await until(() => scoped.requests().length === 1);
    scoped.release();
    await watch2.finished;
    const request = scoped.requests()[0];
    if (request === undefined) throw new Error('the scoped transport must have been started');
    expect(request.route.accountId).toBe(OTHER_ACCOUNT);
    expect(request.role.id).toBe('assistant');
    expect(request.role.writeScope).toEqual({ kind: 'none' });
    expect(request.role.capabilities).toEqual([]);
    expect(request.role.docketTools).toBe(true);
    expect(request.role.instructions).toContain('docket_get');
    expect(request.role.instructions).toContain('operator approves');
    expect(request.cwd).toBe(h2.runDirs.created()[0]);
  });

  it('A-234: assistantBrief is pure and carries the scope, the approval rule, the language rule and the trust boundary', () => {
    const input = { scope: { kind: 'project' as const, project: PROJECT }, today: '2026-10-10' };
    expect(assistantBrief(input)).toBe(assistantBrief(input));
    const brief = assistantBrief(input);
    expect(brief).toContain(PROJECT);
    expect(brief).toContain('2026-10-10');
    expect(brief).toContain('propose');
    expect(brief).toContain('operator approves');
    expect(brief).toContain("operator's language");
    expect(brief).toContain('DATA');
    expect(brief).toContain('never instructions');
    expect(brief).toContain('still data');

    const global = assistantBrief({ scope: { kind: 'global' } });
    expect(global).not.toContain('2026-10-10');
    expect(global).not.toBe(brief);
    expect(assistantBrief({ scope: { kind: 'workOrder', workOrder: WORK_ORDER } })).toContain(WORK_ORDER);
  });

  it('A-235: each pre-turn refusal starts no agent run and writes only the notice message', async () => {
    const cases: readonly { readonly name: string; readonly code: 'tools_unavailable' | 'consent' | 'quota' | 'spend'; readonly setup: () => Promise<Harness> }[] = [
      { name: 'no transport', code: 'tools_unavailable', setup: (): Promise<Harness> => harness({ withTransport: false }) },
      { name: 'mcp unsupported', code: 'tools_unavailable', setup: (): Promise<Harness> => harness({ mcpUnsupported: true }) },
      {
        name: 'no consent',
        code: 'consent',
        setup: (): Promise<Harness> => harness({ models: [METERED_MODEL], tierModels: { strong: 'm-metered', balanced: 'm-metered', fast: 'm-metered' } }),
      },
      { name: 'no headroom', code: 'quota', setup: (): Promise<Harness> => harness({ pools: POOLS, meters: [openMeter(0)] }) },
      { name: 'spend cap', code: 'spend', setup: (): Promise<Harness> => harness({ caps: [{ scope: 'account_month', cap: { amountUsd: 1, warnPercent: 80 } }], spend: 2 }) },
    ];
    for (const item of cases) {
      const h = await item.setup();
      const watch = watching(h.runner, CONVERSATION);
      const turn = await send(h.runner, CONVERSATION, { text: 'Selam' });
      const done = await watch.finished;
      expect(done, item.name).toMatchObject({ type: 'finished', turn, outcome: 'refused' });
      expect(watch.events.some((event) => event.type === 'notice' && event.code === item.code), item.name).toBe(true);
      expect(h.transport.requests(), item.name).toHaveLength(0);
      expect(h.tokens.minted(), item.name).toEqual([]);
      expect(h.runDirs.created(), item.name).toEqual([]);
      const message = await lastMessage(h, CONVERSATION);
      expect(message, item.name).toMatchObject({ role: 'assistant', text: CHAT_NOTICE_TEXT_KEY[item.code] });
    }
  });

  it('A-236: the turn mints a chat token, attaches the MCP capability with DOCKET_MCP_KIND=chat, runs in the run dir, and lists attachments as data without their bytes', async () => {
    const h = await harness({ script: [text('baktım'), finished('completed')] });
    const watch = watching(h.runner, CONVERSATION);
    const SECRET = 'attachment-secret-value-99';
    const turn = await send(h.runner, CONVERSATION, {
      text: 'Ekteki dosyaya bak',
      refs: [{ kind: 'workOrder', id: WORK_ORDER }],
      attachments: [{ name: 'notlar.md', kind: 'text', bytes: new TextEncoder().encode(SECRET) }],
    });
    await watch.finished;

    const minted = h.tokens.minted();
    expect(minted).toHaveLength(1);
    expect(minted[0]?.binding).toEqual({ kind: 'chat', turn, conversation: CONVERSATION, role: 'assistant' });
    const request = h.transport.requests()[0];
    if (request === undefined) throw new Error('the transport must have been started');
    expect(request.cwd).toBe(h.runDirs.created()[0]);
    expect(request.runDir).toBe(h.runDirs.created()[0]);
    expect(request.cwd.startsWith('/fake-data/runs/')).toBe(true);
    const capability = request.capabilities.find((entry) => entry.id === 'docket-pages');
    if (capability === undefined || capability.kind !== 'mcp') throw new Error('the docket-pages capability must be attached');
    expect(capability.env['DOCKET_MCP_KIND']).toEqual({ literal: 'chat' });
    expect(capability.env['DOCKET_MCP_SOCKET']).toEqual({ literal: ENDPOINT.socketPath });
    expect(capability.env['DOCKET_MCP_TOKEN']).toEqual({ literal: minted[0]?.token });
    expect(capability.env['DOCKET_LAUNCH_SECRET']).toEqual({ literal: ENDPOINT.env['DOCKET_LAUNCH_SECRET'] });

    expect(request.prompt).toContain('notlar.md');
    expect(request.prompt).toContain(WORK_ORDER);
    expect(request.prompt).not.toContain(SECRET);
    expect(request.prompt).not.toContain(ENDPOINT.env['DOCKET_LAUNCH_SECRET']);
    expect(request.resume).toBeUndefined();
  });

  it('A-236: history trimming keeps the newest messages within the 24-message / 48 KiB budget', async () => {
    const filler = 'x'.repeat(4_000);
    const seeded = conversationRecord(CONVERSATION, {
      messages: Array.from({ length: 30 }, (_, index): Message => ({
        id: idOf<'message'>(100 + index),
        role: 'user',
        at: T0 - 60_000 + index,
        text: index === 0 ? 'mesaj-0' : `mesaj-${index} ${filler}`,
        refs: [],
        attachments: [],
        artifacts: [],
        sources: [],
      })),
    });
    const h = await harness({ script: [text('tamam'), finished('completed')], conversation: seeded });
    const watch = watching(h.runner, CONVERSATION);
    await send(h.runner, CONVERSATION, { text: 'Son soru' });
    await watch.finished;

    const request = h.transport.requests()[0];
    if (request === undefined) throw new Error('the transport must have been started');
    expect(request.prompt).not.toContain('mesaj-0');
    expect(request.prompt).not.toContain('mesaj-5');
    expect(request.prompt).toContain('mesaj-29');
    expect(request.prompt).toContain('Son soru');
    expect(request.prompt.length).toBeLessThan(CHAT_TURN_HISTORY_LIMITS.bytes + 8_000);
  });

  it('A-237: permission asks are always denied, limit hits end the turn without fallback or queueing, and bookkeeping events never reach listeners', async () => {
    const h = await harness({ script: [text('a'), ask('ask-1'), quotaSignal(), errorEvent('network'), limitHit()], pools: POOLS });
    const watch = watching(h.runner, CONVERSATION);
    await send(h.runner, CONVERSATION, { text: 'Selam' });
    const done = await watch.finished;

    expect(h.transport.answers()).toEqual([{ askId: 'ask-1', decision: 'deny' }]);
    expect(done).toMatchObject({ type: 'finished', outcome: 'limit' });
    expect(watch.events.some((event) => event.type === 'notice' && event.code === 'limit')).toBe(true);
    expect((await lastMessage(h, CONVERSATION)).text).toBe('a');
    expect(await h.accounts.meters(ACCOUNT)).toHaveLength(1);
    for (const event of watch.events) expect(['started', 'text', 'notice', 'finished']).toContain(event.type);
    expect(await h.deps.queue.list()).toEqual([]);
  });

  it('A-237: an error class names the notice of a failed turn', async () => {
    const h = await harness({ script: [text('a'), errorEvent('auth'), finished('failed')] });
    const watch = watching(h.runner, CONVERSATION);
    await send(h.runner, CONVERSATION, { text: 'Selam' });
    const done = await watch.finished;
    expect(done).toMatchObject({ outcome: 'failed' });
    expect(watch.events.some((event) => event.type === 'notice' && event.code === 'auth')).toBe(true);
    expect((await lastMessage(h, CONVERSATION)).text).toBe('a');
  });

  it('A-238: the ledger drains into artifacts and sources, and an entry referencing nothing is dropped', async () => {
    const h = await harness({ script: [text('yaptım'), finished('completed')] });
    const watch = watching(h.runner, CONVERSATION);
    const turn = await send(h.runner, CONVERSATION, { text: 'Sayfa aç' });
    const PAGE = idOf<'page'>(71);
    const MISSING_PAGE = idOf<'page'>(72);
    const PROPOSAL = idOf<'proposal'>(73);
    await h.deps.pages.save({
      id: PAGE,
      title: 'Tablo',
      kind: 'table',
      createdAt: T0,
      approval: 'none',
      conversation: CONVERSATION,
      createdBy: { kind: 'agent', runId: turn, role: ASSISTANT },
      versions: [{ n: 1, createdAt: T0, by: OPERATOR, entry: 'table.csv', files: [] }],
    });
    await h.deps.proposals.save({
      id: PROPOSAL,
      scope: { kind: 'global' },
      target: 'roles/helper.yaml',
      before: 'a: 1\n',
      after: 'a: 2\n',
      baseHash: 'h',
      summary: 's',
      author: OPERATOR,
      createdAt: T0,
      status: 'pending',
    });
    h.ledger.record(turn, { kind: 'page', page: PAGE, version: 1, source: 'operator request' });
    h.ledger.record(turn, { kind: 'page', page: MISSING_PAGE, version: 1 });
    h.ledger.record(turn, { kind: 'proposal', proposal: PROPOSAL, action: idOf<'action'>(74), source: 'operator request' });
    h.ledger.record(turn, { kind: 'setting', action: idOf<'action'>(75) });

    await watch.finished;
    const message = await lastMessage(h, CONVERSATION);
    expect(message.text).toBe('yaptım');
    expect(message.artifacts).toEqual([
      { kind: 'page', page: PAGE, version: 1 },
      { kind: 'proposal', proposal: PROPOSAL },
    ]);
    expect(message.sources).toEqual(['operator request']);
    expect(h.ledger.take(turn)).toEqual([]);
  });

  it('A-239: a transport that throws mid-stream, fails to start, or dries up ends failed with the token revoked, the dir removed and active cleared', async () => {
    const boom = throwingTransport();
    const h = await harness({ transport: boom.transport });
    const watch = watching(h.runner, CONVERSATION);
    await send(h.runner, CONVERSATION, { text: 'Selam' });
    const done = await watch.finished;
    expect(done).toMatchObject({ outcome: 'failed' });
    expect(watch.events.some((event) => event.type === 'notice' && event.code === 'crash')).toBe(true);
    expect(h.tokens.live()).toEqual([]);
    expect(h.runDirs.live()).toEqual([]);
    expect(h.runner.active(CONVERSATION)).toBeUndefined();
    expect((await lastMessage(h, CONVERSATION)).text).toBe('par');

    const failStart = createFakeTransport([finished('completed')]);
    failStart.failStart({ code: 'not_logged_in', message: 'no login' });
    const h2 = await harness({ transport: failStart });
    const watch2 = watching(h2.runner, CONVERSATION);
    await send(h2.runner, CONVERSATION, { text: 'Selam' });
    const done2 = await watch2.finished;
    expect(done2).toMatchObject({ outcome: 'failed' });
    expect(watch2.events.some((event) => event.type === 'notice' && event.code === 'auth')).toBe(true);
    expect(h2.tokens.live()).toEqual([]);
    expect(h2.runner.active(CONVERSATION)).toBeUndefined();

    const dry = createFakeTransport([]);
    const h3 = await harness({ transport: dry });
    const watch3 = watching(h3.runner, CONVERSATION);
    await send(h3.runner, CONVERSATION, { text: 'Selam' });
    expect(await watch3.finished).toMatchObject({ outcome: 'failed' });
    expect(watch3.events.some((event) => event.type === 'notice' && event.code === 'crash')).toBe(true);
    expect((await lastMessage(h3, CONVERSATION)).text).toBe(CHAT_NOTICE_TEXT_KEY.crash);
    expect(h3.tokens.live()).toEqual([]);
  });

  it('A-240: cancelling mid-stream stops the handle once and stores the partial text; cancelling an idle conversation is an ok no-op', async () => {
    const idle = await harness({ script: [text('a'), finished('completed')] });
    expect((await idle.runner.cancel(CONVERSATION, OPERATOR)).ok).toBe(true);

    const parked = parkedTransport([text('yarı'), text(' kesildi'), finished('completed')]);
    const h = await harness({ transport: parked.transport });
    const watch = watching(h.runner, CONVERSATION);
    await send(h.runner, CONVERSATION, { text: 'Uzun anlat' });
    await until(() => watch.events.some((event) => event.type === 'text'));
    expect((await h.runner.cancel(CONVERSATION, OPERATOR)).ok).toBe(true);
    expect((await h.runner.cancel(CONVERSATION, OPERATOR)).ok).toBe(true);
    const done = await watch.finished;
    expect(parked.stops()).toBe(1);
    expect(done).toMatchObject({ outcome: 'cancelled' });
    expect((await lastMessage(h, CONVERSATION)).text).toBe('yarı');
    expect(h.tokens.live()).toEqual([]);
  });

  it('A-241: the audit trail carries ids, outcome and counts only — never message text', async () => {
    const h = await harness({ script: [text('gizli metin burada'), usage(), finished('completed')] });
    const watch = watching(h.runner, CONVERSATION);
    const turn = await send(h.runner, CONVERSATION, { text: 'gizli soru metni' });
    await watch.finished;

    expect(h.log.entries().map((entry) => entry.action)).toEqual(['chat.turn_started', 'chat.turn_finished']);
    for (const entry of h.log.entries()) expect(entry.subject).toEqual({ kind: 'conversation', id: CONVERSATION });
    const trail = JSON.stringify(h.log.entries().map((entry) => ({ action: entry.action, detail: entry.detail })));
    expect(trail).toContain(turn);
    expect(trail).not.toContain('gizli');
    const finishedEntry = h.log.entries().find((entry) => entry.action === 'chat.turn_finished');
    expect(finishedEntry?.detail).toMatchObject({ outcome: 'completed', artifacts: 0, sources: 0 });
  });

  // --- chat spend (A-276 … A-279) ------------------------------------------------------------------

  /** Wraps the harness's recordSpend so a test sees every entry the runner writes; an `order`
   *  array, when given, receives 'spend' beside the entry so the test can interleave it with the
   *  turn's own events. */
  const spyingSpend = (
    h: Harness,
    order?: string[],
  ): { readonly entries: (RunSpendEntry | AccountTestSpendEntry | ChatSpendEntry)[] } => {
    const entries: (RunSpendEntry | AccountTestSpendEntry | ChatSpendEntry)[] = [];
    const record = h.accounts.recordSpend;
    vi.spyOn(h.accounts, 'recordSpend').mockImplementation(async (entry) => {
      entries.push(entry);
      if (order !== undefined) order.push('spend');
      await record(entry);
    });
    return { entries };
  };

  it('A-276: a costed turn writes exactly one chat spend entry — account, conversation, its project, no text — before finished; zero or absent cost writes none', async () => {
    const h = await harness({ script: [text('gizli cevap metni'), usage(0.1), usage(0.05), finished('completed')] });
    const order: string[] = [];
    const spent = spyingSpend(h, order);
    h.runner.subscribe(CONVERSATION, (event) => {
      if (event.type === 'finished') order.push('finished');
    });
    const watch = watching(h.runner, CONVERSATION);
    await send(h.runner, CONVERSATION, { text: 'gizli soru metni' });
    await watch.finished;

    expect(spent.entries).toHaveLength(1);
    const entry = spent.entries[0];
    if (entry === undefined || !('kind' in entry) || entry.kind !== 'chat') {
      throw new Error('the turn must write a chat spend entry');
    }
    expect(entry).toStrictEqual({
      kind: 'chat',
      accountId: ACCOUNT,
      at: T0,
      usd: 0.15,
      conversation: CONVERSATION,
      project: PROJECT,
    });
    // Ids and a number only: no text, no title, no prompt ever rides the entry.
    expect(Object.keys(entry).sort()).toEqual(['accountId', 'at', 'conversation', 'kind', 'project', 'usd']);
    expect(JSON.stringify(entry)).not.toContain('gizli');
    expect(order.filter((mark) => mark !== 'started')).toEqual(['spend', 'finished']);

    const zero = await harness({ script: [text('a'), usage(0), finished('completed')] });
    const zeroSpent = spyingSpend(zero);
    const zeroWatch = watching(zero.runner, CONVERSATION);
    await send(zero.runner, CONVERSATION, { text: 'Selam' });
    await zeroWatch.finished;
    expect(zeroSpent.entries).toEqual([]);

    const noCost = await harness({ script: [text('a'), usage(), finished('completed')] });
    const noCostSpent = spyingSpend(noCost);
    const noCostWatch = watching(noCost.runner, CONVERSATION);
    await send(noCost.runner, CONVERSATION, { text: 'Selam' });
    await noCostWatch.finished;
    expect(noCostSpent.entries).toEqual([]);

    // A work-order conversation records its order's project; a global one records none.
    const ordered = await harness({
      script: [usage(0.2), finished('completed')],
      conversation: conversationRecord(CONVERSATION, { scope: { kind: 'workOrder', workOrder: WORK_ORDER } }),
    });
    const orderedSpent = spyingSpend(ordered);
    const orderedWatch = watching(ordered.runner, CONVERSATION);
    await send(ordered.runner, CONVERSATION, { text: 'Selam' });
    await orderedWatch.finished;
    expect(orderedSpent.entries).toStrictEqual([
      { kind: 'chat', accountId: ACCOUNT, at: T0, usd: 0.2, conversation: CONVERSATION, project: PROJECT },
    ]);

    const global = await harness({
      script: [usage(0.2), finished('completed')],
      conversation: conversationRecord(CONVERSATION, { scope: { kind: 'global' } }),
    });
    const globalSpent = spyingSpend(global);
    const globalWatch = watching(global.runner, CONVERSATION);
    await send(global.runner, CONVERSATION, { text: 'Selam' });
    await globalWatch.finished;
    expect(globalSpent.entries).toStrictEqual([{ kind: 'chat', accountId: ACCOUNT, at: T0, usd: 0.2, conversation: CONVERSATION }]);

    // Cancelled, limit and failed turns record the cost they reported. The usage rides ahead of
    // the text: seeing the text event proves the cost was already folded in.
    const parked = parkedTransport([usage(0.3), text('yarı'), finished('completed')]);
    const cancelled = await harness({ transport: parked.transport });
    const cancelledSpent = spyingSpend(cancelled);
    const cancelledWatch = watching(cancelled.runner, CONVERSATION);
    await send(cancelled.runner, CONVERSATION, { text: 'Uzun anlat' });
    await until(() => cancelledWatch.events.some((event) => event.type === 'text'));
    await cancelled.runner.cancel(CONVERSATION, OPERATOR);
    expect(await cancelledWatch.finished).toMatchObject({ outcome: 'cancelled' });
    expect(cancelledSpent.entries).toStrictEqual([
      { kind: 'chat', accountId: ACCOUNT, at: T0, usd: 0.3, conversation: CONVERSATION, project: PROJECT },
    ]);

    const limit = await harness({ script: [usage(0.3), limitHit()] });
    const limitSpent = spyingSpend(limit);
    const limitWatch = watching(limit.runner, CONVERSATION);
    await send(limit.runner, CONVERSATION, { text: 'Selam' });
    await limitWatch.finished;
    expect(limitSpent.entries).toHaveLength(1);

    const failed = await harness({ script: [usage(0.3), errorEvent('crash'), finished('failed')] });
    const failedSpent = spyingSpend(failed);
    const failedWatch = watching(failed.runner, CONVERSATION);
    await send(failed.runner, CONVERSATION, { text: 'Selam' });
    await failedWatch.finished;
    expect(failedSpent.entries).toHaveLength(1);
  });

  it('A-277: a failing recordSpend never breaks the turn — the message is still written and finished still fires', async () => {
    const h = await harness({ script: [text('cevap yazıldı'), usage(0.4), finished('completed')] });
    const spy = vi.spyOn(h.accounts, 'recordSpend').mockRejectedValue(new Error('spend store down'));
    const watch = watching(h.runner, CONVERSATION);
    const turn = await send(h.runner, CONVERSATION, { text: 'Selam' });
    const done = await watch.finished;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(done).toMatchObject({ type: 'finished', turn, outcome: 'completed' });
    if (done.type !== 'finished') throw new Error('the turn must finish');
    expect(done.message).toBeDefined();
    expect((await lastMessage(h, CONVERSATION)).text).toBe('cevap yazıldı');
    expect(h.tokens.live()).toEqual([]);
    expect(h.runner.active(CONVERSATION)).toBeUndefined();
  });

  it('A-278: chat spend the caps see — a turn that spends up to the account cap refuses the conversation\'s next turn with spend', async () => {
    const h = await harness({
      script: [usage(1.2), finished('completed')],
      caps: [{ scope: 'account_month', cap: { amountUsd: 1, warnPercent: 80 } }],
    });
    const first = watching(h.runner, CONVERSATION);
    await send(h.runner, CONVERSATION, { text: 'Pahalı soru' });
    await first.finished;
    expect(await h.accounts.spend({ accountId: ACCOUNT, from: 0, to: T0 })).toBe(1.2);

    const second = watching(h.runner, CONVERSATION);
    await send(h.runner, CONVERSATION, { text: 'Devam' });
    const done = await second.finished;
    expect(done).toMatchObject({ outcome: 'refused' });
    expect(second.events.some((event) => event.type === 'notice' && event.code === 'spend')).toBe(true);
    expect(h.transport.requests()).toHaveLength(1);
  });

  it('A-279: the project month budget counts a project conversation\'s chat spend and not a global one\'s', async () => {
    const budget = { amountUsd: 2, warnPercent: 80 };

    const projectSide = await harness({ script: [usage(2.5), finished('completed')] });
    await projectSide.deps.projects.save({ id: PROJECT, name: 'Atölye', mainRepo: REPO, repos: [REPO], budget });
    const first = watching(projectSide.runner, CONVERSATION);
    await send(projectSide.runner, CONVERSATION, { text: 'Pahalı' });
    await first.finished;
    expect(await projectSide.accounts.spend({ project: PROJECT, from: 0, to: T0 })).toBe(2.5);
    const second = watching(projectSide.runner, CONVERSATION);
    await send(projectSide.runner, CONVERSATION, { text: 'Devam' });
    const refused = await second.finished;
    expect(refused).toMatchObject({ outcome: 'refused' });
    expect(second.events.some((event) => event.type === 'notice' && event.code === 'spend')).toBe(true);
    expect(projectSide.transport.requests()).toHaveLength(1);

    // A global conversation's spend carries no project, so the ceiling never sees it: the
    // project conversation still runs, while the account sum holds every chat dollar.
    const globalSide = await harness({ script: [usage(3), finished('completed')] });
    await globalSide.deps.projects.save({ id: PROJECT, name: 'Atölye', mainRepo: REPO, repos: [REPO], budget });
    const GLOBAL = idOf<'conversation'>(42);
    await globalSide.conversations.save(conversationRecord(GLOBAL, { scope: { kind: 'global' } }));
    const globalWatch = watching(globalSide.runner, GLOBAL);
    await send(globalSide.runner, GLOBAL, { text: 'Küresel' });
    await globalWatch.finished;
    expect(await globalSide.accounts.spend({ project: PROJECT, from: 0, to: T0 })).toBe(0);
    expect(await globalSide.accounts.spend({ accountId: ACCOUNT, from: 0, to: T0 })).toBe(3);
    const projectWatch = watching(globalSide.runner, CONVERSATION);
    await send(globalSide.runner, CONVERSATION, { text: 'Proje sorusu' });
    expect(await projectWatch.finished).toMatchObject({ outcome: 'completed' });
    expect(globalSide.transport.requests()).toHaveLength(2);
  });
});
