// screens/wizard.tsx — the setup wizard in the v3 frame (U-42): the shared Window with the five
// steps in its left column (✓ done, – skipped, the current one signed amber; a done step goes back
// when clicked), a head, the scrolling body and a footer band. A footer button that does not apply
// to a step is not rendered — Geri does not exist on Hoş geldin and "Bu adımı atla" only on Bütçe
// — so nothing reserves space for it. The machine lives in stores/wizard.ts; this file mirrors it.
// Every part that Settings also draws is a shared component (Window, SettingRow, Listbox,
// AccountGroups, MeterList, DragOrderList, AccountEditor): this file only arranges them for the
// steps. Finishing leaves for Anasayfa — the shell takes `finished` and shows the toast. No secret
// value has a surface here, and every string arrives through a label key (U-1).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { AccountEditorDialog } from '../components/account-editor-dialog';
import { AccountGroups, BillingTag, candidateRowView, EditButton } from '../components/account-groups';
import { ActionButton } from '../components/action-button';
import { AppearanceRows } from '../components/appearance-rows';
import { DragOrderList, type DragOrderItem } from '../components/drag-order-list';
import { KeyMoveCard } from '../components/key-move-card';
import { Listbox } from '../components/listbox';
import { MeterList } from '../components/meter-list';
import { OutcomeNotice } from '../components/outcome-notice';
import { ProviderMark } from '../components/provider-mark';
import { StatusLamp } from '../components/status-lamp';
import { WindowFrame, WindowTitle } from '../components/window-frame';
import { policyLabelKey, createAccountEditorStore, type LimitPolicy } from '../stores/account-editor';
import { CAP_SCOPES, type CapScope } from '../stores/account-models';
import { billingTagKey, groupAccountRows, groupTotals, type AccountGroup } from '../stores/account-groups';
import { candidateStatusTone } from '../stores/candidates';
import type { LocaleStore } from '../stores/locale';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { RECOMMENDED } from '../stores/recommended';
import type { ThemeStore } from '../stores/theme';
import type { BudgetRow, WizardAccountRow, WizardState, WizardStep, WizardStore } from '../stores/wizard';
import { WIZARD_EDITOR_TABS, WIZARD_STEPS } from '../stores/wizard';

export interface WizardScreenProps {
  readonly store: WizardStore;
  readonly locale: Locale;
  readonly localeStore: LocaleStore;
  readonly themeStore: ThemeStore;
  readonly marks: ProviderMarksStore;
}

const STEP_KEY: Readonly<Record<WizardStep, LabelKey>> = {
  welcome: 'wizard.step.welcome',
  accounts: 'wizard.step.accounts',
  capabilities: 'wizard.step.capabilities',
  order: 'wizard.step.order',
  budget: 'wizard.step.budget',
};

const LEAD_KEY: Readonly<Record<WizardStep, LabelKey | null>> = {
  welcome: 'wizard.welcome.lead',
  accounts: 'wizard.accounts.lead',
  capabilities: 'wizard.capabilities.lead',
  order: 'wizard.order.lead',
  budget: 'wizard.budget.lead',
};

const SCOPE_KEY: Readonly<Record<CapScope, LabelKey>> = {
  account_day: 'cap.scope.account_day',
  account_week: 'cap.scope.account_week',
  account_month: 'cap.scope.account_month',
};

/** "Provider · account": the provider name carries the weight, the account label follows. */
const accountName = (providerName: string | null, label: string): string => (providerName === null ? label : `${providerName} · ${label}`);

