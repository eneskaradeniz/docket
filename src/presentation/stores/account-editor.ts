// stores/account-editor.ts — the account editor's rules (U-29, U-30, U-31) as data and pure
// helpers: the tab model, the Genel facts (a key's standing is a boolean, never a value), the
// Kullanım reading, the reserve zone on a bar, the reset intents as command payloads, and the
// save-on-commit state (the "Kaydedildi" flag for 1.5 s, a failure mapped through U-8 under its
// row). The store never touches the api: it issues commands through an injected runner, so the
// Settings host and any later host share one body. Time is injected.
import type { Command, CommandResult } from '../../api/commands';
import type { SettingsAccountView, SettingsMeterView } from '../../api/queries';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { RECOMMENDED, settingDiffs, type SettingDiff, type SettingKey } from './recommended';
import type { SettingsOpenTarget } from './settings-panel';

export type EditorTab = 'general' | 'usage' | 'limits' | 'models';

export const EDITOR_TABS: readonly EditorTab[] = ['general', 'usage', 'limits', 'models'];

/** How long "Kaydedildi" stays beside a row after a save (U-29). */
export const SAVED_FLAG_MS = 1500;

export type FactKey = 'provider' | 'connection' | 'plan' | 'identityDir' | 'endpointHost' | 'secret';

export interface AccountFact {
  readonly key: FactKey;
  /** Text for a fact; `secret` is whether a key sits in the keychain, never the key. */
  readonly value: string | boolean;
}

/** The read-only facts of Genel, in display order; an absent optional fact is omitted. */
export const generalFacts = (account: SettingsAccountView): readonly AccountFact[] => {
  const facts: AccountFact[] = [
    { key: 'provider', value: account.provider },
    { key: 'connection', value: account.authMode },
  ];
  if (account.plan !== null) facts.push({ key: 'plan', value: account.plan });
  if (account.identityDir !== null) facts.push({ key: 'identityDir', value: account.identityDir });
  if (account.endpointHost !== null) facts.push({ key: 'endpointHost', value: account.endpointHost });
  facts.push({ key: 'secret', value: account.hasSecret });
  return facts;
};

type AccountSave = Extract<Command, { readonly type: 'account.save' }>;

// The account's stored fields, resent unchanged: account.save replaces them, while reserve and
// limitPolicy left absent are kept by the api (A-45).
const accountFields = (account: SettingsAccountView): AccountSave => ({
  type: 'account.save',
  id: account.id,
  provider: account.provider,
  label: account.label,
  authMode: account.authMode,
  ...(account.plan !== null ? { plan: account.plan } : {}),
});

export const labelSaveCommand = (account: SettingsAccountView, label: string): Command => ({
  ...accountFields(account),
  label,
});

const capSave = (id: string, scope: string, amountUsd: number, warnPercent: number): Command => ({
  type: 'account.cap.save',
  id,
  scope,
  amountUsd,
  warnPercent,
});

/** The commands that bring one setting back to the recommendation. */
export const resetCommands = (account: SettingsAccountView, key: SettingKey): readonly Command[] => {
  switch (key) {
    case 'limitPolicy':
      return [{ ...accountFields(account), limitPolicy: RECOMMENDED.limitPolicy }];
    case 'reserve':
      return [{ ...accountFields(account), reserve: { ...RECOMMENDED.reserve } }];
    case 'cap': {
      const { scope, amountUsd } = RECOMMENDED.cap;
      const others: Command[] = account.caps
        .filter((cap) => cap.scope !== scope)
        .map((cap) => ({ type: 'account.cap.remove', id: account.id, scope: cap.scope }));
      return [capSave(account.id, scope, amountUsd, RECOMMENDED.warnPercent), ...others];
    }
    case 'warnPercent':
      return account.caps
        .filter((cap) => cap.warnPercent !== RECOMMENDED.warnPercent)
        .map((cap) => capSave(account.id, cap.scope, cap.amountUsd, RECOMMENDED.warnPercent));
  }
};

/** Every differing setting reset once; a cap reset already writes the recommended warn percent,
 *  so the warn reset is not issued on top of it. */
