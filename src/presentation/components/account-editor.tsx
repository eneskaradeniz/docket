// components/account-editor.tsx — the account editor body (U-30): a head with the recommendation
// count and "Hepsini önerilene döndür" (U-29), four tabs, and the tab's content. Genel holds the
// label (saved on commit) and the read-only facts; Kullanım the meter bars or the spend against
// the cap; Limitler holds the limit policy, the reserve and the spend cap (U-30); Modeller lists the catalog by billing with the spend-consent card (U-32). The rules live in
// stores/account-editor.ts; this file renders them. The host (Settings sub-page, later the
// wizard window) frames the body.
import { useEffect, useState, useSyncExternalStore } from 'react';

import type { SettingsAccountView } from '../../api/queries';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import {
  CAP_SCOPES,
  EDITOR_TABS,
  RESERVE_PRESETS,
  SAVED_FLAG_MS,
  capFormStartsOpen,
  diffValueLabel,
  generalFacts,
  mayHaveCap,
  policyOptions,
  reserveChoice,
  reserveFieldMeters,
  reserveSplitStartsOpen,
  usageView,
  type AccountEditorStore,
  type EditorTab,
  type FactKey,
} from '../stores/account-editor';
import type { AccountModelsStore, CapScope } from '../stores/account-models';
import { RECOMMENDED, settingDiffs } from '../stores/recommended';
import { ActionButton } from './action-button';
import { MeterBar } from './meter-bar';
import { ModelList } from './model-list';
import { formatMeterValue } from './meter-value';
import { SettingRow } from './setting-row';

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

const CONNECTION_KEY: Readonly<Record<string, LabelKey>> = {
  subscription: 'auth.mode.subscription',
  api_key: 'auth.mode.api_key',
  cloud: 'auth.mode.cloud',
  byok: 'auth.mode.byok',
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
  /** The roles that route this account — the chips on Genel (U-37). */
  readonly roleChips?: readonly { readonly id: string; readonly name: string }[];
  /** A chip's intent: Settings → Roller with that role's İnce ayar open. */
  readonly onOpenRole?: (roleId: string) => void;
}