function RailStep({ locale, step, index, standing, onGo }: { readonly locale: Locale; readonly step: WizardStep; readonly index: number; readonly standing: 'todo' | 'cur' | 'done' | 'skipped'; readonly onGo: () => void }) {
  const number =
    standing === 'done' ? (
      '✓'
    ) : standing === 'skipped' ? (
      t(locale, 'wizard.rail.skipped')
    ) : (
      index + 1
    );
  const badge =
    standing === 'cur'
      ? 'border-signal text-signal-soft'
      : standing === 'done'
        ? 'border-ink bg-ink text-surface'
        : 'border-bord text-inkdim';
  return (
    <li>
      <button
        type="button"
        disabled={standing !== 'done'}
        onClick={onGo}
        aria-current={standing === 'cur' ? 'step' : undefined}
        data-rail-step={step}
        data-standing={standing}
        className={`flex w-full items-center gap-2.5 rounded-control px-2 py-[7px] text-left text-[13px] font-semibold ${
          standing === 'cur' ? 'bg-raised text-ink' : standing === 'done' ? 'text-ink hover:bg-raised' : 'text-inkdim'
        }`}
      >
        <span aria-hidden="true" className={`grid h-[22px] w-[22px] flex-none place-items-center rounded-full border font-mono text-[11px] ${badge}`}>
          {number}
        </span>
        {t(locale, STEP_KEY[step])}
      </button>
    </li>
  );
}

function Accounts({ state, store, locale, marks }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale; readonly marks: ProviderMarksStore }) {
  const installed = new Set(state.installed.map((entry) => entry.id));
  const groups = groupAccountRows(
    state.rows.map((row) => candidateRowView(row, locale, row.label, row.providerName)),
    state.providers.map((provider) => ({ id: provider.id, name: provider.name, installed: installed.has(provider.id) })),
  );
  const totals = groupTotals(groups);
  const nameOf = (group: AccountGroup<ReturnType<typeof candidateRowView<WizardAccountRow>>>): string =>
    group.name ?? group.rows[0]?.source.providerName ?? group.providerId ?? t(locale, 'accountGroups.unknownProvider');
  return (
    <div>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="font-bold text-ink">
          {t(locale, 'accountGroups.found')}{' '}
          <span className="font-medium text-inkdim">
            · {t(locale, 'accountGroups.counts').replace('{accounts}', String(totals.accounts)).replace('{assistants}', String(totals.assistants))}
          </span>
        </span>
        <span className="ml-auto">
          <ActionButton disabled={state.loading} onClick={() => void store.rescan()}>
            {t(locale, state.loading ? 'candidates.status.scanning' : 'candidates.rescan')}
          </ActionButton>
        </span>
      </div>
      {state.loading ? (
        <div className="-mt-1.5 mb-2.5 h-0.5 overflow-hidden rounded-full bg-hairline" role="progressbar" aria-label={t(locale, 'candidates.status.scanning')}>
          <i className="block h-full w-[30%] animate-[scan_1s_linear_infinite] bg-signal motion-reduce:animate-none" />
        </div>
      ) : null}
      {groups.length === 0 && !state.loading ? <p className="text-[13px] text-inkdim">{t(locale, 'candidates.empty')}</p> : null}
      <AccountGroups
        locale={locale}
        groups={groups}
        markFor={marks.markFor}
        nameOf={nameOf}
        onToggle={(row) => store.select(row.id)}
        onEdit={(row) => void store.openEditor(row.id)}
        below={(row) =>
          row.source.keyMoveCard ? <KeyMoveCard locale={locale} on={row.source.importToken} onChange={(on) => store.setImportToken(row.id, on)} /> : null
        }
      />
    </div>
  );
}

function Capabilities({ state, store, locale }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale }) {
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {state.capabilities.map((capability) => (
        <li key={capability.id}>
          <button
            type="button"
            role="checkbox"
            aria-checked={capability.selected}
            onClick={() => store.toggleCapability(capability.id)}
            className={`flex w-full items-center gap-3 rounded-card border px-3.5 py-3 text-left hover:border-bord ${capability.selected ? 'border-bord bg-raised' : 'border-hairline bg-surface'}`}
          >
            {/* Technical terms (MCP, Skill, Hook, Context) are never translated. */}
            <span className="flex-none font-mono text-[11px] text-inkdim">{capability.kind}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{capability.name}</span>
            <span
              aria-hidden="true"
              className={`grid h-5 w-5 flex-none place-items-center rounded-full border-[1.5px] text-[11px] ${capability.selected ? 'border-signal bg-signal text-signal-ink' : 'border-bord text-transparent'}`}
            >
              ✓
            </span>
          </button>
        </li>
      ))}
      <li className="sr-only">{t(locale, 'wizard.step.capabilities')}</li>
    </ul>
  );
}

