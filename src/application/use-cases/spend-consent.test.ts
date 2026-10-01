// spend consent use cases — P-40 of docs/v2/provider-capabilities.md § 14: a metered or
// unverified model runs only with the user's recorded consent and a spend cap on the account.
// Driven over the in-memory port fakes.
import { describe, expect, it } from 'vitest';

import {
  parseUlid,
  type AccountId,
  type Actor,
  type Ulid,
} from '../../domain/index';

import type { AccountRecord, AppDeps } from '../ports';
import {
  createFakeClock,
  createFakeDeps,
  createFakeEventLog,
  type FakeEventLog,
} from '../ports/fakes';

import { grantSpendConsent, revokeSpendConsent } from './spend-consent';

// --- fixtures ---------------------------------------------------------------------------------------

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA4');
const T0 = 1_000;
const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const accountRecord = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id: ACCOUNT,
  provider: 'provider-a',
  label: 'Work account',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  ...overrides,
});

const DAY_CAP: AccountRecord['caps'][number] = {
  scope: 'account_day',
  cap: { amountUsd: 5, warnPercent: 80 },
};

interface Harness {
  readonly deps: AppDeps;
  readonly log: FakeEventLog;
}

const makeHarness = (): Harness => {
  const clock = createFakeClock(T0);
  const log = createFakeEventLog();
  const deps = createFakeDeps({ clock, log });
  return { deps, log };
};

const withAccount = async (h: Harness, record: AccountRecord = accountRecord()): Promise<void> => {
  await h.deps.accounts.save(record);
};

// --- grantSpendConsent ------------------------------------------------------------------------------

