// roles-section.test.ts — U-33 on the rendered Roller work-style rows: the unset banner, the
// segment control per role with the recommended hint, the inert "Özel" standing, and the saves the
// store issues for a pick and for "Önerilenleri uygula". The store is the real one over fakes.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command } from '../../api/commands';
import type { Query, RoleListItem, SettingsAccountsView, SettingsBindingView } from '../../api/queries';
import type { Locale } from '../labels/t';
import { createRolesStore, type RolesStore } from '../stores/roles';
import { RolesSection } from './roles-section';

type BindingSave = Extract<Command, { readonly type: 'binding.save' }>;

const role = (id: string, name: string): RoleListItem => ({ id, name, version: 1, removal: { kind: 'delete' }, pastVersions: [], stages: [] });
const binding = (roleId: string, extra: Partial<SettingsBindingView> = {}): SettingsBindingView => ({
  scope: { level: 'global' },
  role: roleId,
  thinking: null,
  tier: null,
  accounts: [{ accountId: 'a1', model: null }],
  ...extra,
});

const ROLES = [role('developer', 'Geliştirici'), role('reviewer', 'Gözden geçirici'), role('analyst', 'Analist')];

const setup = async (bindings: readonly SettingsBindingView[]): Promise<{ store: RolesStore; commands: Command[] }> => {
  const commands: Command[] = [];
  const api: Pick<Api, 'query' | 'command'> = {
    query: (query: Query) => {
      if (query.type === 'roles.list') return Promise.resolve(ROLES);
      const view = { accounts: [], bindings } as unknown as SettingsAccountsView;
      return Promise.resolve(view);
    },
    command: (_actor, command) => {
      commands.push(command);
      return Promise.resolve({ ok: true } as const);
    },
  };
  const store = createRolesStore({ api, changes: () => () => undefined, actor: { kind: 'user' } as never, now: () => 0 });
  await store.load();
  return { store, commands };
};

const render = (store: RolesStore, locale: Locale = 'tr'): string =>
  renderToStaticMarkup(createElement(RolesSection, { locale, store, state: store.state() }));

const rowOf = (html: string, id: string): string => html.split('data-role-row=').find((part) => part.startsWith(`"${id}"`)) ?? '';

describe('U-33: Roller work-style rows', () => {
  it('U-33: a role with neither tier nor thinking shows the banner and no selection', async () => {
    const { store } = await setup([binding('developer'), binding('reviewer', { tier: 'balanced', thinking: { level: 'balanced' } }), binding('analyst', { tier: 'fast', thinking: { level: 'fast' } })]);
    const out = render(store);
    expect(out).toContain('data-roles-unset');
    expect(out).toContain('1 rol önerilen çalışma biçimini kullanmıyor');
    expect(out).toContain('>Önerilenleri uygula<');
    expect(rowOf(out, 'developer')).not.toContain('aria-pressed="true"');
  });

  it('U-33: no banner once every role has a style; the pressed segment is the stored one and the recommended one is tagged', async () => {
    const { store } = await setup([
      binding('developer', { tier: 'balanced', thinking: { level: 'balanced' } }),
      binding('reviewer', { tier: 'strong', thinking: { level: 'deep' } }),
      binding('analyst', { tier: 'fast', thinking: { level: 'fast' } }),
    ]);
    const out = render(store);
    expect(out).not.toContain('data-roles-unset');
    expect(rowOf(out, 'reviewer')).toMatch(/aria-pressed="true"[^>]*>[^<]*Özenli/);
    expect(rowOf(out, 'reviewer')).toContain('Önerilen');
    expect(rowOf(out, 'analyst')).toMatch(/aria-pressed="true"[^>]*>Hızlı/);
  });

  it('U-33: a custom pair shows Özel as an inert fourth standing with no pressed segment', async () => {
    const { store } = await setup([
      binding('developer', { tier: 'strong', thinking: { level: 'fast' } }),
      binding('reviewer', { tier: 'strong', thinking: { level: 'deep' } }),
      binding('analyst', { tier: 'fast', thinking: { level: 'fast' } }),
    ]);
    const row = rowOf(render(store), 'developer');
    expect(row).toContain('aria-disabled="true"');
    expect(row).toContain('Özel');
    expect(row).not.toContain('aria-pressed="true"');
  });

  it('U-33: the copy has an English peer', async () => {
    const { store } = await setup([binding('developer'), binding('reviewer'), binding('analyst')]);
    const out = render(store, 'en');
    expect(out).toContain('Apply recommended');
    expect(out).toContain('>Careful<');
  });

  it('U-33: picking a segment saves a complete binding for that role', async () => {
    const { store, commands } = await setup([binding('developer'), binding('reviewer'), binding('analyst')]);
    await store.setStyle('developer', 'careful');
    const saves = commands.filter((c): c is BindingSave => c.type === 'binding.save');
    expect(saves).toEqual([{ type: 'binding.save', role: 'developer', accounts: [{ accountId: 'a1' }], thinking: { level: 'deep' }, tier: 'strong' }]);
  });

  it('U-33: Önerilenleri uygula saves the recommended style for exactly the unset roles', async () => {
    const { store, commands } = await setup([binding('developer'), binding('reviewer', { tier: 'fast', thinking: { level: 'fast' } }), binding('analyst')]);
    await store.applyRecommended();
    const saves = commands.filter((c): c is BindingSave => c.type === 'binding.save');
    expect(saves.map((s) => [s.role, s.tier])).toEqual([
      ['developer', 'balanced'],
      ['analyst', 'fast'],
    ]);
  });
});