export const resetAllCommands = (account: SettingsAccountView): readonly Command[] => {
  const keys = settingDiffs(account).map((diff) => diff.key);
  const covered = keys.includes('cap');
  return keys.filter((key) => !(covered && key === 'warnPercent')).flatMap((key) => resetCommands(account, key));
};

/** The disclosures an editor carries and the setting each one holds. */
export type DisclosureKey = 'reserve' | 'warnPercent';

/** A disclosure whose content differs from the recommendation starts open (U-29). */
export const disclosureStartsOpen = (account: SettingsAccountView, key: DisclosureKey): boolean =>
  settingDiffs(account).some((diff) => diff.key === key);

export type UsageView =
  | { readonly kind: 'meters'; readonly meters: readonly SettingsMeterView[] }
  | {
      readonly kind: 'spend';
      readonly spentUsd: number | null;
      readonly cap: { readonly scope: string; readonly amountUsd: number } | null;
    };

/** Kullanım: a subscription account reads as bars, a pay-per-use one as this period's spend
 *  against its cap. */
export const usageView = (account: SettingsAccountView): UsageView => {
  if (account.authMode === 'subscription') return { kind: 'meters', meters: account.meters };
  const usd = account.meters.filter((meter) => meter.unit === 'usd' && meter.used !== null);
  const spentUsd = usd.length === 0 ? null : usd.reduce((sum, meter) => sum + (meter.used ?? 0), 0);
  const cap = account.caps[0];
  return { kind: 'spend', spentUsd, cap: cap === undefined ? null : { scope: cap.scope, amountUsd: cap.amountUsd } };
};

export interface MeterBar {
  /** Remaining from the left, 0..1; null when the meter cannot say. */
  readonly fill: number | null;
  /** The hatched zone from 0 to this share; null = no zone. */
  readonly zone: number | null;
  /** Remaining is at or below the reserve: "Rezerve ulaştı". */
  readonly reached: boolean;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const normalizedFill = (meter: Pick<SettingsMeterView, 'unit' | 'remaining' | 'used' | 'limit'>): number | null => {
  if (meter.unit === 'fraction') return meter.remaining === null ? null : clamp01(meter.remaining);
  if (meter.unit === 'percent') return meter.remaining === null ? null : clamp01(meter.remaining / 100);
  if (meter.limit !== null && meter.limit > 0) {
    if (meter.remaining !== null) return clamp01(meter.remaining / meter.limit);
    if (meter.used !== null) return clamp01(1 - meter.used / meter.limit);
  }
  return null;
};

/** U-31: the zone's width is the meter's `reserveShare` as the api computed it; a unit that is
 *  not a share (percent or fraction) never draws one. */
export const meterBar = (
  meter: Pick<SettingsMeterView, 'unit' | 'remaining' | 'used' | 'limit' | 'reserveShare'>,
): MeterBar => {
  const fill = normalizedFill(meter);
  const isShare = meter.unit === 'percent' || meter.unit === 'fraction';
  const zone = isShare && meter.reserveShare > 0 ? meter.reserveShare : null;
  return { fill, zone, reached: zone !== null && fill !== null && fill <= zone };
};

export type AccountStatus = 'ready' | 'reserve' | 'noData';

/** The status a Hesaplar row shows: a reached reserve outranks ready; no readable meter = no data. */
export const accountStatus = (account: SettingsAccountView): AccountStatus => {
  const bars = account.meters.map(meterBar);
  if (bars.some((bar) => bar.reached)) return 'reserve';
  return bars.some((bar) => bar.fill !== null) ? 'ready' : 'noData';
};

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);

const POLICY_KEY: Readonly<Record<SettingsAccountView['limitPolicy'], LabelKey>> = {
  wait_resume: 'editor.policy.wait_resume',
  switch_pool: 'editor.policy.switch_pool',
  fallback_account: 'editor.policy.fallback_account',
  ask: 'editor.policy.ask',
};

export const policyLabelKey = (policy: SettingsAccountView['limitPolicy']): LabelKey => POLICY_KEY[policy];

const percentText = (share: string): string => String(Math.round(Number(share) * 100));

const CAP_SCOPE_LABEL: Readonly<Record<string, LabelKey>> = {
  account_day: 'cap.scope.account_day',
  account_week: 'cap.scope.account_week',
  account_month: 'cap.scope.account_month',
};

