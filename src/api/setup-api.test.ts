// api/setup-api.test.ts — the Docket AI setup surface of the boundary (A-357 … A-360): the start
// command and its refusals, the ask event and the answer loop over the real tool dispatch, the
// setup token a live turn mints and the draft it persists, and the project_setup decision routing.
import { describe, expect, it } from 'vitest';

import type { AccountRoute, Actor, AgentEvent, CatalogModel, RoleSlug, Slug, Ulid } from '../domain/index';
import { parseSlug, parseUlid } from '../domain/index';

import type { AgentTransport, AppDeps, McpEndpoint } from '../application';
import {
  createActionApplier,
  createActionUndoer,
  createChatRunner,
  createChatTurnLedger,
  createDocketTools,
  createSetupContexts,
  type ActionApplier,
  type ActionUndoer,
  type SetupConversations,
  type SetupDraft,
  type SetupDraftStore,
  type SetupPathReader,
} from '../application';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeIdGen,
  createFakeModelCatalog,
  createFakeRunDirs,
  createFakeRunTokens,
  createFakeTransportResolver,
  type FakeDefinitionStore,
  type FakeRunTokens,
  type FakeTransportResolver,
} from '../application/ports/fakes';
import { createProjectSetupProposal, defaultSetupAnswers } from '../application/use-cases/setup';

import { createApi, type UiEvent } from './api';

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const idOf = <B extends string>(n: number): Ulid<B> => ulidOf<B>(`01ARZ3NDEKTSV4RRFFQ69${String(n).padStart(5, '0')}`);

const T0 = 1_728_000_000_000;
const ACCOUNT = idOf<'account'>(11);
const ROLE = slugOf<'role'>('assistant') as RoleSlug;
const USER: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: idOf<'run'>(40), role: ROLE };
const REPO = '/Users/op/work/acme';
const DATA = '/Users/op/.docket';
const OUTSIDE = '/Users/op/notes/plan.md';
const ENDPOINT: McpEndpoint = { socketPath: '/fake-socket/docket.sock', command: 'node', args: ['mcp-child.js'], env: {} };
const MODEL: CatalogModel = { id: 'm-bal', source: 'bundled', tier: 'balanced', thinking: 'unknown', billing: 'included', contextWindow: null };

/** A transport that plays a fixed script and parks before its finished event until released. */
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

interface DraftRecorder extends SetupDraftStore {
  readonly saved: readonly SetupDraft[];
}

const recordingDrafts = (): DraftRecorder => {
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

interface Harness {
  readonly api: ReturnType<typeof createApi>;
  readonly deps: AppDeps;
  readonly tokens: FakeRunTokens;
  readonly definitions: FakeDefinitionStore;
  readonly drafts: DraftRecorder;
  readonly contexts: SetupConversations;
  readonly events: readonly UiEvent[];
  readonly release: (() => void) | undefined;
}

interface SeedOptions {
  readonly endpoint?: McpEndpoint;
  readonly withTurn?: boolean;
  readonly reader?: SetupPathReader;
}

const seed = async (options: SeedOptions = {}): Promise<Harness> => {
  const deps = createFakeDeps({
    clock: createFakeClock(T0),
    ids: createFakeIdGen(idOf<'conversation'>(90) as unknown as string),
    runTokens: createFakeRunTokens(),
    runDirs: createFakeRunDirs(),
    definitions: createFakeDefinitionStore(),
    transports: createFakeTransportResolver(),
    modelCatalog: createFakeModelCatalog({ [ACCOUNT]: [MODEL] }),
    mcpEndpoint: options.endpoint,
  });
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

  const drafts = recordingDrafts();
  const contexts = createSetupContexts(
    { clock: deps.clock, ids: deps.ids },
    { dataDir: DATA, drafts, reader: options.reader ?? { resolve: (path) => path, read: async () => ({ kind: 'missing' }) } },
  );
  let release: (() => void) | undefined;
  // A transport the account always resolves to (canStartDocketAiSetup demands one); a turn test
  // replaces it with its own scripted transport — the last registration wins.
  const idle = parkedTransport([]);
  (deps.transports as FakeTransportResolver).register(ACCOUNT, idle.transport);
  if (options.withTurn === true) {
    const parked = parkedTransport([
      { type: 'text', at: T0 + 1, delta: 'Repoja baktım.' },
      { type: 'finished', at: T0 + 2, reason: 'completed' },
    ]);
    (deps.transports as FakeTransportResolver).register(ACCOUNT, parked.transport);
    release = parked.release;
  }
  const api = createApi(
    deps,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      runner: createChatRunner(deps, { turnLedger: createChatTurnLedger(), setupContexts: contexts }),
      apply: createActionApplier(deps) as ActionApplier,
      undo: createActionUndoer(deps) as ActionUndoer,
    },
    undefined,
    undefined,
    contexts,
  );
  const events: UiEvent[] = [];
  api.subscribe((event) => events.push(event));
  return { api, deps, tokens: deps.runTokens as unknown as FakeRunTokens, definitions: deps.definitions as FakeDefinitionStore, drafts, contexts, events, release };
};

