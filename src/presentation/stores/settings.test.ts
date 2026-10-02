// settings.test.ts — U-6: the settings store lists accounts with their pools/meters as rendering
// data (label, remaining, unit, resets-at in the active locale, source badge), exposes the
// per-role bindings, and lists discovery rows so that one slow or failed provider delays only
// the refresh — the prior rows stay listed and a failed provider arrives as its null-fields row,
// never a query failure. Save/remove intents map through results.ts (U-8); removing an account a
// binding still references warns with the referencing roles BEFORE account.remove is issued and
// issues only on explicit confirmation. Api and change signal are injected fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query, SettingsAccountsView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { Locale } from '../labels/t';

import { createSettingsStore, type SettingsChange, type SettingsChangeSignal } from './settings';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };

const ACCOUNT_SETTINGS = {
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: null,
  endpointHost: null,
  hasSecret: false,
} as const;

const METER_WINDOW = {
  id: 'meter-1',
  poolId: 'pool-1',
  label: 'Prompts',
  cadence: 'rolling_from_first_use',
  durationMs: 604_800_000,
  unit: 'prompts',
  used: 40,
  limit: 100,
  remaining: 60,
  resetsAt: 9_000,
  resetPrecision: 'exact',
  observedAt: 8_000,
  source: 'polled',
  staleAfterMs: null,
  reserveClass: 'long',
  reserveShare: 0,
} as const;

/** The bare meter pins the nulls: no label of its own, nothing measured, no reset time. */
const METER_BARE = {
  id: 'meter-2',
  poolId: 'pool-1',
  label: null,
  cadence: 'none',
  durationMs: null,
  unit: 'usd',
  used: null,
  limit: null,
  remaining: null,
  resetsAt: null,
  resetPrecision: 'unknown',
  observedAt: 8_500,
  source: 'pushed',
  staleAfterMs: null,
  reserveClass: 'long',
  reserveShare: 0,
} as const;

const VIEW: SettingsAccountsView = {
  accounts: [
    {
      id: 'acc-1',
      provider: 'acme-prov',
      label: 'Main',
      authMode: 'subscription',
      plan: 'pro',
      ...ACCOUNT_SETTINGS,
      pools: [{ id: 'pool-1', label: 'Weekly allowance', kind: 'allowance', appliesTo: 'all' }],
      meters: [METER_WINDOW, METER_BARE],
    },
    {
      id: 'acc-2',
      provider: 'beta-prov',
      label: 'Spare',
      authMode: 'api_key',
      plan: null,
      ...ACCOUNT_SETTINGS,
      pools: [],
      meters: [],
    },
    {
      id: 'acc-3',
      provider: 'gamma-prov',
      label: 'Unbound',
      authMode: 'cloud',
      plan: null,
      ...ACCOUNT_SETTINGS,
      pools: [],
      meters: [],
    },
  ],
  bindings: [
    { scope: { level: 'global' }, role: 'worker', thinking: null, tier: null, accounts: [{ accountId: 'acc-1', model: 'atlas-max' }] },
    {
      scope: { level: 'repo', repo: 'atolye' },
      role: 'reviewer',
      thinking: null,
      tier: null,
      accounts: [
        { accountId: 'acc-2', model: null },
        { accountId: 'acc-1', model: null },
      ],
    },
    {
      scope: { level: 'workOrder', workOrderId: 'wo-1' },
      role: 'worker',
      thinking: null,
      tier: null,
      accounts: [{ accountId: 'acc-2', model: null }],
    },
  ],
};

const ALPHA_ROW = {
  defId: 'alpha',
  binPath: '/usr/local/bin/alpha',
  version: '1.2.3',
  loggedIn: true,
  optionalFlags: ['--fast'],
};

/** A provider whose probe failed or was cut off: null fields, never a failed query. */
const BROKEN_ROW = {
  defId: 'beta',
  binPath: null,
  version: null,
  loggedIn: null,
  optionalFlags: [],
};

interface FakeSettingsApi extends Pick<Api, 'query' | 'command'> {
  readonly queries: Query[];
  readonly commands: Command[];
  setReply(type: Query['type'], reply: unknown): void;
  /** Subsequent queries of the type hang until `release` — the hanging pass. */
  hold(type: Query['type']): void;
  release(type: Query['type'], reply: unknown): void;
  setCommandResult(result: CommandResult): void;
}

