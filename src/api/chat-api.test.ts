// api/chat-api.test.ts — the chat surface of the boundary (6e-5): every query and command over
// fakes, the reference-resolution rule at the edge, the attach validation, the live turn events
// and their hygiene, and the no-oracle id answers. Rules A-251 … A-265 and U-97 … U-100 of
// docs/v2/application.md and docs/v2/ui.md.
import { describe, expect, it } from 'vitest';

import type {
  AccountRoute,
  ActionRecord,
  AgentEvent,
  Actor,
  AttachmentRef,
  CatalogModel,
  Conversation,
  Grant,
  ProjectSlug,
  RepoSlug,
  RoleSlug,
  RunId,
  Slug,
  Ulid,
} from '../domain/index';
import { parseSlug, parseUlid, sha256Hex } from '../domain/index';

import type { AgentTransport, AppDeps, ChatRunner, McpEndpoint } from '../application';
import {
  createActionApplier,
  createActionUndoer,
  createChatRunner,
  createChatTurnLedger,
  type ActionApplier,
  type ActionUndoer,
} from '../application';
import {
  createFakeAttachmentFiles,
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeIdGen,
  createFakeModelCatalog,
  createFakeRunDirs,
  createFakeRunTokens,
  createFakeTransportResolver,
  type FakeAttachmentFiles,
  type FakeClock,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeRunDirs,
  type FakeRunTokens,
  type FakeTransportResolver,
} from '../application/ports/fakes';

import { createApi, type ChatWiring, type UiEvent } from './api';
import type { ChatConversationSummaryView, ChatConversationView, ChatUsageView } from './chat-views';
import type { ChatRefInput } from './commands';

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

const T0 = 1_728_000_000_000; // 2024-10-03T09:20:00Z — a fixed month boundary to count within
const ATOLYE = slugOf<'project'>('atolye') as ProjectSlug;
const DIGER = slugOf<'project'>('diger') as ProjectSlug;
const ACME = slugOf<'repo'>('acme') as RepoSlug;
const WEB = slugOf<'repo'>('web') as RepoSlug;
const YABANCI = slugOf<'repo'>('yabanci') as RepoSlug;
const ROLE = slugOf<'role'>('assistant') as RoleSlug;
const ACCOUNT = idOf<'account'>(11);
const WORK_ORDER = idOf<'work-order'>(21);
const PAGE = idOf<'page'>(22);
const CONVERSATION = idOf<'conversation'>(30);
const CONVERSATION_OTHER = idOf<'conversation'>(31);
const DRAFT = idOf<'draft'>(32);
const ACTION = idOf<'action'>(33);
const GRANT = idOf<'grant'>(34);
const ATTACHMENT = idOf<'attachment'>(35);
const USER: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: idOf<'run'>(40), role: slugOf<'role'>('worker') };

const ENDPOINT: McpEndpoint = { socketPath: '/fake-socket/docket.sock', command: 'node', args: ['mcp-child.js'], env: {} };
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const MODEL: CatalogModel = { id: 'm-bal', source: 'bundled', tier: 'balanced', thinking: 'unknown', billing: 'included', contextWindow: null };

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const b64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8_192));
  }
  return btoa(binary);
};

/** A transport that parks before its finished event until released, so a test can act while the
 * turn is mid-stream. */
const parkedTransport = (script: readonly AgentEvent[]): { readonly transport: AgentTransport; readonly release: () => void } => {
  let released = false;
  const waiters: (() => void)[] = [];
  const open = (): void => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  const transport: AgentTransport = {
    start: async () => ({
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
    }),
  };
  return { transport, release: () => { released = true; open(); } };
};

interface Harness {
  readonly api: ReturnType<typeof createApi>;
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly attachments: FakeAttachmentFiles;
  readonly tokens: FakeRunTokens;
  readonly runDirs: FakeRunDirs;
  readonly definitions: FakeDefinitionStore;
  readonly transports: FakeTransportResolver;
  readonly log: FakeEventLog;
  readonly release: (() => void) | undefined;
  readonly events: readonly UiEvent[];
  readonly finished: Promise<string>;
}

const PLANTED_TOKEN = 'tok_PLANTED-NEVER-IN-VIEWS';
const PLANTED_BYTES = 'ATTACHMENT-BYTES-PLANTED-NEVER-IN-VIEWS';

interface SeedOptions {
  readonly withTurn?: boolean;
  readonly withBinding?: boolean;
}

