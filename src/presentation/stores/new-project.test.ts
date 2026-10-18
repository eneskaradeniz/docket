// new-project.test.ts — Phase 7 project setup (U-272 … U-287) and retained attach/create rules.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { EN } from '../labels/en';
import { TR } from '../labels/tr';
import { PermissionPrompt } from '../components/permission-prompt';
import { SetupProposalDiff } from '../components/setup-proposal-diff';
import { NewProjectPanel } from '../screens/new-project';

const RAW = import.meta.glob(
  [
    '../components/permission-prompt.tsx',
    '../components/setup-proposal-diff.tsx',
    '../components/setup-summary.tsx',
    '../components/setup-add-repo-chooser.tsx',
    '../components/setup-copy-from.tsx',
    '../components/setup-import-repos.tsx',
    '../screens/new-project.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;
const raw = (suffix: string): string => Object.entries(RAW).find(([path]) => path.endsWith(suffix))?.[1] ?? '';
import {
  buildSetupProposal,
  canShowPermission,
  connectedProviderOf,
  createNewProjectStore,
  disclosureExpanded,
  failureOf,
  folderName,
  hasDraft,
  mcpRunningOf,
  permissionAfterDeny,
  readRequestKind,
  resetSessionDisclosure,
  START_FORM,
  testCommandOf,
  toggleDisclosure,
  type NewProjectStore,
  type SetupChange,
} from './new-project';

const actor: Actor = { kind: 'user', id: 'user-1' };

interface Fake extends Pick<Api, 'query' | 'command'> {
  readonly commands: Command[];
  readonly queries: Query[];
  accounts: unknown;
  reply(type: Command['type'], result: CommandResult): void;
}

const oneRepoTree = [
  {
    project: 'atolye',
    name: 'Atölye',
    firstRepo: 'atolye',
    repos: [{ repo: 'atolye', name: 'atolye', first: true, active: 0, status: 'idle' }],
    active: 0,
    running: 0,
    waiting: 0,
    status: 'idle',
  },
];

const fakeApi = (tree: unknown = oneRepoTree, accounts: unknown = { accounts: [{ id: 'a' }], bindings: [] }): Fake => {
  const commands: Command[] = [];
  const queries: Query[] = [];
  const replies = new Map<string, CommandResult>();
  return {
    commands,
    queries,
    accounts,
    reply: (type, result) => replies.set(type, result),
    query: (query) => {
      queries.push(query);
      if (query.type === 'settings.accounts') return Promise.resolve(accounts);
      if (query.type === 'mcp.status') return Promise.resolve({ state: 'running' });
      return Promise.resolve(tree);
    },
    command: (_actor, command) => {
      commands.push(command);
      return Promise.resolve(replies.get(command.type) ?? { ok: true, id: 'atolye' });
    },
  };
};

const setup = (tree?: unknown, accounts?: unknown): { readonly api: Fake; readonly store: NewProjectStore } => {
  const api = fakeApi(tree, accounts);
  const store = createNewProjectStore({ api, actor, reloadTree: async () => undefined });
  return { api, store };
};

const permissionHtml = (locale: 'tr' | 'en' = 'tr'): string =>
  renderToStaticMarkup(
    createElement(PermissionPrompt, {
      open: true,
      prompt: { path: '/tmp/readme.md', reason: 'Outside default scope' },
      locale,
      onDeny: () => undefined,
      onAllow: () => undefined,
      returnFocusRef: { current: null },
    }),
  );

describe('setup permission prompt', () => {
  it('U-272: permission prompt renders requested path in monospace and tool reason line', () => {
    const html = permissionHtml();
    expect(html).toContain('data-setup-permission-path=""');
    expect(html).toContain('/tmp/readme.md');
    expect(html).toContain('font-mono');
    expect(html).toContain('Outside default scope');
    expect(html).toContain(TR['setup.permission.title']);
  });

  it('U-273: permission prompt renders Reddet as default focused Esc action and Bu oturum için izin ver', () => {
    const html = permissionHtml();
    expect(html).toContain(TR['setup.permission.deny']);
    expect(html).toContain(TR['setup.permission.allow']);
    expect(html).toContain('data-setup-permission-deny=""');
    expect(html).toContain('data-setup-permission-allow=""');
  });

  it('U-274: permission prompt offers no permanent grant option', () => {
    const html = permissionHtml('en');
    expect(html).not.toMatch(/always|permanent|Kalıcı|Her zaman/i);
    expect(html).toContain(EN['setup.permission.allow']);
  });

  it('U-275: exactly one permission prompt presented at a time', () => {
    const store = setup().store;
    store.requestAiRead('/a', 'one');
    expect(store.state().permission?.path).toBe('/a');
    store.requestAiRead('/b', 'two');
    expect(store.state().permission?.path).toBe('/a');
    expect(canShowPermission(store.state().permission, new Set(), '/c')).toBe(false);
  });

  it('U-276: denied path remembered for conversation and never reprompted', () => {
    const store = setup().store;
    store.requestAiRead('/denied', 'ask');
    store.denyPermission();
    store.requestAiRead('/denied', 'ask again');
    expect(store.state().permission).toBeNull();
    const denied = permissionAfterDeny(new Set(), '/denied');
    expect(denied.has('/denied')).toBe(true);
    expect(canShowPermission(null, denied, '/denied')).toBe(false);
  });

  it('U-277: secret-shaped path displays thread notice Anahtar benzeri dosya okunmaz without prompt', async () => {
    expect(readRequestKind('/work/.env')).toBe('secret');
    const { store } = setup();
    await store.refreshProvider();
    store.pickPath('docket_ai');
    store.requestAiRead('/work/.env', 'should not show');
    expect(store.state().permission).toBeNull();
    expect(store.state().secretNotices).toBe(1);
    const panel = renderToStaticMarkup(
      createElement(NewProjectPanel, {
        open: true,
        origin: 'pointer',
        store,
        locale: 'tr',
        onClose: () => undefined,
        onDone: () => undefined,
      }),
    );
    expect(panel).toContain(TR['setup.permission.secretNotice']);
    expect(panel).not.toContain('data-setup-permission=""');
  });

  it('U-278: permission prompt traps focus, Esc triggers Reddet, restores opener focus', () => {
    const src = raw('permission-prompt.tsx');
    expect(src).toContain('aria-modal="true"');
    expect(src).toContain("event.key === 'Escape'");
    expect(src).toContain('onDeny');
    expect(src).toContain('returnFocusRef');
    expect(src).toContain("event.key !== 'Tab'");
  });

  it('U-279: all copy sourced from label bundles with no inline strings', () => {
    const permissionSrc = raw('permission-prompt.tsx');
    const diffSrc = raw('setup-proposal-diff.tsx');
    const screenSrc = raw('new-project.tsx');
    for (const src of [permissionSrc, diffSrc, screenSrc]) {
      expect(src).toContain("t(locale,");
      expect(src).not.toMatch(/>\s*[A-Za-zÇĞİÖŞÜçğıöşü]{4,}\s*</);
    }
  });
});

describe('project setup entries and proposal diff', () => {
  it('U-286: renders Docket AI, Quick, Detailed entries; no-provider disables AI; all produce SetupProposal diff', async () => {
    const noProvider = setup(oneRepoTree, { accounts: [], bindings: [] });
    await noProvider.store.refreshProvider();
    expect(noProvider.store.state().connectedProvider).toBe(false);
    const closed = renderToStaticMarkup(
      createElement(NewProjectPanel, {
        open: true,
        origin: 'pointer',
        store: noProvider.store,
        locale: 'tr',
        onClose: () => undefined,
        onDone: () => undefined,
      }),
    );
    expect(closed).toContain('data-card="docket_ai"');
    expect(closed).toContain('data-card="quick"');
    expect(closed).toContain('data-card="detailed"');
    expect(closed).toContain(TR['setup.ai.noProvider']);
    expect(closed).toContain('aria-disabled="true"');

    const { store } = setup();
    await store.refreshProvider();
    store.pickPath('quick');
    store.setRepoPath('/Users/e/atolye');
    await store.submit();
    expect(store.state().proposal?.project.name).toBe('atolye');
    const html = renderToStaticMarkup(
      createElement(NewProjectPanel, {
        open: true,
        origin: 'pointer',
        store,
        locale: 'tr',
        onClose: () => undefined,
        onDone: () => undefined,
      }),
    );
    expect(html).toContain('data-setup-proposal=""');
    expect(buildSetupProposal('Acme', '/x/acme')).toEqual(buildSetupProposal('Acme', '/x/acme'));
  });

  it('U-287: detail sections start collapsed and remember state; no basic/advanced switch; no flow catalog', () => {
    resetSessionDisclosure();
    expect(disclosureExpanded('flow')).toBe(false);
    expect(toggleDisclosure('flow')).toBe(true);
    expect(disclosureExpanded('flow')).toBe(true);
    const proposal = buildSetupProposal('P', '/p');
    const closed = renderToStaticMarkup(
      createElement(SetupProposalDiff, {
        locale: 'tr',
        proposal,
        expanded: () => false,
        onToggle: () => undefined,
      }),
    );
    expect(closed).toContain('aria-expanded="false"');
    const open = renderToStaticMarkup(
      createElement(SetupProposalDiff, {
        locale: 'tr',
        proposal,
        expanded: () => true,
        onToggle: () => undefined,
      }),
    );
    expect(open).toContain('aria-expanded="true"');
    const screenSrc = raw('new-project.tsx');
    expect(screenSrc).not.toMatch(/Basit|Gelişmiş|Basic|Advanced/);
    expect(screenSrc).not.toContain('flow catalog');
    expect(proposal.repo.flow.flowId).toBe('standard');
  });

  it('U-315: a stopped Docket MCP disables the AI entry with the sentence-button; running re-enables it', async () => {
    expect(mcpRunningOf({ state: 'running', tools: { run: [], chat: [] }, rolesWithout: [] })).toBe(true);
    expect(mcpRunningOf({ state: 'stopped', reason: 'listener_down', tools: { run: [], chat: [] }, rolesWithout: [] })).toBe(false);
    expect(mcpRunningOf({ ok: false, code: 'not_found' })).toBeNull();

    const stopped: Fake = {
      ...fakeApi(),
      query: (query) => {
        if (query.type === 'mcp.status') return Promise.resolve({ state: 'stopped', reason: 'listener_down' });
        return Promise.resolve({ accounts: [{ id: 'a' }], bindings: [] });
      },
    };
    const store = createNewProjectStore({ api: stopped, actor, reloadTree: async () => undefined });
    await store.refreshProvider();
    expect(store.state().mcpRunning).toBe(false);
    store.pickPath('docket_ai');
    expect(store.state().screen).toBe('choose');
    const html = renderToStaticMarkup(
      createElement(NewProjectPanel, {
        open: true,
        origin: 'pointer',
        store,
        locale: 'tr',
        onClose: () => undefined,
        onDone: () => undefined,
      }),
    );
    expect(html).toContain('data-setup-no-mcp=""');
    expect(html).toContain(TR['setup.ai.mcpDown']);
    const english = renderToStaticMarkup(
      createElement(NewProjectPanel, {
        open: true,
        origin: 'pointer',
        store,
        locale: 'en',
        onClose: () => undefined,
        onDone: () => undefined,
      }),
    );
    expect(english).toContain(EN['setup.ai.mcpDown']);

    const running = setup();
    await running.store.refreshProvider();
    expect(running.store.state().mcpRunning).toBe(true);
    running.store.pickPath('docket_ai');
    expect(running.store.state().screen).toBe('ai');
  });

  it('U-315: a start refusal because of the listener carries the entry\'s own sentence', async () => {
    const api = fakeApi();
    api.reply('setup.ai.start', { ok: false, code: 'mcp_down' });
    const store = createNewProjectStore({ api, actor, reloadTree: async () => undefined });
    store.pickPath('docket_ai');
    store.setRepoPath('/Users/e/atolye');
    await store.startAi();
    expect(store.state().ai.failure).toBe('setup.ai.mcpDown');
  });
});

describe('setup helpers retained', () => {
  it('U-40: repo path still pre-fills the project name until the name is edited', () => {
    const { store } = setup();
    store.pickPath('quick');
    store.setRepoPath('/Users/e/atolye');
    expect(store.state().form.name).toBe('atolye');
    store.setName('Özel');
    store.setRepoPath('/Users/e/baska');
    expect(store.state().form.name).toBe('Özel');
  });

  it('folderName and connectedProviderOf behave predictably', () => {
    expect(folderName('/Users/e/proje')).toBe('proje');
    expect(connectedProviderOf({ accounts: [], bindings: [] })).toBe(false);
    expect(connectedProviderOf({ accounts: [{ id: 'x' }], bindings: [] })).toBe(true);
  });

  it('project_exists still offers attach on import path', () => {
    expect(failureOf('project_exists', true).offerAttach).toBe(true);
  });
});

// --- the Docket AI thread (A-357 … A-360) ---------------------------------------------------------------

const CONVERSATION = '01ARZ3NDEKTSV4RRFFQ69G5FC9';

interface AiOptions {
  readonly accounts?: unknown;
  readonly draft?: unknown;
  readonly conversation?: unknown;
  readonly pending?: unknown;
  readonly proposals?: unknown;
  readonly proposalDetail?: unknown;
  readonly startResult?: CommandResult;
}

interface AiHarness {
  readonly api: Fake;
  readonly store: NewProjectStore;
  readonly emit: (change: SetupChange) => void;
  setPending: (pending: unknown) => void;
}

const aiSetup = (options: AiOptions = {}): AiHarness => {
  const commands: Command[] = [];
  const replies = new Map<string, CommandResult>();
  if (options.startResult !== undefined) replies.set('setup.ai.start', options.startResult);
  const emitListeners = new Set<(change: SetupChange) => void>();
  const live: { pending: unknown } = { pending: options.pending ?? { ask: null, secrets: 0 } };
  const answers: Readonly<Record<string, unknown | (() => unknown)>> = {
    'settings.accounts': options.accounts ?? { accounts: [{ id: 'a' }], bindings: [] },
    'mcp.status': { state: 'running' },
    'setup.draft': options.draft ?? { draft: null },
    'setup.read.pending': (): unknown => live.pending,
    'chat.conversation': options.conversation ?? {
      id: CONVERSATION,
      messages: [
        { id: 'm1', role: 'user', text: 'Bu repoyu kur', refs: [], attachments: [], artifacts: [], sources: [] },
        { id: 'm2', role: 'assistant', text: 'Baktım, öneriyi hazırlıyorum.', refs: [], attachments: [], artifacts: [], sources: [] },
      ],
    },
    'proposals.list': options.proposals ?? [],
    'proposal.detail': options.proposalDetail ?? { ok: false, code: 'not_found' },
    'project.tree': oneRepoTree,
  };
  const api: Fake = {
    commands,
    queries: [],
    accounts: answers['settings.accounts'],
    reply: (type, result) => replies.set(type, result),
    query: (query) => {
      const answer = answers[query.type];
      return Promise.resolve(typeof answer === 'function' ? answer() : answer === undefined ? oneRepoTree : answer);
    },
    command: (_actor, command) => {
      commands.push(command);
      return Promise.resolve(replies.get(command.type) ?? { ok: true, conversation: CONVERSATION });
    },
  };
  const store = createNewProjectStore({
    api,
    actor,
    changes: (listener) => {
      emitListeners.add(listener);
      return () => emitListeners.delete(listener);
    },
    reloadTree: async () => undefined,
  });
  return {
    api,
    store,
    emit: (change) => {
      for (const listener of emitListeners) listener(change);
    },
    setPending: (pending) => {
      live.pending = pending;
    },
  };
};

const drawAi = (store: NewProjectStore, locale: 'tr' | 'en' = 'tr'): string =>
  renderToStaticMarkup(
    createElement(NewProjectPanel, {
      open: true,
      origin: 'pointer',
      store,
      locale,
      onClose: () => undefined,
      onDone: () => undefined,
    }),
  );

describe('the Docket AI setup thread', () => {
  it('U-286: the AI entry starts from the repo folder and renders the live thread of the started conversation', async () => {
    const { api, store } = aiSetup();
    await store.refreshProvider();
    store.pickPath('docket_ai');
    store.setRepoPath('/Users/e/acme');
    const html = drawAi(store);
    expect(html).toContain('data-setup-ai-start=""');
    expect(html).toContain(TR['setup.ai.start']);

    await store.startAi();
    expect(api.commands).toContainEqual({ type: 'setup.ai.start', repoPath: '/Users/e/acme' });
    expect(store.state().ai.conversation).toBe(CONVERSATION);
    const live = drawAi(store);
    expect(live).not.toContain('data-setup-ai-start=""');
    expect(live).toContain('data-setup-thread=""');
    expect(live).toContain('Bu repoyu kur');
    expect(live).toContain('Baktım, öneriyi hazırlıyorum.');
    expect(live).toContain('data-setup-composer=""');
  });

  it('U-286: a refused start shows the surface failure line, the entry stays honest', async () => {
    const { store } = aiSetup({ startResult: { ok: false, code: 'no_provider' } });
    await store.refreshProvider();
    store.pickPath('docket_ai');
    store.setRepoPath('/Users/e/acme');
    await store.startAi();
    expect(store.state().ai.conversation).toBeNull();
    expect(store.state().ai.failure).toBe('setup.ai.noProvider');
    expect(drawAi(store)).toContain(TR['setup.ai.noProvider']);
  });

  it('U-275: an ask event opens exactly one prompt whose answer commands the server; a secret count shows the notice', async () => {
    const { api, store, emit, setPending } = aiSetup({ pending: { ask: { path: '/Users/e/notes/plan.md', reason: 'read the migration plan' }, secrets: 0 } });
    await store.refreshProvider();
    store.pickPath('docket_ai');
    store.setRepoPath('/Users/e/acme');
    await store.startAi();

    emit({ type: 'setup.read.ask', conversation: CONVERSATION });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state().permission).toEqual({ path: '/Users/e/notes/plan.md', reason: 'read the migration plan' });
    emit({ type: 'setup.read.ask', conversation: CONVERSATION });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state().permission?.path).toBe('/Users/e/notes/plan.md');

    store.allowPermission();
    expect(store.state().permission).toBeNull();
    expect(api.commands).toContainEqual({ type: 'setup.read.answer', conversation: CONVERSATION, path: '/Users/e/notes/plan.md', allow: true });

    setPending({ ask: { path: '/Users/e/other.md', reason: 'r' }, secrets: 1 });
    emit({ type: 'setup.read.ask', conversation: CONVERSATION });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state().secretNotices).toBe(1);
    expect(drawAi(store)).toContain(TR['setup.permission.secretNotice']);
  });

  it('U-286: the agent’s proposal opens the identical diff and Accept decides it server-side', async () => {
    const proposal = buildSetupProposal('Acme', '/Users/e/acme');
    const { api, store, emit } = aiSetup({
      proposals: [{ id: 'P1', target: 'project_setup', status: 'pending' }],
      proposalDetail: { id: 'P1', target: 'project_setup', status: 'pending', after: JSON.stringify(proposal) },
    });
    await store.refreshProvider();
    store.pickPath('docket_ai');
    store.setRepoPath('/Users/e/acme');
    await store.startAi();

    emit({ type: 'chat.turn', conversation: CONVERSATION, turn: 'T1', phase: 'finished', outcome: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state().screen).toBe('proposal');
    expect(store.state().proposalId).toBe('P1');
    expect(store.state().proposal?.project.name).toBe('Acme');
    expect(drawAi(store)).toContain('data-setup-proposal=""');

    store.discardProposal();
    expect(api.commands).toContainEqual({ type: 'proposal.decide', id: 'P1', decision: 'rejected' });
    expect(store.state().screen).toBe('ai');
    expect(store.state().proposal).toBeNull();
    expect(store.state().done).toBeNull();

    emit({ type: 'chat.turn', conversation: CONVERSATION, turn: 'T2', phase: 'finished', outcome: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state().proposalId).toBe('P1');
    await store.acceptProposal();
    expect(api.commands).toContainEqual({ type: 'proposal.decide', id: 'P1', decision: 'approved' });
    expect(store.state().screen).toBe('summary');
    expect(store.state().done).toBeNull();
  });

  it('U-286: a persisted draft offers the resume card and resume re-registers onto its conversation', async () => {
    const { api, store } = aiSetup({ draft: { draft: { id: '01ARZ3NDEKTSV4RRFFQ69G5FD1', repoPath: '/Users/e/acme', mode: 'ai', updatedAt: 9 } } });
    await store.refreshProvider();
    expect(store.state().resumable).toEqual({ id: '01ARZ3NDEKTSV4RRFFQ69G5FD1', repoPath: '/Users/e/acme' });
    expect(hasDraft(START_FORM, 'choose', null, store.state().resumable)).toBe(true);
    expect(drawAi(store)).toContain('data-card="resume"');

    store.resumeDraft();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.commands).toContainEqual({
      type: 'setup.ai.start',
      repoPath: '/Users/e/acme',
      draft: '01ARZ3NDEKTSV4RRFFQ69G5FD1',
    });
    expect(store.state().ai.conversation).toBe(CONVERSATION);
    expect(store.state().screen).toBe('ai');
  });
});

