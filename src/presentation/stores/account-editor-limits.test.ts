// account-editor-limits.test.ts — U-30's Limitler part: the policy options and the single-pool
// reason, the reserve choice and its split fields, the 0–95 validation, the cap form, the command
// payloads (a complete reserve, shares on the wire), and the api refusals mapped under their row.
// Node environment; the runner and the clock are injected.
import { describe, expect, it } from 'vitest';

import type { Command, CommandResult } from '../../api/commands';
import type { SettingsAccountView, SettingsMeterView } from '../../api/queries';

import {
  capFormStartsOpen,
  capSaveCommands,
  createAccountEditorStore,
  mayHaveCap,
  parseCapForm,
  parseReservePercent,
  policyOptions,
  policySaveCommand,
  reserveChoice,
  reserveFieldMeters,
  reserveSaveCommand,
  reserveSplitStartsOpen,
} from './account-editor';
import { commandResultKey, failureKey } from './results';

const ACCOUNT: SettingsAccountView = {
  id: 'a-1',
  provider: 'claude',
  label: 'Work',
  authMode: 'subscription',
  plan: 'pro',
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: null,
  endpointHost: null,
  hasSecret: false,
  pools: [],
  meters: [],
};

const POOL = { id: 'p-1', label: 'Pool one', kind: 'plan', appliesTo: 'all' as const };

const meter = (id: string, reserveClass: SettingsMeterView['reserveClass'], label: string | null): SettingsMeterView => ({
  id,
  poolId: 'p-1',
  label,
  cadence: 'rolling_from_first_use',
  durationMs: null,
  unit: 'percent',
  used: 0,
  limit: 100,
  remaining: 100,
  resetsAt: null,
  resetPrecision: 'exact',
  observedAt: 0,
  source: 'provider_api',
  staleAfterMs: null,
  reserveClass,
  reserveShare: 0,
});

const PAID: SettingsAccountView = { ...ACCOUNT, authMode: 'api_key', plan: null };

const harness = (result: CommandResult = { ok: true }) => {
  const issued: Command[] = [];
  const store = createAccountEditorStore({
    run: async (command) => {
      issued.push(command);
      return { result, labelKey: commandResultKey(command.type, result) };
    },
    now: () => 1_000,
  });
  return { store, issued };
};

describe('Limit dolunca', () => {
  it('U-30: four policies each with a purpose, wait_resume marked recommended', () => {
    const options = policyOptions({ ...ACCOUNT, pools: [POOL, { ...POOL, id: 'p-2' }] });
    expect(options.map((option) => option.policy)).toEqual(['wait_resume', 'switch_pool', 'fallback_account', 'ask']);
    expect(options.filter((option) => option.recommended).map((option) => option.policy)).toEqual(['wait_resume']);
    expect(options.every((option) => option.purposeKey.startsWith('editor.policy.purpose.'))).toBe(true);
    expect(options.every((option) => option.disabledReasonKey === undefined)).toBe(true);
  });

  it('U-30: switch_pool is disabled with a reason when the account has a single pool', () => {
    for (const pools of [[], [POOL]]) {
      const options = policyOptions({ ...ACCOUNT, pools });
      expect(options.find((option) => option.policy === 'switch_pool')?.disabledReasonKey).toBe('editor.limits.policy.singlePool');
      expect(options.filter((option) => option.disabledReasonKey !== undefined)).toHaveLength(1);
    }
  });

  it('U-30: a policy saves through account.save with limitPolicy and the stored fields, reserve absent', async () => {
    const command = policySaveCommand(ACCOUNT, 'ask');
    expect(command).toEqual({ type: 'account.save', id: 'a-1', provider: 'claude', label: 'Work', authMode: 'subscription', plan: 'pro', limitPolicy: 'ask' });
    expect('reserve' in command).toBe(false);
    const { store, issued } = harness();
    await store.savePolicy(ACCOUNT, 'ask');
    expect(issued).toEqual([command]);
    expect(store.isSaved('limitPolicy')).toBe(true);
  });

  it('U-30: choosing the policy already stored issues nothing', async () => {
    const { store, issued } = harness();
    await store.savePolicy(ACCOUNT, 'wait_resume');
    expect(issued).toEqual([]);
  });
});