const fakeSettingsApi = (): FakeSettingsApi => {
  const queries: Query[] = [];
  const commands: Command[] = [];
  const replies = new Map<string, unknown>();
  const heldTypes = new Set<string>();
  const heldResolvers = new Map<string, ((reply: unknown) => void)[]>();
  let nextCommandResult: CommandResult = { ok: true };
  return {
    queries,
    commands,
    setReply: (type, reply) => {
      replies.set(type, reply);
    },
    hold: (type) => {
      heldTypes.add(type);
    },
    release: (type, reply) => {
      heldTypes.delete(type);
      for (const resolve of heldResolvers.get(type) ?? []) resolve(reply);
      heldResolvers.set(type, []);
    },
    setCommandResult: (result) => {
      nextCommandResult = result;
    },
    query: (query) => {
      queries.push(query);
      if (heldTypes.has(query.type)) {
        return new Promise((resolve) => {
          const resolvers = heldResolvers.get(query.type) ?? [];
          resolvers.push(resolve);
          heldResolvers.set(query.type, resolvers);
        });
      }
      return Promise.resolve(replies.get(query.type));
    },
    command: (_actor, command) => {
      commands.push(command);
      const result = nextCommandResult;
      nextCommandResult = { ok: true };
      return Promise.resolve(result);
    },
  };
};

interface FakeSignal {
  readonly signal: SettingsChangeSignal;
  emit(change: SettingsChange): void;
}