const drawPanel = (store: NewProjectStore, locale: 'tr' | 'en' = 'tr'): string =>
  renderToStaticMarkup(
    createElement(NewProjectPanel, {
      open: true,
      origin: 'pointer',
      store,
      locale,
      onClose: () => undefined,
      onDone: () => undefined,
    }),
  );

describe('multi-repo setup (U-316 … U-319)', () => {
  it('U-316: first accept opens the summary and the permission dialog can show the repo badge', async () => {
    const { api, store } = setup();
    store.pickPath('quick');
    store.setRepoPath('/Users/e/acme');
    store.setName('Acme');
    await store.submit();
    api.reply('project.create', { ok: true, id: 'acme' });
    api.reply('setup.apply', { ok: true });
    await store.acceptProposal();
    expect(store.state().screen).toBe('summary');
    const html = drawPanel(store);
    expect(html).toContain('data-setup-summary=""');
    expect(html).toContain(TR['setup.multi.summary.openProject']);
    const perm = renderToStaticMarkup(
      createElement(PermissionPrompt, {
        open: true,
        prompt: { path: '/tmp/x', reason: 'Need schema' },
        locale: 'tr',
        repoLabel: 'acme',
        onDeny: () => undefined,
        onAllow: () => undefined,
        returnFocusRef: { current: null },
      }),
    );
    expect(perm).toContain(TR['setup.permission.repoPrefix']);
    expect(perm).toContain('acme');
  });

  it('U-317: Depo ekle chooser renders five method cards including copy and import', () => {
    const { store } = setup();
    store.showAddChooser();
    const html = drawPanel(store);
    expect(html).toContain('data-setup-add-chooser=""');
    expect(html).toContain('data-card="copy_from"');
    expect(html).toContain('data-card="import_multi"');
    expect(html).toContain(TR['setup.multi.copy.title']);
    expect(html).toContain(TR['setup.multi.batch.title']);
  });

  it('U-318: copy-from screen lists copied and not-copied regions', () => {
    const { store } = setup();
    store.showAddChooser();
    store.pickPath('copy_from');
    const html = drawPanel(store);
    expect(html).toContain('data-setup-copy-from=""');
    expect(html).toContain(TR['setup.multi.copy.copiedHead']);
    expect(html).toContain(TR['setup.multi.copy.notCopiedHead']);
  });

  it('U-319: import batch exposes both modes and a queue with approve actions', async () => {
    const { api, store } = setup();
    store.showAddChooser();
    store.pickPath('import_multi');
    const html = drawPanel(store);
    expect(html).toContain('data-setup-import=""');
    expect(html).toContain('data-import-mode="multi"');
    expect(html).toContain('data-import-mode="parent"');
    const prior = api.query.bind(api);
    api.query = (query) => {
      if (query.type === 'repos.discover') {
        return Promise.resolve({ found: [{ name: 'beta', path: '/parent/beta', isGit: true }], truncated: false });
      }
      return prior(query);
    };
    store.setImportParent('/parent');
    await store.scanImportParent();
    const queued = drawPanel(store);
    expect(queued).toContain('data-setup-import-queue=""');
    expect(queued).toContain(TR['setup.multi.batch.approveOne']);
  });
});

