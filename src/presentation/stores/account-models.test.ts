// account-models.test.ts — P-40's row view model (docs/v2/provider-capabilities.md § 14): the
// model list the settings panel shows per account — the billing mark (never an amount or a price
// claim for `unknown`), the stale note, the consent standing, and the inline consent draft whose
// allow action stays disabled until the entered cap parses. Api and change signal are fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command } from '../../api/commands';
import type { AccountModelsView, Query } from '../../api/queries';
import {
  billingMark,
  CAP_SCOPES,
  CAP_WARN_PERCENT,
  createAccountModelsStore,
  modelRows,
  parseAmountUsd,
  type AccountModelsChange,
  type AccountModelsChangeSignal,
} from './account-models';


const modelsView: AccountModelsView = {
  models: [
    { id: 'atlas-max', displayName: 'Atlas Max', tier: 'strong', thinking: { kind: 'levels', levels: ['low'] }, billing: 'included', source: 'live', stale: false, autoClassified: false, consented: false },
    { id: 'atlas-fog', tier: 'balanced', thinking: { kind: 'unknown' }, billing: 'unknown', source: 'bundled', stale: true, autoClassified: true, consented: true },
    { id: 'atlas-mini', thinking: { kind: 'none' }, billing: 'metered', source: 'live', stale: false, autoClassified: false, consented: false },
    { id: 'atlas-bare', thinking: { kind: 'none' }, billing: 'metered', source: 'live', stale: false, autoClassified: false, consented: false },
  ],
  defaultConsented: false,
  defaultBilling: 'unknown',
};

interface FakeApi extends Pick<Api, 'query' | 'command'> {
  readonly queries: Query[];
  readonly commands: readonly Command[];
  setReply(reply: unknown): void;
  setCommandResult(result: 'ok' | { readonly code: string }): void;
}

const fakeApi = (initial: unknown): FakeApi => {
  const queries: Query[] = [];
  const commands: Command[] = [];
  let reply: unknown = initial;
  let commandResult: 'ok' | { readonly code: string } = 'ok';
  return {
    queries,
    commands,
    setReply: (next) => {
      reply = next;
    },
    setCommandResult: (next) => {
      commandResult = next;
    },
    query: (query) => {
      queries.push(query);
      return Promise.resolve(reply);
    },
    command: (_actor, command) => {
      commands.push(command);
      return Promise.resolve(commandResult === 'ok' ? ({ ok: true } as const) : ({ ok: false, code: commandResult.code } as const));
    },
  };
};

interface FakeSignal {
  readonly signal: AccountModelsChangeSignal;
  emit(change: AccountModelsChange): void;
}

