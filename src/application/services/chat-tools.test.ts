// chat tools — rules A-204 … A-212 (docs/v2/application.md): the token kinds' tool lists, the read
// scope, and the three read-only tools of a chat turn (docket_get, docket_search, docket_read_file),
// driven through the real dispatch (createDocketTools) over the in-memory fakes.
import { describe, expect, it, vi } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type Actor,
  type Conversation,
  type ConversationRef,
  type ConversationScope,
  type EpochMs,
  type Message,
  type Page,
  type ProjectSlug,
  type RepoSlug,
  type RoleSlug,
  type RunId,
  type Ulid,
  type WorkOrderEvent,
  type WorkOrderId,
} from '../../domain/index';

import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeRepoFileReader,
  createFakeRunTokens,
  FAKE_ROADMAP_TARGET,
  type FakeRepoFileReader,
  type FakeRunTokens,
} from '../ports/fakes/index';

import {
  createDocketTools,
  DOCKET_CHAT_TOOLS_INSTRUCTIONS,
  DOCKET_TOOL_DEFINITIONS_BY_KIND,
  DOCKET_TOOL_LIMITS,
  DOCKET_TOOLS_INSTRUCTIONS,
  DOCKET_TOOLS_INSTRUCTIONS_BY_KIND,
  type DocketToolResponse,
} from './docket-tools';

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

const ALPHA = slugOf<'project'>('alpha') as ProjectSlug;
const BETA = slugOf<'project'>('beta') as ProjectSlug;
const ALPHA_APP = slugOf<'repo'>('alpha-app') as RepoSlug;
const ALPHA_API = slugOf<'repo'>('alpha-api') as RepoSlug;
const BETA_APP = slugOf<'repo'>('beta-app') as RepoSlug;
const ROLE = slugOf<'role'>('asistan') as RoleSlug;

const WO_A1 = idOf<'work-order'>(1) as WorkOrderId; // alpha-app, number 1
const WO_A2 = idOf<'work-order'>(2) as WorkOrderId; // alpha-api, number 2
const WO_B1 = idOf<'work-order'>(3) as WorkOrderId; // beta-app, number 3
const NO_SUCH_WO = idOf<'work-order'>(99) as WorkOrderId;
const PAGE_A = idOf<'page'>(11);
const PAGE_B = idOf<'page'>(12);
const PAGE_ORPHAN = idOf<'page'>(13);
const NO_SUCH_PAGE = idOf<'page'>(98);
const CONVERSATION = idOf<'conversation'>(21);
const TURN = idOf<'run'>(31) as RunId;
const RUN_RECORD = idOf<'run'>(32) as RunId;
const RUN_RECORD_2 = idOf<'run'>(33) as RunId;
const ACCOUNT = idOf<'account'>(41);

const OPERATOR: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const COMMENT_TEXT = 'comment-text-that-must-never-reach-the-assistant';
const PLANTED = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
const redact = (text: string): string => text.split(PLANTED).join('[redacted]');
const MAX_RESPONSE_BYTES = 32 * 1024;