const start = async (h: Harness, repoPath = REPO): Promise<string> => {
  const result = await h.api.command(USER, { type: 'setup.ai.start', repoPath });
  if (!result.ok || result.conversation === undefined) throw new Error(`setup.ai.start failed: ${JSON.stringify(result)}`);
  return result.conversation;
};

describe('the setup conversation boundary', () => {
  it('A-357: setup.ai.start creates a global conversation and registers the context; no provider or a bad path refuses', async () => {
    const h = await seed({ endpoint: ENDPOINT });
    const conversation = await start(h);
    expect(await h.deps.conversations.get(ulidOf<'conversation'>(conversation))).toMatchObject({ scope: { kind: 'global' }, title: '' });
    // The registration is visible through the surface's own read.
    expect(await h.api.query({ type: 'setup.read.pending', conversation })).toEqual({ ask: null, secrets: 0 });

    const badPath = await h.api.command(USER, { type: 'setup.ai.start', repoPath: 'acme' });
    expect(badPath).toMatchObject({ ok: false, code: 'bad_input' });

    const noProvider = await seed({ endpoint: undefined });
    const refused = await noProvider.api.command(USER, { type: 'setup.ai.start', repoPath: REPO });
    expect(refused).toMatchObject({ ok: false, code: 'no_provider' });
    // An unwired surface answers not_found like every other one.
    const bare = await seed({ endpoint: ENDPOINT });
    const bareApi = createApi(bare.deps);
    expect(await bareApi.command(USER, { type: 'setup.ai.start', repoPath: REPO })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await bareApi.query({ type: 'setup.draft' })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('A-357: a draft resumes onto its stored conversation; a missing draft or a dead conversation answers not_found', async () => {
    const h = await seed({ endpoint: ENDPOINT, withTurn: true });
    const conversation = await start(h);
    await h.api.command(USER, { type: 'chat.send', conversation, text: 'Bu repoyu kur' });
    h.release?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const drafts = await h.api.query({ type: 'setup.draft' });
    const draft = (drafts as { draft: { id: string; repoPath: string } | null }).draft;
    expect(draft).toMatchObject({ repoPath: REPO });

    // A second api over the same draft store — the app restarted — resumes the stored conversation.
    const resumed = await h.api.command(USER, { type: 'setup.ai.start', repoPath: draft?.repoPath ?? REPO, draft: draft?.id });
    expect(resumed).toMatchObject({ ok: true, conversation });
    expect(await h.api.query({ type: 'setup.read.pending', conversation })).toEqual({ ask: null, secrets: 0 });

    expect(await h.api.command(USER, { type: 'setup.ai.start', repoPath: REPO, draft: '01ARZ3NDEKTSV4RRFFQ69G5FA0' })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('A-358: an ask through the real tool dispatch pushes one coarse event, the pending query answers it, and the answer clears it', async () => {
    const h = await seed({ endpoint: ENDPOINT, reader: { resolve: (path) => path, read: async () => ({ kind: 'file', content: 'plan' }) } });
    const conversationId = await start(h);
    const conversation = ulidOf<'conversation'>(conversationId);
    const tools = createDocketTools(h.deps, {
      applyAction: createActionApplier(h.deps),
      turnLedger: createChatTurnLedger(),
      setupContextOf: h.contexts.contextOf,
    });
    const token = h.tokens.mint({ kind: 'chat', turn: idOf<'run'>(50), conversation, role: ROLE, conversationKind: 'setup' });

    const asked = await tools.call({ token, tool: 'docket_read_path', args: { path: OUTSIDE, reason: 'read the migration plan' } });
    expect(asked.ok).toBe(true);
    const askEvents = h.events.filter((event) => event.type === 'setup.read.ask');
    expect(askEvents).toEqual([{ type: 'setup.read.ask', conversation: conversationId }]);
    expect(await h.api.query({ type: 'setup.read.pending', conversation: conversationId })).toEqual({
      ask: { path: OUTSIDE, reason: 'read the migration plan' },
      secrets: 0,
    });

    expect(await h.api.command(USER, { type: 'setup.read.answer', conversation: conversationId, path: OUTSIDE, allow: true })).toEqual({ ok: true });
    expect(await h.api.query({ type: 'setup.read.pending', conversation: conversationId })).toEqual({ ask: null, secrets: 0 });
    const retry = await tools.call({ token, tool: 'docket_read_path', args: { path: OUTSIDE, reason: 'retry' } });
    expect(retry.ok).toBe(true);

    expect(await h.api.command(USER, { type: 'setup.read.answer', conversation: conversationId, path: OUTSIDE, allow: false })).toEqual({ ok: true });
    const denied = await tools.call({ token, tool: 'docket_read_path', args: { path: '/Users/op/other.md', reason: 'x' } });
    void denied;
    expect(await h.api.command(USER, { type: 'setup.read.answer', conversation: 'not-a-ulid', path: OUTSIDE, allow: true })).toMatchObject({ ok: false, code: 'bad_input' });
    expect(await h.api.command(USER, { type: 'setup.read.answer', conversation: idOf<'conversation'>(99), path: OUTSIDE, allow: true })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('A-359: a live turn on a setup conversation mints conversationKind setup and persists the draft after the operator message', async () => {
    const h = await seed({ endpoint: ENDPOINT, withTurn: true });
    const conversationId = await start(h);
    const sent = await h.api.command(USER, { type: 'chat.send', conversation: conversationId, text: 'Bu repoyu kur' });
    expect(sent.ok).toBe(true);
    h.release?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const minted = h.tokens.minted().map((entry) => entry.binding);
    const setupToken = minted.find((binding) => binding.kind === 'chat' && binding.conversationKind === 'setup');
    expect(setupToken).toBeDefined();
    expect(h.drafts.saved).toHaveLength(1);
    expect(h.drafts.saved[0]).toMatchObject({ repoPath: REPO, mode: 'ai', answers: { conversation: conversationId } });
    const drafts = (await h.api.query({ type: 'setup.draft' })) as { draft: { id: string; mode: string } | null };
    expect(drafts.draft).toMatchObject({ mode: 'ai' });
  });

  it('A-360: proposal.decide routes a project_setup proposal to the setup executor — approval writes definitions, rejection writes nothing', async () => {
    const h = await seed({ endpoint: ENDPOINT });
    const created = await createProjectSetupProposal(
      { clock: h.deps.clock, ids: h.deps.ids, log: h.deps.log, proposals: h.deps.proposals },
      { proposal: defaultSetupAnswers('Acme', 'acme') as never, author: AGENT },
    );
    if (!created.ok) throw new Error('fixture proposal');
    const rejected = await createProjectSetupProposal(
      { clock: h.deps.clock, ids: h.deps.ids, log: h.deps.log, proposals: h.deps.proposals },
      { proposal: defaultSetupAnswers('Diger', 'diger') as never, author: AGENT },
    );
    if (!rejected.ok) throw new Error('fixture proposal');

    expect(await h.api.command(USER, { type: 'proposal.decide', id: rejected.value, decision: 'rejected' })).toMatchObject({ ok: true });
    expect(await h.definitions.readFile('projects/diger/project.yaml')).toBeUndefined();

    expect(await h.api.command(USER, { type: 'proposal.decide', id: created.value, decision: 'approved' })).toMatchObject({ ok: true });
    expect((await h.definitions.readFile('projects/acme/project.yaml'))?.content).toContain('Acme');
    expect((await h.definitions.readFile('repos/acme/repo.yaml'))?.content).toContain('acme');
    // A decided proposal never decides twice.
    expect(await h.api.command(USER, { type: 'proposal.decide', id: created.value, decision: 'approved' })).toMatchObject({ ok: false, code: 'not_pending' });
  });
});
