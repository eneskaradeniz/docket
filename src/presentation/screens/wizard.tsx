// screens/wizard.tsx — the setup wizard in the v3 frame (U-42): the shared Window with the five
// steps in its left column (✓ done, – skipped, the current one signed amber; a done step goes back
// when clicked), a head, the scrolling body and a footer band. A footer button that does not apply
// to a step is not rendered — Geri does not exist on Hoş geldin and "Bu adımı atla" only on Bütçe
// — so nothing reserves space for it; while a finish runs every one of them is disabled, not gone
// (U-49). Bütçe's accounts are one compact row each with an Ayrıntı that opens the row's controls
// in place (U-48); a pay-per-use row keeps its cap and consent in the row itself (U-44a). The
// finish turns the body into its four-line progress list (U-49) and, once done, the window fades
// over the Anasayfa the shell has already opened. The machine lives in stores/wizard.ts; this file
// mirrors it. Every part that Settings also draws is a shared component (Window, SettingRow,
// Listbox, AccountGroups, MeterList, DragOrderList, AccountEditor): this file only arranges them
// for the steps. No secret value has a surface here, and every string arrives through a label key
// (U-1).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { AccountEditorDialog } from '../components/account-editor-dialog';
import { AccountGroups, BillingTag, candidateRowView, EditButton } from '../components/account-groups';
import { AccountsScanning } from '../components/accounts-scanning';
import { ActionButton } from '../components/action-button';
import { AppearanceRows } from '../components/appearance-rows';
import { DragOrderList, type DragOrderItem } from '../components/drag-order-list';
import { KeyMoveCard } from '../components/key-move-card';
import { Listbox } from '../components/listbox';
import { MeterList } from '../components/meter-list';
import { ProviderMark } from '../components/provider-mark';
import { StatusLamp } from '../components/status-lamp';
import { WindowFrame, WindowTitle } from '../components/window-frame';
import { policyLabelKey, createAccountEditorStore, RESERVE_PRESETS, type LimitPolicy } from '../stores/account-editor';
import { CAP_SCOPES, type CapScope } from '../stores/account-models';
import { SECTION_OPEN_INITIAL, billingTagKey, groupAccountRows, groupTotals, toggleSection, type AccountGroup } from '../stores/account-groups';
import { candidateStatusTone } from '../stores/candidates';
import type { LocaleStore } from '../stores/locale';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { RECOMMENDED } from '../stores/recommended';
import type { ThemeStore } from '../stores/theme';
import { toastOutcome } from '../stores/toasts';
import type { BudgetRow, FinishPhase, WizardAccountRow, WizardState, WizardStep, WizardStore } from '../stores/wizard';
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