const FLOW = {
  id: 'main',
  name: 'Main',
  stages: [
    { id: 'plan', name: 'Plan', role: null, exit: [{ kind: 'human', id: 'plan-ok', label: 'Plan ok' }] },
    { id: 'close', name: 'Close', role: null, exit: [{ kind: 'human', id: 'closure', label: 'Closure' }] },
  ],
};
const defsFor = (repo: string): string =>
  JSON.stringify({
    roles: [],
    flows: [FLOW],
    capabilities: [],
    repo: { id: repo, name: repo, repos: [], flows: ['main'], defaultFlow: 'main', commandSets: {}, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
  });

const message = (role: 'user' | 'assistant', refs: readonly ConversationRef[], n: number): Message => ({
  id: idOf<'message'>(500 + n),
  role,
  at: 1 as EpochMs,
  text: 'hi',
  refs,
  attachments: [],
  artifacts: [],
  sources: [],
});

const conversationOf = (scope: ConversationScope, messages: readonly Message[] = []): Conversation => ({
  id: CONVERSATION,
  scope,
  title: 'chat',
  createdAt: 1 as EpochMs,
  updatedAt: 1 as EpochMs,
  pinned: false,
  messages,
});

const pageOf = (id: Page['id'], title: string, extra: Partial<Page>): Page => ({
  id,
  title,
  kind: 'html',
  createdBy: OPERATOR,
  createdAt: 100 as EpochMs,
  versions: [{ n: 1, createdAt: 200 as EpochMs, by: OPERATOR, entry: 'index.html', files: [{ path: 'index.html', bytes: 5, sha256: 'a'.repeat(64) }] }],
  approval: 'none',
  ...extra,
});

interface Harness {
  readonly deps: ReturnType<typeof createFakeDeps>;
  readonly tokens: FakeRunTokens;
  readonly reader: FakeRepoFileReader;
  readonly log: ReturnType<typeof createFakeEventLog>;
  /** Saves the conversation and mints a chat token bound to it. */
  chat(conversation: Conversation): Promise<string>;
  call(token: string, tool: string, args: unknown): Promise<DocketToolResponse>;
}

const harness = async (overrides: Partial<Parameters<typeof createFakeDeps>[0]> = {}): Promise<Harness> => {
  const clock = createFakeClock(1_000_000);
  const log = createFakeEventLog();
  const tokens = createFakeRunTokens();
  const reader = createFakeRepoFileReader({ redact });
  const definitions = createFakeDefinitionStore();
  for (const repo of [ALPHA_APP, ALPHA_API, BETA_APP]) definitions.seed({ kind: 'repo', repo }, 'defs.json', defsFor(repo));
  const deps = createFakeDeps({ clock, log, runTokens: tokens, repoFiles: reader, definitions, ...overrides });

  const alpha = { id: ALPHA, name: 'Alpha Uygulaması', mainRepo: ALPHA_APP, repos: [ALPHA_APP, ALPHA_API] };
  const beta = { id: BETA, name: 'Beta', mainRepo: BETA_APP, repos: [BETA_APP] };
  for (const project of [alpha, beta]) {
    await deps.projects.save(project);
    definitions.setProject(project);
  }
  definitions.seed(
    { kind: 'project', project: ALPHA },
    FAKE_ROADMAP_TARGET,
    JSON.stringify({
      phases: [
        {
          id: 'faz-1',
          name: 'Faz 1',
          blockedBy: [],
          tasks: [{ id: 'giris', title: 'Giriş', dependsOn: [], acceptance: [], targets: [ALPHA_APP] }],
        },
      ],
    }),
  );

  const order = async (id: WorkOrderId, project: ProjectSlug, repo: RepoSlug, title: string, at: number, extra: { task?: string } = {}): Promise<void> => {
    await deps.workOrders.create({
      id,
      project,
      repo,
      flow: slugOf<'flow'>('main'),
      title,
      createdAt: at as EpochMs,
      createdBy: OPERATOR,
      ...(extra.task === undefined ? {} : { task: slugOf<'task'>(extra.task) }),
    });
    await deps.workOrders.appendEvent(id, { type: 'created', at: at as EpochMs, by: OPERATOR, flow: slugOf<'flow'>('main') });
  };
  await order(WO_A1, ALPHA, ALPHA_APP, 'Giriş ekranı', 1_000, { task: 'giris' });
  await order(WO_A2, ALPHA, ALPHA_API, 'Ödeme servisi', 2_000);
  await order(WO_B1, BETA, BETA_APP, 'Beta gizli plan', 3_000);

  const started: WorkOrderEvent = { type: 'run_started', at: 1_100 as EpochMs, runId: RUN_RECORD, stage: slugOf<'stage'>('plan'), attempt: 1 };
  await deps.workOrders.appendEvent(WO_A1, started);
  for (const [id, startedAt] of [[RUN_RECORD, 1_100], [RUN_RECORD_2, 1_300]] as const) {
    await deps.runs.create({
      id,
      workOrderId: WO_A1,
      stage: slugOf<'stage'>('plan'),
      attempt: 1,
      role: slugOf<'role'>('worker'),
      route: { accountId: ACCOUNT },
      startedAt: startedAt as EpochMs,
      autoResumesUsed: 0,
    });
  }

  await deps.pages.save(pageOf(PAGE_A, 'Giriş taslağı', { project: ALPHA, workOrder: WO_A1 }));
  await deps.pages.save(pageOf(PAGE_B, 'Beta sayfası', { project: BETA, workOrder: WO_B1 }));
  await deps.pages.save(pageOf(PAGE_ORPHAN, 'Serbest not', {}));
  await deps.pages.saveComment({
    id: idOf<'page-comment'>(61),
    page: PAGE_A,
    version: 1,
    by: OPERATOR,
    at: 300 as EpochMs,
    text: COMMENT_TEXT,
  });

  reader.put(ALPHA_APP, 'src/main.ts', 'export const main = 1;\n');
  reader.put(ALPHA_APP, 'src/other.ts', 'export const other = 2;\n');
  reader.put(ALPHA_API, 'README.md', '# api\n');
  reader.put(BETA_APP, 'src/beta.ts', 'export const beta = 3;\n');
  reader.put(BETA_APP, 'src/beta2.ts', 'export const beta2 = 4;\n');

  const tools = createDocketTools(deps);
  return {
    deps,
    tokens,
    reader,
    log,
    chat: async (conversation) => {
      await deps.conversations.save(conversation);
      return tokens.mint({ kind: 'chat', turn: TURN, conversation: conversation.id, role: ROLE });
    },
    call: (token, tool, args) => tools.call({ token, tool, args }),
  };
};

const resultOf = (response: DocketToolResponse): Record<string, unknown> => {
  if (!response.ok) throw new Error(`expected ok, got ${response.code}`);
  return response.result as Record<string, unknown>;
};
const codeOf = (response: DocketToolResponse): string => {
  if (response.ok) throw new Error(`expected failure, got ${JSON.stringify(response.result).slice(0, 200)}`);
  return response.code;
};
const bytesOf = (response: DocketToolResponse): number => new TextEncoder().encode(JSON.stringify(response)).length;

const PROJECT_ALPHA: ConversationScope = { kind: 'project', project: ALPHA };

// --- A-204: the tool list belongs to the token's kind ----------------------------------------------

describe('A-204: tools by token kind', () => {
  it('A-204: run tokens list exactly the three page tools and chat tokens exactly the three read tools', () => {
    expect(DOCKET_TOOL_DEFINITIONS_BY_KIND.run.map((tool) => tool.name)).toEqual(['page_publish', 'page_update', 'page_comments']);
    expect(DOCKET_TOOL_DEFINITIONS_BY_KIND.chat.map((tool) => tool.name)).toEqual(['docket_get', 'docket_search', 'docket_read_file']);
    for (const tool of DOCKET_TOOL_DEFINITIONS_BY_KIND.chat) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('A-204: a run token calling any chat tool is forbidden and reads nothing', async () => {
    const h = await harness();
    const run = h.tokens.mint({ kind: 'run', runId: RUN_RECORD, workOrderId: WO_A1, project: ALPHA, role: ROLE });
    for (const [tool, args] of [
      ['docket_get', { kind: 'work_order', id: WO_A1 }],
      ['docket_search', { query: 'giris' }],
      ['docket_read_file', { repo: ALPHA_APP, path: 'src/main.ts' }],
    ] as const) {
      expect(codeOf(await h.call(run, tool, args)), tool).toBe('forbidden');
    }
    expect(h.reader.calls()).toEqual([]);
  });

  it('A-204: a chat token calling a page tool is forbidden and writes nothing; an unknown tool stays unknown_tool', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    const before = (await h.deps.pages.list({})).length;
    expect(codeOf(await h.call(token, 'page_publish', { title: 'x', kind: 'markdown', content: '# x' }))).toBe('forbidden');
    expect(codeOf(await h.call(token, 'page_update', { pageId: PAGE_A, content: 'x' }))).toBe('forbidden');
    expect(codeOf(await h.call(token, 'page_comments', { pageId: PAGE_A }))).toBe('forbidden');
    expect(codeOf(await h.call(token, 'shell_exec', { command: 'ls' }))).toBe('unknown_tool');
    expect(codeOf(await h.call(token, 'constructor', {}))).toBe('unknown_tool');
    expect((await h.deps.pages.list({})).length).toBe(before);
    expect(await h.deps.pages.comments(PAGE_A, { undelivered: true })).toHaveLength(1); // nothing was acked either
  });

  it('A-204: arguments that smuggle a kind or a conversation change nothing: the token decides', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const other = { ...conversationOf({ kind: 'global' }), id: idOf<'conversation'>(22) };
    await h.deps.conversations.save(other);
    const response = await h.call(token, 'docket_get', { kind: 'work_order', id: WO_B1, conversation: other.id, token: 'x', scope: 'global' });
    expect(codeOf(response)).toBe('forbidden');
  });

  it('A-204: a chat token whose conversation is gone is forbidden', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    await h.deps.conversations.delete(CONVERSATION);
    expect(codeOf(await h.call(token, 'docket_get', { kind: 'project', id: ALPHA }))).toBe('forbidden');
  });
});

