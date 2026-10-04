import { describe, expect, it } from 'vitest';

import type { SettingsMeterView, SettingsPoolView } from '../../api/queries';
import { hasModelScopedPool, meterListEmpty, meterListView, meterResetText } from './meter-list';

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

  it('U-44: with no rows the line says what is missing — login first, then a load or failure, else no usage', () => {
    expect(meterListEmpty({ loading: false, failed: false, needsLogin: true })).toBe('meterList.needsLogin');
    expect(meterListEmpty({ loading: true, failed: false, needsLogin: false })).toBe('meterList.afterAdd');
    expect(meterListEmpty({ loading: false, failed: true, needsLogin: false })).toBe('meterList.afterAdd');
    expect(meterListEmpty({ loading: false, failed: false, needsLogin: false })).toBe('meterList.noMeter');
  });

  it('U-44: the reset reads "<span> sonra sıfırlanır" from the clock it is given, and nothing without a reset', () => {
    const now = 1_000_000;
    expect(meterResetText('tr', now + 2 * 3_600_000 + 10 * 60_000, now)).toBe('2 sa 10 dk sonra sıfırlanır');
    expect(meterResetText('en', now + 40 * 60_000, now)).toBe('resets in 40m');
    expect(meterResetText('tr', null, now)).toBeNull();
  });
});
