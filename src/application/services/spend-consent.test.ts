// P-51: the default billing of a route and the consent gate built on it.
import { describe, expect, it } from 'vitest';

import { parseUlid, type AccountId, type Ulid } from '../../domain/index';

import type { AccountRecord } from '../ports';
import { createFakeCapabilityCatalog, createFakeDeps } from '../ports/fakes';

import { DEFAULT_MODEL_CONSENT, defaultBillingOf, spendConsentSatisfied } from './spend-consent';

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA4');
const CAP: AccountRecord['caps'][number] = { scope: 'account_day', cap: { amountUsd: 5, warnPercent: 80 } };

const record = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id: ACCOUNT,
  provider: 'provider-a',
  label: 'Work',
  authMode: 'api_key',
  limitPolicy: 'wait_resume',
  caps: [],
  ...overrides,
});

describe('defaultBillingOf', () => {
  const capabilities = createFakeCapabilityCatalog();

  it('P-51: a route kind without defaultBilling is unknown for api_key and cloud, never metered', () => {
    expect(defaultBillingOf(capabilities, record({ authMode: 'api_key' }))).toBe('unknown');
    expect(defaultBillingOf(capabilities, record({ authMode: 'cloud' }))).toBe('unknown');
  });

  it('P-51: a subscription without defaultBilling is included', () => {
    expect(defaultBillingOf(capabilities, record({ authMode: 'subscription' }))).toBe('included');
  });

  it('P-51: a route kind that fixes defaultBilling wins over the auth mode', () => {
    const fixed = createFakeCapabilityCatalog([{ id: 'k', provider: 'provider-a', authMode: 'api_key', defaultBilling: 'included' }]);
    expect(defaultBillingOf(fixed, record())).toBe('included');
  });
});

describe('spendConsentSatisfied on an unpinned run', () => {
  const gate = async (overrides: Partial<AccountRecord>): Promise<boolean> => {
    const deps = createFakeDeps();
    await deps.accounts.save(record(overrides));
    return spendConsentSatisfied(deps, ACCOUNT, undefined);
  };

  it('P-51: unknown default billing needs consent and a cap, exactly like metered', async () => {
    expect(await gate({})).toBe(false);
    expect(await gate({ consentedModels: [DEFAULT_MODEL_CONSENT] })).toBe(false);
    expect(await gate({ caps: [CAP] })).toBe(false);
    expect(await gate({ consentedModels: [DEFAULT_MODEL_CONSENT], caps: [CAP] })).toBe(true);
  });

  it('P-51: metered default billing needs consent and a cap', async () => {
    const deps = createFakeDeps({
      capabilities: createFakeCapabilityCatalog([{ id: 'k', provider: 'provider-a', authMode: 'api_key', defaultBilling: 'metered' }]),
    });
    await deps.accounts.save(record({ consentedModels: [DEFAULT_MODEL_CONSENT] }));
    expect(await spendConsentSatisfied(deps, ACCOUNT, undefined)).toBe(false);
    await deps.accounts.save(record({ consentedModels: [DEFAULT_MODEL_CONSENT], caps: [CAP] }));
    expect(await spendConsentSatisfied(deps, ACCOUNT, undefined)).toBe(true);
  });

  it('P-51: a subscription runs without consent', async () => {
    expect(await gate({ authMode: 'subscription' })).toBe(true);
  });
});