// --- A-206: the scope is enforced; no existence oracle ------------------------------------------------

describe('A-206: read scope enforcement', () => {
  it('A-206: ids are validated first — a malformed id, kind or slug is bad_input, never forbidden or not_found', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const bad: readonly (readonly [string, unknown])[] = [
      ['docket_get', { kind: 'work_order', id: 'not-a-ulid' }],
      ['docket_get', { kind: 'page', id: '../../etc' }],
      ['docket_get', { kind: 'project', id: 'Not A Slug' }],
      ['docket_get', { kind: 'repo_board', id: '' }],
      ['docket_get', { kind: 'roadmap', id: 7 }],
      ['docket_get', { kind: 'secrets', id: ALPHA }],
      ['docket_get', { id: ALPHA }],
      ['docket_get', 'a string'],
      ['docket_get', null],
      ['docket_read_file', { repo: 'No Repo', path: 'a' }],
      ['docket_read_file', { repo: ALPHA_APP }],
    ];
    for (const [tool, args] of bad) expect(codeOf(await h.call(token, tool, args)), JSON.stringify(args)).toBe('bad_input');
  });

  it('A-206: from a project conversation, another project\'s ids are forbidden — and exactly as forbidden as ids that do not exist', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const outOfScope: readonly unknown[] = [
      { kind: 'work_order', id: WO_B1 },
      { kind: 'project', id: BETA },
      { kind: 'repo_board', id: BETA_APP },
      { kind: 'roadmap', id: BETA },
      { kind: 'page', id: PAGE_B },
      { kind: 'page', id: PAGE_ORPHAN },
    ];
    const nonexistent: readonly unknown[] = [
      { kind: 'work_order', id: NO_SUCH_WO },
      { kind: 'project', id: slugOf<'project'>('no-such-project') },
      { kind: 'repo_board', id: slugOf<'repo'>('no-such-repo') },
      { kind: 'roadmap', id: slugOf<'project'>('no-such-project') },
      { kind: 'page', id: NO_SUCH_PAGE },
    ];
    for (const args of [...outOfScope, ...nonexistent]) {
      expect(await h.call(token, 'docket_get', args), JSON.stringify(args)).toEqual({ ok: false, code: 'forbidden' });
    }
  });

  it('A-206: a work order of the same project but a different repo is in scope; ids in other projects\' repos are not', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    expect(resultOf(await h.call(token, 'docket_get', { kind: 'work_order', id: WO_A2 }))['code']).toBe('İE-0002');
    expect(codeOf(await h.call(token, 'docket_read_file', { repo: BETA_APP, path: 'src/beta.ts' }))).toBe('forbidden');
    expect(resultOf(await h.call(token, 'docket_read_file', { repo: ALPHA_API, path: 'README.md' }))['content']).toBe('# api');
  });

  it('A-206: a work-order conversation reads its work order and, for context, its project and repo — not its siblings', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'workOrder', workOrder: WO_A1 }));
    expect(resultOf(await h.call(token, 'docket_get', { kind: 'work_order', id: WO_A1 }))['code']).toBe('İE-0001');
    expect(resultOf(await h.call(token, 'docket_get', { kind: 'project', id: ALPHA }))['name']).toBe('Alpha Uygulaması');
    expect(resultOf(await h.call(token, 'docket_get', { kind: 'repo_board', id: ALPHA_APP }))).toHaveProperty('stages');
    expect(resultOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'src/main.ts' }))).toHaveProperty('content');
    expect(codeOf(await h.call(token, 'docket_get', { kind: 'work_order', id: WO_A2 }))).toBe('forbidden');
    expect(codeOf(await h.call(token, 'docket_get', { kind: 'repo_board', id: ALPHA_API }))).toBe('forbidden');
    expect(codeOf(await h.call(token, 'docket_read_file', { repo: ALPHA_API, path: 'README.md' }))).toBe('forbidden');
  });

  it('A-206: a reference widens the scope by exactly what it names and no further', async () => {
    const h = await harness();
    const widen = (ref: ConversationRef) => h.chat(conversationOf(PROJECT_ALPHA, [message('user', [ref], 1)]));

    const workOrder = await widen({ kind: 'workOrder', id: WO_B1 });
    expect(resultOf(await h.call(workOrder, 'docket_get', { kind: 'work_order', id: WO_B1 }))['code']).toBe('İE-0003');
    // Its linked pages are readable (the work order's own view names them); nothing around it is.
    expect(resultOf(await h.call(workOrder, 'docket_get', { kind: 'page', id: PAGE_B }))['title']).toBe('Beta sayfası');
    expect(codeOf(await h.call(workOrder, 'docket_get', { kind: 'page', id: PAGE_ORPHAN }))).toBe('forbidden');
    expect(codeOf(await h.call(workOrder, 'docket_get', { kind: 'project', id: BETA }))).toBe('forbidden');
    expect(codeOf(await h.call(workOrder, 'docket_read_file', { repo: BETA_APP, path: 'src/beta.ts' }))).toBe('forbidden');

    const page = await widen({ kind: 'page', id: PAGE_B });
    expect(resultOf(await h.call(page, 'docket_get', { kind: 'page', id: PAGE_B }))['title']).toBe('Beta sayfası');
    expect(codeOf(await h.call(page, 'docket_get', { kind: 'work_order', id: WO_B1 }))).toBe('forbidden');
    expect(codeOf(await h.call(page, 'docket_get', { kind: 'page', id: PAGE_ORPHAN }))).toBe('forbidden');

    const file = await widen({ kind: 'file', id: 'src/beta.ts', repo: BETA_APP });
    expect(resultOf(await h.call(file, 'docket_read_file', { repo: BETA_APP, path: 'src/beta.ts' }))['content']).toBe('export const beta = 3;');
    expect(codeOf(await h.call(file, 'docket_read_file', { repo: BETA_APP, path: 'src/beta2.ts' }))).toBe('forbidden');
    expect(codeOf(await h.call(file, 'docket_get', { kind: 'repo_board', id: BETA_APP }))).toBe('forbidden');

    const repo = await widen({ kind: 'repo', id: BETA_APP });
    expect(resultOf(await h.call(repo, 'docket_read_file', { repo: BETA_APP, path: 'src/beta2.ts' }))).toHaveProperty('content');
    expect(resultOf(await h.call(repo, 'docket_get', { kind: 'repo_board', id: BETA_APP }))).toHaveProperty('stages');
    expect(codeOf(await h.call(repo, 'docket_get', { kind: 'work_order', id: WO_B1 }))).toBe('forbidden');

    const project = await widen({ kind: 'project', id: BETA });
    expect(resultOf(await h.call(project, 'docket_get', { kind: 'project', id: BETA }))['name']).toBe('Beta');
    expect(resultOf(await h.call(project, 'docket_get', { kind: 'work_order', id: WO_B1 }))['code']).toBe('İE-0003');
    expect(resultOf(await h.call(project, 'docket_get', { kind: 'page', id: PAGE_B }))['title']).toBe('Beta sayfası');
    expect(resultOf(await h.call(project, 'docket_read_file', { repo: BETA_APP, path: 'src/beta.ts' }))).toHaveProperty('content');
  });

  it('A-206: a reference in an assistant message never widens the scope', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA, [message('assistant', [{ kind: 'project', id: BETA }, { kind: 'workOrder', id: WO_B1 }], 1)]));
    expect(codeOf(await h.call(token, 'docket_get', { kind: 'work_order', id: WO_B1 }))).toBe('forbidden');
    expect(codeOf(await h.call(token, 'docket_get', { kind: 'project', id: BETA }))).toBe('forbidden');
  });

  it('A-206: a global conversation reads every project, while ids that do not exist stay forbidden', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    expect(resultOf(await h.call(token, 'docket_get', { kind: 'work_order', id: WO_B1 }))['code']).toBe('İE-0003');
    expect(resultOf(await h.call(token, 'docket_get', { kind: 'page', id: PAGE_ORPHAN }))['title']).toBe('Serbest not');
    expect(resultOf(await h.call(token, 'docket_read_file', { repo: BETA_APP, path: 'src/beta.ts' }))).toHaveProperty('content');
    expect(await h.call(token, 'docket_get', { kind: 'work_order', id: NO_SUCH_WO })).toEqual({ ok: false, code: 'forbidden' });
    expect(await h.call(token, 'docket_get', { kind: 'project', id: slugOf<'project'>('ghost') })).toEqual({ ok: false, code: 'forbidden' });
    expect(codeOf(await h.call(token, 'docket_read_file', { repo: slugOf<'repo'>('ghost'), path: 'a.txt' }))).toBe('forbidden');
  });

  it('A-206: the scope is read at every call: a reference added later widens later calls, and nothing earlier', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    expect(codeOf(await h.call(token, 'docket_get', { kind: 'work_order', id: WO_B1 }))).toBe('forbidden');
    await h.deps.conversations.save(conversationOf(PROJECT_ALPHA, [message('user', [{ kind: 'workOrder', id: WO_B1 }], 1)]));
    expect(resultOf(await h.call(token, 'docket_get', { kind: 'work_order', id: WO_B1 }))).toHaveProperty('code');
  });
});