describe('existing-folder import accept', () => {
  it('accept creates the project through project.create existing and applies the proposal, never attaching', async () => {
    const { api, store } = setup();
    store.pickPath('import');
    store.setRepoPath('/Users/e/atolye');
    await store.submit();
    api.reply('project.create', { ok: true, id: 'atolye' });
    api.reply('setup.apply', { ok: true });
    await store.acceptProposal();
    expect(api.commands).toContainEqual({ type: 'project.create', mode: 'existing', path: '/Users/e/atolye', name: 'atolye' });
    expect(api.commands).not.toContainEqual(expect.objectContaining({ type: 'project.attach' }));
    expect(api.commands).toContainEqual({
      type: 'setup.apply',
      project: 'atolye',
      path: '/Users/e/atolye',
      proposal: buildSetupProposal('atolye', '/Users/e/atolye'),
    });
    expect(store.state().screen).toBe('summary');
    expect(store.state().projectId).toBe('atolye');
    expect(store.state().done).toBeNull();
  });

  it('A-387: the summary counts only a repo whose repo.yaml was written', async () => {
    const { api, store } = setup();
    store.pickPath('import');
    store.setRepoPath('/Users/e/atolye');
    await store.submit();
    api.reply('project.create', { ok: true, id: 'atolye' });
    api.reply('setup.apply', { ok: true, wroteRepoYaml: false });
    await store.acceptProposal();
    expect(store.state().addedRepos).toEqual([]);
  });

  it('a create refusal shows its labelled failure and no success toast', async () => {
    const { api, store } = setup();
    store.pickPath('import');
    store.setRepoPath('/Users/e/atolye');
    await store.submit();
    api.reply('project.create', { ok: false, code: 'not_a_repo' });
    await store.acceptProposal();
    expect(store.state().failure?.key).toBe('error.not_a_repo');
    expect(store.state().failure?.offerAttach).toBe(false);
    expect(store.state().done).toBeNull();
  });

  it('project_exists on import keeps the attach offer and the attach button still attaches', async () => {
    const { api, store } = setup();
    store.pickPath('import');
    store.setRepoPath('/Users/e/atolye');
    await store.submit();
    api.reply('project.create', { ok: false, code: 'project_exists' });
    await store.acceptProposal();
    expect(store.state().failure?.key).toBe('error.project_exists');
    expect(store.state().failure?.offerAttach).toBe(true);
    expect(store.state().done).toBeNull();
    api.reply('project.attach', { ok: true, id: 'atolye' });
    await store.attachExisting();
    expect(api.commands).toContainEqual({ type: 'project.attach', path: '/Users/e/atolye' });
    expect(store.state().done?.toastKey).toBe('success.project.attach');
  });
});

