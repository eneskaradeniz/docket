// account-view.test.ts — U-20: the account view store mirrors `account.detail` — one window
// block per window with the normalized used percent and its warn standing, the active-work rows
// in the query's order, and the limit-policy band's label — and never blanks the view: a failed
// query keeps the previous one and surfaces the problem. The policy is read-only here; editing
// stays in the Settings window. Api and change signal are injected fakes.
import { describe, expect, it } from 'vitest';

import { CLOSED_SETTINGS_PANEL, settingsPanelReducer } from './settings-panel';
import type { Api } from '../../api/api';
import type { AccountDetailView, Query } from '../../api/queries';
import { resetLine } from './reset-line';
import { createAccountViewStore, editInSettingsTarget, limitBand, policyKey, windowBars, type AccountViewChange, type AccountViewChangeSignal } from './account-view';

const detailView: AccountDetailView = {
  account: { id: 'acc-1', provider: 'claude-code', label: 'Claude Max', authMode: 'subscription', plan: 'Max', limitPolicy: 'wait_resume' },
  windows: [
    { label: '5 saatlik pencere', unit: 'percent', used: 41, limit: 100, remaining: 59, resetsAt: 1_000, resetPrecision: 'exact', source: 'polled' },
    { label: 'Haftalık pencere', unit: 'percent', used: 91, limit: 100, remaining: 9, resetsAt: 2_000, resetPrecision: 'exact', source: 'polled' },
  ],
  activeWork: [
    { workOrderId: 'wo-1', number: 1, title: 'Stok uyarısı', stage: 'test', status: 'running' },
    { workOrderId: 'wo-2', number: 2, title: 'Mobil login', stage: null, status: 'ready' },
  ],
};

interface FakeApi extends Pick<Api, 'query'> {
  readonly queries: Query[];
  setReply(reply: unknown): void;
}

const fakeApi = (initial: unknown): FakeApi => {
  const queries: Query[] = [];
  let reply: unknown = initial;
  return {
    queries,
    setReply: (next) => {
      reply = next;
    },
    query: (query) => {
      queries.push(query);
      return Promise.resolve(reply);
    },
  };
};

interface FakeSignal {
  readonly signal: AccountViewChangeSignal;
  emit(change: AccountViewChange): void;
}

const fakeSignal = (): FakeSignal => {
  const listeners: ((change: AccountViewChange) => void)[] = [];
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

const flush = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

describe('account view store (U-20)', () => {
  it('U-20: the store mirrors account.detail and derives one bar per window', async () => {
    const api = fakeApi(detailView);
    const store = createAccountViewStore({ api, changes: fakeSignal().signal, now: () => 0 });
    expect(store.state()).toEqual({ loading: false, view: null, problem: null });

    await store.load('acc-1');

    expect(api.queries).toEqual([{ type: 'account.detail', id: 'acc-1' }]);
    const state = store.state();
    expect(state.loading).toBe(false);
    expect(state.problem).toBeNull();
    expect(state.view).toEqual(detailView);
    expect(state.view?.activeWork.map((row) => row.workOrderId)).toEqual(['wo-1', 'wo-2']);
  });

  it('U-20: a failed query keeps the previous view and surfaces the problem', async () => {
    const api = fakeApi(detailView);
    const store = createAccountViewStore({ api, changes: fakeSignal().signal, now: () => 0 });
    await store.load('acc-1');

    api.setReply({ ok: false, code: 'not_found' });
    await store.load('acc-1');

    const state = store.state();
    expect(state.problem).toBe('not_found');
    expect(state.view).toEqual(detailView);
    expect(state.loading).toBe(false);
  });

  it('U-20: change events re-query the loaded account', async () => {
    const api = fakeApi(detailView);
    const emitter = fakeSignal();
    const store = createAccountViewStore({ api, changes: emitter.signal, now: () => 0 });

    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.length).toBe(0);

    await store.load('acc-1');
    emitter.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();
    expect(api.queries).toEqual([{ type: 'account.detail', id: 'acc-1' }, { type: 'account.detail', id: 'acc-1' }]);
  });
});