describe('Kendi kullanımın için ayır', () => {
  it('U-30: the choice reads Yok, a preset, or split', () => {
    expect(reserveChoice(ACCOUNT)).toBe('none');
    expect(reserveChoice({ ...ACCOUNT, reserve: { short: 0.2, long: 0.2 } })).toBe(20);
    expect(reserveChoice({ ...ACCOUNT, reserve: { short: 0.1, long: 0.3 } })).toBe('split');
    expect(reserveChoice({ ...ACCOUNT, reserve: { short: 0.15, long: 0.15 } })).toBe('split');
  });

  it('U-30: the fine-tune starts open when short differs from long', () => {
    expect(reserveSplitStartsOpen({ ...ACCOUNT, reserve: { short: 0.1, long: 0.3 } })).toBe(true);
    expect(reserveSplitStartsOpen({ ...ACCOUNT, reserve: { short: 0.2, long: 0.2 } })).toBe(false);
    expect(reserveSplitStartsOpen(ACCOUNT)).toBe(false);
  });

  it('U-30: the split fields name the meters of each class, a larger meter under both', () => {
    const account: SettingsAccountView = {
      ...ACCOUNT,
      pools: [POOL],
      meters: [meter('m-1', 'short', '5h'), meter('m-2', 'long', 'Weekly'), meter('m-3', 'larger', null)],
    };
    expect(reserveFieldMeters(account)).toEqual({
      short: [
        { name: '5h', larger: false },
        { name: 'Pool one', larger: true },
      ],
      long: [
        { name: 'Weekly', larger: false },
        { name: 'Pool one', larger: true },
      ],
    });
    expect(reserveFieldMeters(ACCOUNT)).toEqual({ short: [], long: [] });
  });

  it('U-30: a percent is valid only as an integer from 0 to 95', () => {
    expect(parseReservePercent('0')).toBe(0);
    expect(parseReservePercent(' 30 ')).toBe(30);
    expect(parseReservePercent('95')).toBe(95);
    for (const bad of ['96', '-1', '10.5', '', 'abc', '1e1']) expect(parseReservePercent(bad)).toBeNull();
  });

  it('U-30: the reserve saves complete, as shares on the wire (percent ÷ 100)', async () => {
    expect(reserveSaveCommand(ACCOUNT, 10, 30)).toEqual({
      type: 'account.save',
      id: 'a-1',
      provider: 'claude',
      label: 'Work',
      authMode: 'subscription',
      plan: 'pro',
      reserve: { short: 0.1, long: 0.3 },
    });
    expect(reserveSaveCommand(ACCOUNT, 29, 57)).toMatchObject({ reserve: { short: 0.29, long: 0.57 } });
    const { store, issued } = harness();
    await store.saveReserve(ACCOUNT, '20', '20');
    expect(issued).toEqual([reserveSaveCommand(ACCOUNT, 20, 20)]);
    expect(store.isSaved('reserve')).toBe(true);
  });

  it('U-30: 96 stays on the client — an error under the row, nothing issued', async () => {
    const { store, issued } = harness();
    await store.saveReserve(ACCOUNT, '10', '96');
    expect(issued).toEqual([]);
    expect(store.state().failure).toEqual({ row: 'reserve', labelKey: 'editor.limits.reserve.invalid' });
    await store.saveReserve(ACCOUNT, '10', '30');
    expect(store.state().failure).toBeNull();
  });

  it('U-30: an unchanged reserve issues nothing', async () => {
    const { store, issued } = harness();
    await store.saveReserve({ ...ACCOUNT, reserve: { short: 0.1, long: 0.3 } }, '10', '30');
    expect(issued).toEqual([]);
  });

  it('U-30: the api invalid_reserve maps under the reserve row', async () => {
    const { store } = harness({ ok: false, code: 'invalid_reserve' });
    await store.saveReserve(ACCOUNT, '10', '30');
    expect(failureKey('invalid_reserve')).toBe('error.invalid_reserve');
    expect(store.state().failure).toEqual({ row: 'reserve', labelKey: 'error.invalid_reserve' });
  });
});

