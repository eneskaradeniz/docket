// wizard-screen.test.ts — the rendered behaviour of the Bütçe step (U-48) and the finishing
// progress (U-49): the screen is mounted over a real wizard store (a scripted api), drawn with
// the server renderer the way the layer's component tests draw, so every claim below reads the
// markup a user would see — not the store's logic alone. The store keeps one cached state object,
// so useSyncExternalStore's getSnapshot is stable and repeated renders below are byte-identical.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query, SettingsAccountView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { Budget, BudgetDetail, toggleBudgetRow, WizardScreen } from './wizard';
import type { LocaleStore } from '../stores/locale';
import type { ThemeStore } from '../stores/theme';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { createWizardStore, type WizardStore } from '../stores/wizard';

const userActor: Actor = { kind: 'user', id: 'user-1' };

const candidate = (path: string, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  sourcePath: `/h/${path}`,
  displayPath: `~/${path}`,
  kind: 'subscription',
  routeKind: 'anthropic',
  provider: 'claude',
  billing: 'included',
  hasOauthLogin: true,
  envOverrides: [],
  warnings: [],
  alreadyAdded: false,
  ...patch,
});

const subscription = candidate('.claude');
const paygEndpoint = candidate('.claude-zai', {
  kind: 'compatible_endpoint',
  billing: 'unknown',
  endpointHost: 'api.z.ai',
  envOverrides: ['token', 'endpoint'],
});

const claudeProvider = { defId: 'claude', name: 'Claude Code', installUrl: null, binPath: '/usr/bin/claude', version: null, loggedIn: true, optionalFlags: [] };

