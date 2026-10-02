// account-models.test.ts — P-40's row view model (docs/v2/provider-capabilities.md § 14): the
// model list the settings panel shows per account — the billing mark (never an amount or a price
// claim for `unknown`), the stale note, the consent standing, and the inline consent draft whose
// allow action stays disabled until the entered cap parses. Api and change signal are fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command } from '../../api/commands';
import type { AccountModelsView, Query } from '../../api/queries';
import { t } from '../labels/t';
import { RECOMMENDED } from './recommended';
import {
  billingMark,
  CAP_SCOPES,
  CAP_WARN_PERCENT,
  createAccountModelsStore,
  groupModels,
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

    store.beginConsent({ model: 'atlas-mini', name: 'atlas-mini', billing: 'metered', hasCap: false });
    let draft = store.state().draft;
    expect(draft?.model).toBe('atlas-mini');
    // The recommendation is prefilled, so allow starts enabled; a cap that cannot cap disables it.
    expect(draft?.allowEnabled).toBe(true);

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

    store.beginConsent({ model: '*', name: null, billing: 'unknown', hasCap: false });
    expect(store.state().draft?.model).toBe('*');
    store.editCap({ amountUsd: '10', scope: 'account_day' });
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

    store.beginConsent({ model: 'atlas-mini', name: 'atlas-mini', billing: 'metered', hasCap: false });
    store.editCap({ amountUsd: 'nope' });
    expect(await store.allow()).toBeNull();
    expect(api.commands).toEqual([]);
    expect(store.state().draft?.model).toBe('atlas-mini');

    // The default line of an included route has nothing to consent; neither does a known-included row.
    store.cancel();
    store.beginConsent({ model: 'atlas-max', name: 'Atlas Max', billing: 'included', hasCap: false });
    expect(store.state().draft).toBeNull();
    // A model the loaded list does not carry cannot be consented from this surface.
    store.beginConsent({ model: 'ghost', name: 'ghost', billing: 'metered', hasCap: false });
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

    store.beginConsent({ model: 'atlas-mini', name: 'atlas-mini', billing: 'metered', hasCap: false });
    store.editCap({ amountUsd: '15' });
    const outcome = await store.allow();
    expect(outcome?.labelKey).toBe('success.account.consent.grant');
  });

  it('P-40: a failed consent command keeps the draft open and reports the failure code', async () => {
    const api = fakeApi(modelsView);
    const store = storeFor(api);
    await store.load('acc-1');
    store.beginConsent({ model: 'atlas-mini', name: 'atlas-mini', billing: 'metered', hasCap: false });
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
    store.beginConsent({ model: 'sub-opus', name: 'Opus', billing: 'metered', hasCap: false });
    expect(store.state().draft).toBeNull();
  });

  it('P-40: only an unknown row opens the draft, and the draft carries the view billing', async () => {
    const store = storeFor(fakeApi(subscriptionView));
    await store.load('acc-1');
    store.beginConsent({ model: 'sub-fable', name: 'Fable', billing: 'metered', hasCap: false });
    expect(store.state().draft?.billing).toBe('unknown');
  });

  it('P-40: the default line follows the view defaultBilling — included opens no consent, no mark', async () => {
    const store = storeFor(fakeApi(subscriptionView));
    await store.load('acc-1');
    expect(store.state().defaultModel?.mark).toBe('none');
    store.beginConsent({ model: '*', name: null, billing: 'unknown', hasCap: false });
    expect(store.state().draft).toBeNull();
  });
});

