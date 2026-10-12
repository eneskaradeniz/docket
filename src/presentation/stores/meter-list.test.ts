import { describe, expect, it } from 'vitest';

import type { SettingsAccountView, SettingsMeterView, SettingsPoolView } from '../../api/queries';
import { accountMeterStanding, hasModelScopedPool, meterListEmpty, meterListView, meterResetText } from './meter-list';

const pool = (id: string, label: string, appliesTo: SettingsPoolView['appliesTo']): SettingsPoolView => ({ id, label, kind: 'allowance', appliesTo });

const meter = (over: Partial<SettingsMeterView> & Pick<SettingsMeterView, 'id' | 'poolId'>): SettingsMeterView => ({
  label: null,
  cadence: 'fixed',
  durationMs: null,
  unit: 'fraction',
  used: 0.34,
  limit: 1,
  remaining: 0.66,
  resetsAt: 1_700_000_000_000,
  resetPrecision: 'exact',
  observedAt: 1,
  source: 'polled',
  staleAfterMs: null,
  reserveClass: 'short',
  reserveShare: 0,
  ...over,
});

const ACCOUNT = pool('p-acc', 'max', 'all');
const FABLE = pool('p-fable', 'Fable', [{ prefix: 'claude-fable' }]);

describe('meter list (U-44)', () => {
  it('U-44: one row per meter, named by the provider window with known codes in words', () => {
    const view = meterListView(
      [ACCOUNT],
      [meter({ id: 'm1', poolId: 'p-acc', label: 'five_hour' }), meter({ id: 'm2', poolId: 'p-acc', label: 'seven_day' }), meter({ id: 'm3', poolId: 'p-acc', label: 'Custom window' })],
    );
    expect(view.rows.map((row) => row.name)).toEqual([
      { key: 'meterList.window.five_hour' },
      { key: 'meterList.window.seven_day' },
      { text: 'Custom window' },
    ]);
    // A meter without its own label reads under its pool's name.
    expect(meterListView([ACCOUNT], [meter({ id: 'm', poolId: 'p-acc' })]).rows[0]?.name).toEqual({ text: 'max' });
  });

  it('U-44: scope tags appear only when another pool of the account is model-scoped', () => {
    const plain = meterListView([ACCOUNT], [meter({ id: 'm1', poolId: 'p-acc' })]);
    expect(plain.rows[0]?.scope).toBeNull();
    expect(plain.modelNote).toBeNull();

    const view = meterListView([ACCOUNT, FABLE], [meter({ id: 'm1', poolId: 'p-acc' }), meter({ id: 'm2', poolId: 'p-fable' })]);
    expect(view.rows.map((row) => row.scope)).toEqual([{ kind: 'all' }, { kind: 'model', model: 'Fable' }]);
  });

  it('U-44: a pool whose applicability is unknown carries no tag even beside a model-scoped pool', () => {
    const view = meterListView([pool('p-u', 'x', 'unknown'), FABLE], [meter({ id: 'm1', poolId: 'p-u' })]);
    expect(view.rows[0]?.scope).toBeNull();
  });

  it('U-44: the model note names the model-scoped pool, once', () => {
    const view = meterListView([ACCOUNT, FABLE], [meter({ id: 'm1', poolId: 'p-acc' }), meter({ id: 'm2', poolId: 'p-fable' })]);
    expect(view.modelNote).toBe('Fable');
    expect(hasModelScopedPool([ACCOUNT, FABLE])).toBe(true);
    expect(hasModelScopedPool([ACCOUNT])).toBe(false);
  });

  it('U-44: the bar reads remaining from the left and turns amber under 40 %', () => {
    const view = meterListView(
      [ACCOUNT],
      [meter({ id: 'a', poolId: 'p-acc', remaining: 0.66 }), meter({ id: 'b', poolId: 'p-acc', remaining: 0.39 }), meter({ id: 'c', poolId: 'p-acc', remaining: 0.4 })],
    );
    expect(view.rows.map((row) => [row.remaining, row.low])).toEqual([
      [0.66, false],
      [0.39, true],
      [0.4, false],
    ]);
  });

  it('U-44: a set reserve draws its zone and flags a bar at or below it', () => {
    const row = meterListView([ACCOUNT], [meter({ id: 'a', poolId: 'p-acc', remaining: 0.15, reserveShare: 0.2 })]).rows[0];
    expect(row?.zone).toBe(0.2);
    expect(row?.reached).toBe(true);
  });

  it('U-44: a counted unit shows its fraction first; a share or money never does', () => {
    const counted = meterListView([ACCOUNT], [meter({ id: 'a', poolId: 'p-acc', unit: 'requests', used: 120, limit: 300, remaining: 180 })]).rows[0];
    expect(counted?.fraction).toBe('120 / 300');
    expect(counted?.remaining).toBeCloseTo(0.6);
    expect(meterListView([ACCOUNT], [meter({ id: 'a', poolId: 'p-acc' })]).rows[0]?.fraction).toBeNull();
    expect(meterListView([ACCOUNT], [meter({ id: 'a', poolId: 'p-acc', unit: 'usd', used: 3, limit: 50, remaining: 47 })]).rows[0]?.fraction).toBeNull();
  });

  it('U-44: with no rows the line says what is missing — login first, then a load, then an unclassed failure', () => {
    expect(meterListEmpty({ loading: false, failed: false, needsLogin: true })).toBe('meterList.needsLogin');
    expect(meterListEmpty({ loading: true, failed: false, needsLogin: false })).toBe('meterList.afterAdd');
    // A preview failure that carries no class (the wizard's candidate quota) keeps its own line.
    expect(meterListEmpty({ loading: false, failed: true, needsLogin: false })).toBe('meterList.afterAdd');
  });

  it('U-264: a failed read shows its typed reason, never the no-meter line', () => {
    const standing = { loading: false, needsLogin: false, failed: true };
    expect(meterListEmpty({ ...standing, failure: 'needs_key', hasUsageSource: true })).toBe('meterList.failed.needsKey');
    expect(meterListEmpty({ ...standing, failure: 'network', hasUsageSource: true })).toBe('meterList.failed.network');
    // The reason outranks the source question: even a sourceless provider shows why a read failed.
    expect(meterListEmpty({ ...standing, failure: 'rejected', hasUsageSource: false })).toBe('meterList.failed.rejected');
  });

  it('U-264: accountMeterStanding derives typed failures from account state and test results', () => {
    const baseAccount: SettingsAccountView = {
      id: 'acc-1',
      provider: 'custom',
      label: 'Custom Account',
      authMode: 'api_key',
      billing: 'metered',
      plan: null,
      limitPolicy: 'wait_resume',
      reserve: { short: null, long: null },
      caps: [],
      consentedModels: [],
      routeKind: null,
      identityDir: null,
      endpointHost: 'api.example.com',
      hasSecret: true,
      test: null,
      pools: [],
      meters: [],
    };

    // An API key account without a secret in the vault needs a key
    expect(accountMeterStanding({ ...baseAccount, hasSecret: false })).toEqual({
      loading: false,
      failed: true,
      needsLogin: false,
      failure: 'needs_key',
      hasUsageSource: true,
    });

    // An API key account with a network test failure reports network
    expect(accountMeterStanding({ ...baseAccount, test: { state: 'failed', class: 'network', detail: null, model: null, at: 100 } })).toEqual({
      loading: false,
      failed: true,
      needsLogin: false,
      failure: 'network',
      hasUsageSource: true,
    });

    // An API key account with an auth rejection reports rejected
    expect(accountMeterStanding({ ...baseAccount, test: { state: 'failed', class: 'auth', detail: null, model: null, at: 100 } })).toEqual({
      loading: false,
      failed: true,
      needsLogin: false,
      failure: 'rejected',
      hasUsageSource: true,
    });

    // A subscription account with auth failure reports needsLogin
    expect(accountMeterStanding({ ...baseAccount, authMode: 'subscription', test: { state: 'failed', class: 'auth', detail: null, model: null, at: 100 } })).toEqual({
      loading: false,
      failed: true,
      needsLogin: true,
      failure: null,
      hasUsageSource: true,
    });

    // A sourceless account without endpoint or pools reports hasUsageSource false
    expect(accountMeterStanding({ ...baseAccount, endpointHost: null, pools: [] })).toEqual({
      loading: false,
      failed: false,
      needsLogin: false,
      failure: null,
      hasUsageSource: false,
    });
  });

  it('U-265: the no-meter line appears only for a provider with no usage source; a source not yet read says so', () => {
    expect(meterListEmpty({ loading: false, needsLogin: false, failed: false, failure: null, hasUsageSource: false })).toBe('meterList.noMeter');
    expect(meterListEmpty({ loading: false, needsLogin: false, failed: false, failure: null, hasUsageSource: true })).toBe('meterList.notRead');
    // A caller that does not know the source (the wizard's preview) claims none: no-meter, as before.
    expect(meterListEmpty({ loading: false, needsLogin: false, failed: false, failure: null })).toBe('meterList.noMeter');
  });

  it('U-44: the reset reads "<span> sonra sıfırlanır" from the clock it is given, and nothing without a reset', () => {
    const now = 1_000_000;
    expect(meterResetText('tr', now + 2 * 3_600_000 + 10 * 60_000, now)).toBe('2 sa 10 dk sonra sıfırlanır');
    expect(meterResetText('en', now + 40 * 60_000, now)).toBe('resets in 40m');
    expect(meterResetText('tr', null, now)).toBeNull();
  });
});