const fakeSignal = (): FakeSignal => {
  const listeners: ((change: AccountModelsChange) => void)[] = [];
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

describe('billing marks (P-40)', () => {
  it('P-40: included shows no mark, metered a currency mark, unknown a question mark — never an amount', () => {
    expect(billingMark('included')).toBe('none');
    expect(billingMark('metered')).toBe('currency');
    expect(billingMark('unknown')).toBe('question');
  });

  it('P-40: a row carries the display name (the id when the list has none), its tier chip and its consent standing', () => {
    expect(modelRows(modelsView)).toEqual([
      { id: 'atlas-max', name: 'Atlas Max', tier: 'strong', billing: 'included', mark: 'none', stale: false, consented: false },
      { id: 'atlas-fog', name: 'atlas-fog', tier: 'balanced', billing: 'unknown', mark: 'question', stale: true, consented: true },
      { id: 'atlas-mini', name: 'atlas-mini', tier: null, billing: 'metered', mark: 'currency', stale: false, consented: false },
      { id: 'atlas-bare', name: 'atlas-bare', tier: null, billing: 'metered', mark: 'currency', stale: false, consented: false },
    ]);
  });
});

describe('cap input (P-40)', () => {
  it('P-40: an amount parses only as a finite number above zero — the allow action needs a cap', () => {
    expect(parseAmountUsd('5')).toBe(5);
    expect(parseAmountUsd(' 12.50 ')).toBe(12.5);
    // The Turkish bundle types its decimal comma; the parse must not refuse it.
    expect(parseAmountUsd('7,50')).toBe(7.5);
    expect(parseAmountUsd('')).toBeNull();
    expect(parseAmountUsd('0')).toBeNull();
    expect(parseAmountUsd('-3')).toBeNull();
    expect(parseAmountUsd('abc')).toBeNull();
  });

  it('P-40: the cap scope is a day, week or month of the account', () => {
    expect(CAP_SCOPES).toEqual(['account_day', 'account_week', 'account_month']);
    // The warn percent rides the domain's documented default; the form asks for scope and amount only.
    expect(CAP_WARN_PERCENT).toBe(80);
  });
});

describe('account models store (P-40)', () => {
  it('P-40: load mirrors account.models — rows, the stale note when any row is stale, and the unpinned default line', async () => {
    const api = fakeApi(modelsView);
    const store = createAccountModelsStore({ api, changes: fakeSignal().signal, actor: { kind: 'user', id: 'u', label: 'U' } });
    expect(store.state()).toEqual({
      accountId: null,
      loading: false,
      refreshing: false,
      rows: null,
      defaultModel: null,
      stale: false,
      problem: null,
      draft: null,
      lastOutcome: null,
    });

    await store.load('acc-1');

    expect(api.queries).toEqual([{ type: 'account.models', accountId: 'acc-1' }]);
    const state = store.state();
    expect(state.loading).toBe(false);
    expect(state.problem).toBeNull();
    expect(state.rows?.map((row) => row.id)).toEqual(['atlas-max', 'atlas-fog', 'atlas-mini', 'atlas-bare']);
    expect(state.stale).toBe(true);
    expect(state.defaultModel).toEqual({ billing: 'unknown', mark: 'question', consented: false });
  });

  it('P-40: the stale list refreshes through account.models with refresh: true, keeping the rows while it runs', async () => {
    const api = fakeApi(modelsView);
    const store = createAccountModelsStore({ api, changes: fakeSignal().signal, actor: { kind: 'user', id: 'u', label: 'U' } });
    await store.load('acc-1');

    api.setReply({ ...modelsView, models: modelsView.models.map((model) => ({ ...model, stale: false })) });
    const refreshing = store.refresh();
    expect(store.state().refreshing).toBe(true);
    expect(store.state().rows?.length).toBe(4);
    await refreshing;

    expect(api.queries).toEqual([
      { type: 'account.models', accountId: 'acc-1' },
      { type: 'account.models', accountId: 'acc-1', refresh: true },
    ]);
    expect(store.state().refreshing).toBe(false);
    expect(store.state().stale).toBe(false);
  });

  it('P-40: a failed re-query of the same account keeps its rows and surfaces the problem; another account never shows them', async () => {
    const api = fakeApi(modelsView);
    const store = createAccountModelsStore({ api, changes: fakeSignal().signal, actor: { kind: 'user', id: 'u', label: 'U' } });
    await store.load('acc-1');

    api.setReply({ ok: false, code: 'not_found' });
    await store.load('acc-1');
    expect(store.state().problem).toBe('not_found');
    expect(store.state().rows?.length).toBe(4);

    // Another account's load clears the rows up front — acc-1's models never show under acc-2's
    // card, not even while the reply is in flight.
    const switching = store.load('acc-2');
    expect(store.state().rows).toBeNull();
    expect(store.state().defaultModel).toBeNull();
    await switching;
    expect(store.state().problem).toBe('not_found');
    expect(store.state().rows).toBeNull();
  });

  it('P-40: an empty catalog is an empty list, not a problem', async () => {
    const api = fakeApi({ models: [], defaultConsented: false, defaultBilling: 'included' });
    const store = createAccountModelsStore({ api, changes: fakeSignal().signal, actor: { kind: 'user', id: 'u', label: 'U' } });
    await store.load('acc-1');
    expect(store.state().rows).toEqual([]);
    expect(store.state().problem).toBeNull();
  });

  it('P-40: change events re-query the loaded account', async () => {
    const api = fakeApi(modelsView);
    const emitter = fakeSignal();
    const store = createAccountModelsStore({ api, changes: emitter.signal, actor: { kind: 'user', id: 'u', label: 'U' } });

    emitter.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();
    expect(api.queries.length).toBe(0);

    await store.load('acc-1');
    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.length).toBe(2);
  });
});