describe('Harcama tavanı', () => {
  it('U-30: the cap row shows only on a pay-per-use account or one with consentedModels', () => {
    expect(mayHaveCap(ACCOUNT)).toBe(false);
    expect(mayHaveCap(PAID)).toBe(true);
    expect(mayHaveCap({ ...ACCOUNT, consentedModels: ['*'] })).toBe(true);
  });

  it('U-30: the form parses an amount above zero, a period and a warn percent of 1 to 100', () => {
    expect(parseCapForm({ amount: '25,5', scope: 'account_week', warn: '90' })).toEqual({
      ok: true,
      amountUsd: 25.5,
      scope: 'account_week',
      warnPercent: 90,
    });
    expect(parseCapForm({ amount: '0', scope: 'account_day', warn: '80' })).toEqual({ ok: false, field: 'amount' });
    expect(parseCapForm({ amount: '', scope: 'account_day', warn: '80' })).toEqual({ ok: false, field: 'amount' });
    for (const warn of ['0', '101', '8.5', '', 'x']) {
      expect(parseCapForm({ amount: '10', scope: 'account_day', warn })).toEqual({ ok: false, field: 'warn' });
    }
    expect(parseCapForm({ amount: '10', scope: 'account_day', warn: '1' })).toMatchObject({ ok: true, warnPercent: 1 });
    expect(parseCapForm({ amount: '10', scope: 'account_day', warn: '100' })).toMatchObject({ ok: true, warnPercent: 100 });
  });

  it('U-30: a cap saves through account.cap.save; a changed period removes the old scope after saving', () => {
    expect(capSaveCommands(PAID, { amountUsd: 20, scope: 'account_week', warnPercent: 70 })).toEqual([
      { type: 'account.cap.save', id: 'a-1', scope: 'account_week', amountUsd: 20, warnPercent: 70 },
    ]);
    const capped = { ...PAID, caps: [{ scope: 'account_month' as const, amountUsd: 50, warnPercent: 80 }] };
    expect(capSaveCommands(capped, { amountUsd: 20, scope: 'account_week', warnPercent: 70 })).toEqual([
      { type: 'account.cap.save', id: 'a-1', scope: 'account_week', amountUsd: 20, warnPercent: 70 },
      { type: 'account.cap.remove', id: 'a-1', scope: 'account_month' },
    ]);
  });

  it('U-30: a committed cap saves at once; a bad amount or warn stays under its own row', async () => {
    const { store, issued } = harness();
    await store.saveCap(PAID, 'cap', { amount: '40', scope: 'account_month', warn: '80' });
    expect(issued).toEqual([{ type: 'account.cap.save', id: 'a-1', scope: 'account_month', amountUsd: 40, warnPercent: 80 }]);
    expect(store.isSaved('cap')).toBe(true);
    await store.saveCap(PAID, 'cap', { amount: '-3', scope: 'account_month', warn: '80' });
    expect(store.state().failure).toEqual({ row: 'cap', labelKey: 'editor.limits.cap.invalidAmount' });
    await store.saveCap(PAID, 'warnPercent', { amount: '40', scope: 'account_month', warn: '120' });
    expect(store.state().failure).toEqual({ row: 'warnPercent', labelKey: 'editor.limits.cap.invalidWarn' });
    expect(issued).toHaveLength(1);
  });

  it('U-30: an unchanged cap issues nothing', async () => {
    const { store, issued } = harness();
    const capped = { ...PAID, caps: [{ scope: 'account_month' as const, amountUsd: 50, warnPercent: 80 }] };
    await store.saveCap(capped, 'cap', { amount: '50', scope: 'account_month', warn: '80' });
    expect(issued).toEqual([]);
  });

  it('U-30: cap_required and invalid_cap map under the cap row', async () => {
    const required = harness({ ok: false, code: 'cap_required' });
    await required.store.saveCap(PAID, 'cap', { amount: '40', scope: 'account_month', warn: '80' });
    expect(required.store.state().failure).toEqual({ row: 'cap', labelKey: 'error.cap_required' });
    const invalid = harness({ ok: false, code: 'invalid_cap' });
    await invalid.store.saveCap(PAID, 'cap', { amount: '40', scope: 'account_month', warn: '80' });
    expect(invalid.store.state().failure).toEqual({ row: 'cap', labelKey: 'error.invalid_cap' });
  });

  it('U-29: the warn fine-tune starts open when the warn percent differs from 80', () => {
    expect(capFormStartsOpen(PAID)).toBe(false);
    expect(capFormStartsOpen({ ...PAID, caps: [{ scope: 'account_month', amountUsd: 50, warnPercent: 60 }] })).toBe(true);
  });
});