// --- A-207: docket_get ------------------------------------------------------------------------------

describe('A-207: docket_get', () => {
  it('A-207: a work order answers its code, title, project, repo, derived state, gates, stages, linked pages and usage', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const view = resultOf(await h.call(token, 'docket_get', { kind: 'work_order', id: WO_A1 }));
    expect(view).toMatchObject({
      kind: 'data',
      source: expect.any(String),
      code: 'İE-0001',
      title: 'Giriş ekranı',
      project: ALPHA,
      repo: ALPHA_APP,
      stage: 'plan',
      gates: [{ id: 'plan-ok', state: expect.any(String) }],
      flowStages: [
        { id: 'plan', name: 'Plan' },
        { id: 'close', name: 'Close' },
      ],
      linkedPages: [{ id: PAGE_A, title: 'Giriş taslağı' }],
      usage: { runs: 2, lastRunAt: 1_300 },
    });
    expect(typeof view['status']).toBe('string');
  });

  it('A-207: a project answers its name, repos, main repo and counts of open and attention-needing work orders', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const view = resultOf(await h.call(token, 'docket_get', { kind: 'project', id: ALPHA }));
    expect(view).toMatchObject({
      kind: 'data',
      name: 'Alpha Uygulaması',
      repos: [ALPHA_APP, ALPHA_API],
      mainRepo: ALPHA_APP,
      openWorkOrders: 2,
    });
    expect(typeof view['attention']).toBe('number');
  });

  it('A-207: a repo board groups its work orders by stage with code, title and status only', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const board = resultOf(await h.call(token, 'docket_get', { kind: 'repo_board', id: ALPHA_APP }));
    expect(board['kind']).toBe('data');
    expect(board['stages']).toEqual([{ stage: 'plan', items: [{ code: 'İE-0001', title: 'Giriş ekranı', status: expect.any(String) }] }]);
  });

  it('A-207: a repo board lists at most 200 items and says it cut', async () => {
    const h = await harness();
    for (let i = 0; i < 205; i += 1) {
      const id = idOf<'work-order'>(1000 + i) as WorkOrderId;
      await h.deps.workOrders.create({
        id,
        project: ALPHA,
        repo: ALPHA_API,
        flow: slugOf<'flow'>('main'),
        title: `Iş ${i}`,
        createdAt: (5_000 + i) as EpochMs,
        createdBy: OPERATOR,
      });
      await h.deps.workOrders.appendEvent(id, { type: 'created', at: (5_000 + i) as EpochMs, by: OPERATOR, flow: slugOf<'flow'>('main') });
    }
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const response = await h.call(token, 'docket_get', { kind: 'repo_board', id: ALPHA_API });
    const board = resultOf(response);
    const items = (board['stages'] as readonly { readonly items: readonly unknown[] }[]).flatMap((stage) => stage.items);
    expect(items.length).toBeLessThanOrEqual(200);
    expect(items.length).toBeGreaterThan(0);
    expect(board['truncated']).toBe(true);
    expect(bytesOf(response)).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
  });

  it('A-207: a roadmap answers phases and tasks with derived statuses and the codes of their linked work orders', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const roadmap = resultOf(await h.call(token, 'docket_get', { kind: 'roadmap', id: ALPHA }));
    expect(roadmap).toMatchObject({
      kind: 'data',
      phases: [
        {
          id: 'faz-1',
          name: 'Faz 1',
          status: expect.any(String),
          tasks: [{ id: 'giris', title: 'Giriş', status: expect.any(String), workOrders: ['İE-0001'] }],
        },
      ],
    });
  });

  it('A-207: a project without a roadmap is not_found for a project the conversation may read', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    expect(codeOf(await h.call(token, 'docket_get', { kind: 'roadmap', id: BETA }))).toBe('not_found');
  });

  it('A-207: a page answers metadata only — never file bytes, file names or comment text', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const response = await h.call(token, 'docket_get', { kind: 'page', id: PAGE_A });
    expect(resultOf(response)).toEqual({
      kind: 'data',
      source: expect.any(String),
      title: 'Giriş taslağı',
      pageKind: 'html',
      latestVersion: 1,
      approval: 'none',
      projectName: 'Alpha Uygulaması',
      workOrderCode: 'İE-0001',
    });
    const text = JSON.stringify(response);
    expect(text).not.toContain(COMMENT_TEXT);
    expect(text).not.toContain('index.html');
    expect(text).not.toContain('sha256');
  });
});

