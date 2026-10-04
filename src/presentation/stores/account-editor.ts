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
import type { LampTone } from './candidates';
import { CAP_SCOPES, parseAmountUsd, type CapScope } from './account-models';
import { hasModelScopedPool } from './pool-scope';
import { RECOMMENDED, mayHaveCap, settingDiffs, type SettingDiff, type SettingKey } from './recommended';
import type { SettingsOpenTarget } from './settings-panel';

export { CAP_SCOPES, mayHaveCap };

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

const CONNECTION_KEY: Readonly<Record<string, LabelKey>> = {
  subscription: 'auth.mode.subscription',
  api_key: 'auth.mode.api_key',
  cloud: 'auth.mode.cloud',
  byok: 'auth.mode.byok',
};

/** The words of a connection (auth mode); an unknown mode reads as itself. */
export const connectionText = (locale: Locale, authMode: string): string => {
  const key = CONNECTION_KEY[authMode];
  return key === undefined ? authMode : t(locale, key);
};

/** The sub-page head's second line: "sağlayıcı adı · bağlantı · plan"; no plan, no third part. */
export const accountHeadMeta = (locale: Locale, account: SettingsAccountView, providerName: string | null): string =>
  [providerName ?? account.provider, connectionText(locale, account.authMode), account.plan]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

/** "n ayar önerilenden farklı" — the one wording of the U-29 count, in the list row and the head. */
export const diffCountText = (locale: Locale, n: number): string => t(locale, 'editor.head.diffs').replace('{n}', String(n));

/** The read-only facts of Genel, in display order; an absent optional fact is omitted. The
 *  provider reads by its display name (A-67), by its id only when no name is known. */