function Order({ state, store, locale, marks }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale; readonly marks: ProviderMarksStore }) {
  const items: readonly DragOrderItem[] = state.order.map((entry, index) => {
    const row = state.rows.find((candidate) => candidate.id === entry.id);
    const tag = t(locale, billingTagKey(entry.billing, entry.viaKey));
    return {
      id: entry.id,
      markKey: entry.markKey,
      label: accountName(entry.providerName, entry.label),
      sub: entry.autoSkipped ? `${tag} · ${t(locale, 'wizard.order.skipsAuto')}` : index === 0 ? t(locale, 'wizard.order.first') : tag,
      trailing:
        row === undefined ? undefined : <StatusLamp tone={candidateStatusTone(row.statusKey)}>{t(locale, row.statusKey)}</StatusLamp>,
    };
  });
  return (
    <div>
      <DragOrderList locale={locale} items={items} markFor={marks.markFor} label={t(locale, 'wizard.step.order')} onReorder={(id, index) => store.moveTo(id, index)} />
      <p className="mt-3.5 max-w-[62ch] text-[13px] text-inkdim">{t(locale, 'wizard.order.note')}</p>
      <p className="mt-3.5 max-w-[62ch] text-[13px] text-inkdim">
        {t(locale, 'dragOrder.keysLead')}{' '}
        <kbd className="rounded-control border border-bord px-1 font-mono text-[11px] text-ink">Alt</kbd> +{' '}
        <kbd className="rounded-control border border-bord px-1 font-mono text-[11px] text-ink">↑</kbd>{' '}
        <kbd className="rounded-control border border-bord px-1 font-mono text-[11px] text-ink">↓</kbd>
      </p>
    </div>
  );
}

function BudgetIdentity({ row, locale, marks }: { readonly row: BudgetRow; readonly locale: Locale; readonly marks: ProviderMarksStore }) {
  const meta = [row.displayPath, row.host].filter((part): part is string => part !== null && part !== '').join(' · ');
  return (
    <>
      <span className="mt-0.5 grid h-[26px] w-[26px] flex-none place-items-center rounded-control border border-hairline bg-raised text-ink">
        <ProviderMark provider={row.markKey ?? ''} mark={row.markKey === null ? null : marks.markFor(row.markKey)} size={15} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 font-bold text-ink">
          {accountName(row.providerName, row.label)}
          <BillingTag locale={locale} billing={row.billing} viaKey={row.viaKey} />
        </div>
        {meta !== '' ? <div className="truncate font-mono text-[12px] text-inkdim">{meta}</div> : null}
      </div>
    </>
  );
}

function SubscriptionRow({ row, store, locale, marks }: { readonly row: BudgetRow; readonly store: WizardStore; readonly locale: Locale; readonly marks: ProviderMarksStore }) {
  const options = row.policyChoices.map((policy: LimitPolicy) => ({
    value: policy,
    label: t(locale, policyLabelKey(policy)),
    recommended: policy === RECOMMENDED.limitPolicy,
  }));
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 border-t border-hairline p-3.5 first:border-t-0" data-budget-row={row.id}>
      <BudgetIdentity row={row} locale={locale} marks={marks} />
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11.5px] text-inkdim">{t(locale, 'editor.limits.policy.title')}</span>
        <div className="flex items-start gap-2">
          <Listbox
            label={t(locale, 'editor.limits.policy.title')}
            value={row.policy}
            options={options}
            recommendedLabel={t(locale, 'editor.recommended')}
            minWidth={220}
            onPick={(policy) => store.setPolicy(row.id, policy)}
          />
          <EditButton locale={locale} onClick={() => void store.openEditor(row.id)} />
        </div>
      </div>
      <div className="col-span-2 col-start-2 mt-1">
        <MeterList locale={locale} view={row.meters} empty={row.meterEmpty} now={Date.now()} />
      </div>
    </li>
  );
}