// --- A-208: docket_search ------------------------------------------------------------------------------

describe('A-208: docket_search', () => {
  const search = async (h: Harness, token: string, args: unknown) => resultOf(await h.call(token, 'docket_search', args))['results'] as readonly Record<string, unknown>[];

  it('A-208: finds a work order by its code, case-insensitively', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    expect(await search(h, token, { query: 'ie-0001', kinds: ['work_order'] })).toEqual([{ kind: 'work_order', id: WO_A1, label: expect.stringContaining('Giriş ekranı'), project: ALPHA }]);
    expect((await search(h, token, { query: 'İE-0002', kinds: ['work_order'] })).map((item) => item['id'])).toEqual([WO_A2]);
    // The code is part of a page's text too, so the page of that work order is found by it.
    expect((await search(h, token, { query: 'ie-0001', kinds: ['page'] })).map((item) => item['id'])).toEqual([PAGE_A]);
  });

  it('A-208: matches Turkish text without the diacritics ("giris ekrani" finds "Giriş ekranı") and finds pages by their kind name', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const found = await search(h, token, { query: 'giris ekrani' });
    expect(found.map((item) => item['id'])).toContain(WO_A1);
    expect((await search(h, token, { query: 'taslak', kinds: ['page'] })).map((item) => item['id'])).toEqual([PAGE_A]);
  });

  it('A-208: searches only inside the read scope — other projects\' work orders, pages, repos and the project itself never appear', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    for (const query of ['beta', 'gizli', 'ie-0003', 'serbest', 'sayfasi']) {
      expect(await search(h, token, { query }), query).toEqual([]);
    }
    const everything = await search(h, token, { query: '' + 'a' });
    expect(everything.map((item) => item['id'])).not.toContain(WO_B1);
    expect(everything.map((item) => item['id'])).not.toContain(BETA);
    expect(everything.map((item) => item['id'])).not.toContain(PAGE_B);
  });

  it('A-208: a reference makes exactly the named item searchable', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA, [message('user', [{ kind: 'page', id: PAGE_B }], 1)]));
    expect((await search(h, token, { query: 'beta' })).map((item) => item['id'])).toEqual([PAGE_B]);
  });

  it('A-208: a global conversation searches every project; kinds narrows the answer; projects and repos are found by name', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    expect((await search(h, token, { query: 'beta', kinds: ['project'] })).map((item) => item['id'])).toEqual([BETA]);
    expect((await search(h, token, { query: 'alpha-app', kinds: ['repo'] })).map((item) => ({ kind: item['kind'], id: item['id'], project: item['project'] }))).toEqual([
      { kind: 'repo', id: ALPHA_APP, project: ALPHA },
    ]);
    expect((await search(h, token, { query: 'beta' })).map((item) => item['kind']).sort()).toEqual(['page', 'project', 'repo', 'work_order']);
  });

  it('A-208: limit defaults to 20 and is at most 50; a bad query, kinds or limit is bad_input', async () => {
    const h = await harness();
    for (let i = 0; i < 60; i += 1) {
      const id = idOf<'work-order'>(2000 + i) as WorkOrderId;
      await h.deps.workOrders.create({
        id,
        project: ALPHA,
        repo: ALPHA_API,
        flow: slugOf<'flow'>('main'),
        title: `Toplu iş ${i}`,
        createdAt: (9_000 + i) as EpochMs,
        createdBy: OPERATOR,
      });
    }
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    expect(await search(h, token, { query: 'toplu' })).toHaveLength(20);
    expect(await search(h, token, { query: 'toplu', limit: 5 })).toHaveLength(5);
    expect(await search(h, token, { query: 'toplu', limit: 50 })).toHaveLength(50);
    for (const args of [
      { query: 'toplu', limit: 51 },
      { query: 'toplu', limit: 0 },
      { query: 'toplu', limit: 1.5 },
      { query: 'toplu', limit: '5' },
      { query: '' },
      { query: '   ' },
      { query: 7 },
      { query: 'x'.repeat(201) },
      { query: 'x', kinds: ['secret'] },
      { query: 'x', kinds: 'page' },
      {},
    ]) {
      expect(codeOf(await h.call(token, 'docket_search', args)), JSON.stringify(args)).toBe('bad_input');
    }
  });

  it('A-208: results carry the data wrapper and never comment text', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const response = await h.call(token, 'docket_search', { query: 'comment' });
    expect(resultOf(response)).toMatchObject({ kind: 'data', source: expect.any(String), results: [] });
    expect(JSON.stringify(response)).not.toContain(COMMENT_TEXT);
  });
});