const fakeSignal = (): FakeSignal => {
  const listeners: ((change: SettingsChange) => void)[] = [];
  return {
    signal: (listener) => {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
  };
};

interface Harness {
  readonly api: FakeSettingsApi;
  readonly emitter: FakeSignal;
  readonly store: ReturnType<typeof createSettingsStore>;
  setLocale(locale: Locale): void;
}

const createHarness = (locale: Locale = 'tr'): Harness => {
  const api = fakeSettingsApi();
  api.setReply('settings.accounts', VIEW);
  const emitter = fakeSignal();
  let active: Locale = locale;
  const store = createSettingsStore({
    api,
    changes: emitter.signal,
    actor: ACTOR,
    locale: () => active,
    timeZone: 'UTC',
  });
  return {
    api,
    emitter,
    store,
    setLocale: (next) => {
      active = next;
    },
  };
};

/** Lets the store's fire-and-forget reloads finish before assertions read the state. */
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('settings store', () => {
  it('U-6: accounts list their pools and meters as rendering data — label, remaining, unit, source badge', async () => {
    const h = createHarness('tr');
    expect(h.store.state()).toEqual({
      loading: false,
      view: null,
      problem: null,
      discovery: { running: false, rows: [], failed: false },
      lastOutcome: null,
      removeWarning: null,
    });

    await h.store.load();

    const state = h.store.state();
    expect(state.loading).toBe(false);
    expect(state.problem).toBeNull();
    expect(state.view?.accounts).toEqual([
      {
        id: 'acc-1',
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'subscription',
        plan: 'pro',
        detail: expect.objectContaining({ id: 'acc-1' }),
        pools: [{ id: 'pool-1', label: 'Weekly allowance', kind: 'allowance', appliesTo: 'all' }],
        meters: [
          {
            id: 'meter-1',
            poolId: 'pool-1',
            label: 'Prompts',
            unit: 'prompts',
            remaining: 60,
            resetsAt: 9_000,
            resetPrecision: 'exact',
            source: 'polled',
          },
          {
            id: 'meter-2',
            poolId: 'pool-1',
            // A meter without its own label renders under its pool's name.
            label: 'Weekly allowance',
            unit: 'usd',
            remaining: null,
            resetsAt: null,
            resetPrecision: 'unknown',
            source: 'pushed',
          },
        ],
      },
      { id: 'acc-2', provider: 'beta-prov', label: 'Spare', authMode: 'api_key', plan: null, detail: expect.objectContaining({ id: 'acc-2' }), pools: [], meters: [] },
      { id: 'acc-3', provider: 'gamma-prov', label: 'Unbound', authMode: 'cloud', plan: null, detail: expect.objectContaining({ id: 'acc-3' }), pools: [], meters: [] },
    ]);
  });

  it('U-6: resetsAt renders in the active locale — switching the locale switches the format', async () => {
    const h = createHarness('tr');
    await h.store.load();

    expect(h.store.resetsAtLabel(9_000)).toBe('1 Oca 1970 00:00');
    expect(h.store.resetsAtLabel(1_758_000_000_000)).toBe('16 Eyl 2025 05:20');
    expect(h.store.resetsAtLabel(null)).toBeNull();

    h.setLocale('en');
    expect(h.store.resetsAtLabel(9_000)).toBe('Jan 1, 1970, 12:00 AM');
    expect(h.store.resetsAtLabel(1_758_000_000_000)).toBe('Sep 16, 2025, 5:20 AM');
    expect(h.store.resetsAtLabel(null)).toBeNull();
  });

  it('U-6: per-role bindings are exposed with their scopes', async () => {
    const h = createHarness('tr');
    await h.store.load();

    expect(h.store.state().view?.bindings).toEqual([
      { scope: { level: 'global' }, role: 'worker', thinking: null, tier: null, accounts: [{ accountId: 'acc-1', model: 'atlas-max' }] },
      {
        scope: { level: 'repo', repo: 'atolye' },
        role: 'reviewer',
        thinking: null,
        tier: null,
        accounts: [
          { accountId: 'acc-2', model: null },
          { accountId: 'acc-1', model: null },
        ],
      },
      {
        scope: { level: 'workOrder', workOrderId: 'wo-1' },
        role: 'worker',
        thinking: null,
        tier: null,
        accounts: [{ accountId: 'acc-2', model: null }],
      },
    ]);
  });

  it('U-6: discovery lists every reported provider — a failed provider arrives as its null-fields row, never a query failure', async () => {
    const h = createHarness('tr');
    h.api.hold('providers.discovered');
    const pass = h.store.discover();
    expect(h.store.state().discovery.running).toBe(true);

    h.api.release('providers.discovered', [ALPHA_ROW, BROKEN_ROW]);
    await pass;

    const discovery = h.store.state().discovery;
    expect(discovery.running).toBe(false);
    expect(discovery.failed).toBe(false);
    expect(discovery.rows).toEqual([ALPHA_ROW, BROKEN_ROW]);
    expect(h.store.state().problem).toBeNull();
  });

  it('U-6: a hanging discovery pass delays only the refresh — prior rows stay listed while it runs', async () => {
    const h = createHarness('tr');
    h.api.hold('providers.discovered');
    const first = h.store.discover();
    h.api.release('providers.discovered', [ALPHA_ROW]);
    await first;
    expect(h.store.state().discovery.rows).toEqual([ALPHA_ROW]);

    // The next pass hangs: the earlier rows must stay on screen, never blank out.
    h.api.hold('providers.discovered');
    const second = h.store.discover();
    expect(h.store.state().discovery.running).toBe(true);
    expect(h.store.state().discovery.rows).toEqual([ALPHA_ROW]);

    h.api.release('providers.discovered', [ALPHA_ROW, BROKEN_ROW]);
    await second;
    const discovery = h.store.state().discovery;
    expect(discovery.running).toBe(false);
    expect(discovery.rows).toEqual([ALPHA_ROW, BROKEN_ROW]);
  });

  it('U-6: a failed discovery pass keeps the prior rows and surfaces the failure', async () => {
    const h = createHarness('tr');
    h.api.hold('providers.discovered');
    const first = h.store.discover();
    h.api.release('providers.discovered', [ALPHA_ROW]);
    await first;

    h.api.setReply('providers.discovered', { ok: false, code: 'not_found' });
    await h.store.discover();

    const discovery = h.store.state().discovery;
    expect(discovery.running).toBe(false);
    expect(discovery.failed).toBe(true);
    expect(discovery.rows).toEqual([ALPHA_ROW]);
  });

  it('U-6: removing an account a binding still references warns with the referencing roles before any command is issued', async () => {
    const h = createHarness('tr');
    await h.store.load();

    const outcome = await h.store.removeAccount('acc-1');

    // The warning surfaces first: no command travels until the user confirms.
    expect(h.api.commands).toEqual([]);
    expect(outcome).toEqual({
      command: 'account.remove',
      result: { ok: false, code: 'binding_exists', roles: ['worker', 'reviewer'] },
      labelKey: 'error.binding_exists',
    });
    expect(h.store.state().removeWarning).toEqual({ accountId: 'acc-1', roles: ['worker', 'reviewer'] });
  });

  it('U-6: explicit confirmation issues account.remove once, maps through U-8 and refreshes the view', async () => {
    const h = createHarness('tr');
    await h.store.load();
    await h.store.removeAccount('acc-1');
    expect(h.api.queries.filter((q) => q.type === 'settings.accounts').length).toBe(1);

    const outcome = await h.store.confirmRemoveAccount('acc-1');

    expect(h.api.commands).toEqual([{ type: 'account.remove', id: 'acc-1' }]);
    expect(outcome).toEqual({
      command: 'account.remove',
      result: { ok: true },
      labelKey: 'success.account.remove',
    });
    expect(h.store.state().removeWarning).toBeNull();
    // The store mirrors its own mutation: the accounts view is re-queried.
    expect(h.api.queries.filter((q) => q.type === 'settings.accounts').length).toBe(2);
  });

  it('U-6: removing an unbound account issues account.remove directly, without a warning', async () => {
    const h = createHarness('tr');
    await h.store.load();

    const outcome = await h.store.removeAccount('acc-3');

    expect(h.api.commands).toEqual([{ type: 'account.remove', id: 'acc-3' }]);
    expect(outcome.labelKey).toBe('success.account.remove');
    expect(h.store.state().removeWarning).toBeNull();
  });

  it('U-6: save intents issue account.save and binding.save and map through U-8 — success and failure', async () => {
    const h = createHarness('tr');
    await h.store.load();

    const saved = await h.store.saveAccount({
      provider: 'acme-prov',
      label: 'Main',
      authMode: 'subscription',
      plan: 'pro',
    });
    expect(h.api.commands[0]).toEqual({
      type: 'account.save',
      provider: 'acme-prov',
      label: 'Main',
      authMode: 'subscription',
      plan: 'pro',
    });
    expect(saved.labelKey).toBe('success.account.save');

    const bound = await h.store.saveBinding({
      role: 'worker',
      accounts: [{ accountId: 'acc-1', model: 'atlas-max' }],
    });
    expect(h.api.commands[1]).toEqual({
      type: 'binding.save',
      role: 'worker',
      accounts: [{ accountId: 'acc-1', model: 'atlas-max' }],
    });
    expect(bound.labelKey).toBe('success.binding.save');
    // Both intents refreshed the accounts view after issuing.
    expect(h.api.queries.filter((q) => q.type === 'settings.accounts').length).toBe(3);

    h.api.setCommandResult({ ok: false, code: 'invalid_id' });
    const failed = await h.store.saveAccount({
      provider: 'acme-prov',
      label: 'Main',
      authMode: 'subscription',
    });
    expect(failed.labelKey).toBe('error.invalid_id');
    expect(h.store.state().lastOutcome?.labelKey).toBe('error.invalid_id');
  });

  it('U-6: change events re-query the accounts view but never re-kick a discovery pass', async () => {
    const h = createHarness('tr');
    await h.store.load();
    h.api.hold('providers.discovered');
    const pass = h.store.discover();
    h.api.release('providers.discovered', [ALPHA_ROW]);
    await pass;
    const accountsQueries = (): number => h.api.queries.filter((q) => q.type === 'settings.accounts').length;
    const discoveryQueries = (): number => h.api.queries.filter((q) => q.type === 'providers.discovered').length;
    expect(accountsQueries()).toBe(1);
    expect(discoveryQueries()).toBe(1);

    h.emitter.emit({ type: 'workOrders.changed' });
    h.emitter.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();

    // Meters move with runs and accounts with commands, so both events refresh the view — but a
    // discovery pass spawns probes, so change events never pay for one.
    expect(accountsQueries()).toBe(3);
    expect(discoveryQueries()).toBe(1);
  });
});