function PayPerUseRow({ row, store, locale, marks }: { readonly row: BudgetRow; readonly store: WizardStore; readonly locale: Locale; readonly marks: ProviderMarksStore }) {
  const [amount, setAmount] = useState(String(row.capShown.amountUsd));
  const scope = row.capShown.scope;
  // A cap the draft now holds replaces what was typed.
  useEffect(() => setAmount(String(row.capShown.amountUsd)), [row.capShown.amountUsd]);
  const commit = (nextScope: CapScope = scope): boolean => store.setCap(row.id, { amount, scope: nextScope });
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 border-t border-hairline p-3.5 first:border-t-0" data-budget-row={row.id}>
      <BudgetIdentity row={row} locale={locale} marks={marks} />
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11.5px] text-inkdim">{t(locale, 'wizard.budget.cap')}</span>
        <div className="flex items-start gap-1.5">
          <label className="flex h-[34px] items-center gap-1 rounded-control border border-bord bg-raised px-2.5">
            <span className="font-mono text-[13px] text-inkdim">$</span>
            <input
              inputMode="decimal"
              value={amount}
              aria-label={t(locale, 'wizard.budget.cap')}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.,]/g, ''))}
              onBlur={() => void commit()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commit();
              }}
              className="w-[54px] border-0 bg-transparent text-right font-mono text-[13px] text-ink outline-none"
            />
          </label>
          <Listbox
            label={t(locale, 'wizard.budget.period')}
            value={scope}
            options={CAP_SCOPES.map((entry) => ({ value: entry, label: t(locale, SCOPE_KEY[entry]), recommended: entry === RECOMMENDED.cap.scope }))}
            recommendedLabel={t(locale, 'editor.recommended')}
            minWidth={110}
            onPick={(entry) => void commit(entry)}
          />
          <EditButton locale={locale} onClick={() => void store.openEditor(row.id)} />
        </div>
        {row.consented ? (
          <span className="flex items-center gap-2 text-[12.5px]" data-consent="granted">
            <span className="text-proceed">{t(locale, 'wizard.consent.granted')}</span>
            <ActionButton variant="ghost" onClick={() => store.revokeSpend(row.id)}>
              {t(locale, 'wizard.consent.revoke')}
            </ActionButton>
          </span>
        ) : (
          <ActionButton variant="primary" onClick={() => void store.allowSpend(row.id, { amount, scope })}>
            {t(locale, 'wizard.consent.allow')}
          </ActionButton>
        )}
      </div>
      <p className="col-span-2 col-start-2 text-[12.5px] text-inkdim">{t(locale, 'wizard.budget.capNote')}</p>
    </li>
  );
}

function Budget({ state, store, locale, marks }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale; readonly marks: ProviderMarksStore }) {
  const { subscriptions, payPerUse } = state.budget;
  const group = (name: LabelKey, hint: LabelKey, key: string, children: React.ReactNode) => (
    <section className="mb-[18px]" data-budget-group={key}>
      <h2 className="mb-2 flex items-baseline gap-2 text-[13px] font-bold text-ink">
        {t(locale, name)}
        <span className="font-medium text-inkdim">{t(locale, hint)}</span>
      </h2>
      <ul className="m-0 list-none rounded-card border border-hairline bg-surface p-0">{children}</ul>
    </section>
  );
  return (
    <div>
      {subscriptions.length > 0
        ? group(
            'wizard.budget.subscriptions',
            'wizard.budget.subscriptionsHint',
            'subscriptions',
            subscriptions.map((row) => <SubscriptionRow key={row.id} row={row} store={store} locale={locale} marks={marks} />),
          )
        : null}
      {payPerUse.length > 0
        ? group(
            'wizard.budget.payPerUse',
            'wizard.budget.payPerUseHint',
            'pay-per-use',
            payPerUse.map((row) => <PayPerUseRow key={row.id} row={row} store={store} locale={locale} marks={marks} />),
          )
        : null}
    </div>
  );
}