// --- A-209: docket_read_file — which paths ---------------------------------------------------------------

describe('A-209: docket_read_file paths and names', () => {
  it('A-209: a path that is not a plain relative path is bad_input and never reaches the reader', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const bad = [
      '../secrets',
      'src/../../x',
      '/etc/passwd',
      'C:/Windows/system.ini',
      'src\\main.ts',
      'src/%2e%2e/x',
      'src/main.ts\0.txt',
      'src/\u202Emain.ts',
      'src//main.ts',
      './src/main.ts',
      'src/main.ts/',
      '',
      '.',
      'a'.repeat(300),
    ];
    for (const path of bad) expect(codeOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path })), JSON.stringify(path)).toBe('bad_input');
    expect(codeOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 5 }))).toBe('bad_input');
    expect(h.reader.calls()).toEqual([]);
  });

  it('A-209: secret-bearing names are forbidden before any read, in or out of scope, in any case', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    const denied = [
      '.git/config',
      'sub/.git/HEAD',
      '.GIT/config',
      '.env',
      '.env.local',
      'app/.env.production',
      'cert.pem',
      'server.KEY',
      'bundle.p12',
      'id_rsa',
      'id_rsa.pub',
      '.ssh/id_ed25519',
      'release.keystore',
      'credentials.json',
      'config/Credentials.yaml',
      '.npmrc',
      'home/.netrc',
    ];
    for (const path of denied) {
      h.reader.put(ALPHA_APP, path, 'secret');
      expect(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path }), path).toEqual({ ok: false, code: 'forbidden' });
    }
    expect(h.reader.calls()).toEqual([]);
  });

  it('A-209: names that merely look similar are readable (".environment.md", "key.md", "credits.txt")', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    for (const path of ['docs/environment.md', 'docs/key.md', 'docs/credits.txt', 'src/gitlab.ts']) {
      h.reader.put(ALPHA_APP, path, 'ok');
      expect(resultOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path }))['content'], path).toBe('ok');
    }
  });

  it('A-209: a file reference widens the scope to that exact path only; a denied name stays denied even when referenced', async () => {
    const h = await harness();
    h.reader.put(BETA_APP, '.env', 'KEY=1');
    const token = await h.chat(
      conversationOf(PROJECT_ALPHA, [
        message('user', [{ kind: 'file', id: 'src/beta.ts', repo: BETA_APP }, { kind: 'file', id: '.env', repo: BETA_APP }], 1),
      ]),
    );
    expect(resultOf(await h.call(token, 'docket_read_file', { repo: BETA_APP, path: 'src/beta.ts' }))).toHaveProperty('content');
    expect(codeOf(await h.call(token, 'docket_read_file', { repo: BETA_APP, path: 'src/beta2.ts' }))).toBe('forbidden');
    expect(codeOf(await h.call(token, 'docket_read_file', { repo: BETA_APP, path: '.env' }))).toBe('forbidden');
    expect(codeOf(await h.call(token, 'docket_read_file', { repo: BETA_APP, path: 'SRC/beta.ts' }))).toBe('forbidden');
  });

  it('A-209: a repo that is not registered is forbidden, like one out of scope', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    expect(await h.call(token, 'docket_read_file', { repo: slugOf<'repo'>('ghost'), path: 'a.txt' })).toEqual({ ok: false, code: 'forbidden' });
  });
});