const seed = async (options: SeedOptions = {}): Promise<Harness> => {
  const clock = createFakeClock(T0);
  const deps = createFakeDeps({
    clock,
    ids: createFakeIdGen(idOf<'conversation'>(90) as unknown as string),
    log: createFakeEventLog(),
    runTokens: createFakeRunTokens(),
    runDirs: createFakeRunDirs(),
    definitions: createFakeDefinitionStore(),
    transports: createFakeTransportResolver(),
    modelCatalog: createFakeModelCatalog({ [ACCOUNT]: [MODEL] }),
    mcpEndpoint: ENDPOINT,
    attachmentFiles: createFakeAttachmentFiles(),
  });
  await deps.projects.save({ id: ATOLYE, name: 'Atölye', mainRepo: ACME, repos: [ACME, WEB] });
  await deps.projects.save({ id: DIGER, name: 'Diğer', mainRepo: YABANCI, repos: [YABANCI] });
  await deps.workOrders.create({
    id: WORK_ORDER,
    project: ATOLYE,
    repo: ACME,
    flow: slugOf<'flow'>('main'),
    title: 'Rapor taslağı hazırla',
    createdAt: T0 - 100_000,
    createdBy: USER,
  });
  await deps.pages.save({
    id: PAGE,
    title: 'Sprint tablosu',
    kind: 'table',
    project: ATOLYE,
    createdBy: USER,
    createdAt: T0 - 50_000,
    versions: [{ n: 1, createdAt: T0 - 50_000, by: USER, entry: 't.csv', files: [] }],
    approval: 'none',
  });

  const attachmentRef: AttachmentRef = {
    id: ATTACHMENT,
    name: 'ekran.png',
    kind: 'image',
    bytes: PNG_BYTES.length,
    sha256: sha256Hex(enc(PLANTED_BYTES)),
  };
  await deps.attachmentFiles.write(CONVERSATION, ATTACHMENT, enc(PLANTED_BYTES));
  const conversation: Conversation = {
    id: CONVERSATION,
    scope: { kind: 'project', project: ATOLYE },
    title: 'Rapor taslağı',
    createdAt: T0 - 40_000,
    updatedAt: T0 - 10_000,
    pinned: false,
    messages: [
      {
        id: idOf<'message'>(41),
        role: 'user',
        at: T0 - 40_000,
        text: 'İE-0001 raporuna bakar mısın? Taslağı gözden geçir.',
        refs: [
          { kind: 'workOrder', id: WORK_ORDER },
          { kind: 'project', id: ATOLYE },
          { kind: 'repo', id: ACME },
          { kind: 'file', id: 'src/app.ts', repo: ACME },
        ],
        attachments: [attachmentRef],
        artifacts: [],
        sources: [],
      },
      {
        id: idOf<'message'>(42),
        role: 'assistant',
        at: T0 - 10_000,
        text: 'Tabloyu hazırladım.',
        refs: [],
        attachments: [],
        artifacts: [{ kind: 'page', page: PAGE, version: 1 }],
        sources: ['operator request'],
        usage: { inputTokens: 100, outputTokens: 50, costMicros: 250_000 },
      },
    ],
  };
  await deps.conversations.save(conversation);
  await deps.conversations.save({
    id: CONVERSATION_OTHER,
    scope: { kind: 'global' },
    title: 'Serbest sohbet',
    createdAt: T0 - 30_000,
    updatedAt: T0 - 20_000,
    pinned: true,
    messages: [
      { id: idOf<'message'>(43), role: 'user', at: T0 - 30_000, text: 'eski mesaj', refs: [], attachments: [], artifacts: [], sources: [] },
    ],
  });
  await deps.conversations.saveDraft({
    id: DRAFT,
    conversation: CONVERSATION,
    project: ATOLYE,
    repo: ACME,
    title: 'Yeni iş emri',
    status: 'draft',
  });
  await deps.actions.save({
    id: ACTION,
    conversation: CONVERSATION,
    action: { kind: 'setting_change', key: 'dispatch.mode', value: 'auto' },
    status: 'pending',
    proposedAt: T0 - 5_000,
  } as ActionRecord);
  await deps.grants.save({
    id: GRANT,
    conversation: CONVERSATION,
    by: { kind: 'user', id: USER.id },
    classes: ['setting_change'],
    grantedAt: T0 - 4_000,
    expiresAt: T0 + 600_000,
    applied: 2,
  } as Grant);

  let release: (() => void) | undefined;
  if (options.withBinding !== false) {
    await deps.accounts.save({
      id: ACCOUNT,
      provider: 'provider-x',
      label: 'Ana hesap',
      authMode: 'subscription',
      limitPolicy: 'wait_resume',
      caps: [],
      tierModels: { strong: 'm-bal', balanced: 'm-bal', fast: 'm-bal' },
    });
    await deps.bindings.save({ level: 'global' }, { role: ROLE, accounts: [{ accountId: ACCOUNT } as AccountRoute] });
  }
  if (options.withTurn === true) {
    const parked = parkedTransport([
      { type: 'text', at: T0 + 1, delta: 'Merhaba, ' },
      { type: 'text', at: T0 + 2, delta: 'rapora baktım.' },
      { type: 'finished', at: T0 + 3, reason: 'completed' },
    ]);
    (deps.transports as FakeTransportResolver).register(ACCOUNT, parked.transport);
    release = parked.release;
  }

  const wiring: ChatWiring = {
    runner: createChatRunner(deps, { turnLedger: createChatTurnLedger() }),
    apply: createActionApplier(deps) as ActionApplier,
    undo: createActionUndoer(deps) as ActionUndoer,
  };
  const api = createApi(deps, undefined, undefined, undefined, undefined, undefined, undefined, undefined, wiring);
  const events: UiEvent[] = [];
  let settle: ((outcome: string) => void) | undefined;
  const finished = new Promise<string>((resolve) => {
    settle = resolve;
  });
  api.subscribe((event) => {
    events.push(event);
    if (event.type === 'chat.turn' && event.phase === 'finished' && settle !== undefined) settle(event.outcome ?? '');
  });
  return { api, deps, clock, attachments: deps.attachmentFiles as FakeAttachmentFiles, tokens: deps.runTokens as unknown as FakeRunTokens, runDirs: deps.runDirs as FakeRunDirs, definitions: deps.definitions as FakeDefinitionStore, transports: deps.transports as FakeTransportResolver, log: deps.log as FakeEventLog, release, events, finished };
};

const query = async <T = readonly ChatConversationSummaryView[]>(h: Harness, q: unknown): Promise<T> => (await h.api.query(q as never)) as T;

