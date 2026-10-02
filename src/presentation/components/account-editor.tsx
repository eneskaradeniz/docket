// components/account-editor.tsx — the account editor body (U-30): a head with the recommendation
// count and "Hepsini önerilene döndür" (U-29), four tabs, and the tab's content. Genel holds the
// label (saved on commit) and the read-only facts; Kullanım the meter bars or the spend against
// the cap; Limitler is a placeholder until its screen lands; Modeller lists the catalog by billing with the spend-consent card (U-32). The rules live in
// stores/account-editor.ts; this file renders them. The host (Settings sub-page, later the
// wizard window) frames the body.
import { useEffect, useState, useSyncExternalStore } from 'react';

import type { SettingsAccountView } from '../../api/queries';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import {
  EDITOR_TABS,
  SAVED_FLAG_MS,
  generalFacts,
  usageView,
  type AccountEditorStore,
  type EditorTab,
  type FactKey,
} from '../stores/account-editor';
import type { AccountModelsStore } from '../stores/account-models';
import { settingDiffs } from '../stores/recommended';
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
  /** The models list and the spend-consent flow of the Modeller tab (U-32). */
  readonly models: AccountModelsStore;
  /** A moment in the active locale (meter resets, the last read). */
  readonly formatTime: (epochMs: number | null) => string | null;
  /** Re-reads the account's meters ("Yenile"). */
  readonly onRefresh: () => void;
}

function LabelRow({ account, locale, store }: Pick<AccountEditorProps, 'account' | 'locale' | 'store'>) {
  const [draft, setDraft] = useState(account.label);
  // A saved name coming back from the query replaces the draft; typing in between is the user's.
  useEffect(() => setDraft(account.label), [account.label]);
  const state = useSyncExternalStore(store.subscribe, store.state);
  const [, bump] = useState(0);
  const saved = store.isSaved('label');
  // The flag leaves by itself: one re-render when its 1.5 s are up.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => bump((n) => n + 1), SAVED_FLAG_MS);
    return () => window.clearTimeout(timer);
  }, [saved, state.savedUntil]);
  const commit = (): void => void store.saveLabel(account, draft);
  return (
    <SettingRow
      locale={locale}
      title={t(locale, 'editor.general.label')}
      purpose={t(locale, 'editor.general.labelHint')}
      saved={saved}
      failure={state.failure?.row === 'label' ? t(locale, state.failure.labelKey) : undefined}
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

function General({ account, locale, store }: Pick<AccountEditorProps, 'account' | 'locale' | 'store'>) {
  return (
    <div>
      <LabelRow account={account} locale={locale} store={store} />
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

function Models({ account, locale, models, onRefresh }: Pick<AccountEditorProps, 'account' | 'locale' | 'models' | 'onRefresh'>) {
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
        {EDITOR_TABS.map((tab) => (
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
        {state.tab === 'general' ? <General account={account} locale={locale} store={store} /> : null}
        {state.tab === 'usage' ? (
          <Usage account={account} locale={locale} formatTime={props.formatTime} onRefresh={props.onRefresh} />
        ) : null}
        {state.tab === 'limits' ? <p className="py-3 text-[13px] text-inkdim">{t(locale, 'editor.limits.placeholder')}</p> : null}
        {state.tab === 'models' ? (
          <Models account={account} locale={locale} models={props.models} onRefresh={props.onRefresh} />
        ) : null}
      </div>
    </div>
  );
}