describe('grantSpendConsent', () => {
  it('P-40: records the model in consentedModels and saves the given cap, audited without secrets', async () => {
    const h = makeHarness();
    await withAccount(h);

    const result = await grantSpendConsent(h.deps, {
      accountId: ACCOUNT,
      model: 'model-x',
      cap: DAY_CAP,
      actor: USER,
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({
      consentedModels: ['model-x'],
      caps: [DAY_CAP],
    });
    expect(h.log.entries()).toHaveLength(1);
    expect(h.log.entries()[0]).toMatchObject({
      at: T0,
      actor: USER,
      action: 'account.consent.granted',
      subject: { kind: 'account', id: ACCOUNT },
      detail: { model: 'model-x', capScope: 'account_day', capAmountUsd: 5 },
    });
    // The recorded detail names targets only — no secret ever crosses this use case.
    expect(JSON.stringify(h.log.entries())).not.toContain('sk-');
  });

  it('P-40: a record saved before the field existed gains consentedModels on grant and keeps its caps', async () => {
    const h = makeHarness();
    const before = accountRecord({ caps: [DAY_CAP] });
    await withAccount(h, before);

    const result = await grantSpendConsent(h.deps, { accountId: ACCOUNT, model: 'model-x', actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.get(ACCOUNT)).toEqual({
      ...before,
      consentedModels: ['model-x'],
    });
  });

  it('P-40: granting without a cap leaves the account caps untouched', async () => {
    const h = makeHarness();
    await withAccount(h, accountRecord({ caps: [DAY_CAP] }));

    const result = await grantSpendConsent(h.deps, { accountId: ACCOUNT, model: 'model-x', actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({ caps: [DAY_CAP], consentedModels: ['model-x'] });
  });

  it('P-40: granting the same model twice records it once and replaces the cap of the same scope', async () => {
    const h = makeHarness();
    await withAccount(h);

    const first = await grantSpendConsent(h.deps, { accountId: ACCOUNT, model: 'model-x', actor: USER });
    const second = await grantSpendConsent(h.deps, {
      accountId: ACCOUNT,
      model: 'model-x',
      cap: { scope: 'account_day', cap: { amountUsd: 12.5, warnPercent: 90 } },
      actor: USER,
    });
    const third = await grantSpendConsent(h.deps, {
      accountId: ACCOUNT,
      model: 'model-y',
      cap: { scope: 'account_month', cap: { amountUsd: 80, warnPercent: 80 } },
      actor: USER,
    });

    expect(first).toEqual({ ok: true, value: undefined });
    expect(second).toEqual({ ok: true, value: undefined });
    expect(third).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({
      consentedModels: ['model-x', 'model-y'],
      caps: [
        { scope: 'account_day', cap: { amountUsd: 12.5, warnPercent: 90 } },
        { scope: 'account_month', cap: { amountUsd: 80, warnPercent: 80 } },
      ],
    });
  });

  it('P-40: an unknown account fails with not_found and writes nothing', async () => {
    const h = makeHarness();

    const result = await grantSpendConsent(h.deps, { accountId: ACCOUNT, model: 'model-x', actor: USER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(await h.deps.accounts.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('P-40: an empty model id fails with invalid_model and writes nothing', async () => {
    const h = makeHarness();
    await withAccount(h);

    const result = await grantSpendConsent(h.deps, { accountId: ACCOUNT, model: '', actor: USER });

    expect(result).toEqual({ ok: false, error: 'invalid_model' });
    expect(await h.deps.accounts.get(ACCOUNT)).toEqual(accountRecord());
    expect(h.log.entries()).toEqual([]);
  });

  it('P-40: a cap that cannot cap (non-positive amount or warnPercent outside 1..100) fails with invalid_cap', async () => {
    const h = makeHarness();
    await withAccount(h);

    const zero = await grantSpendConsent(h.deps, {
      accountId: ACCOUNT,
      model: 'model-x',
      cap: { scope: 'account_day', cap: { amountUsd: 0, warnPercent: 80 } },
      actor: USER,
    });
    const percent = await grantSpendConsent(h.deps, {
      accountId: ACCOUNT,
      model: 'model-x',
      cap: { scope: 'account_day', cap: { amountUsd: 5, warnPercent: 101 } },
      actor: USER,
    });

    expect(zero).toEqual({ ok: false, error: 'invalid_cap' });
    expect(percent).toEqual({ ok: false, error: 'invalid_cap' });
    expect(await h.deps.accounts.get(ACCOUNT)).toEqual(accountRecord());
    expect(h.log.entries()).toEqual([]);
  });

  it('P-40: grant never mutates the stored record object it read', async () => {
    const h = makeHarness();
    const stored = accountRecord();
    await withAccount(h, stored);
    const before = JSON.stringify(stored);

    await grantSpendConsent(h.deps, { accountId: ACCOUNT, model: 'model-x', actor: USER });

    expect(JSON.stringify(stored)).toBe(before);
    expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({ consentedModels: ['model-x'] });
  });
});

// --- revokeSpendConsent -----------------------------------------------------------------------------

describe('revokeSpendConsent', () => {
  it('P-40: removes the model from consentedModels, keeps the caps, and audits the revoke', async () => {
    const h = makeHarness();
    await withAccount(
      h,
      accountRecord({
        consentedModels: ['model-x', 'model-y'],
        caps: [DAY_CAP],
      }),
    );

    const result = await revokeSpendConsent(h.deps, { accountId: ACCOUNT, model: 'model-x', actor: USER });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({
      consentedModels: ['model-y'],
      caps: [DAY_CAP],
    });
    expect(h.log.entries()).toHaveLength(1);
    expect(h.log.entries()[0]).toMatchObject({
      at: T0,
      actor: USER,
      action: 'account.consent.revoked',
      subject: { kind: 'account', id: ACCOUNT },
      detail: { model: 'model-x' },
    });
  });

  it('P-40: revoking the last consent leaves an empty list and stays idempotent on a repeat', async () => {
    const h = makeHarness();
    await withAccount(h, accountRecord({ consentedModels: ['model-x'] }));

    const first = await revokeSpendConsent(h.deps, { accountId: ACCOUNT, model: 'model-x', actor: USER });
    const second = await revokeSpendConsent(h.deps, { accountId: ACCOUNT, model: 'model-x', actor: USER });

    expect(first).toEqual({ ok: true, value: undefined });
    expect(second).toEqual({ ok: true, value: undefined });
    expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({ consentedModels: [] });
    expect(h.log.entries()).toHaveLength(2);
  });

  it('P-40: an unknown account fails with not_found and writes nothing', async () => {
    const h = makeHarness();

    const result = await revokeSpendConsent(h.deps, { accountId: ACCOUNT, model: 'model-x', actor: USER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(h.log.entries()).toEqual([]);
  });

  it('P-40: an empty model id fails with invalid_model and writes nothing', async () => {
    const h = makeHarness();
    await withAccount(h, accountRecord({ consentedModels: ['model-x'] }));

    const result = await revokeSpendConsent(h.deps, { accountId: ACCOUNT, model: '', actor: USER });

    expect(result).toEqual({ ok: false, error: 'invalid_model' });
    expect(await h.deps.accounts.get(ACCOUNT)).toMatchObject({ consentedModels: ['model-x'] });
    expect(h.log.entries()).toEqual([]);
  });
});
