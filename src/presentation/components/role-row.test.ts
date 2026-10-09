// role-row.test.ts — U-33a: the Roller screen's "Asistan sırası" as rendered markup. An account
// the stored bindings never mention cannot join the order by dragging — the section offers it a
// "+" chip under the chain, the same chip the fine-tune's own chain uses, and a click sends it to
// the chain's end (the command fan-out is roles.test.ts's). The renders run against the real
// store (a resolved fake api), so the markup is the component's own output, not a mock's.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Query, RoleListItem, SettingsAccountsView, SettingsBindingView } from '../../api/queries';
import { ChainSection } from './role-row';
import { createRolesStore, type RolesStore } from '../stores/roles';

const account = (id: string): SettingsAccountsView['accounts'][number] => ({
  id,
  provider: 'atlas',
  label: id,
  authMode: 'subscription',
  billing: 'included',
  plan: null,
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: null,
  endpointHost: null,
  hasSecret: false,
  test: null,
  pools: [],
  meters: [],
});

const binding = (role: string, ids: readonly string[]): SettingsBindingView => ({
  scope: { level: 'global' },
  role,
  thinking: null,
  tier: null,
  accounts: ids.map((accountId) => ({ accountId, model: null })),
});

const ROLES: readonly RoleListItem[] = [
  { id: 'developer', name: 'Geliştirici', stages: [] },
  { id: 'planner', name: 'Planlayıcı', stages: [] },
];

const rolesApi = (view: SettingsAccountsView): Pick<Api, 'query' | 'command'> => ({
  query: (query: Query) => {
    if (query.type === 'roles.list') return Promise.resolve(ROLES);
    if (query.type === 'settings.accounts') return Promise.resolve(view);
    return Promise.resolve({ ok: false, code: 'not_found' });
  },
  command: () => Promise.resolve({ ok: true } as const),
});

const renderChain = async (view: SettingsAccountsView): Promise<{ readonly html: string; readonly store: RolesStore }> => {
  const store = createRolesStore({ api: rolesApi(view), changes: () => () => undefined, actor: { kind: 'user' } as never, now: () => 0 });
  await store.load();
  const html = renderToStaticMarkup(createElement(ChainSection, { store, locale: 'tr', markFor: () => null }));
  return { html, store };
};

describe('U-33a: Asistan sırası add chips', () => {
  it('U-33a: an account outside the chain gets a + chip under the order; accounts in the chain do not', async () => {
    const { html } = await renderChain({
      accounts: [account('a1'), account('a2'), account('a3')],
      bindings: [binding('developer', ['a1', 'a2']), binding('planner', ['a1', 'a2'])],
    });
    expect(html).toContain('data-roles-chain-add');
    expect(html).toContain('Sıraya eklemek için bir hesap seç.');
    expect(html).toContain('+ a3');
    expect(html).not.toContain('+ a1');
    expect(html).not.toContain('+ a2');
  });

  it('U-33a: with accounts but an empty chain the chips still offer every account beside the empty line', async () => {
    const { html } = await renderChain({ accounts: [account('a1'), account('a2')], bindings: [] });
    expect(html).toContain('Hesap var ama sıra boş.');
    expect(html).toContain('+ a1');
    expect(html).toContain('+ a2');
  });
});
