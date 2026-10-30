// components/account-editor.tsx — the account editor's four tabs (U-30, U-43): Genel holds the
// name and the account facts; Kullanım the MeterList (or the spend against the
// cap) with "Son okuma · Yenile"; Limitler the "Limit dolunca" radio cards, the reserve segments and
// the spend cap; Modeller the catalog by billing with the spend-consent card (U-32). The rules live
// in stores/account-editor.ts; this file renders them. The frame — scrim, head, vertical tabs,
// footer — is components/account-editor-dialog.tsx, which both hosts (Settings, the wizard) use.
import { useEffect, useId, useState, useSyncExternalStore } from 'react';

import type { SettingsAccountView } from '../../api/queries';
import type { TestRefusal } from '../stores/account-test';
import { AccountTest } from './account-test';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import {
  CAP_SCOPES,
  RESERVE_PRESETS,
  SAVED_FLAG_MS,
  capFormStartsOpen,
  connectionText,
  diffValueLabel,
  generalFacts,
  mayHaveCap,
  policyOptions,
  effectiveReservePercents,
  reserveChoice,
  reserveIsUnset,
  reserveFieldMeters,
  reserveSplitStartsOpen,
  usageView,
  type AccountEditorStore,
  type EditorTab,
  type FactKey,
} from '../stores/account-editor';
import { includedReason, type AccountModelsStore, type CapScope } from '../stores/account-models';
import { RECOMMENDED, settingDiffs } from '../stores/recommended';
import { ActionButton } from './action-button';
import { SegmentedControl } from './segmented-control';
import { MeterList, MeterNote } from './meter-list';
import { ModelList } from './model-list';
import { formatMeterValue } from './meter-value';
import { SettingRow } from './setting-row';
import { Skeleton, SkeletonStyle, useSkeleton } from './skeleton';
import { meterListEmpty, meterListView, type MeterFailure, type MeterListEmpty } from '../stores/meter-list';
import { accountUsageStanding } from '../stores/account-editor';

const TAB_KEY: Readonly<Record<EditorTab, LabelKey>> = {
  general: 'editor.tab.general',
  usage: 'editor.tab.usage',
  limits: 'editor.tab.limits',
  models: 'editor.tab.models',
};

const FACT_KEY: Readonly<Record<FactKey, LabelKey>> = {
  provider: 'editor.fact.provider',
  connection: 'editor.fact.connection',
  plan: 'editor.fact.plan',
  identityDir: 'editor.fact.identityDir',
  endpointHost: 'editor.fact.endpointHost',
  secret: 'editor.fact.secret',
};

const SCOPE_KEY: Readonly<Record<string, LabelKey>> = {
  account_day: 'cap.scope.account_day',
  account_week: 'cap.scope.account_week',
  account_month: 'cap.scope.account_month',
};

export interface AccountEditorProps {
  readonly account: SettingsAccountView;
  readonly locale: Locale;
  readonly store: AccountEditorStore;
  /** The models list and the spend-consent flow of the Modeller tab (U-32); a host without a
   *  stored account (the wizard's draft window) passes none and offers no Modeller tab. */
  readonly models?: AccountModelsStore;
  /** The tabs this host offers, in order; every tab when absent. */
  readonly tabs?: readonly EditorTab[];
  /** A moment in the active locale (meter resets, the last read). */
  readonly formatTime: (epochMs: number | null) => string | null;
  /** Re-reads the account's meters ("Yenile"). */
  readonly onRefresh: () => void;
  /** Whether quota refresh is running right now (U-266). */
  readonly refreshing?: boolean;
  /** A failure from the latest refresh attempt, if any (U-267). */
  readonly refreshFailure?: MeterFailure | null;
  /** Injected clock for testing the 150 ms skeleton delay (U-266). */
  readonly skeletonNow?: () => number;
  /** The roles that route this account — the chips on Genel (U-37). */
  readonly roleChips?: readonly { readonly id: string; readonly name: string }[];
  /** A chip's intent: Settings → Roller with that role's İnce ayar open. */
  readonly onOpenRole?: (roleId: string) => void;
  /** The provider's display name (A-67) Genel shows in place of the id; absent or null = the id. */
  readonly providerName?: string | null;
  /** "Test et" on Genel (U-39); absent = the host has no stored account to test. */
  readonly accountTest?: {
    readonly testing: boolean;
    readonly refusal: TestRefusal | undefined;
    readonly onTest: () => void;
  };
  /** "Hesabı kaldır" at the bottom of Genel (a danger zone); absent = the host offers no removal. */
  readonly onRemove?: () => void;
  /** The standing warning of a refused removal (the account is still bound to roles). Its only
   *  way forward is updating the binding in Roller; when the account is the only one there is
   *  nothing to rebind to yet, so the warning says that instead of offering the jump. */
  readonly removeWarning?: {
    readonly roles: readonly string[];
    readonly onlyAccount: boolean;
    readonly onOpenRoles: () => void;
    readonly onDismiss: () => void;
  };
  readonly draftMode?: boolean;
}