describe('window bars (U-20)', () => {
  it('U-20: the bar carries the normalized percent, the warn standing and the reset', () => {
    expect(windowBars(detailView)).toEqual([
      { label: '5 saatlik pencere', percent: 41, warn: false, resetsAt: 1_000 },
      { label: 'Haftalık pencere', percent: 91, warn: true, resetsAt: 2_000 },
    ]);
  });

  it('U-20: a window without readings renders an empty bar, never a guess', () => {
    const bare: AccountDetailView = {
      ...detailView,
      windows: [{ unit: 'percent', resetPrecision: 'exact', source: 'polled' }],
    };
    expect(windowBars(bare)).toEqual([{ label: null, percent: 0, warn: false, resetsAt: null }]);
  });

  it('U-20: the percent clamps to the bar — over-limit never overflows the track', () => {
    const over: AccountDetailView = {
      ...detailView,
      windows: [{ label: 'Aylık pencere', unit: 'usd', used: 9, limit: 10, resetsAt: 3_000, resetPrecision: 'exact', source: 'polled' }],
    };
    expect(windowBars(over)).toEqual([{ label: 'Aylık pencere', percent: 90, warn: true, resetsAt: 3_000 }]);
  });

  it('U-20: the time until reset reads from resetsAt through the injected clock', async () => {
    const api = fakeApi(detailView);
    let now = 500;
    const store = createAccountViewStore({ api, changes: fakeSignal().signal, now: () => now });
    await store.load('acc-1');

    expect(store.remainingMs(1_000)).toBe(500);
    now = 2_000;
    expect(store.remainingMs(1_000)).toBe(0);
  });
});

describe('reset line (U-20)', () => {
  it('U-20: the window reset line is the shared reset line, read through the injected clock', async () => {
    const api = fakeApi(detailView);
    const store = createAccountViewStore({ api, changes: fakeSignal().signal, now: () => 500 });
    await store.load('acc-1');
    expect(store.resetLine('tr', 'UTC', 1_000)).toBe(resetLine('tr', 'UTC', 1_000, 500));
    expect(store.resetLine('en', 'UTC', 1_000)).toBe(resetLine('en', 'UTC', 1_000, 500));
  });
});

describe('policy band (U-20)', () => {
  it('U-20: every policy of the closed set carries its own label key', () => {
    expect(policyKey('wait_resume')).toBe('account.policy.wait_resume');
    expect(policyKey('switch_pool')).toBe('account.policy.switch_pool');
    expect(policyKey('fallback_account')).toBe('account.policy.fallback_account');
    expect(policyKey('ask')).toBe('account.policy.ask');
    expect(policyKey('baska-bir-sey')).toBe('account.policy.wait_resume');
  });
});

describe('U-37: the account view links into Settings', () => {
  it('U-37: the limit band is one sentence — policy plus reserve (Yok, one share, or kısa · uzun)', () => {
    expect(limitBand('tr', 'wait_resume', { short: null, long: null })).toBe('Limit dolunca: Sıfırlanınca sürdür · Rezerv: Yok');
    expect(limitBand('tr', 'wait_resume', { short: 0, long: 0 })).toContain('Rezerv: Yok');
    expect(limitBand('tr', 'ask', { short: 0.1, long: 0.1 })).toBe('Limit dolunca: Bana sor · Rezerv: %10');
    expect(limitBand('tr', 'switch_pool', { short: 0.1, long: 0.25 })).toBe(
      'Limit dolunca: Başka havuza geç · Rezerv: kısa %10 · uzun %25',
    );
    expect(limitBand('en', 'wait_resume', { short: 0.1, long: 0.25 })).toBe(
      'When the limit is full: Resume on reset · Reserve: short 10% · long 25%',
    );
  });

  it('U-37: a band whose reserve is unknown still reads as one sentence (Yok)', () => {
    expect(limitBand('tr', 'wait_resume', null)).toBe('Limit dolunca: Sıfırlanınca sürdür · Rezerv: Yok');
  });

  it("U-37: Ayarlar'da düzenle opens Settings on that account's sub-page, Limitler tab", () => {
    const state = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer', ...editInSettingsTarget('acc-1') });
    expect(state).toMatchObject({ open: true, section: 'accounts', subPage: 'acc-1', tab: 'limits' });
  });
});