// "Kaydedildi" beside a row for 1.5 s, and the row's failure copy.
function useRowStatus(store: AccountEditorStore, row: string, locale: Locale): { saved: boolean; failure: string | undefined } {
  const state = useSyncExternalStore(store.subscribe, store.state);
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

function LabelRow({ account, locale, store }: Pick<AccountEditorProps, 'account' | 'locale' | 'store'>) {
  const [draft, setDraft] = useState(account.label);
  // A saved name coming back from the query replaces the draft; typing in between is the user's.
  useEffect(() => setDraft(account.label), [account.label]);
  const status = useRowStatus(store, 'label', locale);
  const commit = (): void => void store.saveLabel(account, draft);
  return (
    <SettingRow
      locale={locale}
      title={t(locale, 'editor.general.label')}
      purpose={t(locale, 'editor.general.labelHint')}
      saved={status.saved}
      failure={status.failure}
      control={
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
          aria-label={t(locale, 'editor.general.label')}
          className="w-56 rounded-control border border-bord bg-transparent px-2.5 py-1 text-[13px] text-ink focus:border-signal focus:outline-none"
        />
      }
    />
  );
}

function General({ account, locale, store, roleChips, onOpenRole }: Pick<AccountEditorProps, 'account' | 'locale' | 'store' | 'roleChips' | 'onOpenRole'>) {
  return (
    <div>
      <LabelRow account={account} locale={locale} store={store} />
      {roleChips !== undefined && roleChips.length > 0 ? (
        <div className="flex items-start justify-between gap-4 border-b border-hairline py-3" data-role-chips="">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-ink">{t(locale, 'editor.general.roles')}</p>
            <p className="text-[12.5px] text-inkdim">{t(locale, 'editor.general.rolesHint')}</p>
          </div>
          <span className="flex flex-wrap justify-end gap-1.5">
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
        </div>
      ) : null}
      <dl className="grid gap-2 py-3">
        {generalFacts(account).map((fact) => {
          const connectionKey = fact.key === 'connection' && typeof fact.value === 'string' ? CONNECTION_KEY[fact.value] : undefined;
          const text =
            typeof fact.value === 'boolean'
              ? t(locale, fact.value ? 'editor.fact.secret.yes' : 'editor.fact.secret.no')
              : connectionKey !== undefined
                ? t(locale, connectionKey)
                : fact.value;
          return (
            <div key={fact.key} className="flex items-baseline gap-3" data-fact={fact.key}>
              <dt className="w-32 flex-none text-[12.5px] text-inkdim">{t(locale, FACT_KEY[fact.key])}</dt>
              <dd className="min-w-0 break-all font-mono text-[12.5px] text-ink">{text}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function Usage({ account, locale, formatTime, onRefresh }: Pick<AccountEditorProps, 'account' | 'locale' | 'formatTime' | 'onRefresh'>) {
  const view = usageView(account);
  const lastRead = account.meters.length === 0 ? null : formatTime(Math.max(...account.meters.map((meter) => meter.observedAt)));
  return (
    <div className="grid gap-3 py-3">
      {view.kind === 'meters' ? (
        view.meters.length === 0 ? (
          <p className="text-[13px] text-inkdim">{t(locale, 'settings.meters.empty')}</p>
        ) : (
          <ul className="grid gap-3">
            {view.meters.map((meter) => (
              <MeterBar
                key={meter.id}
                meter={meter}
                name={meter.label ?? account.pools.find((pool) => pool.id === meter.poolId)?.label ?? meter.poolId}
                locale={locale}
                resetsAt={formatTime(meter.resetsAt)}
              />
            ))}
          </ul>
        )
      ) : (
        <div className="grid gap-1" data-spend="">
          <p className="text-[13px] text-ink">
            {t(locale, 'editor.usage.spend')}{' '}
            <span className="font-mono">{view.spentUsd === null ? t(locale, 'editor.usage.spendNone') : formatMeterValue(locale, 'usd', view.spentUsd)}</span>
          </p>
          <p className="font-mono text-[11.5px] text-inkdim">
            {view.cap === null
              ? t(locale, 'editor.usage.noCap')
              : `${t(locale, 'editor.usage.cap')} ${formatMeterValue(locale, 'usd', view.cap.amountUsd)} · ${
                  SCOPE_KEY[view.cap.scope] === undefined ? view.cap.scope : t(locale, SCOPE_KEY[view.cap.scope] ?? 'editor.usage.cap')
                }`}
          </p>
        </div>
      )}
      <p className="flex items-center gap-2 text-[12px] text-inkdim">
        <span>
          {t(locale, 'editor.usage.lastRead')}
          {lastRead !== null ? ` ${lastRead}` : ''}
        </span>
        <span aria-hidden="true">·</span>
        <ActionButton variant="ghost" onClick={onRefresh}>
          {t(locale, 'editor.usage.refresh')}
        </ActionButton>
      </p>
    </div>
  );
}

const INPUT_CLASS =
  'rounded-control border border-bord bg-transparent px-2.5 py-1 text-[13px] text-ink focus:border-signal focus:outline-none';

const OPTION_CLASS = (selected: boolean, disabled: boolean): string =>
  `inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-[12.5px] ${
    selected ? 'border-signal text-ink' : 'border-bord text-inkdim'
  } ${disabled ? 'opacity-50' : 'hover:text-ink'}`;

const PERIOD_KEY: Readonly<Record<string, LabelKey>> = {
  account_day: 'editor.limits.cap.period.account_day',
  account_week: 'editor.limits.cap.period.account_week',
  account_month: 'editor.limits.cap.period.account_month',
};

function RecommendedMark({ locale }: { readonly locale: Locale }) {
  return (
    <span className="rounded-control border border-hairline px-1.5 text-[10.5px] text-signal-soft">{t(locale, 'editor.recommended')}</span>
  );
}

function PolicyRow({ account, locale, store }: Pick<AccountEditorProps, 'account' | 'locale' | 'store'>) {
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
      onReset={() => void store.reset(account, 'limitPolicy')}
      control={
        <div role="radiogroup" aria-label={t(locale, 'editor.limits.policy.title')} className="grid w-72 gap-1.5">
          {policyOptions(account).map((option) => {
            const disabled = option.disabledReasonKey !== undefined;
            return (
              <button
                key={option.policy}
                type="button"
                role="radio"
                aria-checked={account.limitPolicy === option.policy}
                aria-disabled={disabled}
                disabled={disabled}
                onClick={() => void store.savePolicy(account, option.policy)}
                className={`${OPTION_CLASS(account.limitPolicy === option.policy, disabled)} grid gap-0.5 text-left`}
                data-policy={option.policy}
              >
                <span className="flex items-center gap-2">
                  <span>{t(locale, option.labelKey)}</span>
                  {option.recommended ? <RecommendedMark locale={locale} /> : null}
                </span>
                <span className="text-[11.5px] text-inkdim">
                  {option.disabledReasonKey !== undefined ? t(locale, option.disabledReasonKey) : t(locale, option.purposeKey)}
                </span>
              </button>
            );
          })}
        </div>
      }
    />
  );
}

function ReserveRow({ account, locale, store }: Pick<AccountEditorProps, 'account' | 'locale' | 'store'>) {
  const status = useRowStatus(store, 'reserve', locale);
  const percent = (share: number | null): string => String(Math.round((share ?? 0) * 100));
  const [short, setShort] = useState(percent(account.reserve.short));
  const [long, setLong] = useState(percent(account.reserve.long));
  const [splitOpen, setSplitOpen] = useState(reserveSplitStartsOpen(account));
  // A saved reserve coming back from the query replaces the drafts.
  useEffect(() => {
    setShort(percent(account.reserve.short));
    setLong(percent(account.reserve.long));
  }, [account.reserve.short, account.reserve.long]);
  const choice = splitOpen ? 'split' : reserveChoice(account);
  const diff = settingDiffs(account).find((entry) => entry.key === 'reserve');
  const meters = reserveFieldMeters(account);
  const commit = (nextShort: string, nextLong: string): void => void store.saveReserve(account, nextShort, nextLong);
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
          className={`${INPUT_CLASS} w-24 font-mono`}
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
  const options: readonly { readonly id: string; readonly selected: boolean; readonly label: string; readonly onPick: () => void }[] = [
    { id: 'none', selected: choice === 'none', label: t(locale, 'editor.limits.reserve.none'), onPick: () => pick(0) },
    ...RESERVE_PRESETS.map((value) => ({
      id: String(value),
      selected: choice === value,
      label: t(locale, 'editor.limits.reserve.preset').replace('{value}', String(value)),
      onPick: () => pick(value),
    })),
    { id: 'split', selected: choice === 'split', label: t(locale, 'editor.limits.reserve.split'), onPick: () => setSplitOpen(true) },
  ];
  function pick(value: number): void {
    setSplitOpen(false);
    setShort(String(value));
    setLong(String(value));
    commit(String(value), String(value));
  }
  return (
    <SettingRow
      locale={locale}
      title={t(locale, 'editor.limits.reserve.title')}
      purpose={t(locale, 'editor.limits.reserve.purpose')}
      saved={status.saved}
      failure={status.failure}
      differsFrom={diff === undefined ? undefined : t(locale, 'editor.limits.reserve.none')}
      onReset={() => {
        setSplitOpen(false);
        void store.reset(account, 'reserve');
      }}
      control={
        <div className="grid justify-items-end gap-2">
          <div role="radiogroup" aria-label={t(locale, 'editor.limits.reserve.title')} className="flex flex-wrap justify-end gap-1.5">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.selected}
                onClick={option.onPick}
                className={OPTION_CLASS(option.selected, false)}
                data-reserve-option={option.id}
              >
                {option.label}
                {option.id === 'none' ? <RecommendedMark locale={locale} /> : null}
              </button>
            ))}
          </div>
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

function CapRow({ account, locale, store }: Pick<AccountEditorProps, 'account' | 'locale' | 'store'>) {
  const capStatus = useRowStatus(store, 'cap', locale);
  const warnStatus = useRowStatus(store, 'warnPercent', locale);
  const stored = account.caps[0];
  const [amount, setAmount] = useState(stored === undefined ? '' : String(stored.amountUsd));
  const [scope, setScope] = useState<CapScope>(stored?.scope ?? RECOMMENDED.cap.scope);
  const [warn, setWarn] = useState(String(stored?.warnPercent ?? RECOMMENDED.warnPercent));
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
    void store.saveCap(account, row, { amount, scope: nextScope, warn });
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
      onReset={() => void store.reset(account, 'cap')}
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
            <div role="radiogroup" aria-label={t(locale, 'editor.limits.cap.period')} className="flex gap-1">
              {CAP_SCOPES.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="radio"
                  aria-checked={scope === entry}
                  onClick={() => {
                    setScope(entry);
                    commit('cap', entry);
                  }}
                  className={OPTION_CLASS(scope === entry, false)}
                  data-cap-period={entry}
                >
                  {t(locale, PERIOD_KEY[entry] ?? 'editor.limits.cap.period')}
                  {entry === RECOMMENDED.cap.scope ? <RecommendedMark locale={locale} /> : null}
                </button>
              ))}
            </div>
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
                className={`${INPUT_CLASS} w-20 font-mono`}
                data-cap-field="warn"
              />
            </label>
            {warnDiff !== undefined ? (
              <p className="flex flex-wrap items-center gap-2 text-[12px] text-signal-soft">
                <span>{t(locale, 'editor.differs').replace('{value}', diffValueLabel(locale, 'warnPercent', warnDiff.recommended))}</span>
                <ActionButton variant="ghost" onClick={() => void store.reset(account, 'warnPercent')}>
                  {t(locale, 'editor.reset')}
                </ActionButton>
              </p>
            ) : null}
          </div>
        ),
      }}
    />
  );
}

