// api/settings.test.ts — the dispatch-limits query and command on the wire (A-108).
import { describe, expect, it } from 'vitest';

import type { Actor } from '../domain/index';
import type { AccountRecord } from '../application';
import { createFakeDeps } from '../application/ports/fakes';

import { createApi } from './api';
import { COMMAND_REGISTRY, QUERY_REGISTRY } from './registry';

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FCV';

const account: AccountRecord = {
  id: ACCOUNT as AccountRecord['id'],
  provider: 'provider-x',
  label: 'Work account',
  authMode: 'subscription',
  limitPolicy: 'ask',
  caps: [],
};

const makeApi = async () => {
  const deps = createFakeDeps();
  await deps.accounts.save(account);
  return createApi(deps);
};

describe('settings.dispatch / settings.setDispatch', () => {
  it('A-108: the query answers the defaults, then what settings.setDispatch saved', async () => {
    const api = await makeApi();
    expect(await api.query({ type: 'settings.dispatch' })).toStrictEqual({ global: 4, perRepo: 3, perAccount: {} });

    expect(await api.command(USER, { type: 'settings.setDispatch', global: 6, perRepo: 2, perAccount: { [ACCOUNT]: 3 } })).toStrictEqual({ ok: true });
    expect(await api.query({ type: 'settings.dispatch' })).toStrictEqual({ global: 6, perRepo: 2, perAccount: { [ACCOUNT]: 3 } });
  });

  it('A-108: invalid numbers answer invalid_limits, an unknown or malformed account unknown_account / invalid_id, and nothing is written', async () => {
    const api = await makeApi();
    expect(await api.command(USER, { type: 'settings.setDispatch', global: 17, perRepo: 1, perAccount: {} })).toStrictEqual({ ok: false, code: 'invalid_limits' });
    expect(
      await api.command(USER, { type: 'settings.setDispatch', global: 4, perRepo: 1, perAccount: { '01ARZ3NDEKTSV4RRFFQ69G5FCW': 1 } }),
    ).toStrictEqual({ ok: false, code: 'unknown_account' });
    expect(await api.command(USER, { type: 'settings.setDispatch', global: 4, perRepo: 1, perAccount: { nope: 1 } })).toStrictEqual({ ok: false, code: 'invalid_id' });
    expect(await api.query({ type: 'settings.dispatch' })).toStrictEqual({ global: 4, perRepo: 3, perAccount: {} });
  });

  it('A-108: both operations are listed in the registry', () => {
    expect(COMMAND_REGISTRY['settings.setDispatch'].input).toContain('perAccount');
    expect(QUERY_REGISTRY['settings.dispatch'].input).toBe('no input');
  });
});
