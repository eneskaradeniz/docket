/// <reference types="vite/client" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Actor } from '../../domain/index';
import { TR } from '../labels/tr';
import { createNewProjectStore, hasDraft } from '../stores/new-project';
import { NewProjectPanel } from './new-project';

interface SetupReturn {
  readonly api: {
    readonly query: (q: unknown) => Promise<unknown>;
    readonly command: (actor: Actor, c: unknown) => Promise<unknown>;
    reply: (kind: string, answer: unknown) => void;
  };
  readonly store: ReturnType<typeof createNewProjectStore>;
}

const setup = (): SetupReturn => {
  const replies = new Map<string, unknown>();
  const actor: Actor = { kind: 'user', id: 'user-1' };
  const api = {
    reply: (kind: string, answer: unknown) => {
      replies.set(kind, answer);
    },
    query: async () => [],
    command: async (_actor: Actor, cmd: unknown) => {
      const kind = typeof cmd === 'object' && cmd !== null && 'type' in cmd ? String((cmd as { type: unknown }).type) : '';
      return replies.get(kind) ?? { ok: true, id: 'acme' };
    },
  };
  const store = createNewProjectStore({
    api: api as unknown as Api,
    actor,
    reloadTree: async () => undefined,
  });
  return { api, store };
};

const drawPanel = (store: ReturnType<typeof createNewProjectStore>, locale: 'tr' | 'en' = 'tr'): string =>
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

describe('NewProjectPanel (U-364)', () => {
  it('U-364: renders no duplicate modal footer on summary screen; SetupSummary owns actions', async () => {
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

    // Modal frame should NOT render the footer band
    expect(html).not.toContain('data-window-footer=""');

    // SetupSummary inside the body should render the summary controls
    expect(html).toContain('data-setup-summary=""');
    expect(html).toContain(TR['setup.multi.summary.openProject']);
    expect(html).toContain(TR['setup.multi.summary.addMore']);
    expect(html).toContain(TR['setup.multi.summary.viewList']);
  });

  it('U-364: renders modal footer on single-screen paths like form', () => {
    const { store } = setup();
    store.pickPath('quick');
    expect(store.state().screen).toBe('form');

    const html = drawPanel(store);
    expect(html).toContain('data-window-footer=""');
    expect(html).toContain(TR['newProject.cancel']);
    expect(html).toContain(TR['newProject.create']);
  });

  it('U-364: hasDraft returns false on summary screen even when proposal and form are populated', async () => {
    const { api, store } = setup();
    store.pickPath('quick');
    store.setRepoPath('/Users/e/acme');
    store.setName('Acme');
    await store.submit();
    api.reply('project.create', { ok: true, id: 'acme' });
    api.reply('setup.apply', { ok: true });
    await store.acceptProposal();

    expect(store.state().screen).toBe('summary');
    expect(hasDraft(store.state().form, store.state().screen, store.state().proposal)).toBe(false);
  });
});
