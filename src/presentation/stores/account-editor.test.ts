// account-editor.test.ts — U-29 (reset intents, open-when-changed, save on commit with the 1.5 s
// "Kaydedildi" flag, U-8 failures under the row), U-30 (tab model, Genel facts, the label save,
// no secret field) and U-31 (the reserve zone on a bar, the "Rezerve ulaştı" flag, no zone for a
// unit that is not a share). Node environment; the command runner and the clock are injected.
import { describe, expect, it } from 'vitest';

import type { Command, CommandResult } from '../../api/commands';
import type { SettingsAccountView, SettingsMeterView } from '../../api/queries';

import {
  EDITOR_TABS,
  SAVED_FLAG_MS,
  accountStatus,
  createAccountEditorStore,
  diffValueLabel,
  disclosureStartsOpen,
  accountHeadMeta,
  accountStatusTone,
  diffCountText,
  generalFacts,
  labelSaveCommand,
  meterBar,
  resetCommands,
  roleChipTarget,
  rolesOfAccount,
  usageView,
} from './account-editor';
import { CLOSED_SETTINGS_PANEL, settingsPanelReducer } from './settings-panel';

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
  identityDir: '/home/u/.claude-work',
  endpointHost: null,
  hasSecret: false,
  test: null,
  pools: [],
  meters: [],
};

const METER: SettingsMeterView = {
  id: 'm-1',
  poolId: 'p-1',
  label: 'Weekly',
  cadence: 'rolling_from_first_use',
  durationMs: 604_800_000,
  unit: 'percent',
  used: 40,
  limit: 100,
  remaining: 60,
  resetsAt: null,
  resetPrecision: 'exact',
  observedAt: 0,
  source: 'provider_api',
  staleAfterMs: null,
  reserveClass: 'long',
  reserveShare: 0.2,
};

const OFF: SettingsAccountView = {
  ...ACCOUNT,
  limitPolicy: 'ask',
  reserve: { short: 0.1, long: 0.2 },
  caps: [
    { scope: 'account_day', amountUsd: 20, warnPercent: 90 },
    { scope: 'account_month', amountUsd: 50, warnPercent: 80 },
  ],
};

const harness = (result: CommandResult = { ok: true }) => {
  const issued: Command[] = [];
  let clock = 1_000;
  const store = createAccountEditorStore({
    run: async (command) => {
      issued.push(command);
      return { result, labelKey: result.ok ? 'success.account.save' : 'error.not_found' };
    },
    now: () => clock,
  });
  return { store, issued, advance: (ms: number) => (clock += ms) };
};

