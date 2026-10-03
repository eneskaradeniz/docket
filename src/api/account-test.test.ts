// api: the account.test command and the `test` field of settings.accounts rows (A-72, A-74).
// The use case's own rules are tested beside it; here only the mapping onto the boundary is covered.
import { describe, expect, it } from 'vitest';

import type { Actor, AgentEvent } from '../domain/index';
import { parseUlid } from '../domain/index';

import type { AccountRecord } from '../application';
import {
  createFakeClock,
  createFakeDeps,
  createFakeEventLog,
  createFakeTransport,
  createFakeTransportResolver,
} from '../application/ports/fakes';

import { createApi } from './api';
import type { SettingsAccountsView } from './queries';

const ACTOR: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const T0 = 1_760_000_000_000;
const ID = '01ARZ3NDEKTSV4RRFFQ69G5FA4';
const OTHER = '01ARZ3NDEKTSV4RRFFQ69G5FA5';

const parsed = parseUlid<'account'>(ID);
if (!parsed.ok) throw new Error('fixture ulid must parse');
const ACCOUNT = parsed.value;

const record = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id: ACCOUNT,
  provider: 'provider-a',
  label: 'Work',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  ...overrides,
});

const setup = async (script: readonly AgentEvent[] = [{ type: 'finished', at: T0, reason: 'completed' }]) => {
  const resolver = createFakeTransportResolver();
  const transport = createFakeTransport(script);
  const deps = createFakeDeps({ clock: createFakeClock(T0), log: createFakeEventLog(), transports: resolver });
  await deps.accounts.save(record());
  resolver.register(ACCOUNT, transport);
  return { deps, transport, api: createApi(deps) };
};

const rows = async (api: ReturnType<typeof createApi>): Promise<SettingsAccountsView> =>
  (await api.query({ type: 'settings.accounts' })) as SettingsAccountsView;

describe('account.test', () => {
  it('A-74: a finished test answers ok and the outcome rides settings.accounts', async () => {
    const h = await setup();
    expect(await h.api.command(ACTOR, { type: 'account.test', id: ID })).toEqual({ ok: true });
    expect((await rows(h.api)).accounts[0]?.test).toEqual({ state: 'ok', class: null, model: null, at: T0, detail: null });
  });

  it('A-74: a finished test that failed still answers ok; the failure is in the row', async () => {
    const h = await setup([{ type: 'error', at: T0, class: 'auth', message: 'not signed in' }, { type: 'finished', at: T0, reason: 'failed' }]);
    expect(await h.api.command(ACTOR, { type: 'account.test', id: ID })).toEqual({ ok: true });
    expect((await rows(h.api)).accounts[0]?.test).toEqual({ state: 'failed', class: 'auth', model: null, at: T0, detail: 'not signed in' });
  });

  it('A-74: a refusal answers ok false with the use case code', async () => {
    const h = await setup();
    expect(await h.api.command(ACTOR, { type: 'account.test', id: OTHER })).toEqual({ ok: false, code: 'not_found' });
    expect(await h.api.command(ACTOR, { type: 'account.test', id: 'nope' })).toEqual({ ok: false, code: 'invalid_id' });
    expect(h.transport.requests()).toEqual([]);
  });

  it('A-74: an absent or empty model means the route default', async () => {
    const h = await setup();
    await h.api.command(ACTOR, { type: 'account.test', id: ID });
    await h.api.command(ACTOR, { type: 'account.test', id: ID, model: '' });
    expect(h.transport.requests().map((request) => request.route)).toEqual([{ accountId: ACCOUNT }, { accountId: ACCOUNT }]);
    expect((await rows(h.api)).accounts[0]?.test?.model).toBeNull();
  });

  it('A-74: a given model is tested and shown on the row', async () => {
    const h = await setup();
    await h.deps.accounts.save(record({ consentedModels: ['model-x'], caps: [{ scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } }] }));
    expect(await h.api.command(ACTOR, { type: 'account.test', id: ID, model: 'model-x' })).toEqual({ ok: true });
    expect(h.transport.requests()[0]?.route).toEqual({ accountId: ACCOUNT, model: 'model-x' });
    expect((await rows(h.api)).accounts[0]?.test?.model).toBe('model-x');
  });
});

describe('settings.accounts test field', () => {
  it('A-72: a row without a record has test null', async () => {
    const h = await setup();
    expect((await rows(h.api)).accounts[0]?.test).toBeNull();
  });

  it('A-72: a running record shows state running with startedAt and null class and detail', async () => {
    const h = await setup();
    await h.deps.accountTests.save({ accountId: ACCOUNT, model: null, state: 'running', startedAt: T0 });
    expect((await rows(h.api)).accounts[0]?.test).toEqual({ state: 'running', class: null, model: null, at: T0, detail: null });
  });

  it('A-72: class and detail are null unless the state is failed', async () => {
    const h = await setup();
    await h.deps.accountTests.save({ accountId: ACCOUNT, model: 'm', state: 'ok', class: 'auth', detail: 'stale', startedAt: 1, endedAt: 5 });
    expect((await rows(h.api)).accounts[0]?.test).toEqual({ state: 'ok', class: null, model: 'm', at: 5, detail: null });
    await h.deps.accountTests.save({ accountId: ACCOUNT, model: 'm', state: 'failed', class: 'limit', detail: '', startedAt: 1, endedAt: 6 });
    expect((await rows(h.api)).accounts[0]?.test).toEqual({ state: 'failed', class: 'limit', model: 'm', at: 6, detail: '' });
  });

  it('A-73: account.save and account.remove clear the stored result through the command surface', async () => {
    const h = await setup();
    await h.api.command(ACTOR, { type: 'account.test', id: ID });
    // A label edit keeps the result; removal drops it.
    await h.api.command(ACTOR, { type: 'account.save', id: ID, provider: 'provider-a', label: 'Renamed', authMode: 'subscription' });
    expect((await rows(h.api)).accounts[0]?.test?.state).toBe('ok');
    await h.api.command(ACTOR, { type: 'account.remove', id: ID });
    expect(await h.deps.accountTests.get(ACCOUNT)).toBeUndefined();
  });
});