const accountView = (id: string, label: string, authMode: string): SettingsAccountView => ({
  id,
  provider: 'claude',
  label,
  authMode,
  billing: authMode === 'subscription' ? 'included' : 'unknown',
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

const quota = {
  ok: true,
  pools: [{ id: 'p1', label: 'Max', kind: 'allowance', appliesTo: 'all' }],
  meters: [
    {
      id: 'm1',
      poolId: 'p1',
      label: 'five_hour',
      cadence: 'fixed',
      durationMs: null,
      unit: 'fraction',
      used: 0.3,
      limit: 1,
      remaining: 0.7,
      resetsAt: 1,
      resetPrecision: 'exact',
      observedAt: 1,
      source: 'polled',
      staleAfterMs: null,
      reserveClass: 'short',
      reserveShare: 0,
    },
  ],
};

interface Fake extends Pick<Api, 'query' | 'command'> {
  readonly commands: Command[];
  failOn(type: Command['type'], result: CommandResult): void;
  holdOn(type: Command['type']): { readonly resolve: () => void };
}

const fakeApi = (): Fake => {
  const commands: Command[] = [];
  const failures = new Map<string, CommandResult>();
  const holds = new Map<string, (() => void)[]>();
  let adopted = 0;
  const accounts: SettingsAccountView[] = [];
  const settle = (command: Command): Promise<CommandResult> => {
    const failure = failures.get(command.type);
    if (failure !== undefined) return Promise.resolve(failure);
    if (command.type === 'account.adopt') {
      adopted += 1;
      const id = `acc-${adopted}`;
      const isEndpoint = command.sourcePath.includes('zai');
      accounts.push(accountView(id, command.label, isEndpoint ? 'api_key' : 'subscription'));
      return Promise.resolve({ ok: true, id });
    }
    return Promise.resolve({ ok: true });
  };
  return {
    commands,
    failOn: (type, result) => failures.set(type, result),
    holdOn: (type) => {
      holds.set(type, []);
      return {
        resolve: () => {
          const waiting = holds.get(type) ?? [];
          holds.delete(type);
          for (const go of waiting) go();
        },
      };
    },
    query: (query: Query) => {
      switch (query.type) {
        case 'project.tree':
          return Promise.resolve([]);
        case 'accounts.candidates':
          return Promise.resolve([subscription, paygEndpoint]);
        case 'providers.discovered':
          return Promise.resolve([claudeProvider]);
        case 'settings.accounts':
          return Promise.resolve({ accounts, bindings: [] });
        case 'roles.list':
          return Promise.resolve([]);
        case 'accounts.candidateQuota':
          return Promise.resolve(quota);
        default:
          return Promise.resolve([]);
      }
    },
    command: (_actor, command) => {
      commands.push(command);
      const held = holds.get(command.type);
      if (held !== undefined) return new Promise((resolve) => { held.push(() => { void settle(command).then(resolve); }); });
      return settle(command);
    },
  };
};

interface Setup {
  readonly api: Fake;
  readonly store: WizardStore;
}

/** The wizard on Bütçe with one subscription and one consented pay-per-use row. */
const toBudget = async (): Promise<Setup> => {
  const api = fakeApi();
  const store = createWizardStore({ api, actor: userActor, changes: () => () => {} });
  await store.open();
  await store.next();
  store.select('/h/.claude-zai');
  store.setImportToken('/h/.claude-zai', true);
  await store.next();
  await store.next();
  expect(store.state().step).toBe('budget');
  expect(store.allowSpend('/h/.claude-zai', { amount: '40', scope: 'account_month' })).toBe(true);
  return { api, store };
};

const localeStore: LocaleStore = { current: () => 'tr', set: () => {}, subscribe: () => () => {} };
const themeStore: ThemeStore = { preference: () => 'system', resolved: () => 'dark', set: () => {}, subscribe: () => () => {} };
const marks: ProviderMarksStore = { load: () => Promise.resolve(), markFor: () => null, state: () => ({ loaded: true }), subscribe: () => () => {} };

const draw = (store: WizardStore): string =>
  renderToStaticMarkup(createElement(WizardScreen, { store, locale: 'tr', localeStore, themeStore, marks }));

const drawBudget = (store: WizardStore): string => renderToStaticMarkup(createElement(Budget, { state: store.state(), store, locale: 'tr', marks }));

/** One row's slice of the markup: the segment from its data-budget-row to the next one's. */
const rowSegment = (html: string, index: number): string => {
  const parts = html.split('data-budget-row=');
  return parts[index + 1] ?? '';
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('wizard screen — Bütçe (U-48)', () => {
  it('U-48: a line above the groups says the recommended settings are applied, and the two billing groups keep their headers', async () => {
    const { store } = await toBudget();
    const html = drawBudget(store);
    expect(html).toContain('Önerilen ayarlar uygulandı — değiştirmek istersen satırı aç.');
    expect(html.indexOf('data-budget-hint')).toBeLessThan(html.indexOf('data-budget-group="subscriptions"'));
    expect(html).toContain('Abonelikler');
    expect(html).toContain('Kullandıkça öde ya da ücreti bilinmeyen');
  });

  it('U-48: every account is one compact row — mark, name, tag and one summary line — and all rows start closed', async () => {
    const { store } = await toBudget();
    const html = drawBudget(store);
    expect(html.match(/data-budget-row=/g)).toHaveLength(2);
    expect(rowSegment(html, 0)).toContain('Limit dolunca bekler · rezerv yok');
    expect(rowSegment(html, 0)).toContain('data-budget-summary=');
    // The pay-per-use row carries its cap and consent standing in its summary.
    expect(rowSegment(html, 1)).toContain('Tavan $40 · izinli');
    // Every Ayrıntı starts closed; no row's controls are in the markup.
    expect(rowSegment(html, 0)).toContain('aria-expanded="false"');
    expect(rowSegment(html, 1)).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-budget-detail=');
  });

  it('U-48: a pay-per-use row always keeps its consent control and cap field in the row', async () => {
    const { store } = await toBudget();
    const html = drawBudget(store);
    expect(rowSegment(html, 1)).toContain('data-consent="granted"');
    expect(rowSegment(html, 1)).toContain('aria-label="Tavan"');
    expect(rowSegment(html, 0)).not.toContain('data-consent=');
    expect(rowSegment(html, 0)).not.toContain('aria-label="Tavan"');
  });

  it('U-48: the open detail holds the limit-full choice, the reserve, ✎ and the meter lines', async () => {
    const { store } = await toBudget();
    const row = store.state().budget.subscriptions[0];
    expect(row).toBeDefined();
    const html = renderToStaticMarkup(createElement(BudgetDetail, { row, store, locale: 'tr' }));
    expect(html).toContain('Limit dolunca');
    expect(html).toContain('Kendi kullanımın için ayır');
    expect(html).toContain('aria-label="Düzenle"');
    // The Max account's limit lines live under the open row.
    expect(html).toContain('role="img"');
  });

  it('U-48: one row is open at a time — opening a row closes the other', () => {
    expect(toggleBudgetRow(null, 'a')).toBe('a');
    expect(toggleBudgetRow('a', 'b')).toBe('b');
    expect(toggleBudgetRow('a', 'a')).toBeNull();
  });

  it('U-48: the step renders from a stable snapshot — repeated reads never look like a change', async () => {
    const { store } = await toBudget();
    expect(store.state()).toBe(store.state());
    expect(drawBudget(store)).toBe(drawBudget(store));
  });
});

describe('wizard screen — finishing (U-49)', () => {
  it('U-49: "Kurulumu bitir" becomes a spinner "Kuruluyor…" and the body becomes the four-line list', async () => {
    const { api, store } = await toBudget();
    const held = api.holdOn('account.adopt');
    const finishing = store.next();
    await tick();
    const html = draw(store);
    expect(store.state().finishing).toBe(true);
    expect(html).toContain('Kurulum sürüyor');
    expect(html).toContain('Kuruluyor…');
    expect(html).toContain('animate-spin');
    // The motion variants stay quiet under reduced motion, in the same order.
    expect(html).toContain('motion-reduce:animate-none');
    expect(html.indexOf('data-finish-line="accounts"')).toBeLessThan(html.indexOf('data-finish-line="order"'));
    expect(html.indexOf('data-finish-line="order"')).toBeLessThan(html.indexOf('data-finish-line="budget"'));
    expect(html.indexOf('data-finish-line="budget"')).toBeLessThan(html.indexOf('data-finish-line="home"'));
    expect(html.match(/data-finish-line="[^"]+" data-ps="busy"/g)).toEqual(['data-finish-line="accounts" data-ps="busy"']);
    expect(html.match(/data-ps="wait"/g)).toHaveLength(3);
    held.resolve();
    await finishing;
  });

  it('U-49: Geri and the step buttons are disabled while the finish runs', async () => {
    const { api, store } = await toBudget();
    const held = api.holdOn('account.adopt');
    const finishing = store.next();
    await tick();
    const html = draw(store);
    // Five rail buttons, every one of them dead.
    const railButtons = html.match(/<button[^>]*data-rail-step=[^>]*>/g) ?? [];
    expect(railButtons).toHaveLength(5);
    for (const button of railButtons) {
      expect(button).toContain('disabled');
    }
    // Geri stays in the footer, disabled — not gone.
    const back = html.match(/<button[^>]*>Geri<\/button>/g) ?? [];
    expect(back).toHaveLength(1);
    held.resolve();
    await finishing;
  });

  it('U-49: a failing line stops with its reason and a "Tekrar dene" button', async () => {
    const { api, store } = await toBudget();
    api.failOn('account.adopt', { ok: false, code: 'not_found' });
    await store.next();
    expect(store.state().finishError).not.toBeNull();
    const html = draw(store);
    expect(html).toContain('data-finish-line="accounts" data-ps="error"');
    expect(html).toContain('data-finish-reason');
    expect(html).toContain('Kayıt bulunamadı.');
    expect(html).toContain('Tekrar dene');
  });

  it('U-49: the finished window renders the completed list while it hands itself off', async () => {
    const { store } = await toBudget();
    await store.next();
    expect(store.state().finished).toEqual({ accounts: 2 });
    const html = draw(store);
    expect(html.match(/data-ps="done"/g)).toHaveLength(4);
    expect(html).not.toContain('data-ps="wait"');
    // The overlay fades on its way out; the shell is already on Anasayfa beneath it.
    expect(html).toContain('data-wizard-leaving');
    expect(store.state()).toBe(store.state());
    expect(draw(store)).toBe(draw(store));
  });
});