describe('consent flow (P-40)', () => {
  const storeFor = (api: FakeApi) =>
    createAccountModelsStore({ api, changes: fakeSignal().signal, actor: { kind: 'user', id: 'u', label: 'U' } });

  it('P-40: selecting a non-included model opens the draft with allow disabled until the cap parses', async () => {
    const api = fakeApi(modelsView);
    const store = storeFor(api);
    await store.load('acc-1');

    store.beginConsent({ model: 'atlas-mini', name: 'atlas-mini', billing: 'metered' });
    let draft = store.state().draft;
    expect(draft?.model).toBe('atlas-mini');
    expect(draft?.allowEnabled).toBe(false);

    store.editCap({ amountUsd: '0' });
    expect(store.state().draft?.allowEnabled).toBe(false);

    store.editCap({ amountUsd: '25', scope: 'account_week' });
    draft = store.state().draft;
    expect(draft?.cap).toEqual({ scope: 'account_week', amountUsd: '25' });
    expect(draft?.allowEnabled).toBe(true);
  });

  it('P-40: the unpinned default consents through the * marker on the same flow', async () => {
    const api = fakeApi(modelsView);
    const store = storeFor(api);
    await store.load('acc-1');

    store.beginConsent({ model: '*', name: null, billing: 'unknown' });
    expect(store.state().draft?.model).toBe('*');
    store.editCap({ amountUsd: '10' });
    await store.allow();

    expect(api.commands).toEqual([
      {
        type: 'account.consent.grant',
        id: 'acc-1',
        model: '*',
        cap: { scope: 'account_day', amountUsd: 10, warnPercent: 80 },
      },
    ]);
    expect(store.state().draft).toBeNull();
    // The store mirrors its own mutation: the models query re-runs.
    expect(api.queries.length).toBe(2);
  });

  it('P-40: allow without a parsable cap issues no command; an included model never opens the draft', async () => {
    const api = fakeApi(modelsView);
    const store = storeFor(api);
    await store.load('acc-1');

    store.beginConsent({ model: 'atlas-mini', name: 'atlas-mini', billing: 'metered' });
    store.editCap({ amountUsd: 'nope' });
    expect(await store.allow()).toBeNull();
    expect(api.commands).toEqual([]);
    expect(store.state().draft?.model).toBe('atlas-mini');

    // The default line of an included route has nothing to consent; neither does a known-included row.
    store.cancel();
    store.beginConsent({ model: 'atlas-max', name: 'Atlas Max', billing: 'included' });
    expect(store.state().draft).toBeNull();
    // A model the loaded list does not carry cannot be consented from this surface.
    store.beginConsent({ model: 'ghost', name: 'ghost', billing: 'metered' });
    expect(store.state().draft).toBeNull();
  });

  it('P-40: a granted or revoked consent maps its result through U-8 and refreshes the standing', async () => {
    const api = fakeApi(modelsView);
    const store = storeFor(api);
    await store.load('acc-1');

    await store.revoke('atlas-fog');
    expect(api.commands).toEqual([{ type: 'account.consent.revoke', id: 'acc-1', model: 'atlas-fog' }]);
    expect(store.state().lastOutcome?.command).toBe('account.consent.revoke');
    expect(store.state().lastOutcome?.labelKey).toBe('success.account.consent.revoke');
    expect(api.queries.length).toBe(2);

    store.beginConsent({ model: 'atlas-mini', name: 'atlas-mini', billing: 'metered' });
    store.editCap({ amountUsd: '15' });
    const outcome = await store.allow();
    expect(outcome?.labelKey).toBe('success.account.consent.grant');
  });

  it('P-40: a failed consent command keeps the draft open and reports the failure code', async () => {
    const api = fakeApi(modelsView);
    const store = storeFor(api);
    await store.load('acc-1');
    store.beginConsent({ model: 'atlas-mini', name: 'atlas-mini', billing: 'metered' });
    store.editCap({ amountUsd: '15' });

    api.setCommandResult({ code: 'invalid_cap' });

    const outcome = await store.allow();
    expect(outcome?.result).toEqual({ ok: false, code: 'invalid_cap' });
    expect(store.state().lastOutcome?.labelKey).toBe('error.invalid_cap');
    // The draft survives a refusal: the operator can fix the cap and try again.
    expect(store.state().draft?.model).toBe('atlas-mini');
  });
});

describe('consent only for non-included models (P-40, P-42)', () => {
  const storeFor = (api: FakeApi) =>
    createAccountModelsStore({ api, changes: fakeSignal().signal, actor: { kind: 'user', id: 'u', label: 'U' } });
  const subscriptionView: AccountModelsView = {
    models: [
      { id: 'sub-opus', displayName: 'Opus', tier: 'strong', thinking: { kind: 'none' }, billing: 'included', source: 'live', stale: false, autoClassified: false, consented: false },
      { id: 'sub-fable', displayName: 'Fable', thinking: { kind: 'none' }, billing: 'unknown', source: 'live', stale: false, autoClassified: false, consented: false },
    ],
    defaultConsented: false,
    defaultBilling: 'included',
  };

  it('P-40: an included row shows no mark and never opens a draft, whatever billing the caller claims', async () => {
    const store = storeFor(fakeApi(subscriptionView));
    await store.load('acc-1');
    const opus = store.state().rows?.find((row) => row.id === 'sub-opus');
    expect(opus?.mark).toBe('none');
    store.beginConsent({ model: 'sub-opus', name: 'Opus', billing: 'metered' });
    expect(store.state().draft).toBeNull();
  });

  it('P-40: only an unknown row opens the draft, and the draft carries the view billing', async () => {
    const store = storeFor(fakeApi(subscriptionView));
    await store.load('acc-1');
    store.beginConsent({ model: 'sub-fable', name: 'Fable', billing: 'metered' });
    expect(store.state().draft?.billing).toBe('unknown');
  });

  it('P-40: the default line follows the view defaultBilling — included opens no consent, no mark', async () => {
    const store = storeFor(fakeApi(subscriptionView));
    await store.load('acc-1');
    expect(store.state().defaultModel?.mark).toBe('none');
    store.beginConsent({ model: '*', name: null, billing: 'unknown' });
    expect(store.state().draft).toBeNull();
  });
});