describe('account editor', () => {
  it('U-30: the editor body has four tabs in order, Genel first', () => {
    expect(EDITOR_TABS).toEqual(['general', 'usage', 'limits', 'models']);
    const { store } = harness();
    expect(store.state().tab).toBe('general');
    store.setTab('limits');
    expect(store.state().tab).toBe('limits');
  });

  it('U-30: Genel maps provider, connection, plan, identityDir, endpointHost and the key standing', () => {
    expect(generalFacts(ACCOUNT)).toEqual([
      { key: 'provider', value: 'claude' },
      { key: 'connection', value: 'subscription' },
      { key: 'plan', value: 'pro' },
      { key: 'identityDir', value: '/home/u/.claude-work' },
      { key: 'secret', value: false },
    ]);
    const keyed = generalFacts({ ...ACCOUNT, authMode: 'api_key', plan: null, identityDir: null, endpointHost: 'api.example.com', hasSecret: true });
    expect(keyed).toEqual([
      { key: 'provider', value: 'claude' },
      { key: 'connection', value: 'api_key' },
      { key: 'endpointHost', value: 'api.example.com' },
      { key: 'secret', value: true },
    ]);
  });

  it('U-30: Genel carries no secret value — only a boolean for the key', () => {
    const facts = generalFacts({ ...ACCOUNT, hasSecret: true });
    const secret = facts.find((fact) => fact.key === 'secret');
    expect(secret?.value).toBe(true);
    expect(facts.every((fact) => fact.key !== 'secret' || typeof fact.value === 'boolean')).toBe(true);
    expect(JSON.stringify(facts)).not.toMatch(/secretRef|token|apiKey/i);
  });

  it('U-30: the label saves through account.save with the account existing fields and no reserve or policy', () => {
    expect(labelSaveCommand(ACCOUNT, 'Home')).toEqual({
      type: 'account.save',
      id: 'a-1',
      provider: 'claude',
      label: 'Home',
      authMode: 'subscription',
      plan: 'pro',
    });
    const noPlan = labelSaveCommand({ ...ACCOUNT, plan: null }, 'Home');
    expect('plan' in noPlan).toBe(false);
    expect('reserve' in noPlan).toBe(false);
    expect('limitPolicy' in noPlan).toBe(false);
  });

  it('U-30: Kullanım shows one bar per meter, or spend against the cap for a pay-per-use account', () => {
    expect(usageView({ ...ACCOUNT, meters: [METER] })).toEqual({ kind: 'meters', meters: [METER] });
    const usd = { ...METER, id: 'm-2', unit: 'usd', used: 12.5, limit: null, remaining: null };
    const paid = usageView({
      ...ACCOUNT,
      authMode: 'api_key',
      meters: [usd],
      caps: [{ scope: 'account_month', amountUsd: 50, warnPercent: 80 }],
    });
    expect(paid).toEqual({ kind: 'spend', spentUsd: 12.5, cap: { scope: 'account_month', amountUsd: 50 } });
    expect(usageView({ ...ACCOUNT, authMode: 'api_key' })).toEqual({ kind: 'spend', spentUsd: null, cap: null });
  });

  it('U-30: saving the label ignores an unchanged or empty value and issues nothing', async () => {
    const { store, issued } = harness();
    await store.saveLabel(ACCOUNT, 'Work');
    await store.saveLabel(ACCOUNT, '   ');
    expect(issued).toEqual([]);
  });

  it('U-29: a committed label saves at once and shows Kaydedildi for 1.5 s', async () => {
    const { store, issued, advance } = harness();
    await store.saveLabel(ACCOUNT, ' Home ');
    expect(issued).toEqual([labelSaveCommand(ACCOUNT, 'Home')]);
    expect(SAVED_FLAG_MS).toBe(1500);
    expect(store.isSaved('label')).toBe(true);
    advance(1_499);
    expect(store.isSaved('label')).toBe(true);
    advance(1);
    expect(store.isSaved('label')).toBe(false);
  });

  it('U-29: a failure maps through U-8 under the row and shows no Kaydedildi', async () => {
    const { store } = harness({ ok: false, code: 'not_found' });
    await store.saveLabel(ACCOUNT, 'Home');
    expect(store.state().failure).toEqual({ row: 'label', labelKey: 'error.not_found' });
    expect(store.isSaved('label')).toBe(false);
  });

  it('U-29: Önerilene dön is a command payload per setting, keeping the account fields', () => {
    const base = { type: 'account.save', id: 'a-1', provider: 'claude', label: 'Work', authMode: 'subscription', plan: 'pro' };
    expect(resetCommands(OFF, 'limitPolicy')).toEqual([{ ...base, limitPolicy: 'wait_resume' }]);
    expect(resetCommands(OFF, 'reserve')).toEqual([{ ...base, reserve: { short: 0, long: 0 } }]);
    expect(resetCommands(OFF, 'cap')).toEqual([
      { type: 'account.cap.save', id: 'a-1', scope: 'account_month', amountUsd: 50, warnPercent: 80 },
      { type: 'account.cap.remove', id: 'a-1', scope: 'account_day' },
    ]);
    const warn = { ...ACCOUNT, caps: [{ scope: 'account_month' as const, amountUsd: 50, warnPercent: 95 }] };
    expect(resetCommands(warn, 'warnPercent')).toEqual([
      { type: 'account.cap.save', id: 'a-1', scope: 'account_month', amountUsd: 50, warnPercent: 80 },
    ]);
  });

  it('U-29: Hepsini önerilene döndür resets every differing setting once', async () => {
    const { store, issued } = harness();
    await store.resetAll(OFF);
    expect(issued.map((command) => command.type)).toEqual(['account.save', 'account.save', 'account.cap.save', 'account.cap.remove']);
    expect(store.isSaved('all')).toBe(true);
    const clean = harness();
    await clean.store.resetAll(ACCOUNT);
    expect(clean.issued).toEqual([]);
  });

  it('U-29: a failing reset stops at the first failure and shows it under that row', async () => {
    const { store, issued } = harness({ ok: false, code: 'not_found' });
    await store.reset(OFF, 'cap');
    expect(issued).toHaveLength(1);
    expect(store.state().failure).toEqual({ row: 'cap', labelKey: 'error.not_found' });
  });

  it('U-29: a disclosure starts open exactly when its content differs from the recommendation', () => {
    expect(disclosureStartsOpen(ACCOUNT, 'reserve')).toBe(false);
    expect(disclosureStartsOpen(OFF, 'reserve')).toBe(true);
    expect(disclosureStartsOpen(OFF, 'warnPercent')).toBe(true);
    expect(disclosureStartsOpen({ ...ACCOUNT, caps: [{ scope: 'account_month', amountUsd: 50, warnPercent: 80 }] }, 'warnPercent')).toBe(false);
  });

  it('U-31: the zone width is the meter reserveShare and the bar fills from the left by remaining', () => {
    expect(meterBar(METER)).toEqual({ fill: 0.6, zone: 0.2, reached: false });
    expect(meterBar({ ...METER, unit: 'fraction', remaining: 0.5, reserveShare: 0.1 })).toEqual({ fill: 0.5, zone: 0.1, reached: false });
  });

  it('U-31: Rezerve ulaştı shows when normalized remaining is at or below the share', () => {
    expect(meterBar({ ...METER, remaining: 20 }).reached).toBe(true);
    expect(meterBar({ ...METER, remaining: 15 }).reached).toBe(true);
    expect(meterBar({ ...METER, remaining: 21 }).reached).toBe(false);
  });

  it('U-31: a meter without a reserve, or whose unit is not a share, draws no zone', () => {
    expect(meterBar({ ...METER, reserveShare: 0 })).toEqual({ fill: 0.6, zone: null, reached: false });
    const counted = meterBar({ ...METER, unit: 'prompts', used: 10, limit: 100, remaining: 90, reserveShare: 0.2 });
    expect(counted.zone).toBeNull();
    expect(counted.reached).toBe(false);
    expect(meterBar({ ...METER, remaining: null, used: null }).fill).toBeNull();
  });

  it('U-31: a Hesaplar row status is reserve when a bar reached it, ready with a reading, else no data', () => {
    expect(accountStatus({ ...ACCOUNT, meters: [METER] })).toBe('ready');
    expect(accountStatus({ ...ACCOUNT, meters: [{ ...METER, remaining: 10 }] })).toBe('reserve');
    expect(accountStatus(ACCOUNT)).toBe('noData');
  });

  it('U-29: diff values read in the active locale', () => {
    expect(diffValueLabel('tr', 'limitPolicy', 'ask')).toBe('Sor');
    expect(diffValueLabel('tr', 'reserve', '0.1/0.2')).toBe('%10 · %20');
    expect(diffValueLabel('en', 'reserve', '0/0')).toBe('0% · 0%');
    expect(diffValueLabel('tr', 'cap', 'account_month:50')).toBe('$50 · Aylık');
    expect(diffValueLabel('tr', 'warnPercent', 80)).toBe('%80');
  });
});