function Limits({ account, locale, store }: Pick<AccountEditorProps, 'account' | 'locale' | 'store'>) {
  return (
    <div data-limits="">
      <PolicyRow account={account} locale={locale} store={store} />
      <ReserveRow account={account} locale={locale} store={store} />
      {mayHaveCap(account) ? <CapRow account={account} locale={locale} store={store} /> : null}
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
      />
    </div>
  );
}

export function AccountEditor(props: AccountEditorProps) {
  const { account, locale, store } = props;
  const state = useSyncExternalStore(store.subscribe, store.state);
  const diffs = settingDiffs(account);
  return (
    <div className="grid gap-2" data-account-editor={account.id}>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        {diffs.length === 0 ? (
          <p className="text-inkdim">{t(locale, 'editor.head.clean')}</p>
        ) : (
          <>
            <p className="text-signal-soft">{t(locale, 'editor.head.diffs').replace('{n}', String(diffs.length))}</p>
            <span aria-hidden="true" className="text-inkdim">
              ·
            </span>
            <ActionButton variant="ghost" onClick={() => void store.resetAll(account)}>
              {t(locale, 'editor.resetAll')}
            </ActionButton>
          </>
        )}
        {state.failure?.row === 'all' ? (
          <p role="alert" className="text-error">
            {t(locale, state.failure.labelKey)}
          </p>
        ) : null}
      </div>
      <div role="tablist" className="flex gap-1 border-b border-hairline">
        {(props.tabs ?? EDITOR_TABS).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={state.tab === tab}
            onClick={() => store.setTab(tab)}
            className={`rounded-control px-3 py-1.5 text-[13px] ${state.tab === tab ? 'border-b-2 border-signal text-ink' : 'text-inkdim hover:text-ink'}`}
          >
            {t(locale, TAB_KEY[tab])}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {state.tab === 'general' ? <General account={account} locale={locale} store={store} roleChips={props.roleChips} onOpenRole={props.onOpenRole} /> : null}
        {state.tab === 'usage' ? (
          <Usage account={account} locale={locale} formatTime={props.formatTime} onRefresh={props.onRefresh} />
        ) : null}
        {state.tab === 'limits' ? <Limits account={account} locale={locale} store={store} /> : null}
        {state.tab === 'models' && props.models !== undefined ? (
          <Models account={account} locale={locale} models={props.models} onRefresh={props.onRefresh} />
        ) : null}
      </div>
    </div>
  );
}