function RailStep({
  locale,
  step,
  index,
  standing,
  locked,
  onGo,
}: {
  readonly locale: Locale;
  readonly step: WizardStep;
  readonly index: number;
  readonly standing: 'todo' | 'cur' | 'done' | 'skipped';
  /** A finish in flight deads every step button, done ones included (U-49). */
  readonly locked: boolean;
  readonly onGo: () => void;
}) {
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
        disabled={standing !== 'done' || locked}
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
  // The sections' open standing is this screen's: a "Yeniden tara" re-renders it, never resets it (U-45).
  const [sectionOpen, setSectionOpen] = useState(SECTION_OPEN_INITIAL);
  const installed = new Set(state.installed.map((entry) => entry.id));
  const groups = groupAccountRows(
    state.rows.map((row) => candidateRowView(row, locale, row.label, row.providerName)),
    state.providers.map((provider) => ({ id: provider.id, name: provider.name, installed: installed.has(provider.id) })),
  );
  const totals = groupTotals(groups);
  const nameOf = (group: AccountGroup<ReturnType<typeof candidateRowView<WizardAccountRow>>>): string =>
    group.name ?? group.rows[0]?.source.providerName ?? group.providerId ?? t(locale, 'accountGroups.unknownProvider');
  // The scanning surface (U-52) is the one the Settings screen shares: while the scan runs it
  // draws the skeleton; the body mounts only once it ends, told whether to stagger in.
  return (
    <AccountsScanning locale={locale} titleKey="accountGroups.scanned" scanning={state.loading} onRescan={() => void store.rescan()} totals={totals} now={Date.now}>
      {(reveal) => (
        <>
          {groups.length === 0 ? <p className="text-[13px] text-inkdim">{t(locale, 'candidates.empty')}</p> : null}
          <AccountGroups
            locale={locale}
            groups={groups}
            markFor={marks.markFor}
            nameOf={nameOf}
            reveal={reveal}
            onToggle={(row) => store.select(row.id)}
            onEdit={(row) => void store.openEditor(row.id)}
            sections={{ open: sectionOpen, onToggle: (kind) => setSectionOpen(toggleSection(sectionOpen, kind)) }}
            below={(row) =>
              row.source.keyMoveCard ? <KeyMoveCard locale={locale} on={row.source.importToken} onChange={(on) => store.setImportToken(row.id, on)} /> : null
            }
          />
        </>
      )}
    </AccountsScanning>
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

/** The summary line's policy half, in the compact row's own words (U-48). */
const SUMMARY_POLICY_KEY: Readonly<Record<LimitPolicy, LabelKey>> = {
  wait_resume: 'wizard.budget.summary.policy.wait_resume',
  fallback_account: 'wizard.budget.summary.policy.fallback_account',
  switch_pool: 'wizard.budget.summary.policy.switch_pool',
  ask: 'wizard.budget.summary.policy.ask',
};

/** The Ayrıntı disclosure (U-48): one row open at a time — opening a row closes the other. */
export const toggleBudgetRow = (open: string | null, clicked: string): string | null => (open === clicked ? null : clicked);

/** One row's single summary line: what the account does when its limit fills, or its cap standing. */
const summaryLine = (row: BudgetRow, locale: Locale): string => {
  if (row.needsConsent) {
    return t(locale, row.consented ? 'wizard.budget.summary.capAllowed' : 'wizard.budget.summary.capAwaiting').replace('{c}', String(row.capShown.amountUsd));
  }
  const reserve =
    row.reservePercent > 0
      ? t(locale, 'wizard.budget.summary.reserve').replace('{p}', String(row.reservePercent))
      : t(locale, 'wizard.budget.summary.reserveNone');
  return `${t(locale, SUMMARY_POLICY_KEY[row.policy])} · ${reserve}`;
};

/** The cap field and the consent control a pay-per-use row always carries in itself (U-44a in
 *  U-48's compact row) — never folded away behind its Ayrıntı. */
function CapAndConsent({ row, store, locale }: { readonly row: BudgetRow; readonly store: WizardStore; readonly locale: Locale }) {
  const [amount, setAmount] = useState(String(row.capShown.amountUsd));
  const scope = row.capShown.scope;
  // A cap the draft now holds replaces what was typed.
  useEffect(() => setAmount(String(row.capShown.amountUsd)), [row.capShown.amountUsd]);
  const commit = (nextScope: CapScope = scope): boolean => store.setCap(row.id, { amount, scope: nextScope });
  return (
    <div className="flex flex-none flex-wrap items-center gap-1.5" data-budget-inline="">
      <label className="flex h-[30px] items-center gap-1 rounded-control border border-bord bg-raised px-2.5">
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
  );
}

/** The row's controls, opened in place under the row (U-48): the limit-full choice, the reserve,
 *  ✎ and the account's limit lines. Drawn for one row at a time. */
export function BudgetDetail({ row, store, locale }: { readonly row: BudgetRow; readonly store: WizardStore; readonly locale: Locale }) {
  const policyOptions = row.policyChoices.map((policy: LimitPolicy) => ({
    value: policy,
    label: t(locale, policyLabelKey(policy)),
    recommended: policy === RECOMMENDED.limitPolicy,
  }));
  const reservePresets = [
    { value: 'none', label: t(locale, 'editor.limits.reserve.none'), recommended: true },
    ...RESERVE_PRESETS.map((preset) => ({ value: String(preset), label: t(locale, 'editor.limits.reserve.preset').replace('{value}', String(preset)) })),
  ];
  const reserveValue = row.reservePercent > 0 ? String(row.reservePercent) : 'none';
  // A stored reserve outside the presets stays visible in its own control rather than vanishing.
  const reserveOptions = reservePresets.some((option) => option.value === reserveValue)
    ? reservePresets
    : [...reservePresets, { value: reserveValue, label: t(locale, 'editor.limits.reserve.preset').replace('{value}', reserveValue) }];
  return (
    <div id={`budget-detail-${row.id}`} data-budget-detail={row.id} className="border-t border-dashed border-hairline bg-band px-3.5 pb-3.5 pl-[52px] pt-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <div className="grid gap-1">
          <span className="text-[11.5px] font-semibold text-inkdim">{t(locale, 'editor.limits.policy.title')}</span>
          <Listbox
            label={t(locale, 'editor.limits.policy.title')}
            value={row.policy}
            options={policyOptions}
            recommendedLabel={t(locale, 'editor.recommended')}
            minWidth={220}
            onPick={(policy) => store.setPolicy(row.id, policy)}
          />
        </div>
        <div className="grid gap-1">
          <span className="text-[11.5px] font-semibold text-inkdim">{t(locale, 'editor.limits.reserve.title')}</span>
          <Listbox
            label={t(locale, 'editor.limits.reserve.title')}
            value={reserveValue}
            options={reserveOptions}
            recommendedLabel={t(locale, 'editor.recommended')}
            minWidth={150}
            onPick={(value) => store.setReserve(row.id, value === 'none' ? null : Number(value))}
          />
        </div>
        <EditButton locale={locale} onClick={() => void store.openEditor(row.id)} />
      </div>
      <div className="mt-3">
        <MeterList locale={locale} view={row.meters} empty={row.meterEmpty} now={Date.now()} />
      </div>
      {row.needsConsent ? <p className="mt-3 text-[12.5px] text-inkdim">{t(locale, 'wizard.budget.capNote')}</p> : null}
    </div>
  );
}

/** One compact account row (U-48): mark, name, billing tag, one summary line — a pay-per-use row
 *  keeps its cap and consent in the row — and the Ayrıntı that opens the controls in place. */
function BudgetRowCompact({
  row,
  store,
  locale,
  marks,
  open,
  onToggle,
}: {
  readonly row: BudgetRow;
  readonly store: WizardStore;
  readonly locale: Locale;
  readonly marks: ProviderMarksStore;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <li className="border-t border-hairline first:border-t-0" data-budget-row={row.id}>
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-[9px]">
        <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-control border border-hairline bg-raised text-ink">
          <ProviderMark provider={row.markKey ?? ''} mark={row.markKey === null ? null : marks.markFor(row.markKey)} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-bold text-ink">
            {accountName(row.providerName, row.label)}
            <BillingTag locale={locale} billing={row.billing} viaKey={row.viaKey} />
          </div>
          <div className="mt-px text-[12.5px] text-inkdim" data-budget-summary="">
            {summaryLine(row, locale)}
          </div>
        </div>
        {row.needsConsent ? <CapAndConsent row={row} store={store} locale={locale} /> : null}
        <ActionButton
          variant="neutral"
          size="sm"
          ariaExpanded={open}
          ariaControls={`budget-detail-${row.id}`}
          onClick={onToggle}
        >
          {t(locale, 'wizard.budget.detail')}
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className={`h-3.5 w-3.5 flex-none text-inkdim transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </ActionButton>
      </div>
      {open ? <BudgetDetail row={row} store={store} locale={locale} /> : null}
    </li>
  );
}

/** The Bütçe step (U-48): a hint line, then the two billing groups of compact rows. */
export function Budget({ state, store, locale, marks }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale; readonly marks: ProviderMarksStore }) {
  // The open Ayrıntı is this step's own state: a quota re-read or a re-render never closes or
  // duplicates it, and only ever one row stands open.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const { subscriptions, payPerUse } = state.budget;
  const group = (name: LabelKey, hint: LabelKey, key: string, rows: readonly BudgetRow[]) => (
    <section className="mb-[18px]" data-budget-group={key}>
      <h2 className="mb-2 flex items-baseline gap-2 text-[13px] font-bold text-ink">
        {t(locale, name)}
        <span className="font-medium text-inkdim">{t(locale, hint)}</span>
      </h2>
      <ul className="m-0 list-none rounded-card border border-hairline bg-surface p-0">
        {rows.map((row) => (
          <BudgetRowCompact
            key={row.id}
            row={row}
            store={store}
            locale={locale}
            marks={marks}
            open={openRow === row.id}
            onToggle={() => setOpenRow((current) => toggleBudgetRow(current, row.id))}
          />
        ))}
      </ul>
    </section>
  );
  return (
    <div>
      <p className="mb-3.5 flex items-center gap-2 text-[13px] text-inkdim" data-budget-hint="">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-[15px] w-[15px] flex-none text-proceed" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3.5 8.2 3 3 6-6.4" />
        </svg>
        {t(locale, 'wizard.budget.hint')}
      </p>
      {subscriptions.length > 0 ? group('wizard.budget.subscriptions', 'wizard.budget.subscriptionsHint', 'subscriptions', subscriptions) : null}
      {payPerUse.length > 0 ? group('wizard.budget.payPerUse', 'wizard.budget.payPerUseHint', 'pay-per-use', payPerUse) : null}
    </div>
  );
}

/** The finish's four lines (U-49), in the walking order the store's phases publish in. */
const FINISH_PHASES: readonly FinishPhase[] = ['accounts', 'order', 'budget', 'home'];
const FINISH_LINE_KEY: Readonly<Record<FinishPhase, LabelKey>> = {
  accounts: 'wizard.finish.line.accounts',
  order: 'wizard.finish.line.order',
  budget: 'wizard.finish.line.budget',
  home: 'wizard.finish.line.home',
};

/** The window body while "Kurulumu bitir" runs (U-49): four lines, each a spinner until its real
 *  step answers and a drawn check from then on. A failing line keeps its place with its reason
 *  and the one way on. */
function FinishProgress({ state, store, locale }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale }) {
  const at = state.finishPhase === null ? -1 : FINISH_PHASES.indexOf(state.finishPhase);
  return (
    <div className="grid max-w-[440px] gap-3 pt-1" data-finish-list="">
      {FINISH_PHASES.map((phase, index) => {
        const standing = index < at ? 'done' : index > at ? 'wait' : state.finished !== null ? 'done' : state.finishError !== null ? 'error' : 'busy';
        return (
          <div
            key={phase}
            data-finish-line={phase}
            data-ps={standing}
            className={`flex items-center gap-3 text-[14px] ${standing === 'done' ? 'font-semibold text-ink' : 'text-inkdim'}`}
          >
            <span aria-hidden="true" className="grid h-[18px] w-[18px] flex-none place-items-center">
              {standing === 'busy' ? (
                <span className="block h-4 w-4 animate-spin rounded-full border-2 border-hairline border-t-signal motion-reduce:animate-none" />
              ) : standing === 'done' ? (
                // The check draws itself once; a reduced-motion page shows it whole at once.
                <svg viewBox="0 0 16 16" className="h-[15px] w-[15px] text-proceed" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m3.5 8.2 3 3 6-6.4" className="[stroke-dasharray:24] motion-safe:animate-[check-draw_.32s_cubic-bezier(.2,1,.5,1)_both]" />
                </svg>
              ) : standing === 'error' ? (
                <svg viewBox="0 0 16 16" className="h-[15px] w-[15px] text-error" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="8" cy="8" r="5.6" />
                  <path d="m6.1 6.1 3.8 3.8M9.9 6.1l-3.8 3.8" />
                </svg>
              ) : (
                <span className="block h-2 w-2 rounded-full bg-bord" />
              )}
            </span>
            {t(locale, FINISH_LINE_KEY[phase])}
            {standing === 'error' && state.finishError !== null ? (
              <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 pl-4 text-right">
                <span className="text-[12.5px] text-error" data-finish-reason="">
                  {t(locale, state.finishError.reasonKey)}
                </span>
                <ActionButton variant="primary" size="sm" onClick={() => void store.next()}>
                  {t(locale, 'wizard.retry')}
                </ActionButton>
              </span>
            ) : null}
          </div>
        );
      })}
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

/** The window's fade to Anasayfa (U-49): the shell is already there beneath, the overlay thins
 *  out over it and the ack takes it down. A reduced-motion page swaps at once. */
const WIZARD_FADE_MS = 320;

export function WizardScreen({ store, locale, localeStore, themeStore, marks }: WizardScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  // A failed intent leaves as the one toast (U-50), once per outcome — the wizard's own body
  // never draws a notice strip of its own.
  const lastOutcome = state.lastOutcome;
  useEffect(() => {
    if (lastOutcome !== null && !lastOutcome.result.ok) toastOutcome(locale, lastOutcome);
  }, [lastOutcome, locale]);
  // The finished handoff: Anasayfa is already open behind the overlay; the fade is the window's
  // own last step, and ackFinish takes it down only then.
  const leaving = state.finished !== null;
  useEffect(() => {
    if (!leaving) return;
    const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => store.ackFinish(), reduced ? 0 : WIZARD_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, store]);
  // While `open` is still proving that no project exists, and when one does, the wizard has
  // nothing to show.
  if (state.checking || !state.visible) return null;

  const leadKey = LEAD_KEY[state.step];
  // A finish running or stopped keeps the window body as its progress list (U-49).
  const inFinish = state.step === 'budget' && state.finishPhase !== null;
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
          locked={state.finishing || leaving}
          onGo={() => store.goTo(step)}
        />
      ))}
    </ol>
  );

  return (
    <div
      className={`fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 transition-opacity ease-out duration-[320ms] motion-reduce:duration-[0ms] ${
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      data-wizard=""
      data-wizard-leaving={leaving ? '' : undefined}
    >
      <WindowFrame
        label={t(locale, 'wizard.title')}
        brand={t(locale, 'wizard.title')}
        rail={rail}
        railNote={t(locale, 'wizard.railNote')}
        head={
          <WindowTitle
            title={t(locale, inFinish ? 'wizard.finish.title' : STEP_KEY[state.step])}
            {...(inFinish ? { lead: t(locale, 'wizard.finish.lead') } : leadKey === null ? {} : { lead: t(locale, leadKey) })}
          />
        }
        footer={
          <>
            {state.canBack ? (
              <ActionButton variant="ghost" size="md" disabled={state.finishing || leaving} onClick={() => store.back()}>
                {t(locale, 'wizard.back')}
              </ActionButton>
            ) : null}
            {state.canSkip ? (
              <ActionButton variant="ghost" size="md" disabled={state.finishing || leaving} onClick={() => void store.skip()}>
                {t(locale, 'wizard.skip')}
              </ActionButton>
            ) : null}
            <span className="ml-auto min-w-0 text-right text-[12.5px] text-inkdim">
              {state.reasonKey !== null ? t(locale, state.reasonKey) : ''}
            </span>
            <ActionButton variant="primary" size="md" disabled={!state.nextEnabled} onClick={() => void store.next()}>
              {state.finishing ? (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-block h-[15px] w-[15px] animate-spin rounded-full border-2 border-signal-ink/40 border-t-signal-ink motion-reduce:animate-none"
                  />
                  {t(locale, 'wizard.finishing')}
                </>
              ) : (
                t(locale, primaryKey)
              )}
            </ActionButton>
          </>
        }
      >
        {state.step === 'welcome' ? <AppearanceRows locale={locale} localeStore={localeStore} themeStore={themeStore} /> : null}
        {state.step === 'accounts' ? <Accounts state={state} store={store} locale={locale} marks={marks} /> : null}
        {state.step === 'capabilities' ? <Capabilities state={state} store={store} locale={locale} /> : null}
        {state.step === 'order' ? <Order state={state} store={store} locale={locale} marks={marks} /> : null}
        {state.step === 'budget' ? (
          inFinish ? (
            <FinishProgress state={state} store={store} locale={locale} />
          ) : (
            <Budget state={state} store={store} locale={locale} marks={marks} />
          )
        ) : null}
      </WindowFrame>
      {state.editor !== null ? <EditorDialog state={state} store={store} locale={locale} marks={marks} /> : null}
    </div>
  );
}
