// accounts-frame.test.ts — U-16: the sidebar's accounts frame. The store mirrors the
// `settings.accounts` query into compact cards (one mini bar per window, spend meta where the
// account carries it), keeps the frame's disclosure state, and serves the refresh intent that
// re-polls usage. Api and the change signal are injected fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Query, SettingsAccountView, SettingsAccountsView, SettingsMeterView } from '../../api/queries';
import { WARN_PERCENT, accountCards, createAccountsFrameStore, unaddedRow, unaddedRowTarget, windowKind } from './accounts-frame';
import { CLOSED_SETTINGS_PANEL, settingsPanelReducer } from './settings-panel';
import type { ShellChange, ShellChangeSignal } from './shell';

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

const meter = (id: string, poolId: string, overrides: Partial<SettingsMeterView> = {}): SettingsMeterView => ({
  id,
  poolId,
  label: null,
  cadence: 'billing_cycle',
  durationMs: null,
  unit: 'percent',
  used: 0,
  limit: 100,
  remaining: 100,
  resetsAt: null,
  resetPrecision: 'exact',
  observedAt: 0,
  source: 'polled',
  staleAfterMs: null,
  reserveClass: 'long',
  reserveShare: 0,
  ...overrides,
});

const account = (id: string, label: string, meters: readonly SettingsMeterView[]): SettingsAccountView => ({
  id,
  provider: 'opencode',
  label,
  authMode: 'api_key',
  plan: null,
  ...ACCOUNT_SETTINGS,
  pools: [{ id: `pool-${id}`, label, kind: 'allowance', appliesTo: 'all' }],
  meters,
});

const view = (accounts: readonly SettingsAccountView[]): SettingsAccountsView => ({ accounts, bindings: [] });

const frameView = (): SettingsAccountsView =>
  view([
    account('acc-1', 'Claude Max', [
      meter('m-1', 'pool-acc-1', { label: '5 saatlik pencere', cadence: 'rolling_from_first_use', used: 41, limit: 100 }),
      meter('m-2', 'pool-acc-1', { label: 'Haftalık pencere', cadence: 'fixed', used: 12, limit: 100 }),
    ]),
    account('acc-2', 'z.ai GLM', [
      meter('m-3', 'pool-acc-2', { label: 'Aylık pencere', cadence: 'billing_cycle', unit: 'usd', used: 12.4, limit: 50 }),
    ]),
    account('acc-3', 'Codex Pro', [
      meter('m-4', 'pool-acc-3', { label: '5 saatlik pencere', cadence: 'rolling_from_first_use', used: 88, limit: 100 }),
    ]),
  ]);

interface FakeFrameApi extends Pick<Api, 'query'> {
  readonly queries: Query[];
  setReply(reply: unknown): void;
  /** Holds the next query's reply until released, so a refresh can be observed in flight. */
  gate(): { release(): void };
}

const fakeFrameApi = (initial: unknown): FakeFrameApi => {
  const queries: Query[] = [];
  let reply: unknown = initial;
  let blocking = false;
  let waiters: (() => void)[] = [];
  return {
    queries,
    setReply: (next) => {
      reply = next;
    },
    gate: () => ({
      release: () => {
        blocking = false;
        for (const wake of waiters) wake();
        waiters = [];
      },
    }),
    query: (query) => {
      queries.push(query);
      if (!blocking) return Promise.resolve(reply);
      return new Promise((resolve) => {
        waiters.push(() => resolve(reply));
      });
    },
  };
};

interface FakeSignal {
  readonly signal: ShellChangeSignal;
  emit(change: ShellChange): void;
}

