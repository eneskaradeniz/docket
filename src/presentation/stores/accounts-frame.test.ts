// accounts-frame.test.ts — U-16 + U-51: the sidebar's accounts frame. The store mirrors the
// `settings.accounts` query into equal cards — every limit as a row, the tightest one driving the
// card's single bar (U-51) — keeps the frame's disclosure state, and serves the refresh intent
// that re-polls usage. Api and the change signal are injected fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Query, SettingsAccountView, SettingsAccountsView, SettingsMeterView } from '../../api/queries';
import {
  accountCards,
  createAccountsFrameStore,
  remainingTone,
  tightestOf,
  unaddedRow,
  unaddedRowTarget,
} from './accounts-frame';
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
  test: null,
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
  billing: 'unknown',
  plan: null,
  ...ACCOUNT_SETTINGS,
  pools: [{ id: `pool-${id}`, label, kind: 'allowance', appliesTo: 'all' }],
  meters,
});

const view = (accounts: readonly SettingsAccountView[]): SettingsAccountsView => ({ accounts, bindings: [] });

const frameView = (): SettingsAccountsView =>
  view([
    account('acc-1', 'Claude Max', [
      meter('m-1', 'pool-acc-1', { label: '5 saatlik pencere', cadence: 'rolling_from_first_use', used: 41, limit: 100, remaining: 59 }),
      meter('m-2', 'pool-acc-1', { label: 'Haftalık pencere', cadence: 'fixed', used: 12, limit: 100, remaining: 88 }),
    ]),
    account('acc-2', 'z.ai GLM', [
      meter('m-3', 'pool-acc-2', { label: 'Aylık pencere', cadence: 'billing_cycle', unit: 'usd', used: 12.4, limit: 50, remaining: 37.6 }),
    ]),
    account('acc-3', 'Codex Pro', [
      meter('m-4', 'pool-acc-3', { label: '5 saatlik pencere', cadence: 'rolling_from_first_use', used: 88, limit: 100, remaining: 12 }),
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
  it('U-51: one equal card per account, every limit a row and the tightest one marked', async () => {
    const api = fakeFrameApi(frameView());
    const store = createAccountsFrameStore({ api, changes: fakeSignal().signal });

    expect(store.state().cards).toBeNull();
    await store.load();
    expect(api.queries).toEqual([{ type: 'settings.accounts' }]);

    const cards = store.state().cards;
    expect(cards?.map((card) => card.label)).toEqual(['Claude Max', 'z.ai GLM', 'Codex Pro']);
    // The card carries its provider through — the badge resolves the mark from it.
    expect(cards?.map((card) => card.provider)).toEqual(['opencode', 'opencode', 'opencode']);
    // Every limit stays a row: the meter's own label first, the pool's label when it has none.
    expect(cards?.[0]?.limits.map((limit) => ('key' in limit.name ? limit.name.key : limit.name.text))).toEqual([
      '5 saatlik pencere',
      'Haftalık pencere',
    ]);
    expect(cards?.[0]?.limits.map((limit) => limit.remaining)).toEqual([0.59, 0.88]);
    // The tightest limit is the one with the least remaining — the card's one bar.
    expect(cards?.[0]?.tightest?.id).toBe('m-1');
    // A counted unit carries its fraction; a money meter normalizes to its remaining share.
    expect(cards?.[1]?.limits[0]?.remaining).toBeCloseTo(0.752);
  });

  it('U-51: the tightest limit is the least remaining among the readable ones, null without any', () => {
    const limits = [
      { id: 'a', name: { text: 'A' }, remaining: 0.9, fraction: null, resetsAt: null },
      { id: 'b', name: { text: 'B' }, remaining: 0.2, fraction: null, resetsAt: null },
      { id: 'c', name: { text: 'C' }, remaining: 0.5, fraction: null, resetsAt: null },
    ];
    expect(tightestOf(limits)?.id).toBe('b');
    // A tie keeps the first — the order the api reported.
    expect(tightestOf([
      { id: 'x', name: { text: 'X' }, remaining: 0.3, fraction: null, resetsAt: null },
      { id: 'y', name: { text: 'Y' }, remaining: 0.3, fraction: null, resetsAt: null },
    ])?.id).toBe('x');
    // Unreadable limits never win, and no readable limit leaves the card without a bar.
    expect(tightestOf([
      { id: 'n', name: { text: 'N' }, remaining: null, fraction: null, resetsAt: null },
      { id: 'm', name: { text: 'M' }, remaining: 0.4, fraction: null, resetsAt: null },
    ])?.id).toBe('m');
    expect(tightestOf([
      { id: 'n', name: { text: 'N' }, remaining: null, fraction: null, resetsAt: null },
    ])).toBeNull();
    expect(tightestOf([])).toBeNull();
  });

  it('U-51: the tone follows what remains — 40 % or more proceed, 15–40 amber, under 15 red', () => {
    expect(remainingTone(1)).toBe('proceed');
    expect(remainingTone(0.4)).toBe('proceed');
    expect(remainingTone(0.399)).toBe('warn');
    expect(remainingTone(0.15)).toBe('warn');
    expect(remainingTone(0.149)).toBe('error');
    expect(remainingTone(0)).toBe('error');
  });

  it('U-51: a counted limit carries its used / limit fraction, money and shares do not', () => {
    const cards = accountCards(
      view([
        account('acc-1', 'Sayılı', [
          meter('m-1', 'pool-acc-1', { label: 'İstek', unit: 'requests', used: 120, limit: 300, remaining: 180 }),
        ]),
        account('acc-2', 'Paralı', [
          meter('m-2', 'pool-acc-2', { label: 'Bütçe', unit: 'usd', used: 12.4, limit: 50, remaining: 37.6 }),
        ]),
      ]),
    );
    expect(cards[0]?.limits[0]?.fraction).toBe('120 / 300');
    expect(cards[1]?.limits[0]?.fraction).toBeNull();
  });

  it('U-51: an account without limit readings carries no tightest limit', () => {
    const cards = accountCards(view([account('acc-n', 'Sessiz', [meter('m-n', 'pool-acc-n', { used: null, limit: null, remaining: null })])]));
    expect(cards[0]?.limits).toHaveLength(1);
    expect(cards[0]?.tightest).toBeNull();
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