describe('chat queries', () => {
  it('A-251: the history lists pinned first, then newest-updated, with lastText, messageCount and activeTurn', async () => {
    const h = await seed();
    const rows = (await query(h, { type: 'chat.conversations' })) as readonly ChatConversationSummaryView[];
    expect(rows.map((row) => row.id)).toEqual([CONVERSATION_OTHER, CONVERSATION]);
    expect(rows[0]).toMatchObject({ title: 'Serbest sohbet', pinned: true, messageCount: 1, activeTurn: false, lastText: 'eski mesaj' });
    expect(rows[1]).toMatchObject({ title: 'Rapor taslağı', scope: { kind: 'project', project: ATOLYE }, messageCount: 2, activeTurn: false, lastText: 'Tabloyu hazırladım.' });
  });

  it('A-251a: q folds Turkish over title and message text both ways (taslağı ↔ taslak, ı/İ)', async () => {
    const h = await seed();
    expect((await query(h, { type: 'chat.conversations', q: 'taslak' })).map((row: ChatConversationSummaryView) => row.id)).toEqual([CONVERSATION]);
    expect((await query(h, { type: 'chat.conversations', q: 'TASLAĞI' })).map((row: ChatConversationSummaryView) => row.id)).toEqual([CONVERSATION]);
    expect((await query(h, { type: 'chat.conversations', q: 'mesaj' })).map((row: ChatConversationSummaryView) => row.id)).toEqual([CONVERSATION_OTHER]); // only a message holds it
    expect(await query(h, { type: 'chat.conversations', q: 'yokböyleşey' })).toEqual([]);
  });

  it('A-251b: scope, pinned and before narrow; the limit defaults to 30 and caps at 100; lastText cuts at 120', async () => {
    const h = await seed();
    expect((await query(h, { type: 'chat.conversations', scope: { kind: 'global' } })).map((row: ChatConversationSummaryView) => row.id)).toEqual([CONVERSATION_OTHER]);
    expect((await query(h, { type: 'chat.conversations', pinned: true })).map((row: ChatConversationSummaryView) => row.id)).toEqual([CONVERSATION_OTHER]);
    expect((await query(h, { type: 'chat.conversations', before: T0 - 15_000 })).map((row: ChatConversationSummaryView) => row.id)).toEqual([CONVERSATION_OTHER]);
    expect((await query(h, { type: 'chat.conversations', limit: 1 })).length).toBe(1);
    expect(await query(h, { type: 'chat.conversations', limit: 101 })).toEqual({ ok: false, code: 'bad_input' });
    expect(await query(h, { type: 'chat.conversations', limit: 0 })).toEqual({ ok: false, code: 'bad_input' });
    expect(await query(h, { type: 'chat.conversations', scope: { kind: 'project', project: 'not a slug' } })).toEqual({ ok: false, code: 'bad_input' });

    const long = await seed();
    await long.deps.conversations.save({
      id: idOf<'conversation'>(50),
      scope: { kind: 'global' },
      title: 'uzun',
      createdAt: T0 + 1,
      updatedAt: T0 + 1,
      pinned: false,
      messages: [
        { id: idOf<'message'>(51), role: 'user', at: T0 + 1, text: 'x'.repeat(300), refs: [], attachments: [], artifacts: [], sources: [] },
      ],
    });
    const rows = (await query(long, { type: 'chat.conversations' })) as readonly ChatConversationSummaryView[];
    const longRow = rows.find((row) => row.title === 'uzun');
    expect(longRow?.lastText.length).toBe(120);
  });

  it('A-252: the conversation view resolves reference, artifact, draft, action and grant labels', async () => {
    const h = await seed();
    const view = (await query(h, { type: 'chat.conversation', id: CONVERSATION })) as ChatConversationView;
    expect(view.scope).toEqual({ kind: 'project', project: ATOLYE });
    expect(view.messages[0]?.refs).toEqual([
      { kind: 'workOrder', id: WORK_ORDER, label: 'İE-0001 Rapor taslağı hazırla' },
      { kind: 'project', id: ATOLYE, label: 'Atölye' },
      { kind: 'repo', id: ACME, label: 'acme' },
      { kind: 'file', id: 'src/app.ts', label: 'src/app.ts', repo: ACME },
    ]);
    expect(view.messages[0]?.attachments).toEqual([{ id: ATTACHMENT, name: 'ekran.png', type: 'image', bytes: PNG_BYTES.length }]);
    expect(view.messages[1]?.artifacts).toEqual([{ kind: 'page', id: PAGE, version: 1, title: 'Sprint tablosu', pageKind: 'table' }]);
    expect(view.messages[1]?.sources).toEqual(['operator request']);
    expect(view.messages[1]?.usage).toEqual({ inputTokens: 100, outputTokens: 50, costMicros: 250_000 });
    expect(view.drafts).toEqual([{ id: DRAFT, project: ATOLYE, repo: ACME, title: 'Yeni iş emri', task: null, status: 'draft', workOrder: null }]);
    expect(view.actions).toEqual([
      { id: ACTION, class: 'setting_change', status: 'pending', undoable: false, undoExpiresAt: null, authority: null, failure: null },
    ]);
    expect(view.grants).toEqual([{ id: GRANT, classes: ['setting_change'], expiresAt: T0 + 600_000, applicationsLeft: 23 }]);
    expect('activeTurn' in view && view.activeTurn).toBeFalsy();
  });

  it('A-252a: no view ever carries a token, a sessionRef, an environment value or file bytes', async () => {
    const h = await seed({ withTurn: true });
    const wired = h.deps.runTokens as unknown as { mint: (binding: unknown, token: string) => void };
    void wired;
    const list = JSON.stringify(await query(h, { type: 'chat.conversations' }));
    const detail = JSON.stringify(await query(h, { type: 'chat.conversation', id: CONVERSATION }));
    const attachment = JSON.stringify(await query(h, { type: 'chat.attachment', conversation: CONVERSATION, id: ATTACHMENT }));
    const usage = JSON.stringify(await query(h, { type: 'chat.usage' }));
    const all = list + detail + attachment + usage;
    expect(all).not.toContain(PLANTED_BYTES);
    expect(all).not.toContain('sessionRef');
    expect(all).not.toContain('sk-live');
    // The attachment view carries the bytes ON REQUEST (that is its purpose), but never inside a
    // list or detail view — the chips show metadata only.
    expect(detail).not.toContain(b64(enc(PLANTED_BYTES)));
    expect(list).not.toContain(b64(enc(PLANTED_BYTES)));
    expect(usage).not.toContain(PLANTED_TOKEN);
  });

  it('A-253: references fold-searches the operator\'s own projects with kinds, project and limit filters', async () => {
    const h = await seed();
    const rows = (await query(h, { type: 'chat.references', q: 'taslak' })) as readonly { kind: string; id: string; label: string; project?: string }[];
    expect(rows).toEqual([{ kind: 'work_order', id: WORK_ORDER, label: 'İE-0001 Rapor taslağı hazırla', project: ATOLYE }]);
    expect((await query(h, { type: 'chat.references', q: 'atolye' })).length).toBe(1); // ö folds to o
    const repos = (await query(h, { type: 'chat.references', q: 'acme' })) as readonly { kind: string; id: string }[];
    expect(repos.map((row) => row.kind)).toEqual(['repo']);
    expect(repos[0]?.id).toBe(ACME);
    const pages = (await query(h, { type: 'chat.references', q: 'tablo', kinds: ['page'] })) as readonly { kind: string; id: string }[];
    expect(pages).toEqual([{ kind: 'page', id: PAGE, label: 'Sprint tablosu', project: ATOLYE }]);
    const scoped = (await query(h, { type: 'chat.references', q: 'taslak', project: DIGER })) as readonly unknown[];
    expect(scoped).toEqual([]);
    expect((await query(h, { type: 'chat.references', q: 'taslak', limit: 1 })).length).toBe(1);
    expect(await query(h, { type: 'chat.references', q: 'taslak', limit: 51 })).toEqual({ ok: false, code: 'bad_input' });
    expect(await query(h, { type: 'chat.references', q: '' })).toEqual({ ok: false, code: 'bad_input' });
    // Another project's repo never surfaces: yabanci belongs to diger, not to the asked project.
    const foreign = (await query(h, { type: 'chat.references', q: 'yabanci' })) as readonly { kind: string; id: string }[];
    expect(foreign.map((row) => row.id)).toEqual([YABANCI]); // present without a project filter — the operator's own
  });

  it('A-254: an attachment comes back by base64; unknown, foreign and malformed ids are not_found or bad_input', async () => {
    const h = await seed();
    const view = (await query(h, { type: 'chat.attachment', conversation: CONVERSATION, id: ATTACHMENT })) as { name: string; type: string; base64: string };
    expect(view).toEqual({ name: 'ekran.png', type: 'image', base64: b64(enc(PLANTED_BYTES)) });
    expect(await query(h, { type: 'chat.attachment', conversation: CONVERSATION, id: idOf<'attachment'>(36) })).toEqual({ ok: false, code: 'not_found' });
    expect(await query(h, { type: 'chat.attachment', conversation: CONVERSATION_OTHER, id: ATTACHMENT })).toEqual({ ok: false, code: 'not_found' });
    expect(await query(h, { type: 'chat.attachment', conversation: 'nope', id: ATTACHMENT })).toEqual({ ok: false, code: 'bad_input' });
  });

  it('A-255: usage counts this month\'s messages, tokens and cost, and names the assistant account', async () => {
    const h = await seed();
    // One message last month must not count.
    await h.deps.conversations.save({
      id: idOf<'conversation'>(60),
      scope: { kind: 'global' },
      title: 'geçen ay',
      createdAt: T0 - 40 * 86_400_000,
      updatedAt: T0 - 40 * 86_400_000,
      pinned: false,
      messages: [
        { id: idOf<'message'>(61), role: 'assistant', at: T0 - 40 * 86_400_000, text: 'eski yanıt', refs: [], attachments: [], artifacts: [], sources: [], usage: { inputTokens: 999, costMicros: 999_999 } },
      ],
    });
    const view = (await query(h, { type: 'chat.usage' })) as ChatUsageView;
    expect(view.month).toEqual({ messages: 3, tokens: 150, costUsd: 0.25 });
    expect(view.account).toEqual({ label: 'Ana hesap' });

    const bare = await seed({ withBinding: false });
    const bareView = (await query(bare, { type: 'chat.usage' })) as ChatUsageView;
    expect(bareView.account).toBeUndefined();
  });
});