const fakeSignal = (): FakeSignal => {
  const listeners: ((change: ShellChange) => void)[] = [];
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

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('accounts frame store', () => {
  it('U-16: the frame lists the accounts view as cards with one bar per window', async () => {
    const api = fakeFrameApi(frameView());
    const store = createAccountsFrameStore({ api, changes: fakeSignal().signal });

    expect(store.state().cards).toBeNull();
    await store.load();
    expect(api.queries).toEqual([{ type: 'settings.accounts' }]);

    const cards = store.state().cards;
    expect(cards?.map((card) => card.label)).toEqual(['Claude Max', 'z.ai GLM', 'Codex Pro']);
    // The card carries its provider through — the badge resolves the mark from it.
    expect(cards?.map((card) => card.provider)).toEqual(['opencode', 'opencode', 'opencode']);
    expect(cards?.[0]?.windows.map((window) => [window.kind, window.percent])).toEqual([
      ['five_hour', 41],
      ['week', 12],
    ]);
    // The money window normalizes to a whole percent: 12,40 $ of 50 $ is 25.
    expect(cards?.[1]?.windows.map((window) => [window.kind, window.percent])).toEqual([['month', 25]]);
    expect(cards?.[1]?.spend).toEqual({ used: 12.4, cap: 50 });
    // An account without a money window carries no spend meta.
    expect(cards?.[0]?.spend).toBeNull();
    expect(cards?.[2]?.spend).toBeNull();
  });

  it('U-16: a bar at or above the warn percent renders warn, below it stays quiet', () => {
    expect(WARN_PERCENT).toBe(80);
    const cards = accountCards(
      view([
        account('acc-1', 'Edge', [
          meter('m-1', 'p', { used: WARN_PERCENT - 1, limit: 100 }),
          meter('m-2', 'p', { used: WARN_PERCENT, limit: 100 }),
          meter('m-3', 'p', { used: 140, limit: 100 }),
          meter('m-4', 'p', { used: null, limit: null }),
        ]),
      ]),
    );
    const windows = cards[0]?.windows ?? [];
    expect(windows.map((window) => [window.percent, window.warn])).toEqual([
      [79, false],
      [80, true],
      [100, true], // a window past its limit clamps to the full bar
      [0, false], // a meter without readings renders an empty bar, never a guess
    ]);
  });

  it('U-16: the frame starts collapsed and toggles open and back', async () => {
    const store = createAccountsFrameStore({ api: fakeFrameApi(frameView()), changes: fakeSignal().signal });
    expect(store.state().open).toBe(false);

    store.toggle();
    expect(store.state().open).toBe(true);
    store.toggle();
    expect(store.state().open).toBe(false);
  });

  it('U-16: the refresh intent leaves the collapsed state alone', async () => {
    const api = fakeFrameApi(frameView());
    const store = createAccountsFrameStore({ api, changes: fakeSignal().signal });
    expect(store.state().open).toBe(false);

    const gate = api.gate();
    const pending = store.refresh();
    expect(store.state().refreshing).toBe(true);
    expect(store.state().open).toBe(false);
    gate.release();
    await pending;
    expect(store.state().refreshing).toBe(false);
    expect(store.state().open).toBe(false);

    store.toggle();
    expect(store.state().open).toBe(true);
  });

  it('U-16: the refresh intent re-queries and the spin ends when the reply lands', async () => {
    const api = fakeFrameApi(frameView());
    const store = createAccountsFrameStore({ api, changes: fakeSignal().signal });
    await store.load();

    const gate = api.gate();
    const pending = store.refresh();
    expect(store.state().refreshing).toBe(true);
    gate.release();
    await pending;
    expect(store.state().refreshing).toBe(false);
    expect(api.queries).toEqual([{ type: 'settings.accounts' }, { type: 'settings.accounts' }]);
    expect(store.state().cards).toHaveLength(3);
  });

  it('U-16: a failed refresh keeps the cards on screen and still ends the spin', async () => {
    const api = fakeFrameApi(frameView());
    const store = createAccountsFrameStore({ api, changes: fakeSignal().signal });
    await store.load();

    api.setReply({ ok: false, code: 'stale' });
    await store.refresh();
    expect(store.state().refreshing).toBe(false);
    expect(store.state().cards).toHaveLength(3);
    expect(store.state().problem).toBe('stale');
  });

  it('U-16: the cards follow the accounts view on the shell change events', async () => {
    const api = fakeFrameApi(frameView());
    const emitter = fakeSignal();
    const store = createAccountsFrameStore({ api, changes: emitter.signal });
    await store.load();

    api.setReply(view([account('acc-9', 'Yeni Hesap', [meter('m-9', 'p')])]));
    emitter.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();
    expect(store.state().cards?.map((card) => card.label)).toEqual(['Yeni Hesap']);

    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.length).toBe(3);
  });
});

describe('window kinds', () => {
  it('U-16: a meter cadence maps to its window kind, and an unknown cadence maps to none', () => {
    expect(windowKind('rolling_from_first_use')).toBe('five_hour');
    expect(windowKind('fixed')).toBe('week');
    expect(windowKind('billing_cycle')).toBe('month');
    expect(windowKind('rolling_continuous')).toBeNull();
    expect(windowKind('calendar')).toBeNull();
    expect(windowKind('none')).toBeNull();
  });
});

describe('U-37: the frame links into Settings', () => {
  const reserved = (meters: readonly SettingsMeterView[]) =>
    accountCards(view([account('acc-r', 'R', meters)]))[0]?.reserved;

  it('U-37: a card reads rezervde when a share meter has remaining at or below its reserveShare (> 0)', () => {
    expect(reserved([meter('m', 'p', { remaining: 15, reserveShare: 0.2 })])).toBe(true);
    expect(reserved([meter('m', 'p', { remaining: 20, reserveShare: 0.2 })])).toBe(true);
    expect(reserved([meter('m', 'p', { remaining: 21, reserveShare: 0.2 })])).toBe(false);
    expect(
      reserved([meter('a', 'p', { remaining: 90, reserveShare: 0.2 }), meter('b', 'p', { remaining: 5, reserveShare: 0.1 })]),
    ).toBe(true);
  });

  it('U-37: no reserve (share 0) and a unit that is not a share never read rezervde', () => {
    expect(reserved([meter('m', 'p', { remaining: 0, reserveShare: 0 })])).toBe(false);
    expect(reserved([meter('m', 'p', { unit: 'usd', used: 49, limit: 50, remaining: 1, reserveShare: 0.2 })])).toBe(false);
  });

  it('U-37: a card carries the account reserve the account view band reads', () => {
    const [card] = accountCards(view([{ ...account('acc-x', 'X', []), reserve: { short: 0.1, long: 0.2 } }]));
    expect(card?.reserve).toStrictEqual({ short: 0.1, long: 0.2 });
  });

  it('U-37: the trailing row is absent at zero and names the count otherwise, with its Gör action', () => {
    expect(unaddedRow('tr', 0)).toBeNull();
    expect(unaddedRow('tr', 2)).toStrictEqual({ text: '2 hesap eklenmedi', action: 'Gör ›' });
    expect(unaddedRow('en', 1)?.text).toBe('1 account not added');
  });

  it('U-37: the row opens Settings on Hesaplar, on the list', () => {
    const state = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer', ...unaddedRowTarget() });
    expect(state).toMatchObject({ open: true, section: 'accounts', subPage: null });
  });
});