// --- A-210: docket_read_file — limits, paging, redaction ------------------------------------------------

describe('A-210: docket_read_file output', () => {
  const lines = (count: number, width = 10): string => Array.from({ length: count }, (_, i) => `${String(i + 1).padStart(width, '0')}`).join('\n');

  it('A-210: a short file comes back whole, wrapped as data, with truncated false', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    expect(resultOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'src/main.ts' }))).toMatchObject({
      kind: 'data',
      source: expect.any(String),
      repo: ALPHA_APP,
      path: 'src/main.ts',
      from: 1,
      content: 'export const main = 1;',
      truncated: false,
    });
  });

  it('A-210: at most 400 lines per call, with next_from to continue and from to page; the pages join without a gap', async () => {
    const h = await harness();
    h.reader.put(ALPHA_APP, 'big.txt', lines(1000, 3));
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const first = resultOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'big.txt' }));
    expect((first['content'] as string).split('\n')).toHaveLength(400);
    expect(first).toMatchObject({ truncated: true, next_from: 401, from: 1 });
    const second = resultOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'big.txt', from: first['next_from'] }));
    expect((second['content'] as string).split('\n')[0]).toBe('401');
    expect(second).toMatchObject({ from: 401, truncated: true, next_from: 801 });
    const last = resultOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'big.txt', from: 801 }));
    expect((last['content'] as string).split('\n')).toHaveLength(200);
    expect(last['truncated']).toBe(false);
    expect(last).not.toHaveProperty('next_from');
  });

  it('A-210: a bad `from` is bad_input', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    for (const from of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 2]) {
      expect(codeOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'src/main.ts', from })), String(from)).toBe('bad_input');
    }
  });

  it('A-210: every response is at most 32 KiB serialised, and a cut response still pages on without a gap', async () => {
    const h = await harness();
    const wide = Array.from({ length: 400 }, (_, i) => `${String(i + 1).padStart(3, '0')} ${'"\\é'.repeat(60)}`).join('\n');
    h.reader.put(ALPHA_APP, 'wide.txt', wide);
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const response = await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'wide.txt' });
    expect(bytesOf(response)).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    const first = resultOf(response);
    expect(first['truncated']).toBe(true);
    const shown = (first['content'] as string).split('\n').length;
    expect(first['next_from']).toBe(shown + 1);
    const second = resultOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'wide.txt', from: first['next_from'] }));
    expect((second['content'] as string).startsWith(String(shown + 1).padStart(3, '0'))).toBe(true);
  });

  it('A-210: a planted secret in the file is redacted in the response', async () => {
    const h = await harness();
    h.reader.put(ALPHA_APP, 'src/config.ts', `export const token = '${PLANTED}';\nconst ok = 1;`);
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const response = await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'src/config.ts' });
    expect(JSON.stringify(response)).not.toContain(PLANTED);
    expect(resultOf(response)['content']).toContain('[redacted]');
    expect(resultOf(response)['content']).toContain('const ok = 1;');
  });

  it('A-210: binary is not_text, oversize is too_large, a missing file is not_found (inside a repo the conversation may read)', async () => {
    const h = await harness();
    h.reader.put(ALPHA_APP, 'logo.png', new Uint8Array([137, 80, 78, 71, 0, 1, 2]));
    h.reader.put(ALPHA_APP, 'huge.txt', 'x'.repeat(300 * 1024));
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    expect(codeOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'logo.png' }))).toBe('not_text');
    expect(codeOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'huge.txt' }))).toBe('too_large');
    expect(codeOf(await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'src/missing.ts' }))).toBe('not_found');
  });

  it('A-210: a reader that says the path escapes the repo is forbidden, not a hint', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const escaping = { read: async () => ({ ok: false as const, error: 'outside_repo' as const }) };
    const tools = createDocketTools({ ...h.deps, repoFiles: escaping });
    expect(await tools.call({ token, tool: 'docket_read_file', args: { repo: ALPHA_APP, path: 'link-to-outside/passwd' } })).toEqual({
      ok: false,
      code: 'forbidden',
    });
  });
});