export const generalFacts = (account: SettingsAccountView, providerName: string | null = null): readonly AccountFact[] => {
  const facts: AccountFact[] = [
    { key: 'provider', value: providerName ?? account.provider },
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

/** Kullanım: an account whose billing view is `included` reads as bars, any other (pay per use,
 *  unknown) as this period's spend against its cap — decided by the billing view, never by the
 *  connection kind (A-83: a coding plan on a key is still a subscription). */
export const usageView = (account: SettingsAccountView): UsageView => {
  if (account.billing === 'included') return { kind: 'meters', meters: account.meters };
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

export type AccountStatus = 'ready' | 'reserve' | 'noData' | 'modelError';

/** The status a Hesaplar row shows: a failed account test of class `model` outranks everything
 *  until the next test or reset (U-39); then a reached reserve outranks ready; no readable meter
 *  = no data. */
export const accountStatus = (account: SettingsAccountView): AccountStatus => {
  if (account.test?.state === 'failed' && account.test.class === 'model') return 'modelError';
  const bars = account.meters.map(meterBar);
  if (bars.some((bar) => bar.reached)) return 'reserve';
  return bars.some((bar) => bar.fill !== null) ? 'ready' : 'noData';
};

/** The lamp hue of an account's status word (U-28): ready proceed, a reached reserve signal, no data dim. */
export const accountStatusTone = (status: AccountStatus): LampTone =>
  status === 'ready' ? 'proceed' : status === 'reserve' ? 'signal' : status === 'modelError' ? 'error' : 'dim';

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

export type LimitPolicy = SettingsAccountView['limitPolicy'];

// Display order of "Limit dolunca" (U-43): resume, next account, pool switch, ask.
const POLICY_ORDER: readonly LimitPolicy[] = ['wait_resume', 'fallback_account', 'switch_pool', 'ask'];

const POLICY_PURPOSE_KEY: Readonly<Record<LimitPolicy, LabelKey>> = {
  wait_resume: 'editor.policy.purpose.wait_resume',
  switch_pool: 'editor.policy.purpose.switch_pool',
  fallback_account: 'editor.policy.purpose.fallback_account',
  ask: 'editor.policy.purpose.ask',
};

/** The policies an account offers (U-42, U-43): all but the pool switch, which needs a model-scoped
 *  pool to switch within — kept visible when it is already the stored choice, so a value is never hidden. */
export const policyChoices = (account: Pick<SettingsAccountView, 'pools' | 'limitPolicy'>): readonly LimitPolicy[] =>
  POLICY_ORDER.filter((policy) => policy !== 'switch_pool' || hasModelScopedPool(account.pools) || account.limitPolicy === 'switch_pool');

export interface PolicyOption {
  readonly policy: LimitPolicy;
  readonly labelKey: LabelKey;
  readonly purposeKey: LabelKey;
  readonly recommended: boolean;
}

/** "Limit dolunca" as radio cards in the editor and as the wizard's Listbox: the same options. */
export const policyOptions = (account: Pick<SettingsAccountView, 'pools' | 'limitPolicy'>): readonly PolicyOption[] =>
  policyChoices(account).map((policy) => ({
    policy,
    labelKey: POLICY_KEY[policy],
    purposeKey: POLICY_PURPOSE_KEY[policy],
    recommended: policy === RECOMMENDED.limitPolicy,
  }));

export const policySaveCommand = (account: SettingsAccountView, policy: LimitPolicy): Command => ({
  ...accountFields(account),
  limitPolicy: policy,
});

/** The share presets of "Kendi kullanımın için ayır", in percent. */
export const RESERVE_PRESETS: readonly number[] = [10, 20, 30];

/** The reserve's ceiling in percent (A-45: shares 0..0.95). */
export const RESERVE_MAX_PERCENT = 95;

const toPercent = (share: number | null): number => Math.round((share ?? 0) * 100);

export type ReserveChoice = 'none' | 10 | 20 | 30 | 'split';

/** Which option of the reserve row the stored reserve reads as; anything else is a split. */
export const reserveChoice = (account: SettingsAccountView): ReserveChoice => {
  const short = toPercent(account.reserve.short);
  const long = toPercent(account.reserve.long);
  if (short !== long) return 'split';
  if (short === 0) return 'none';
  return short === 10 || short === 20 || short === 30 ? short : 'split';
};

/** The separate short/long fields start open whenever the reserve is not one of the presets. */
export const reserveSplitStartsOpen = (account: SettingsAccountView): boolean => reserveChoice(account) === 'split';

export interface ReserveFieldMeter {
  readonly name: string;
  /** A `larger` meter: it answers to both fields and the larger share governs. */
  readonly larger: boolean;
}

/** The meters each split field governs, by name; a `larger` meter is named under both. */
export const reserveFieldMeters = (
  account: SettingsAccountView,
): { readonly short: readonly ReserveFieldMeter[]; readonly long: readonly ReserveFieldMeter[] } => {
  const named = (meter: SettingsMeterView, larger: boolean): ReserveFieldMeter => ({
    name: meter.label ?? account.pools.find((pool) => pool.id === meter.poolId)?.label ?? meter.poolId,
    larger,
  });
  const forField = (field: 'short' | 'long'): readonly ReserveFieldMeter[] =>
    account.meters
      .filter((meter) => meter.reserveClass === field || meter.reserveClass === 'larger')
      .map((meter) => named(meter, meter.reserveClass === 'larger'));
  return { short: forField('short'), long: forField('long') };
};

/** A reserve field: an integer percent from 0 to 95; null when the text is anything else. */
export const parseReservePercent = (raw: string): number | null => {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value <= RESERVE_MAX_PERCENT ? value : null;
};

/** The complete reserve, both windows, as shares on the wire (percent ÷ 100). */
export const reserveSaveCommand = (account: SettingsAccountView, shortPercent: number, longPercent: number): Command => ({
  ...accountFields(account),
  reserve: { short: shortPercent / 100, long: longPercent / 100 },
});

export interface CapFormInput {
  readonly amount: string;
  readonly scope: CapScope;
  readonly warn: string;
}

export type CapFormParse =
  | { readonly ok: true; readonly amountUsd: number; readonly scope: CapScope; readonly warnPercent: number }
  | { readonly ok: false; readonly field: 'amount' | 'warn' };

/** An amount above zero, a period, and a warn percent that is an integer from 1 to 100. */
export const parseCapForm = (input: CapFormInput): CapFormParse => {
  const amountUsd = parseAmountUsd(input.amount);
  if (amountUsd === null) return { ok: false, field: 'amount' };
  const warn = input.warn.trim();
  const warnPercent = /^\d+$/.test(warn) ? Number(warn) : 0;
  if (warnPercent < 1 || warnPercent > 100) return { ok: false, field: 'warn' };
  return { ok: true, amountUsd, scope: input.scope, warnPercent };
};

/** The cap saved, then every other period's cap removed so one cap remains (the account never
 *  has none in between, so a consented account is not refused). */
export const capSaveCommands = (
  account: SettingsAccountView,
  cap: { readonly amountUsd: number; readonly scope: string; readonly warnPercent: number },
): readonly Command[] => [
  capSave(account.id, cap.scope, cap.amountUsd, cap.warnPercent),
  ...account.caps
    .filter((existing) => existing.scope !== cap.scope)
    .map((existing): Command => ({ type: 'account.cap.remove', id: account.id, scope: existing.scope })),
];

/** The warn-percent fine-tune starts open when the stored warn percent is not the recommended one. */
export const capFormStartsOpen = (account: SettingsAccountView): boolean => disclosureStartsOpen(account, 'warnPercent');

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
  savePolicy(account: SettingsAccountView, policy: SettingsAccountView['limitPolicy']): Promise<void>;
  /** Raw field text; a value outside 0–95 stays under the row and issues nothing. */
  saveReserve(account: SettingsAccountView, shortRaw: string, longRaw: string): Promise<void>;
  /** `row` is the row whose control was committed; a bad field lands under its own row. */
  saveCap(account: SettingsAccountView, row: 'cap' | 'warnPercent', input: CapFormInput): Promise<void>;
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
    savePolicy: async (account, policy) => {
      if (policy === account.limitPolicy) return;
      await runAll('limitPolicy', [policySaveCommand(account, policy)]);
    },
    saveReserve: async (account, shortRaw, longRaw) => {
      const short = parseReservePercent(shortRaw);
      const long = parseReservePercent(longRaw);
      if (short === null || long === null) {
        set({ ...state, failure: { row: 'reserve', labelKey: 'editor.limits.reserve.invalid' } });
        return;
      }
      if (short === toPercent(account.reserve.short) && long === toPercent(account.reserve.long)) {
        if (state.failure?.row === 'reserve') set({ ...state, failure: null });
        return;
      }
      await runAll('reserve', [reserveSaveCommand(account, short, long)]);
    },
    saveCap: async (account, row, input) => {
      const parsed = parseCapForm(input);
      if (!parsed.ok) {
        const labelKey = parsed.field === 'amount' ? 'editor.limits.cap.invalidAmount' : 'editor.limits.cap.invalidWarn';
        set({ ...state, failure: { row: parsed.field === 'amount' ? 'cap' : 'warnPercent', labelKey } });
        return;
      }
      const stored = account.caps.find((cap) => cap.scope === parsed.scope);
      const unchanged =
        account.caps.length === 1 && stored !== undefined && stored.amountUsd === parsed.amountUsd && stored.warnPercent === parsed.warnPercent;
      if (unchanged) {
        if (state.failure?.row === row) set({ ...state, failure: null });
        return;
      }
      await runAll(row, capSaveCommands(account, parsed));
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
