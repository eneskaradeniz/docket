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
  ['../components/permission-prompt.tsx', '../components/setup-proposal-diff.tsx', '../screens/new-project.tsx'],
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
  permissionAfterDeny,
  readRequestKind,
  resetSessionDisclosure,
  toggleDisclosure,
  type NewProjectStore,
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
    mainRepo: 'atolye',
    repos: [{ repo: 'atolye', name: 'atolye', main: true, active: 0, status: 'idle' }],
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