/** A diff value (current or recommended) as the "Önerilenden farklı" line names it. */
export const diffValueLabel = (locale: Locale, key: SettingDiff['key'], value: string | number): string => {
  const text = String(value);
  switch (key) {
    case 'limitPolicy': {
      const policyKey = POLICY_KEY[text as SettingsAccountView['limitPolicy']];
      return policyKey === undefined ? text : t(locale, policyKey);
    }
    case 'reserve': {
      const [short = '0', long = '0'] = text.split('/');
      return fill(t(locale, 'editor.value.reserve'), { short: percentText(short), long: percentText(long) });
    }
    case 'cap': {
      const [scope = '', amount = ''] = text.split(':');
      const scopeKey = CAP_SCOPE_LABEL[scope];
      return fill(t(locale, 'editor.value.cap'), { amount, scope: scopeKey === undefined ? scope : t(locale, scopeKey) });
    }
    case 'warnPercent':
      return fill(t(locale, 'editor.value.warn'), { value: text });
  }
};

export interface EditorOutcome {
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

export interface AccountEditorDeps {
  /** Issues one command as the user and reports its U-8 mapping. */
  readonly run: (command: Command) => Promise<EditorOutcome>;
  readonly now: () => number;
}

export interface AccountEditorState {
  readonly tab: EditorTab;
  readonly savedRow: string | null;
  readonly savedUntil: number;
  /** The latest failure and the row it sits under; null while clean. */
  readonly failure: { readonly row: string; readonly labelKey: LabelKey } | null;
}

export interface AccountEditorStore {
  state(): AccountEditorState;
  subscribe(listener: () => void): () => void;
  setTab(tab: EditorTab): void;
  /** Whether "Kaydedildi" shows beside this row right now. */
  isSaved(row: string): boolean;
  saveLabel(account: SettingsAccountView, label: string): Promise<void>;
  reset(account: SettingsAccountView, key: SettingKey): Promise<void>;
  resetAll(account: SettingsAccountView): Promise<void>;
}

export const createAccountEditorStore = (deps: AccountEditorDeps): AccountEditorStore => {
  let state: AccountEditorState = { tab: 'general', savedRow: null, savedUntil: 0, failure: null };
  const listeners = new Set<() => void>();
  const set = (next: AccountEditorState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  // Commands run in order; the first failure stops the rest and lands under `row`.
  const runAll = async (row: string, commands: readonly Command[]): Promise<void> => {
    for (const command of commands) {
      const outcome = await deps.run(command);
      if (!outcome.result.ok) {
        set({ ...state, failure: { row, labelKey: outcome.labelKey } });
        return;
      }
    }
    set({ ...state, failure: null, savedRow: row, savedUntil: deps.now() + SAVED_FLAG_MS });
  };

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTab: (tab) => set({ ...state, tab }),
    isSaved: (row) => state.savedRow === row && deps.now() < state.savedUntil,
    saveLabel: async (account, label) => {
      const next = label.trim();
      if (next === '' || next === account.label) return;
      await runAll('label', [labelSaveCommand(account, next)]);
    },
    reset: (account, key) => runAll(key, resetCommands(account, key)),
    resetAll: async (account) => {
      const commands = resetAllCommands(account);
      if (commands.length === 0) return;
      await runAll('all', commands);
    },
  };
};

/** The roles whose chain routes the account, in the roles list's order — the chips on Genel (U-37).
 *  Pure; `null` rows (roles not loaded yet) read as none. */
export const rolesOfAccount = (
  rows: readonly { readonly id: string; readonly name: string; readonly chain: readonly { readonly accountId: string }[] }[] | null,
  accountId: string,
): readonly { readonly id: string; readonly name: string }[] =>
  (rows ?? [])
    .filter((row) => row.chain.some((entry) => entry.accountId === accountId))
    .map((row) => ({ id: row.id, name: row.name }));

/** A role chip's intent (U-37): Settings → Roller with that role's "İnce ayar" open. */
export const roleChipTarget = (roleId: string): SettingsOpenTarget => ({ section: 'roles', fineTune: roleId });