describe('models and spend consent (U-32)', () => {
  const storeFor = (api: FakeApi) =>
    createAccountModelsStore({ api, changes: fakeSignal().signal, actor: { kind: 'user', id: 'u', label: 'U' } });
  const model = (id: string, billing: 'included' | 'metered' | 'unknown', consented = false, stale = false) => ({
    id,
    thinking: { kind: 'none' as const },
    billing,
    source: 'live' as const,
    stale,
    autoClassified: false,
    consented,
  });

  it('U-32: account.models groups by billing — included (no mark), metered ($), unknown (?) — in a fixed order, empty groups omitted', () => {
    const rows = modelRows({
      models: [model('a', 'unknown'), model('b', 'included'), model('c', 'metered'), model('d', 'included')],
      defaultConsented: false,
      defaultBilling: 'included',
    });
    const groups = groupModels(rows);
    expect(groups.map((g) => [g.billing, g.rows.map((r) => r.id)])).toEqual([
      ['included', ['b', 'd']],
      ['metered', ['c']],
      ['unknown', ['a']],
    ]);
    expect(groups.map((g) => g.rows[0]?.mark)).toEqual(['none', 'currency', 'question']);
    expect(groupModels(rows.filter((r) => r.billing === 'included')).map((g) => g.billing)).toEqual(['included']);
  });

  it('U-32: billing is per account and plan — the same model id groups differently on a Max and a Pro account', async () => {
    const api = fakeApi({ models: [model('fable-5-1', 'included')], defaultConsented: false, defaultBilling: 'included' });
    const store = storeFor(api);
    await store.load('max');
    expect(groupModels(store.state().rows ?? []).map((g) => g.billing)).toEqual(['included']);
    api.setReply({ models: [model('fable-5-1', 'metered')], defaultConsented: false, defaultBilling: 'included' });
    await store.load('pro');
    expect(groupModels(store.state().rows ?? []).map((g) => g.billing)).toEqual(['metered']);
    expect(api.queries.map((q) => q.type === 'account.models' && q.accountId)).toEqual(['max', 'pro']);
  });

  it('U-32: the card opens requiring a cap, prefilled from RECOMMENDED.cap; the grant carries it; Vazgeç closes without a command', async () => {
    const api = fakeApi({ models: [model('fable', 'metered')], defaultConsented: false, defaultBilling: 'included' });
    const store = storeFor(api);
    await store.load('pro');
    store.beginConsent({ model: 'fable', name: 'Fable', billing: 'metered', hasCap: false });
    const draft = store.state().draft;
    expect(draft?.capRequired).toBe(true);
    expect(draft?.cap).toEqual({ scope: RECOMMENDED.cap.scope, amountUsd: String(RECOMMENDED.cap.amountUsd) });
    expect(draft?.allowEnabled).toBe(true);
    store.editCap({ amountUsd: '' });
    expect(store.state().draft?.allowEnabled).toBe(false);
    expect(await store.allow()).toBeNull();
    store.cancel();
    expect(store.state().draft).toBeNull();
    expect(api.commands).toEqual([]);

    store.beginConsent({ model: 'fable', name: 'Fable', billing: 'metered', hasCap: false });
    await store.allow();
    expect(api.commands).toEqual([
      {
        type: 'account.consent.grant',
        id: 'pro',
        model: 'fable',
        cap: { scope: 'account_month', amountUsd: 50, warnPercent: 80 },
      },
    ]);
  });

  it('U-32: an account that already has a cap grants without asking for another', async () => {
    const api = fakeApi({ models: [model('fable', 'unknown')], defaultConsented: false, defaultBilling: 'included' });
    const store = storeFor(api);
    await store.load('pro');
    store.beginConsent({ model: 'fable', name: 'Fable', billing: 'unknown', hasCap: true });
    expect(store.state().draft?.capRequired).toBe(false);
    expect(store.state().draft?.allowEnabled).toBe(true);
    await store.allow();
    expect(api.commands).toEqual([{ type: 'account.consent.grant', id: 'pro', model: 'fable' }]);
  });

  it('U-32: the ? text is fixed and makes no price or amount claim, in both locales', () => {
    for (const locale of ['tr', 'en'] as const) {
      const text = t(locale, 'settings.models.unknown');
      expect(text).not.toMatch(/[0-9$€₺]|USD|dolar|dollar|price|fiyat|tutar|amount/i);
    }
  });

  it('U-32: a consented row reads İzinli with Geri al (account.consent.revoke, no confirmation); the default row uses model *', async () => {
    const api = fakeApi({ models: [model('fable', 'metered', true)], defaultConsented: true, defaultBilling: 'unknown' });
    const store = storeFor(api);
    await store.load('pro');
    expect(store.state().rows?.[0]?.consented).toBe(true);
    expect(store.state().defaultModel).toEqual({ billing: 'unknown', mark: 'question', consented: true });
    expect(t('tr', 'settings.models.allowed')).toBe('İzinli');
    expect(t('tr', 'settings.models.revoke')).toBe('Geri al');
    await store.revoke('fable');
    await store.revoke('*');
    expect(api.commands).toEqual([
      { type: 'account.consent.revoke', id: 'pro', model: 'fable' },
      { type: 'account.consent.revoke', id: 'pro', model: '*' },
    ]);
  });

  it('U-32: the default row opens the card with model * and its billing', async () => {
    const api = fakeApi({ models: [], defaultConsented: false, defaultBilling: 'metered' });
    const store = storeFor(api);
    await store.load('pro');
    store.beginConsent({ model: '*', name: null, billing: 'metered', hasCap: false });
    expect(store.state().draft).toMatchObject({ model: '*', billing: 'metered', capRequired: true });
  });

  it('U-32: a stale list says so beside Yenile, which re-queries with refresh: true', async () => {
    const api = fakeApi({ models: [model('fable', 'metered', false, true)], defaultConsented: false, defaultBilling: 'included' });
    const store = storeFor(api);
    await store.load('pro');
    expect(store.state().stale).toBe(true);
    await store.refresh();
    expect(api.queries[1]).toEqual({ type: 'account.models', accountId: 'pro', refresh: true });
  });

  it('U-32: a failed grant or revoke maps through U-8 and the card stays open on a refusal', async () => {
    const api = fakeApi({ models: [model('fable', 'metered', true)], defaultConsented: false, defaultBilling: 'included' });
    const store = storeFor(api);
    await store.load('pro');
    api.setCommandResult({ code: 'cap_required' });
    store.beginConsent({ model: 'fable', name: 'Fable', billing: 'metered', hasCap: false });
    await store.allow();
    expect(store.state().lastOutcome?.labelKey).toBe('error.cap_required');
    expect(store.state().draft).not.toBeNull();
    const revoked = await store.revoke('fable');
    expect(revoked?.result.ok).toBe(false);
  });
});