// "Kaydedildi" beside a row for 1.5 s, and the row's failure copy.
function useRowStatus(store: AccountEditorStore, row: string, locale: Locale): { saved: boolean; failure: string | undefined } {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  const [, bump] = useState(0);
  const saved = store.isSaved(row);
  // The flag leaves by itself: one re-render when its 1.5 s are up.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => bump((n) => n + 1), SAVED_FLAG_MS);
    return () => window.clearTimeout(timer);
  }, [saved, state.savedUntil]);
  return { saved, failure: state.failure?.row === row ? t(locale, state.failure.labelKey) : undefined };
}

function LabelRow({ account, locale, store, draftMode = false }: Pick<AccountEditorProps, 'account' | 'locale' | 'store' | 'draftMode'>) {
  const [draft, setDraft] = useState(account.label);
  const inputId = useId();
  // A saved name coming back from the query replaces the draft; typing in between is the user's.
  useEffect(() => setDraft(account.label), [account.label]);
  const status = useRowStatus(store, 'label', locale);
  const commit = (): void => (draftMode ? store.setDraftLabel(account, draft) : void store.saveLabel(account, draft));
  return (
    <div className="grid max-w-[420px] gap-1.5" data-setting-row={t(locale, 'editor.general.label')}>
      <label htmlFor={inputId} className="text-[13px] font-bold text-ink">
        {t(locale, 'editor.general.label')}
      </label>
      <input
        id={inputId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        className="h-9 rounded-control border border-bord bg-raised px-3 text-ink outline-none focus:border-signal"
      />
      <span className="flex items-center gap-2 text-[12.5px] text-inkdim">
        {t(locale, 'editor.general.labelHint')}
        {status.saved ? (
          <span role="status" className="text-proceed">
            {t(locale, 'editor.saved')}
          </span>
        ) : null}
      </span>
      {status.failure !== undefined ? (
        <p role="alert" className="text-[12px] text-error">
          {status.failure}
        </p>
      ) : null}
    </div>
  );
}

/** Facts that are machine data (a path, a host) keep mono; names and states are sans. */
const MONO_FACTS: ReadonlySet<FactKey> = new Set<FactKey>(['identityDir', 'endpointHost']);

function DangerZone({ account, locale, onRemove, removeWarning }: Pick<AccountEditorProps, 'account' | 'locale' | 'onRemove' | 'removeWarning'>) {
  if (onRemove === undefined) return null;
  return (
    <section className="mt-3 grid gap-2 rounded-card border border-error/40 px-4 py-3" data-danger-zone={account.id}>
      <h3 className="text-[14px] font-semibold text-ink">{t(locale, 'editor.danger.title')}</h3>
      <div className="flex items-center justify-between gap-4">
        <p className="text-[12.5px] text-inkdim">{t(locale, 'editor.danger.remove')}</p>
        <button
          type="button"
          onClick={onRemove}
          className="flex-none rounded-control border border-error/60 px-2.5 py-1 text-[12.5px] text-error hover:bg-raised"
        >
          {t(locale, 'settings.account.remove')}
        </button>
      </div>
      {removeWarning !== undefined ? (
        <div role="alert" className="grid gap-2 rounded-card border border-signal/40 bg-signal/10 px-3 py-2.5">
          <p className="text-[13px] text-ink">
            {t(locale, 'settings.remove.warning')} <span className="font-mono text-[12.5px] text-signal-soft">{removeWarning.roles.join(', ')}</span>
          </p>
          {removeWarning.onlyAccount ? (
            <p className="text-[12.5px] text-inkdim">{t(locale, 'settings.remove.onlyAccount')}</p>
          ) : null}
          <div className="flex items-center gap-2">
            {removeWarning.onlyAccount ? null : (
              // The dialog's primary is its footer save (U-375); the warning's own door takes the
              // outline.
              <ActionButton variant="neutral" onClick={removeWarning.onOpenRoles}>
                {t(locale, 'settings.remove.updateRoles')}
              </ActionButton>
            )}
            <ActionButton variant="neutral" onClick={removeWarning.onDismiss}>
              {t(locale, 'settings.remove.cancel')}
            </ActionButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Section({ title, hint, children }: { readonly title: string; readonly hint?: string; readonly children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="text-[14px] font-bold text-ink">{title}</h3>
      {hint !== undefined ? <p className="mb-1.5 max-w-[62ch] text-[13px] text-inkdim">{hint}</p> : null}
      {children}
    </section>
  );
}

function General({
  account,
  accountTest,
  locale,
  store,
  roleChips,
  onOpenRole,
  providerName,
  onRemove,
  removeWarning,
  draftMode,
}: Pick<AccountEditorProps, 'account' | 'accountTest' | 'locale' | 'store' | 'roleChips' | 'onOpenRole' | 'providerName' | 'onRemove' | 'removeWarning' | 'draftMode'>) {
  return (
    <div className="grid gap-[22px]">
      <LabelRow account={account} locale={locale} store={store} draftMode={draftMode} />
      {accountTest !== undefined ? (
        <div className="py-1">
          <AccountTest
            locale={locale}
            test={account.test}
            showButton
            testing={accountTest.testing || account.test?.state === 'running'}
            refusal={accountTest.refusal}
            onTest={accountTest.onTest}
            onOpenModels={() => store.setTab('models')}
          />
        </div>
      ) : null}
      {roleChips !== undefined && roleChips.length > 0 ? (
        <Section title={t(locale, 'editor.general.roles')} hint={t(locale, 'editor.general.rolesHint')}>
          <span className="flex flex-wrap gap-1.5" data-role-chips="">
            {roleChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => onOpenRole?.(chip.id)}
                className="rounded-full border border-hairline px-2.5 py-0.5 text-[12px] text-ink hover:border-bord hover:bg-raised"
              >
                {chip.name}
              </button>
            ))}
          </span>
        </Section>
      ) : null}
      <Section title={t(locale, 'editor.general.facts')}>
        <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-card border border-hairline p-4 text-[13px]">
          {generalFacts(account, providerName ?? null).map((fact) => {
            const text =
              typeof fact.value === 'boolean'
                ? t(locale, fact.value ? 'editor.fact.secret.yes' : 'editor.fact.secret.no')
                : fact.key === 'connection'
                  ? connectionText(locale, fact.value)
                  : fact.value;
            return (
              <div key={fact.key} className="contents" data-fact={fact.key}>
                <dt className="text-inkdim">{t(locale, FACT_KEY[fact.key])}</dt>
                <dd className={`m-0 min-w-0 break-all text-ink ${MONO_FACTS.has(fact.key) ? 'font-mono text-[12.5px]' : ''}`}>{text}</dd>
              </div>
            );
          })}
        </dl>
      </Section>
      <DangerZone account={account} locale={locale} onRemove={onRemove} removeWarning={removeWarning} />
    </div>
  );
}

export interface UsageProps {
  readonly account: SettingsAccountView;
  readonly locale: Locale;
  readonly formatTime: (epochMs: number | null) => string | null;
  readonly onRefresh: () => void;
  readonly refreshing?: boolean;
  readonly refreshFailure?: MeterFailure | null;
  readonly skeletonNow?: () => number;
}

export function Usage({
  account,
  locale,
  formatTime,
  onRefresh,
  refreshing = false,
  refreshFailure = null,
  skeletonNow,
}: UsageProps) {
  const view = usageView(account);
  const lastRead = account.meters.length === 0 ? null : formatTime(Math.max(...account.meters.map((meter) => meter.observedAt)));
  const { skeleton } = useSkeleton(refreshing && account.meters.length === 0, skeletonNow ?? (() => Date.now()));
  const standing = accountUsageStanding(account, refreshing, refreshFailure);
  const failed = refreshFailure !== null || (standing.failed && account.meters.length === 0);
  const failure = refreshFailure ?? standing.failure ?? (standing.needsLogin ? null : 'network');
  const failureKey: MeterListEmpty = meterListEmpty({ ...standing, failure });

  return (
    <div className="grid gap-3.5">
      <Section title={t(locale, 'editor.tab.usage')}>
        <p className="flex items-center gap-2 text-[12.5px] text-inkdim">
          <span>
            {t(locale, 'editor.usage.lastRead')}
            {lastRead !== null ? ` ${lastRead}` : ''}
          </span>
          <span aria-hidden="true">·</span>
          <ActionButton variant="neutral" disabled={refreshing} onClick={onRefresh}>
            {t(locale, 'editor.usage.refresh')}
          </ActionButton>
        </p>
        {view.kind === 'meters' ? (
          refreshing && account.meters.length === 0 ? (
            skeleton ? (
              <div aria-busy="true" className="grid gap-2.5 py-1" data-usage-skeleton="">
                <SkeletonStyle />
                <Skeleton height="1.5rem" radius="control" width="100%" />
                <Skeleton height="1.5rem" radius="control" width="85%" />
              </div>
            ) : null
          ) : failed && !refreshing ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-inkdim" data-usage-error="">
              <MeterNote>{t(locale, failureKey)}</MeterNote>
              <ActionButton variant="neutral" onClick={onRefresh}>
                {t(locale, 'editor.usage.retry')}
              </ActionButton>
            </div>
          ) : (
            <div
              aria-busy={refreshing ? true : undefined}
              className={refreshing ? 'opacity-60 pointer-events-none transition-opacity' : undefined}
              data-usage-busy={refreshing ? '' : undefined}
            >
              <MeterList
                locale={locale}
                view={meterListView(account.pools, account.meters)}
                empty={refreshing ? null : meterListEmpty(standing)}
                now={Date.now()}
              />
            </div>
          )
        ) : (
          <div
            className={`grid gap-1 ${refreshing ? 'opacity-60 pointer-events-none transition-opacity' : ''}`}
            data-spend=""
            aria-busy={refreshing ? true : undefined}
          >
            <p className="text-[13px] text-ink">
              {t(locale, 'editor.usage.spend')}{' '}
              <span className="font-mono">{view.spentUsd === null ? t(locale, 'editor.usage.spendNone') : formatMeterValue(locale, 'usd', view.spentUsd)}</span>
            </p>
            <p className="text-[12.5px] text-inkdim">
              {view.cap === null
                ? t(locale, 'editor.usage.noCap')
                : `${t(locale, 'editor.usage.cap')} ${formatMeterValue(locale, 'usd', view.cap.amountUsd)} · ${
                    SCOPE_KEY[view.cap.scope] === undefined ? view.cap.scope : t(locale, SCOPE_KEY[view.cap.scope] ?? 'editor.usage.cap')
                  }`}
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}

const INPUT_CLASS =
  'rounded-control border border-bord bg-transparent px-2.5 py-1 text-[13px] text-ink focus:border-signal focus:outline-none';

const PERIOD_KEY: Readonly<Record<string, LabelKey>> = {
  account_day: 'editor.limits.cap.period.account_day',
  account_week: 'editor.limits.cap.period.account_week',
  account_month: 'editor.limits.cap.period.account_month',
};

function RecommendedMark({ locale }: { readonly locale: Locale }) {
  return (
    <span className="rounded-control border border-hairline px-1.5 text-[10.5px] text-inkdim">{t(locale, 'editor.recommended')}</span>
  );
}

function PolicyRow({ account, locale, store, draftMode = false }: Pick<AccountEditorProps, 'account' | 'locale' | 'store' | 'draftMode'>) {
  const status = useRowStatus(store, 'limitPolicy', locale);
  const diff = settingDiffs(account).find((entry) => entry.key === 'limitPolicy');
  return (
    <SettingRow
      locale={locale}
      title={t(locale, 'editor.limits.policy.title')}
      purpose={t(locale, 'editor.limits.policy.purpose')}
      saved={status.saved}
      failure={status.failure}
      differsFrom={diff === undefined ? undefined : diffValueLabel(locale, 'limitPolicy', diff.recommended)}
      onReset={() => (draftMode ? store.setDraftPolicy(account, RECOMMENDED.limitPolicy) : void store.reset(account, 'limitPolicy'))}
      control={null}
      below={
        <div role="radiogroup" aria-label={t(locale, 'editor.limits.policy.title')} className="grid gap-2">
          {policyOptions(account).map((option) => {
            const checked = (draftMode ? store.state().draft?.limitPolicy ?? account.limitPolicy : account.limitPolicy) === option.policy;
            return (
              <button
                key={option.policy}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => (draftMode ? store.setDraftPolicy(account, option.policy) : void store.savePolicy(account, option.policy))}
                className={`grid w-full grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-card border px-3.5 py-3 text-left hover:border-bord ${checked ? 'border-bord bg-raised' : 'border-hairline'}`}
                data-policy={option.policy}
              >
                <span aria-hidden="true" className={`row-span-2 mt-px grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] ${checked ? 'border-ink' : 'border-bord'}`}>
                  {checked ? <span className="h-2 w-2 rounded-full bg-ink" /> : null}
                </span>
                <span className="flex items-center gap-2 font-bold text-ink">
                  {t(locale, option.labelKey)}
                  {option.recommended ? <RecommendedMark locale={locale} /> : null}
                </span>
                <span className="text-[12.5px] text-inkdim">{t(locale, option.purposeKey)}</span>
              </button>
            );
          })}
        </div>
      }
    />
  );
}

function ReserveRow({ account, locale, store, draftMode = false }: Pick<AccountEditorProps, 'account' | 'locale' | 'store' | 'draftMode'>) {
  const status = useRowStatus(store, 'reserve', locale);
  const editorState = useSyncExternalStore(store.subscribe, store.state, store.state);
  const effective = effectiveReservePercents(account);
  const [short, setShort] = useState(editorState.draft?.reserveShort ?? String(effective.short));
  const [long, setLong] = useState(editorState.draft?.reserveLong ?? String(effective.long));
  const [splitOpen, setSplitOpen] = useState(reserveSplitStartsOpen(account));
  // A saved reserve coming back from the query replaces the drafts.
  useEffect(() => {
    setShort(String(effectiveReservePercents(account).short));
    setLong(String(effectiveReservePercents(account).long));
  }, [account.reserve.short, account.reserve.long, account.hasWeeklyPool]);
  // A weekly pool with nothing stored runs a default share; the row shows it as a placeholder (R-198).
  const unsetDefault = account.hasWeeklyPool && reserveIsUnset(account);
  const choice = splitOpen ? 'split' : unsetDefault ? 'default' : reserveChoice(account);
  const recommendedOption = account.hasWeeklyPool ? '10' : 'none';
  const diff = settingDiffs(account).find((entry) => entry.key === 'reserve');
  const meters = reserveFieldMeters(account);
  const commit = (nextShort: string, nextLong: string): void =>
    draftMode ? store.setDraftReserve(account, nextShort, nextLong) : void store.saveReserve(account, nextShort, nextLong);
  const field = (which: 'short' | 'long') => {
    const value = which === 'short' ? short : long;
    const named = meters[which];
    return (
      <label key={which} className="grid gap-0.5 text-[12px] text-inkdim">
        <span>{t(locale, which === 'short' ? 'editor.limits.reserve.shortField' : 'editor.limits.reserve.longField')}</span>
        <input
          inputMode="numeric"
          value={value}
          onChange={(event) => (which === 'short' ? setShort(event.target.value) : setLong(event.target.value))}
          onBlur={() => commit(short, long)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(short, long);
          }}
          aria-label={t(locale, which === 'short' ? 'editor.limits.reserve.shortField' : 'editor.limits.reserve.longField')}
          className={`${INPUT_CLASS} w-24`}
          data-reserve-field={which}
        />
        <span className="text-[11.5px]">
          {named.length === 0
            ? t(locale, 'editor.limits.reserve.noMeters')
            : named
                .map((meter) => (meter.larger ? `${meter.name} (${t(locale, 'editor.limits.reserve.larger')})` : meter.name))
                .join(' · ')}
        </span>
      </label>
    );
  };
  function pick(value: number): void {
    setSplitOpen(false);
    setShort(String(value));
    setLong(String(value));
    commit(String(value), String(value));
  }
  const listOptions = [
    { id: 'none', text: t(locale, 'editor.limits.reserve.none'), ...(recommendedOption === 'none' ? { hint: t(locale, 'editor.recommended') } : {}) },
    ...RESERVE_PRESETS.map((value) => ({
      id: String(value),
      text: t(locale, 'editor.limits.reserve.preset').replace('{value}', String(value)),
      ...(recommendedOption === String(value) ? { hint: t(locale, 'editor.recommended') } : {}),
    })),
  ];
  return (
    <SettingRow
      locale={locale}
      title={t(locale, 'editor.limits.reserve.title')}
      purpose={t(locale, 'editor.limits.reserve.purpose')}
      saved={status.saved}
      failure={status.failure}
      differsFrom={
        diff === undefined
          ? undefined
          : account.hasWeeklyPool
            ? t(locale, 'editor.limits.reserve.preset').replace('{value}', recommendedOption)
            : t(locale, 'editor.limits.reserve.none')
      }
      onReset={() => {
        setSplitOpen(false);
        if (draftMode) store.setDraftReserve(account, '0', account.hasWeeklyPool ? recommendedOption : '0');
        else void store.reset(account, 'reserve');
      }}
      control={
        <SegmentedControl<string>
          label={t(locale, 'editor.limits.reserve.title')}
          value={choice === 'split' || choice === 'default' ? null : String(choice)}
          standing={
            choice === 'split'
              ? t(locale, 'editor.limits.reserve.custom')
              : choice === 'default'
                ? t(locale, 'editor.limits.reserve.preset').replace('{value}', String(effective.long))
                : undefined
          }
          options={listOptions}
          onPick={(value) => pick(value === 'none' ? 0 : Number(value))}
        />
      }
      below={
        <div className="grid justify-items-start gap-2">
          <button
            type="button"
            aria-expanded={splitOpen}
            onClick={() => setSplitOpen(!splitOpen)}
            data-reserve-option="split"
            className="rounded-control border border-bord bg-transparent px-2 py-0.5 text-[12.5px] text-ink hover:bg-raised"
          >
            {splitOpen ? '⌄' : '›'} {t(locale, 'editor.limits.reserve.split')}
          </button>
          {splitOpen ? (
            <div className="grid gap-2" data-reserve-split="">
              {field('short')}
              {field('long')}
              <p className="text-[11.5px] text-inkdim">{t(locale, 'editor.limits.reserve.fieldHint')}</p>
            </div>
          ) : null}
        </div>
      }
    />
  );
}

function CapRow({ account, locale, store, draftMode = false }: Pick<AccountEditorProps, 'account' | 'locale' | 'store' | 'draftMode'>) {
  const capStatus = useRowStatus(store, 'cap', locale);
  const warnStatus = useRowStatus(store, 'warnPercent', locale);
  const stored = account.caps[0];
  const editorState = useSyncExternalStore(store.subscribe, store.state, store.state);
  const [amount, setAmount] = useState(editorState.draft?.capAmount ?? (stored === undefined ? '' : String(stored.amountUsd)));
  const [scope, setScope] = useState<CapScope>(editorState.draft?.capScope ?? stored?.scope ?? RECOMMENDED.cap.scope);
  const [warn, setWarn] = useState(editorState.draft?.capWarn ?? String(stored?.warnPercent ?? RECOMMENDED.warnPercent));
  // A saved cap coming back from the query replaces the drafts.
  useEffect(() => {
    setAmount(stored === undefined ? '' : String(stored.amountUsd));
    setScope(stored?.scope ?? RECOMMENDED.cap.scope);
    setWarn(String(stored?.warnPercent ?? RECOMMENDED.warnPercent));
  }, [stored?.amountUsd, stored?.scope, stored?.warnPercent]);
  const diffs = settingDiffs(account);
  const capDiff = diffs.find((entry) => entry.key === 'cap');
  const warnDiff = diffs.find((entry) => entry.key === 'warnPercent');
  // Nothing is written until an amount stands: a bare focus or a period pick on an empty row is no commit.
  const commit = (row: 'cap' | 'warnPercent', nextScope: CapScope = scope): void => {
    if (stored === undefined && amount.trim() === '' && warn === String(RECOMMENDED.warnPercent)) return;
    if (draftMode) store.setDraftCap(account, { amount, scope: nextScope, warn });
    else void store.saveCap(account, row, { amount, scope: nextScope, warn });
  };
  const onEnter = (row: 'cap' | 'warnPercent') => (event: { readonly key: string }): void => {
    if (event.key === 'Enter') commit(row);
  };
  return (
    <SettingRow
      locale={locale}
      title={t(locale, 'editor.limits.cap.title')}
      purpose={t(locale, 'editor.limits.cap.purpose')}
      saved={capStatus.saved || warnStatus.saved}
      failure={capStatus.failure ?? warnStatus.failure}
      differsFrom={capDiff === undefined ? undefined : diffValueLabel(locale, 'cap', capDiff.recommended)}
      onReset={() =>
        draftMode
          ? store.setDraftCap(account, { amount: String(RECOMMENDED.cap.amountUsd), scope: RECOMMENDED.cap.scope, warn: String(RECOMMENDED.warnPercent) })
          : void store.reset(account, 'cap')
      }
      control={
        <div className="grid justify-items-end gap-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[13px] text-inkdim">
              $
              <input
                inputMode="decimal"
                value={amount}
                placeholder={t(locale, 'editor.limits.cap.amountPlaceholder')}
                onChange={(event) => setAmount(event.target.value)}
                onBlur={() => commit('cap')}
                onKeyDown={onEnter('cap')}
                aria-label={t(locale, 'editor.limits.cap.amount')}
                className={`${INPUT_CLASS} w-24 font-mono`}
                data-cap-field="amount"
              />
            </span>
            <SegmentedControl<CapScope>
              label={t(locale, 'editor.limits.cap.period')}
              value={scope}
              options={CAP_SCOPES.map((entry) => ({
                id: entry,
                text: t(locale, PERIOD_KEY[entry] ?? 'editor.limits.cap.period'),
                ...(entry === RECOMMENDED.cap.scope ? { hint: t(locale, 'editor.recommended') } : {}),
              }))}
              onPick={(entry) => {
                setScope(entry);
                commit('cap', entry);
              }}
            />
          </div>
        </div>
      }
      disclosure={{
        label: t(locale, 'editor.limits.reserve.fineTune'),
        startsOpen: capFormStartsOpen(account),
        children: (
          <div className="grid gap-1">
            <label className="flex items-center justify-between gap-3 text-[12.5px] text-inkdim">
              <span>
                {t(locale, 'editor.limits.cap.warn')}
                <span className="block text-[11.5px]">{t(locale, 'editor.limits.cap.warnHint')}</span>
              </span>
              <input
                inputMode="numeric"
                value={warn}
                onChange={(event) => setWarn(event.target.value)}
                onBlur={() => commit('warnPercent')}
                onKeyDown={onEnter('warnPercent')}
                aria-label={t(locale, 'editor.limits.cap.warn')}
                className={`${INPUT_CLASS} w-20`}
                data-cap-field="warn"
              />
            </label>
            {warnDiff !== undefined ? (
              <p className="flex flex-wrap items-center gap-2 text-[12px] text-inkdim">
                <span
                  aria-label={t(locale, 'editor.recommended.tooltip').replace('{value}', diffValueLabel(locale, 'warnPercent', warnDiff.recommended))}
                  title={t(locale, 'editor.recommended.tooltip').replace('{value}', diffValueLabel(locale, 'warnPercent', warnDiff.recommended))}
                  className="h-1.5 w-1.5 rounded-full bg-inkdim"
                />
                <button type="button" onClick={() => (draftMode ? store.setDraftCap(account, { amount, scope, warn: String(RECOMMENDED.warnPercent) }) : void store.reset(account, 'warnPercent'))} aria-label={t(locale, 'editor.reset.aria')} title={t(locale, 'editor.reset.aria')} className="grid h-6 w-6 place-items-center rounded-control border border-bord text-inkdim hover:bg-raised hover:text-ink">
                  <span aria-hidden="true">↶</span>
                  <span className="sr-only">{t(locale, 'editor.reset')}</span>
                </button>
              </p>
            ) : null}
          </div>
        ),
      }}
    />
  );
}

function Limits({ account, locale, store, draftMode }: Pick<AccountEditorProps, 'account' | 'locale' | 'store' | 'draftMode'>) {
  return (
    <div data-limits="">
      <PolicyRow account={account} locale={locale} store={store} draftMode={draftMode} />
      <ReserveRow account={account} locale={locale} store={store} draftMode={draftMode} />
      {mayHaveCap(account) ? <CapRow account={account} locale={locale} store={store} draftMode={draftMode} /> : null}
      <p className="py-3 text-[12px] text-inkdim" data-p40-note="">
        {t(locale, 'editor.limits.p40note')}
      </p>
    </div>
  );
}

function Models({ account, locale, models, onRefresh }: Pick<AccountEditorProps, 'account' | 'locale' | 'onRefresh'> & { readonly models: AccountModelsStore }) {
  const state = useSyncExternalStore(models.subscribe, models.state);
  // The catalog loads when the tab opens and again for another account.
  useEffect(() => {
    void models.load(account.id);
  }, [models, account.id]);
  const hasCap = account.caps.length > 0;
  return (
    <div className="py-3">
      <ModelList
        locale={locale}
        state={state}
        onSelect={(row) => models.beginConsent({ model: row.id, name: row.name, billing: row.billing, hasCap })}
        onSelectDefault={() =>
          models.beginConsent({ model: '*', name: null, billing: state.defaultModel?.billing ?? 'included', hasCap })
        }
        onRefresh={() => void models.refresh()}
        onEditCap={(input) => models.editCap(input)}
        onAllow={() =>
          void models.allow().then((outcome) => {
            // A grant may have created the account's cap; the host re-reads the account.
            if (outcome?.result.ok === true) onRefresh();
          })
        }
        onCancel={() => models.cancel()}
        onRevoke={(model) => void models.revoke(model)}
        reasonOf={(row) => {
          const key = row.billing === 'included' ? includedReason(row.id, account.pools, account.meters) : null;
          return key === null ? null : t(locale, key);
        }}
      />
    </div>
  );
}

/** The tab labels; the dialog frame lists them in the vertical tab column. */
export { TAB_KEY };

/** The body of the selected tab, with the U-29 line above it (the count of settings that differ
 *  from the recommendation and "Hepsini önerilene döndür"). */
export function AccountEditorPanels(props: AccountEditorProps) {
  const { account, locale, store } = props;
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  return (
    <div className="grid gap-4" data-account-editor={account.id}>
      {state.failure?.row === 'all' ? <p role="alert" className="text-error">{t(locale, state.failure.labelKey)}</p> : null}
      <div role="tabpanel" aria-label={t(locale, TAB_KEY[state.tab])}>
        {state.tab === 'general' ? (
          <General
            account={account}
            accountTest={props.accountTest}
            locale={locale}
            store={store}
            draftMode={props.draftMode}
            roleChips={props.roleChips}
            onOpenRole={props.onOpenRole}
            providerName={props.providerName}
            onRemove={props.onRemove}
            removeWarning={props.removeWarning}
          />
        ) : null}
        {state.tab === 'usage' ? (
          <Usage
            account={account}
            locale={locale}
            formatTime={props.formatTime}
            onRefresh={() => {
              props.onRefresh();
              if (props.refreshing === undefined) void store.refreshQuota(account);
            }}
            refreshing={props.refreshing ?? state.refreshing}
            refreshFailure={props.refreshFailure !== undefined ? props.refreshFailure : state.refreshFailure}
            skeletonNow={props.skeletonNow}
          />
        ) : null}
        {state.tab === 'limits' ? <Limits account={account} locale={locale} store={store} draftMode={props.draftMode} /> : null}
        {state.tab === 'models' && props.models !== undefined ? (
          <Models account={account} locale={locale} models={props.models} onRefresh={props.onRefresh} />
        ) : null}
      </div>
    </div>
  );
}