// --- A-211: data wrapper, rate limit, revocation ----------------------------------------------------------

describe('A-211: wrapper, rate limit and revocation', () => {
  it('A-211: every successful result is a { kind: "data", source } wrapper', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    const calls: readonly (readonly [string, unknown])[] = [
      ['docket_get', { kind: 'work_order', id: WO_A1 }],
      ['docket_get', { kind: 'project', id: ALPHA }],
      ['docket_get', { kind: 'repo_board', id: ALPHA_APP }],
      ['docket_get', { kind: 'roadmap', id: ALPHA }],
      ['docket_get', { kind: 'page', id: PAGE_A }],
      ['docket_search', { query: 'a' }],
      ['docket_read_file', { repo: ALPHA_APP, path: 'src/main.ts' }],
    ];
    for (const [tool, args] of calls) {
      const result = resultOf(await h.call(token, tool, args));
      expect(result['kind'], tool).toBe('data');
      expect(typeof result['source'], tool).toBe('string');
      expect(result['source'], tool).not.toBe('');
    }
  });

  it('A-211: the per-token rate limit applies to chat tokens, and a new token has its own budget', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    for (let i = 0; i < DOCKET_TOOL_LIMITS.callsPerMinute; i += 1) {
      expect(resultOf(await h.call(token, 'docket_get', { kind: 'project', id: ALPHA }))).toHaveProperty('name');
    }
    expect(codeOf(await h.call(token, 'docket_get', { kind: 'project', id: ALPHA }))).toBe('rate_limited');
    const another = h.tokens.mint({ kind: 'chat', turn: idOf<'run'>(34) as RunId, conversation: CONVERSATION, role: ROLE });
    expect(resultOf(await h.call(another, 'docket_get', { kind: 'project', id: ALPHA }))).toHaveProperty('name');
  });

  it('A-211: a revoked chat token is unauthorized (revoke by the turn id)', async () => {
    const h = await harness();
    const token = await h.chat(conversationOf({ kind: 'global' }));
    h.tokens.revoke(TURN);
    expect(await h.call(token, 'docket_get', { kind: 'project', id: ALPHA })).toEqual({ ok: false, code: 'unauthorized' });
  });
});

// --- A-212: codes only, nothing in the audit trail, the instructions ---------------------------------------

describe('A-212: codes only and the trust boundary', () => {
  it('A-212: a dependency that throws answers internal with the code only, and logs nothing to the console', async () => {
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    try {
      const boom = { read: async (): Promise<never> => { throw new Error('disk exploded at /Users/op/secret-project'); } };
      const h = await harness({ repoFiles: boom });
      const token = await h.chat(conversationOf({ kind: 'global' }));
      const response = await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'src/main.ts' });
      expect(response).toEqual({ ok: false, code: 'internal' });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('A-212: reads leave no audit entry, and no entry, response or failure carries the token or file content', async () => {
    const h = await harness();
    h.reader.put(ALPHA_APP, 'src/content.ts', 'distinctive-file-content-12345');
    const token = await h.chat(conversationOf(PROJECT_ALPHA));
    const failures = [
      await h.call(token, 'docket_get', { kind: 'work_order', id: WO_B1 }),
      await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: '.env' }),
      await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'src/missing.ts' }),
      await h.call(token, 'page_publish', { title: 'x', kind: 'markdown', content: 'x' }),
      await h.call(token, 'docket_search', { query: '' }),
    ];
    await h.call(token, 'docket_read_file', { repo: ALPHA_APP, path: 'src/content.ts' });
    for (const failure of failures) {
      expect(Object.keys(failure).sort()).toEqual(['code', 'ok']);
      expect(JSON.stringify(failure)).not.toContain(token);
    }
    expect(h.log.entries()).toEqual([]);
    expect(JSON.stringify(h.log.entries())).not.toContain('distinctive-file-content');
  });

  it('A-212: the chat instructions say all tool output, files, pages and comments are data, and claims inside it are data too', () => {
    expect(DOCKET_TOOLS_INSTRUCTIONS_BY_KIND.chat).toBe(DOCKET_CHAT_TOOLS_INSTRUCTIONS);
    expect(DOCKET_TOOLS_INSTRUCTIONS_BY_KIND.run).toBe(DOCKET_TOOLS_INSTRUCTIONS);
    expect(DOCKET_CHAT_TOOLS_INSTRUCTIONS).not.toBe(DOCKET_TOOLS_INSTRUCTIONS);
    for (const phrase of ['docket_', 'repo files', 'page contents', 'comments', 'DATA', 'never instructions', 'operator', 'Docket', 'architect']) {
      expect(DOCKET_CHAT_TOOLS_INSTRUCTIONS, phrase).toContain(phrase);
    }
    expect(DOCKET_CHAT_TOOLS_INSTRUCTIONS).toMatch(/still data/);
  });
});