describe('U-37: role chips on Genel', () => {
  const row = (id: string, name: string, accountIds: readonly string[]) => ({
    id,
    name,
    chain: accountIds.map((accountId) => ({ accountId, model: null })),
  });

  it('U-37: the chips are the roles whose chain routes the account, in the roles list order', () => {
    const rows = [row('planner', 'Planlayıcı', ['a-1', 'a-2']), row('dev', 'Geliştirici', ['a-2']), row('test', 'Test yazarı', ['a-1'])];
    expect(rolesOfAccount(rows, 'a-1')).toStrictEqual([
      { id: 'planner', name: 'Planlayıcı' },
      { id: 'test', name: 'Test yazarı' },
    ]);
    expect(rolesOfAccount(rows, 'a-9')).toStrictEqual([]);
    expect(rolesOfAccount(null, 'a-1')).toStrictEqual([]);
  });

  it("U-37: a role chip opens Settings → Roller with that role's İnce ayar open", () => {
    const state = settingsPanelReducer(CLOSED_SETTINGS_PANEL, { type: 'open', origin: 'pointer', ...roleChipTarget('planner') });
    expect(state).toMatchObject({ open: true, section: 'roles', subPage: null, fineTune: 'planner' });
  });
});

describe('Genel and the diff wording (U-29, U-30)', () => {
  it('U-30: Genel shows the provider display name; the id only when no name is known', () => {
    expect(generalFacts(ACCOUNT, 'Claude Code')[0]).toEqual({ key: 'provider', value: 'Claude Code' });
    expect(generalFacts(ACCOUNT, null)[0]).toEqual({ key: 'provider', value: 'claude' });
    expect(generalFacts(ACCOUNT)[0]).toEqual({ key: 'provider', value: 'claude' });
  });

  it('U-29: the count reads "n ayar önerilenden farklı" everywhere, never an abbreviation', () => {
    expect(diffCountText('tr', 1)).toBe('1 ayar önerilenden farklı');
    expect(diffCountText('tr', 3)).toBe('3 ayar önerilenden farklı');
    expect(diffCountText('en', 2)).toBe('2 settings differ from the recommendation');
  });

  it('U-30: the sub-page head reads "sağlayıcı adı · bağlantı · plan" — the id without a name, no plan no third part', () => {
    expect(accountHeadMeta('tr', ACCOUNT, 'Claude Code')).toBe('Claude Code · Abonelik · pro');
    expect(accountHeadMeta('tr', { ...ACCOUNT, plan: null, authMode: 'api_key' }, null)).toBe('claude · API anahtarı');
    expect(accountHeadMeta('en', ACCOUNT, 'Claude Code')).toBe('Claude Code · Subscription · pro');
  });

  it('U-28: an account status is a lamp and a word — ready proceed, reserve reached signal, no data dim', () => {
    expect(accountStatusTone('ready')).toBe('proceed');
    expect(accountStatusTone('reserve')).toBe('signal');
    expect(accountStatusTone('noData')).toBe('dim');
  });
});