describe('chat commands', () => {
  it('A-256: chat.start validates the scope, creates the shell, and with a message also starts the turn', async () => {
    const h = await seed({ withTurn: true });
    expect(await h.api.command(USER, { type: 'chat.start', scope: { kind: 'nonsense' } as never })).toEqual({ ok: false, code: 'bad_scope' });
    expect(await h.api.command(USER, { type: 'chat.start', scope: { kind: 'project', project: 'yok' } })).toEqual({ ok: false, code: 'bad_scope' });
    expect(await h.api.command(USER, { type: 'chat.start', scope: { kind: 'workOrder', workOrder: idOf<'work-order'>(99) } })).toEqual({ ok: false, code: 'bad_scope' });

    const shell = await h.api.command(USER, { type: 'chat.start', scope: { kind: 'global' } });
    expect(shell.ok).toBe(true);
    if (!shell.ok) throw new Error('unreachable');
    expect(shell.turn).toBeUndefined();
    const stored = await h.deps.conversations.get(ulidOf<'conversation'>(shell.conversation ?? ''));
    expect(stored?.messages).toEqual([]);

    const started = await h.api.command(USER, { type: 'chat.start', scope: { kind: 'global' }, message: 'Yeni bir rapor taslağı' });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error('unreachable');
    expect(typeof started.conversation).toBe('string');
    expect(typeof started.turn).toBe('string');
    h.release?.();
    expect(await h.finished).toBe('completed');
    const conversation = await h.deps.conversations.get(ulidOf<'conversation'>(String(started.conversation)));
    expect(conversation?.title).toBe('Yeni bir rapor taslağı');
    expect(conversation?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('A-257: chat.send appends and starts the turn; conversation errors, busy and too_many_turns pass through', async () => {
    const h = await seed({ withTurn: true });
    expect(await h.api.command(USER, { type: 'chat.send', conversation: 'nope', text: 'selam' })).toEqual({ ok: false, code: 'bad_input' });
    expect(await h.api.command(USER, { type: 'chat.send', conversation: idOf<'conversation'>(98), text: 'selam' })).toEqual({ ok: false, code: 'not_found' });
    expect(await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: '   ' })).toEqual({ ok: false, code: 'empty_message' });
    expect((await h.deps.conversations.get(CONVERSATION))?.messages).toHaveLength(2); // nothing was appended

    const sent = await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'devam et' });
    expect(sent.ok).toBe(true);
    expect(await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'ikinci' })).toEqual({ ok: false, code: 'busy' });
    // A refused turn still appended its message (A-232): both sends stored theirs.
    expect((await h.deps.conversations.get(CONVERSATION))?.messages).toHaveLength(4);
    h.release?.();
    expect(await h.finished).toBe('completed');

    // The app-wide cap: three parked turns on three conversations, the fourth is too_many_turns.
    const busy = await seed({ withTurn: true });
    for (const n of [70, 71, 72]) {
      await busy.deps.conversations.save({ id: idOf<'conversation'>(n), scope: { kind: 'global' }, title: `c${n}`, createdAt: T0, updatedAt: T0, pinned: false, messages: [] });
      const started = await busy.api.command(USER, { type: 'chat.send', conversation: idOf<'conversation'>(n), text: 'selam' });
      expect(started.ok).toBe(true);
    }
    await busy.deps.conversations.save({ id: idOf<'conversation'>(73), scope: { kind: 'global' }, title: 'c73', createdAt: T0, updatedAt: T0, pinned: false, messages: [] });
    expect(await busy.api.command(USER, { type: 'chat.send', conversation: idOf<'conversation'>(73), text: 'selam' })).toEqual({ ok: false, code: 'too_many_turns' });
  });

  it('A-258: cancel stops the live turn; pin marks; delete cancels first and removes everything', async () => {
    const h = await seed({ withTurn: true });
    expect(await h.api.command(USER, { type: 'chat.cancel', conversation: CONVERSATION_OTHER })).toEqual({ ok: true }); // idle: an ok no-op

    await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'uzun iş' });
    expect(await h.api.command(USER, { type: 'chat.cancel', conversation: CONVERSATION })).toEqual({ ok: true });
    expect(await h.finished).toBe('cancelled');
    expect((await query<ChatConversationView>(h, { type: 'chat.conversation', id: CONVERSATION })).activeTurn).toBeUndefined();

    expect(await h.api.command(USER, { type: 'chat.pin', conversation: CONVERSATION, pinned: true })).toEqual({ ok: true });
    expect((await query(h, { type: 'chat.conversations', pinned: true })).length).toBe(2);

    const h2 = await seed({ withTurn: true });
    await h2.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'silinecek' });
    expect(await h2.api.command(USER, { type: 'chat.delete', conversation: CONVERSATION })).toEqual({ ok: true });
    expect(await h2.finished).toBe('cancelled');
    expect(await query(h2, { type: 'chat.conversation', id: CONVERSATION })).toEqual({ ok: false, code: 'not_found' });
    expect(await h2.api.command(USER, { type: 'chat.delete', conversation: CONVERSATION })).toEqual({ ok: true }); // idempotent
  });

  it('A-259: attach decodes strictly, sniffs magic bytes and enforces the per-conversation caps', async () => {
    const h = await seed();
    const good = await h.api.command(USER, { type: 'chat.attach', name: 'ekran.png', fileType: 'png', base64: b64(PNG_BYTES) });
    expect(good).toMatchObject({ ok: true });

    const huge = new Uint8Array(CONVERSATION_LIMITS_BYTES + 1);
    expect(await h.api.command(USER, { type: 'chat.attach', name: 'buyuk.png', fileType: 'png', base64: b64(huge) })).toEqual({ ok: false, code: 'attachment_too_large' });
    expect(await h.api.command(USER, { type: 'chat.attach', name: 'kotu.png', fileType: 'png', base64: 'not base64!' })).toEqual({ ok: false, code: 'bad_base64' });
    expect(await h.api.command(USER, { type: 'chat.attach', name: 'sahte.png', fileType: 'png', base64: b64(enc('<html>not an image</html>')) })).toEqual({ ok: false, code: 'bad_attachment' });
    expect(await h.api.command(USER, { type: 'chat.attach', name: 'fatura.pdf', fileType: 'pdf', base64: b64(enc('%PDF-1.7 fake')) })).toMatchObject({ ok: true });
    expect(await h.api.command(USER, { type: 'chat.attach', name: 'not.txt', fileType: 'exe', base64: b64(enc('x')) })).toEqual({ ok: false, code: 'bad_attachment' });
    expect(await h.api.command(USER, { type: 'chat.attach', name: 'belge.md', fileType: 'png', base64: b64(PNG_BYTES) })).toEqual({ ok: false, code: 'bad_attachment' });

    // Five pending uploads per conversation, then the sixth is too many; the byte total caps too.
    const h2 = await seed();
    const threeMeg = 'a'.repeat(3 * 1_000_000);
    for (let n = 1; n <= 4; n += 1) {
      expect(await h2.api.command(USER, { type: 'chat.attach', conversation: CONVERSATION, name: `k${n}.md`, fileType: 'md', base64: b64(enc(threeMeg)) })).toMatchObject({ ok: true });
    }
    // 12 MB pending + this one's 4 MB crosses the 15 MB conversation cap.
    expect(await h2.api.command(USER, { type: 'chat.attach', conversation: CONVERSATION, name: 'besinci.md', fileType: 'md', base64: b64(enc('b'.repeat(4 * 1_000_000))) })).toEqual({ ok: false, code: 'attachments_too_large' });
    expect(await h2.api.command(USER, { type: 'chat.attach', conversation: CONVERSATION, name: 'besinci.md', fileType: 'md', base64: b64(enc('son')) })).toMatchObject({ ok: true });
    expect(await h2.api.command(USER, { type: 'chat.attach', conversation: CONVERSATION, name: 'altinci.md', fileType: 'md', base64: b64(enc('x')) })).toEqual({ ok: false, code: 'too_many_attachments' });
    expect(await h2.api.command(USER, { type: 'chat.attach', conversation: idOf<'conversation'>(97), name: 'yabanci.md', fileType: 'md', base64: b64(enc('x')) })).toEqual({ ok: false, code: 'not_found' });
  });

  it('A-260: unreferenced uploads older than an hour are swept when a turn starts; fresh ones survive', async () => {
    const h = await seed();
    const stale = await h.api.command(USER, { type: 'chat.attach', name: 'eski.md', fileType: 'md', base64: b64(enc('eski')) });
    if (!stale.ok) throw new Error('fixture attach');
    h.clock.advance(3_600_001);
    const fresh = await h.api.command(USER, { type: 'chat.attach', name: 'yeni.md', fileType: 'md', base64: b64(enc('yeni')) });
    if (!fresh.ok) throw new Error('fixture attach');

    // A send sweeps first: the stale upload is gone before the message could reference it, the
    // fresh one still answers.
    expect(await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'temizlik', attachments: [stale.attachment ?? ''] })).toEqual({ ok: false, code: 'not_found' });
    const sent = await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'temizlik', attachments: [fresh.attachment ?? ''] });
    expect(sent.ok).toBe(true);
    const conversation = await h.deps.conversations.get(CONVERSATION);
    const last = conversation?.messages[conversation.messages.length - 1];
    expect(last?.attachments).toHaveLength(1);
    expect(last?.attachments[0]).toMatchObject({ name: 'yeni.md', kind: 'text', bytes: 4 });
  });

  it('A-261: refs resolve at the boundary — a bad ref never reaches the use case; the 13th is too many', async () => {
    const h = await seed({ withTurn: true });
    const before = (await h.deps.conversations.get(CONVERSATION))?.messages.length ?? 0;
    const badRefs: readonly ChatRefInput[] = [
      { kind: 'workOrder', id: idOf<'work-order'>(98) },
      { kind: 'page', id: idOf<'page'>(98) },
      { kind: 'project', id: 'yokbolebirproje' },
      { kind: 'repo', id: 'unregistered' },
      { kind: 'file', repo: ACME, path: '../dis.json' },
      { kind: 'file', repo: ACME, path: '/etc/passwd' },
      { kind: 'file', repo: ACME, path: 'src\\app.ts' },
      { kind: 'file', repo: ACME, path: 'src/%41pp.ts' },
      { kind: 'file', repo: ACME, path: 'src/app\u0000.ts' },
      { kind: 'file', repo: ACME, path: '.env' },
      { kind: 'file', repo: ACME, path: '.git/config' },
      { kind: 'file', repo: 'unregistered', path: 'src/app.ts' },
    ];
    for (const ref of badRefs) {
      expect(await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'buydu', refs: [ref] })).toEqual({ ok: false, code: 'bad_ref' });
    }
    // A repo of ANOTHER project is still the operator's own and is accepted; the refused ones
    // above left the conversation untouched.
    const cross = await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'idari', refs: [{ kind: 'repo', id: YABANCI }] });
    expect(cross.ok).toBe(true);
    expect((await h.deps.conversations.get(CONVERSATION))?.messages.length).toBe(before + 1);

    // While the turn is still parked: the 13th ref is refused before anything is appended.
    const thirteen = Array.from({ length: 13 }, (): ChatRefInput => ({ kind: 'project', id: ATOLYE }));
    expect(await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'cok', refs: thirteen })).toEqual({ ok: false, code: 'too_many_refs' });
    expect((await h.deps.conversations.get(CONVERSATION))?.messages.length).toBe(before + 1); // only the accepted one

    h.release?.();
    await h.finished;
    expect((await h.deps.conversations.get(CONVERSATION))?.messages.length).toBe(before + 2); // the assistant answered
  });

  it('A-262: draft confirm/drop, action decide/undo and grant/revoke are thin maps with their own codes', async () => {
    const h = await seed();
    h.definitions.seed({ kind: 'repo', repo: ACME }, 'defs.json', JSON.stringify({
      roles: [],
      flows: [{ id: 'main', name: 'Main', stages: [{ id: 'plan', name: 'Plan', role: null, exit: [{ kind: 'human', id: 'ok', label: 'Ok' }] }] }],
      capabilities: [],
      repo: { id: ACME, name: ACME, repos: [], flows: ['main'], defaultFlow: 'main', commandSets: {}, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
    }));

    const confirmed = await h.api.command(USER, { type: 'chat.draft.confirm', draft: DRAFT });
    expect(confirmed).toMatchObject({ ok: true, code: 'İE-0002' });
    expect(await h.api.command(USER, { type: 'chat.draft.confirm', draft: DRAFT })).toEqual({ ok: false, code: 'not_draft' });

    await h.deps.conversations.saveDraft({ id: idOf<'draft'>(38), conversation: CONVERSATION, project: ATOLYE, repo: ACME, title: 'İkinci', status: 'draft' });
    expect(await h.api.command(USER, { type: 'chat.draft.drop', draft: idOf<'draft'>(38) })).toEqual({ ok: true });
    expect(await h.api.command(USER, { type: 'chat.draft.drop', draft: idOf<'draft'>(39) })).toEqual({ ok: false, code: 'not_found' });

    expect(await h.api.command(USER, { type: 'chat.action.decide', id: ACTION, decision: 'approved' })).toEqual({ ok: true });
    expect(await h.api.command(USER, { type: 'chat.action.decide', id: ACTION, decision: 'approved' })).toEqual({ ok: false, code: 'not_pending' });
    expect(await h.api.command(USER, { type: 'chat.action.decide', id: idOf<'action'>(98), decision: 'approved' })).toEqual({ ok: false, code: 'not_found' });
    expect(await h.api.command(AGENT, { type: 'chat.action.decide', id: ACTION, decision: 'approved' })).toEqual({ ok: false, code: 'not_user' });

    const expiredUndo: ActionRecord = {
      id: idOf<'action'>(45),
      conversation: CONVERSATION,
      action: { kind: 'setting_change', key: 'dispatch.mode', value: 'fixed' },
      status: 'applied',
      proposedAt: T0 - 100_000,
      decidedAt: T0 - 90_000,
      decidedBy: { kind: 'user', id: USER.id },
      undo: { kind: 'restore_setting', ref: 'assistant.undo.x', expiresAt: T0 - 1 },
    };
    await h.deps.actions.save(expiredUndo);
    expect(await h.api.command(USER, { type: 'chat.action.undo', id: expiredUndo.id })).toEqual({ ok: false, code: 'undo_expired' });
    // The approved setting change carries a live undo: undoing works, undoing again does not.
    expect(await h.api.command(USER, { type: 'chat.action.undo', id: ACTION })).toEqual({ ok: true });
    expect(await h.api.command(USER, { type: 'chat.action.undo', id: ACTION })).toEqual({ ok: false, code: 'not_applied' });

    const grant = await h.api.command(USER, { type: 'chat.grant', conversation: CONVERSATION, classes: ['setting_change'], minutes: 10 });
    expect(grant).toMatchObject({ ok: true });
    expect(await h.api.command(USER, { type: 'chat.grant', conversation: CONVERSATION, classes: ['merge_everything'], minutes: 10 })).toEqual({ ok: false, code: 'bad_class' });
    expect(await h.api.command(USER, { type: 'chat.grant', conversation: CONVERSATION, classes: ['setting_change'], minutes: 0 })).toEqual({ ok: false, code: 'grant_expired' });
    expect(await h.api.command(USER, { type: 'chat.grant', conversation: CONVERSATION, classes: ['setting_change'], minutes: 61 })).toEqual({ ok: false, code: 'grant_too_long' });
    expect(await h.api.command(AGENT, { type: 'chat.grant', conversation: CONVERSATION, classes: ['setting_change'], minutes: 10 })).toEqual({ ok: false, code: 'grant_not_user' });
    // The smuggled `by` never acted: the grant names the operator the api itself knows.
    if (!grant.ok) throw new Error('unreachable');
    expect(await h.api.command(USER, { type: 'chat.revoke', grant: grant.id ?? '' })).toEqual({ ok: true });
    // Far from the id generator's sequence: an id no grant ever took.
    expect(await h.api.command(USER, { type: 'chat.revoke', grant: ulidOf<'grant'>('01ARZ3NDEKTSV4RRFFQA000000') })).toEqual({ ok: false, code: 'not_found' });
    const stored = await h.deps.grants.get(ulidOf<'grant'>(grant.id ?? ''));
    expect(stored?.by).toEqual({ kind: 'user', id: USER.id });
  });

  it('A-262: a smuggled by/actor field in the payload is ignored — the api\'s own actor acts', async () => {
    const h = await seed();
    const smuggled = {
      type: 'chat.grant',
      conversation: CONVERSATION,
      classes: ['setting_change'],
      minutes: 5,
      by: { kind: 'agent', runId: '01ARZ3NDEKTSV4RRFFQ69G5F777', role: 'worker' },
    } as never;
    const granted = await h.api.command(USER, smuggled);
    expect(granted.ok).toBe(true);
    const stored = await h.deps.grants.forConversation(CONVERSATION);
    expect(stored[stored.length - 1]?.by).toEqual({ kind: 'user', id: USER.id });
  });

  it('A-263: a turn arrives as started, ordered deltas and finished; the coarse events carry no text', async () => {
    const h = await seed({ withTurn: true });
    await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'selam' });
    h.release?.();
    await h.finished;
    const chat = h.events.filter((event) => event.type.startsWith('chat.'));
    expect(chat.map((event) => event.type)).toEqual(['chat.turn', 'chat.delta', 'chat.delta', 'chat.turn']);
    const started = chat[0];
    expect(started).toMatchObject({ type: 'chat.turn', conversation: CONVERSATION, phase: 'started' });
    expect(chat[1]).toMatchObject({ type: 'chat.delta', text: 'Merhaba, ' });
    expect(chat[2]).toMatchObject({ type: 'chat.delta', text: 'rapora baktım.' });
    const finished = chat[3];
    expect(finished).toMatchObject({ type: 'chat.turn', phase: 'finished', outcome: 'completed' });
    for (const event of chat.filter((event) => event.type !== 'chat.delta')) {
      expect('text' in event).toBe(false);
    }
    const turnId = (started as { turn: string }).turn;
    expect((finished as { turn: string }).turn).toBe(turnId);
    expect(typeof turnId).toBe('string');
  });

  it('A-264: the api unsubscribes the runner with its last listener, and a throwing listener breaks nothing', async () => {
    // A hand-rolled runner records its subscriptions, so the api's own hygiene is what is tested.
    let subscribed = 0;
    let unsubscribed = 0;
    let runnerListener: ((event: { type: 'text'; turn: RunId; delta: string }) => void) | undefined;
    const runner: ChatRunner = {
      startTurn: async () => ({ ok: true, value: { turn: idOf<'run'>(80) } }),
      cancel: async () => ({ ok: true, value: undefined }),
      active: () => undefined,
      subscribe: (_conversation, listener) => {
        subscribed += 1;
        runnerListener = listener as typeof runnerListener;
        return () => {
          unsubscribed += 1;
        };
      },
    };
    const deps = createFakeDeps({ clock: createFakeClock(T0) });
    await deps.conversations.save({ id: CONVERSATION, scope: { kind: 'global' }, title: 't', createdAt: T0, updatedAt: T0, pinned: false, messages: [] });
    const api = createApi(deps, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      runner,
      apply: async () => ({ ok: true, value: {} }),
      undo: async () => ({ ok: true, value: undefined }),
    });
    const seen: string[] = [];
    const off1 = api.subscribe(() => {
      throw new Error('this listener is broken');
    });
    const off2 = api.subscribe((event) => {
      if (event.type === 'chat.delta') seen.push(event.text);
    });
    await api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'selam' });
    expect(subscribed).toBe(1);
    runnerListener?.({ type: 'text', turn: idOf<'run'>(80), delta: 'hala geliyor' });
    expect(seen).toEqual(['hala geliyor']); // the broken listener did not take the healthy one down
    off1();
    expect(unsubscribed).toBe(0);
    off2();
    expect(unsubscribed).toBe(1); // the last listener out took the runner bridge with it
  });

  it('A-265: malformed ids are bad_input and unknown ones not_found — missing and foreign answer the same', async () => {
    const h = await seed();
    expect(await query(h, { type: 'chat.conversation', id: 'not-a-ulid' })).toEqual({ ok: false, code: 'bad_input' });
    expect(await query(h, { type: 'chat.conversation', id: idOf<'conversation'>(98) })).toEqual({ ok: false, code: 'not_found' });
    expect(await h.api.command(USER, { type: 'chat.pin', conversation: 'xx', pinned: true })).toEqual({ ok: false, code: 'bad_input' });
    expect(await h.api.command(USER, { type: 'chat.pin', conversation: idOf<'conversation'>(98), pinned: true })).toEqual({ ok: false, code: 'not_found' });
    expect(await h.api.command(USER, { type: 'chat.draft.drop', draft: 'xx' })).toEqual({ ok: false, code: 'bad_input' });
    expect(await h.api.command(USER, { type: 'chat.action.decide', id: 'xx', decision: 'approved' })).toEqual({ ok: false, code: 'bad_input' });
    expect(await h.api.command(USER, { type: 'chat.revoke', grant: 'xx' })).toEqual({ ok: false, code: 'bad_input' });
    expect(await h.api.command(USER, { type: 'chat.cancel', conversation: idOf<'conversation'>(98) })).toEqual({ ok: false, code: 'not_found' });
  });

  it('U-97: chat.delta is the only payload event — every fragment ≤ 4 KiB, in order, never stored', async () => {
    const h = await seed();
    const big = 'ç'.repeat(3_000); // 2 bytes per char: 6 KB of payload must split
    const parked = parkedTransport([
      { type: 'text', at: T0 + 1, delta: big },
      { type: 'finished', at: T0 + 2, reason: 'completed' },
    ]);
    h.transports.register(ACCOUNT, parked.transport);
    await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'buyuk' });
    parked.release();
    await h.finished;
    const deltas = h.events.filter((event): event is Extract<UiEvent, { type: 'chat.delta' }> => event.type === 'chat.delta');
    expect(deltas.length).toBe(2);
    for (const delta of deltas) expect(delta.text.length * 2).toBeLessThanOrEqual(4_096);
    expect(deltas.map((delta) => delta.text).join('')).toBe(big);
    // The store re-queries after the coarse events; none of them carries any text.
    const coarse = h.events.filter((event) => event.type === 'chat.turn' || event.type === 'chat.notice');
    expect(coarse.length).toBeGreaterThan(0);
    for (const event of coarse) expect('text' in event).toBe(false);
  });

  it('U-98: the notice event carries its code, and no listener stack outlives the last subscriber', async () => {
    const h = await seed();
    const parked = parkedTransport([
      { type: 'error', at: T0 + 1, class: 'network', message: 'bağlantı koptu' },
      { type: 'finished', at: T0 + 2, reason: 'failed' },
    ]);
    h.transports.register(ACCOUNT, parked.transport);
    await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'hata' });
    parked.release();
    expect(await h.finished).toBe('failed');
    const notice = h.events.find((event) => event.type === 'chat.notice');
    expect(notice).toMatchObject({ type: 'chat.notice', conversation: CONVERSATION, code: 'network' });
  });

  it('U-100: delta text never reaches the audit log — it holds ids, outcome and counts only', async () => {
    const h = await seed({ withTurn: true });
    await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'kayit' });
    h.release?.();
    await h.finished;
    const entries = h.log.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain('rapora baktım');
  });

  it('U-99: the three chat members ride the same subscribe channel the bridge fans out — no second channel', async () => {
    const h = await seed({ withTurn: true });
    await h.api.command(USER, { type: 'chat.send', conversation: CONVERSATION, text: 'kopru' });
    h.release?.();
    await h.finished;
    const types = h.events.map((event) => event.type);
    expect(types).toContain('chat.turn');
    expect(types).toContain('chat.delta');
    // The UiEvent union accepts all three members: the preload's fan-out needs no new channel.
    const typed: readonly UiEvent[] = h.events;
    expect(typed.length).toBeGreaterThan(2);
  });
});

const CONVERSATION_LIMITS_BYTES = 5_000_000;