describe('setup proposal test command field', () => {
  const diffHtml = (proposal = buildSetupProposal('P', '/p'), onTestCommandChange?: (value: string) => void): string =>
    renderToStaticMarkup(
      createElement(SetupProposalDiff, {
        locale: 'tr',
        proposal,
        expanded: () => false,
        onToggle: () => undefined,
        onTestCommandChange,
      }),
    );

  it('the Komutlar section shows an optional single-line Test komutu field even while the section is collapsed', () => {
    const html = diffHtml(undefined, () => undefined);
    expect(html).toContain('data-setup-test-command=""');
    expect(html).toContain(TR['setup.proposal.testCommand']);
    expect(html).toContain(TR['setup.proposal.testCommandHint']);
    expect(html).toContain('type="text"');
    expect(html).not.toContain('required');
    expect(html).not.toContain('readOnly');
    expect(diffHtml()).toContain('readOnly=""');
    expect(raw('setup-proposal-diff.tsx')).toContain("t(locale, 'setup.proposal.testCommand')");
  });

  it('a typed command becomes the tests set; clearing it empties the set again', async () => {
    const { api, store } = setup();
    store.pickPath('quick');
    store.setRepoPath('/Users/e/atolye');
    await store.submit();
    expect(testCommandOf(buildSetupProposal('P', '/p'))).toBe('');
    store.setTestCommand('  npm test  ');
    expect(store.state().proposal?.repo.commandSets).toEqual({ tests: ['npm test'] });
    store.setTestCommand('   ');
    expect(store.state().proposal?.repo.commandSets).toEqual({ tests: [] });
    store.setTestCommand('make check');
    api.reply('project.create', { ok: true, id: 'atolye' });
    api.reply('setup.apply', { ok: true });
    await store.acceptProposal();
    expect(api.commands).toContainEqual(
      expect.objectContaining({ type: 'setup.apply', proposal: expect.objectContaining({ repo: expect.objectContaining({ commandSets: { tests: ['make check'] } }) }) }),
    );
    expect(store.state().addedRepos[0]?.noTestGate).toBeUndefined();
  });

  it('an accepted setup without a test command marks the repo, and the summary says there is no test gate', async () => {
    const { api, store } = setup();
    store.pickPath('quick');
    store.setRepoPath('/Users/e/atolye');
    await store.submit();
    api.reply('project.create', { ok: true, id: 'atolye' });
    api.reply('setup.apply', { ok: true });
    await store.acceptProposal();
    expect(store.state().addedRepos[0]?.noTestGate).toBe(true);
    const html = drawPanel(store);
    expect(html).toContain('data-setup-no-test-gate=""');
    expect(html).toContain(TR['setup.multi.summary.noTestGate']);
    expect(EN['setup.multi.summary.noTestGate']).toMatch(/no test gate/i);
  });

  it('typing a test command with no proposal on screen changes nothing', () => {
    const { store } = setup();
    store.setTestCommand('npm test');
    expect(store.state().proposal).toBeNull();
  });
});