function EditorDialog({ state, store, locale, marks }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale; readonly marks: ProviderMarksStore }) {
  const editorKey = state.editor?.key ?? '';
  // One editor store per open: the tab starts on Genel each time.
  const editor = useMemo(() => createAccountEditorStore({ run: (command) => store.editorRun(command), now: () => Date.now() }), [store, editorKey]);
  const row = state.rows.find((candidate) => candidate.id === editorKey);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
  if (state.editor === null || row === undefined) return null;
  const account = state.editor.account;
  return (
    <AccountEditorDialog
      host="wizard"
      account={account}
      locale={locale}
      store={editor}
      tabs={WIZARD_EDITOR_TABS}
      formatTime={(epochMs) => (epochMs === null ? null : formatter.format(epochMs))}
      onRefresh={() => void store.refreshQuota(editorKey)}
      providerName={row.providerName}
      mark={<ProviderMark provider={account.provider} mark={account.provider === '' ? null : marks.markFor(account.provider)} size={19} />}
      title={accountName(row.providerName, account.label)}
      meta={[row.displayPath, row.endpointHost].filter((part): part is string => part !== null && part !== '').join(' · ')}
      billing={row.billing}
      viaKey={row.viaKey}
      status={{ tone: candidateStatusTone(row.statusKey), text: t(locale, row.statusKey) }}
      onClose={() => store.cancelEditor()}
      onSave={() => store.saveEditor()}
    />
  );
}

export function WizardScreen({ store, locale, localeStore, themeStore, marks }: WizardScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  // While `open` is still proving that no project exists, and when one does, the wizard has
  // nothing to show.
  if (state.checking || !state.visible) return null;

  const leadKey = LEAD_KEY[state.step];
  const failure = state.lastOutcome !== null && !state.lastOutcome.result.ok ? state.lastOutcome : null;
  const primaryKey: LabelKey = state.step === 'budget' ? (state.finishing ? 'wizard.finishing' : 'wizard.finish') : 'wizard.next';
  const rail = (
    <ol className="m-0 grid list-none gap-0.5 p-0">
      {WIZARD_STEPS.map((step, index) => (
        <RailStep
          key={step}
          locale={locale}
          step={step}
          index={index}
          standing={state.rail.find((entry) => entry.step === step)?.standing ?? 'todo'}
          onGo={() => store.goTo(step)}
        />
      ))}
    </ol>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" data-wizard="">
      <WindowFrame
        label={t(locale, 'wizard.title')}
        brand={t(locale, 'wizard.title')}
        rail={rail}
        railNote={t(locale, 'wizard.railNote')}
        head={<WindowTitle title={t(locale, STEP_KEY[state.step])} {...(leadKey === null ? {} : { lead: t(locale, leadKey) })} />}
        footer={
          <>
            {state.canBack ? (
              <ActionButton variant="ghost" size="md" onClick={() => store.back()}>
                {t(locale, 'wizard.back')}
              </ActionButton>
            ) : null}
            {state.canSkip ? (
              <ActionButton variant="ghost" size="md" disabled={state.finishing} onClick={() => void store.skip()}>
                {t(locale, 'wizard.skip')}
              </ActionButton>
            ) : null}
            <span className="ml-auto min-w-0 text-right text-[12.5px] text-inkdim">
              {state.reasonKey !== null ? t(locale, state.reasonKey) : ''}
            </span>
            <ActionButton variant="primary" size="md" disabled={!state.nextEnabled} onClick={() => void store.next()}>
              {t(locale, primaryKey)}
            </ActionButton>
          </>
        }
      >
        {failure !== null ? (
          <div className="mb-3">
            <OutcomeNotice ok={false} text={t(locale, failure.labelKey)} code={failure.result.ok ? undefined : failure.result.code} />
          </div>
        ) : null}
        {state.step === 'welcome' ? <AppearanceRows locale={locale} localeStore={localeStore} themeStore={themeStore} /> : null}
        {state.step === 'accounts' ? <Accounts state={state} store={store} locale={locale} marks={marks} /> : null}
        {state.step === 'capabilities' ? <Capabilities state={state} store={store} locale={locale} /> : null}
        {state.step === 'order' ? <Order state={state} store={store} locale={locale} marks={marks} /> : null}
        {state.step === 'budget' ? <Budget state={state} store={store} locale={locale} marks={marks} /> : null}
      </WindowFrame>
      {state.editor !== null ? <EditorDialog state={state} store={store} locale={locale} marks={marks} /> : null}
    </div>
  );
}
