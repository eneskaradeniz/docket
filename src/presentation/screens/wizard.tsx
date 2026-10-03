// screens/wizard.tsx — the setup wizard in the rev 28.1 frame (U-35): a rail of the five steps on
// the left (✓ done, – skipped, the current one signed amber) and one pane with fixed footer slots —
// Geri · Bu adımı atla on the left, the reason line and the primary on the right, a hidden control
// keeps its slot. The machine lives in stores/wizard.ts; this file mirrors it. The ✎ buttons open
// the account editor (U-30) in a centred 560×480 window with Vazgeç / Kaydet (Esc = Vazgeç) over
// the store's draft. No secret value has a surface here, and every string arrives through a
// label key (U-1).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { SettingsAccountView } from '../../api/queries';
import { AccountEditor } from '../components/account-editor';
import { ActionButton } from '../components/action-button';
import { InfoBubble } from '../components/info-bubble';
import { LocaleSwitcher } from '../components/locale-switcher';
import { formatMeterValue } from '../components/meter-value';
import { OutcomeNotice } from '../components/outcome-notice';
import { ProviderMark } from '../components/provider-mark';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { createAccountEditorStore, type EditorTab } from '../stores/account-editor';
import { CAP_SCOPES, type CapScope } from '../stores/account-models';
import type { LocaleStore } from '../stores/locale';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { RECOMMENDED } from '../stores/recommended';
import { THEME_PREFERENCES, type ThemePreference, type ThemeStore } from '../stores/theme';
import type { BudgetRow, WizardState, WizardStep, WizardStore } from '../stores/wizard';
import { WIZARD_STEPS } from '../stores/wizard';

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
  done: 'wizard.step.done',
};

const LEAD_KEY: Readonly<Record<WizardStep, LabelKey | null>> = {
  welcome: 'wizard.welcome.lead',
  accounts: 'wizard.accounts.lead',
  capabilities: 'wizard.capabilities.lead',
  order: 'wizard.order.lead',
  budget: null,
  done: 'wizard.done.lead',
};

/** The window offers no Modeller tab: a draft has no stored account to list models of — the
 *  spend consent is asked on Bütçe. */
const WINDOW_TABS: readonly EditorTab[] = ['general', 'usage', 'limits'];

const THEME_KEY: Readonly<Record<ThemePreference, LabelKey>> = {
  system: 'settings.theme.system',
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
};

const SCOPE_KEY: Readonly<Record<CapScope, LabelKey>> = {
  account_day: 'cap.scope.account_day',
  account_week: 'cap.scope.account_week',
  account_month: 'cap.scope.account_month',
};

const CHIP = 'rounded-control border px-[7px] py-px font-mono text-[11px]';
const chipClass = (active: boolean): string =>
  active ? `${CHIP} border-signal text-signal` : `${CHIP} border-hairline text-inkdim transition-colors hover:text-ink`;

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);

const LABEL_CLASS = 'font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim';

/** The 18px selection circle every list of the wizard ends with. */
function SelectionMark({ on }: { readonly on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-[18px] w-[18px] flex-none place-items-center rounded-full border text-[11px] ${
        on ? 'border-signal text-signal' : 'border-bord text-transparent'
      }`}
    >
      ✓
    </span>
  );
}

function EditButton({ locale, labelKey, onClick }: { readonly locale: Locale; readonly labelKey: LabelKey; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={t(locale, labelKey)}
      title={t(locale, labelKey)}
      onClick={onClick}
      className="grid h-7 w-7 flex-none place-items-center rounded-control border border-transparent text-inkdim hover:border-bord hover:text-ink"
    >
      <span aria-hidden="true">✎</span>
    </button>
  );
}

function Welcome({ locale, localeStore, themeStore }: { readonly locale: Locale; readonly localeStore: LocaleStore; readonly themeStore: ThemeStore }) {
  const preference = useSyncExternalStore(themeStore.subscribe, themeStore.preference);
  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <span className={LABEL_CLASS}>{t(locale, 'settings.language.label')}</span>
        <LocaleSwitcher store={localeStore} locale={locale} />
      </div>
      <div className="grid gap-1.5">
        <span className={LABEL_CLASS}>{t(locale, 'settings.theme.label')}</span>
        <div role="group" aria-label={t(locale, 'settings.theme.label')} className="flex w-fit items-center gap-1">
          {THEME_PREFERENCES.map((option) => (
            <button key={option} type="button" aria-pressed={option === preference} onClick={() => themeStore.set(option)} className={chipClass(option === preference)}>
              {t(locale, THEME_KEY[option])}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Accounts({ state, store, locale, marks, onEdit }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale; readonly marks: ProviderMarksStore; readonly onEdit: (key: string) => void }) {
  return (
    <div className="grid gap-3">
      {state.rows.length === 0 && state.providers.length === 0 ? (
        <p className="text-[13px] text-inkdim">{state.loading ? t(locale, 'wizard.checking') : t(locale, 'candidates.empty')}</p>
      ) : null}
      {state.rows.length > 0 ? (
        <ul className="grid gap-2">
          {state.rows.map((row) => (
            <li key={row.id} className="grid gap-2" data-wizard-account={row.id}>
              <div
                className={`flex items-center gap-2.5 rounded-card border px-3 py-2 ${row.selected ? 'border-bord bg-raised' : 'border-hairline bg-surface'} ${
                  row.selectable ? '' : 'opacity-60'
                }`}
              >
                <button
                  type="button"
                  disabled={!row.selectable}
                  aria-pressed={row.selected}
                  onClick={() => store.select(row.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <ProviderMark provider={row.markKey ?? ''} mark={row.markKey === null ? null : marks.markFor(row.markKey)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">{row.label}</span>
                    {row.endpointHost !== null ? <span className="block truncate font-mono text-[11px] text-inkdim">{row.endpointHost}</span> : null}
                    {row.disabledReasonKey !== null ? <span className="block text-[11.5px] text-inkdim">{t(locale, row.disabledReasonKey)}</span> : null}
                  </span>
                </button>
                {row.warnKeys.map((key) => (
                  <span key={key} className="inline-flex items-center gap-1 font-mono text-[11px] text-signal">
                    {t(locale, key)}
                    <InfoBubble locale={locale} subject={t(locale, key)} body={t(locale, 'candidates.info.env_overrides_login')} />
                  </span>
                ))}
                <span className={`flex-none font-mono text-[11px] ${row.statusKey === 'candidates.status.key_needed' ? 'text-signal' : 'text-inkdim'}`}>
                  {t(locale, row.statusKey)}
                </span>
                {row.selected ? <EditButton locale={locale} labelKey="wizard.accounts.edit" onClick={() => onEdit(row.id)} /> : null}
                <button
                  type="button"
                  disabled={!row.selectable}
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => store.select(row.id)}
                  className="flex-none"
                >
                  <SelectionMark on={row.selected} />
                </button>
              </div>
              {row.keyMoveCard ? (
                <div className="grid gap-2 rounded-card border border-hairline bg-band p-3">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 text-[13px] text-ink">{t(locale, 'candidates.keymove.title')}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.importToken}
                      aria-label={t(locale, 'candidates.keymove.switch')}
                      onClick={() => store.setImportToken(row.id, !row.importToken)}
                      className={`relative h-5 w-9 flex-none rounded-full border transition-colors ${row.importToken ? 'border-signal bg-signal' : 'border-hairline bg-raised'}`}
                    >
                      <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-ink transition-[left] ${row.importToken ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                  <p className="text-[12px] text-inkdim">{t(locale, 'candidates.keymove.body')}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state.providers.length > 0 ? (
        <div className="grid gap-1.5">
          <span className={LABEL_CLASS}>{t(locale, 'candidates.providers.title')}</span>
          <ul className="grid gap-1.5">
            {state.providers.map((provider) => (
              <li key={provider.id} className="grid gap-1.5 rounded-card border border-hairline px-3 py-1.5">
                <div className="flex items-center gap-2.5">
                  <ProviderMark provider={provider.id} mark={marks.markFor(provider.id)} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{provider.name}</span>
                  <span className="flex-none font-mono text-[11px] text-inkdim">{t(locale, provider.statusKey)}</span>
                </div>
                {provider.hintKey !== null ? <p className="text-[12px] text-inkdim">{t(locale, provider.hintKey).replace('{name}', provider.name)}</p> : null}
                {provider.installUrl !== null ? (
                  <div className="flex items-center gap-2 rounded-control bg-band px-2 py-1">
                    <code className="min-w-0 flex-1 select-all truncate font-mono text-[11.5px] text-ink">{provider.installUrl}</code>
                    <ActionButton onClick={() => void navigator.clipboard?.writeText(provider.installUrl ?? '')}>{t(locale, 'candidates.install.copy')}</ActionButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <ActionButton disabled={state.loading} onClick={() => void store.rescan()}>
          {t(locale, 'candidates.rescan')}
        </ActionButton>
      </div>
    </div>
  );
}

function Capabilities({ state, store, locale }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale }) {
  return (
    <ul className="grid gap-2">
      {state.capabilities.map((capability) => (
        <li key={capability.id}>
          <button
            type="button"
            aria-pressed={capability.selected}
            onClick={() => store.toggleCapability(capability.id)}
            className={`flex w-full items-center gap-2.5 rounded-card border px-3 py-2 text-left ${capability.selected ? 'border-bord bg-raised' : 'border-hairline bg-surface'}`}
          >
            {/* Technical terms (MCP, Skill, Hook, Context) are never translated. */}
            <span className="flex-none font-mono text-[11px] text-inkdim">{capability.kind}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{capability.name}</span>
            <SelectionMark on={capability.selected} />
          </button>
        </li>
      ))}
      <span className="sr-only">{t(locale, 'wizard.step.capabilities')}</span>
    </ul>
  );
}

function Order({ state, store, locale, marks }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale; readonly marks: ProviderMarksStore }) {
  return (
    <ol className="grid gap-2">
      {state.order.map((entry, index) => (
        <li
          key={entry.id}
          className="flex items-center gap-2.5 rounded-card border border-hairline bg-surface px-3 py-2"
          onKeyDown={(event) => {
            if (!event.altKey) return;
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              store.moveUp(entry.id);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              store.moveDown(entry.id);
            }
          }}
        >
          <span className="w-5 flex-none text-center font-mono text-[12px] text-inkdim">{index + 1}</span>
          <ProviderMark provider={entry.markKey ?? ''} mark={entry.markKey === null ? null : marks.markFor(entry.markKey)} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{entry.label}</span>
          <button
            type="button"
            aria-label={t(locale, 'wizard.order.up')}
            title={t(locale, 'wizard.order.up')}
            disabled={index === 0}
            onClick={() => store.moveUp(entry.id)}
            className="grid h-7 w-7 place-items-center rounded-control border border-bord text-ink hover:bg-raised disabled:opacity-40"
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            type="button"
            aria-label={t(locale, 'wizard.order.down')}
            title={t(locale, 'wizard.order.down')}
            disabled={index === state.order.length - 1}
            onClick={() => store.moveDown(entry.id)}
            className="grid h-7 w-7 place-items-center rounded-control border border-bord text-ink hover:bg-raised disabled:opacity-40"
          >
            <span aria-hidden="true">↓</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** A mini bar: the share still left, from the left edge. */
function MiniBar({ fillShare }: { readonly fillShare: number | null }) {
  return (
    <span className="relative block h-1.5 w-16 overflow-hidden rounded-full bg-raised" role="presentation">
      {fillShare === null ? null : <span className="absolute inset-y-0 left-0 bg-proceed" style={{ width: `${Math.round(fillShare * 100)}%` }} />}
    </span>
  );
}

function ConsentCard({ row, store, locale }: { readonly row: BudgetRow; readonly store: WizardStore; readonly locale: Locale }) {
  const [amount, setAmount] = useState(String(RECOMMENDED.cap.amountUsd));
  const [scope, setScope] = useState<CapScope>(RECOMMENDED.cap.scope);
  if (row.consented) {
    return (
      <div className="flex items-center gap-3 rounded-card border border-hairline bg-band px-3 py-2" data-consent="granted">
        <span className="font-mono text-[11px] text-proceed">{t(locale, 'wizard.consent.granted')}</span>
        <span className="min-w-0 flex-1" />
        <ActionButton variant="ghost" onClick={() => store.revokeSpend(row.id)}>
          {t(locale, 'wizard.consent.revoke')}
        </ActionButton>
      </div>
    );
  }
  return (
    <div className="grid gap-2 rounded-card border border-hairline bg-band p-3" data-consent="needed">
      <p className="text-[13px] font-semibold text-ink">{t(locale, 'wizard.consent.title')}</p>
      <p className="text-[12px] text-inkdim">{t(locale, 'wizard.consent.body')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12.5px] text-inkdim">
          {t(locale, 'wizard.consent.cap')}
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-20 rounded-control border border-bord bg-transparent px-2 py-1 font-mono text-[13px] text-ink focus:border-signal focus:outline-none"
          />
        </label>
        <div role="radiogroup" className="flex items-center gap-1">
          {CAP_SCOPES.map((entry) => (
            <button key={entry} type="button" role="radio" aria-checked={scope === entry} onClick={() => setScope(entry)} className={chipClass(scope === entry)}>
              {t(locale, SCOPE_KEY[entry])}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <ActionButton variant="primary" onClick={() => void store.allowSpend(row.id, { amount, scope })}>
          {t(locale, 'wizard.consent.allow')}
        </ActionButton>
      </div>
    </div>
  );
}

function Budget({ state, store, locale, marks, onEdit }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale; readonly marks: ProviderMarksStore; readonly onEdit: (key: string) => void }) {
  const { subscriptions, payPerUse } = state.budget;
  const reserveText = (row: BudgetRow): string => {
    const share = Math.max(row.reserveShort, row.reserveLong);
    return share > 0 ? fill(t(locale, 'wizard.budget.reserve'), { pct: String(Math.round(share * 100)) }) : t(locale, 'wizard.budget.reserveNone');
  };
  return (
    <div className="grid gap-5">
      {subscriptions.length > 0 ? (
        <section className="grid gap-2" data-budget-group="subscriptions">
          <h3 className="text-[14px] font-semibold text-ink">
            {t(locale, 'wizard.budget.subscriptions')} <span className="font-normal text-inkdim">· {t(locale, 'wizard.budget.subscriptionsHint')}</span>
          </h3>
          <ul className="grid gap-2">
            {subscriptions.map((row) => (
              <li key={row.id} className="flex items-center gap-2.5 rounded-card border border-hairline bg-surface px-3 py-2" data-budget-row={row.id}>
                <ProviderMark provider={row.markKey ?? ''} mark={row.markKey === null ? null : marks.markFor(row.markKey)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{row.label}</span>
                  <span className="block truncate text-[12px] text-inkdim">
                    {t(locale, row.policyKey)} · {reserveText(row)}
                    {row.diffCount > 0 ? ` · ${fill(t(locale, 'editor.head.diffs'), { n: String(row.diffCount) })}` : ''}
                  </span>
                </span>
                <span className="flex flex-none items-center gap-1" title={row.bars.length === 0 ? t(locale, 'wizard.budget.unread') : undefined}>
                  {row.bars.length === 0 ? <MiniBar fillShare={null} /> : row.bars.map((bar, index) => <MiniBar key={index} fillShare={bar} />)}
                </span>
                <EditButton locale={locale} labelKey="wizard.budget.edit" onClick={() => onEdit(row.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {payPerUse.length > 0 ? (
        <section className="grid gap-2" data-budget-group="pay-per-use">
          <h3 className="text-[14px] font-semibold text-ink">
            {t(locale, 'wizard.budget.payPerUse')} <span className="font-normal text-inkdim">· {t(locale, 'wizard.budget.payPerUseHint')}</span>
          </h3>
          <ul className="grid gap-2">
            {payPerUse.map((row) => (
              <li key={row.id} className="grid gap-2" data-budget-row={row.id}>
                <div className="flex items-center gap-2.5 rounded-card border border-hairline bg-surface px-3 py-2">
                  <ProviderMark provider={row.markKey ?? ''} mark={row.markKey === null ? null : marks.markFor(row.markKey)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">{row.label}</span>
                    <span className="block truncate font-mono text-[11.5px] text-inkdim">
                      {fill(t(locale, 'wizard.budget.spend'), {
                        spent: row.spentUsd === null ? '—' : formatMeterValue(locale, 'usd', row.spentUsd),
                        cap:
                          row.cap === null
                            ? t(locale, 'wizard.budget.noCap')
                            : `${formatMeterValue(locale, 'usd', row.cap.amountUsd)} · ${t(locale, SCOPE_KEY[row.cap.scope as CapScope] ?? 'cap.scope.account_month')}`,
                      })}
                      {row.diffCount > 0 ? ` · ${fill(t(locale, 'editor.head.diffs'), { n: String(row.diffCount) })}` : ''}
                    </span>
                  </span>
                  <EditButton locale={locale} labelKey="wizard.budget.edit" onClick={() => onEdit(row.id)} />
                </div>
                <ConsentCard row={row} store={store} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function EditorWindow({ store, account, locale }: { readonly store: WizardStore; readonly account: SettingsAccountView; readonly locale: Locale }) {
  // One editor store per window: the tab starts on Genel each time it opens.
  const editor = useMemo(() => createAccountEditorStore({ run: (command) => store.editorRun(command), now: () => Date.now() }), [store]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      store.cancelEditor();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [store]);
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-black/50 p-4">
      <div role="dialog" aria-label={t(locale, 'wizard.editor.title')} className="flex h-[480px] max-h-full w-[560px] max-w-full flex-col overflow-hidden rounded-panel border border-bord bg-bg" data-wizard-editor="">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <AccountEditor account={account} locale={locale} store={editor} tabs={WINDOW_TABS} formatTime={() => null} onRefresh={() => undefined} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">
          <ActionButton variant="neutral" size="md" onClick={() => store.cancelEditor()}>
            {t(locale, 'wizard.editor.cancel')}
          </ActionButton>
          <ActionButton variant="primary" size="md" onClick={() => store.saveEditor()}>
            {t(locale, 'wizard.editor.save')}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

const railNumberClass = (standing: 'todo' | 'cur' | 'done' | 'skipped'): string => {
  const base = 'grid h-5 w-5 flex-none place-items-center rounded-full border font-mono text-[11px]';
  if (standing === 'cur') return `${base} border-signal text-signal`;
  if (standing === 'done') return `${base} border-proceed bg-proceed text-bg`;
  return `${base} border-bord text-inkdim`;
};

export function WizardScreen({ store, locale, localeStore, themeStore, marks }: WizardScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  // While `open` is still proving that no project exists, and when one does, the wizard has
  // nothing to show.
  if (state.checking || !state.visible) return null;

  const onEdit = (key: string): void => void store.openEditor(key);
  const isDone = state.step === 'done';
  const primaryKey: LabelKey = isDone ? 'wizard.attach' : state.step === 'budget' ? (state.finishing ? 'wizard.finishing' : 'wizard.finish') : 'wizard.next';
  const leadKey = LEAD_KEY[state.step];
  const failure = state.lastOutcome !== null && !state.lastOutcome.result.ok ? state.lastOutcome : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div
        className="relative grid h-[600px] max-h-full w-full max-w-[820px] overflow-hidden rounded-panel border border-bord bg-bg md:grid-cols-[210px_minmax(0,1fr)]"
        role="dialog"
        aria-label={t(locale, 'wizard.title')}
        data-wizard=""
      >
        <div className="flex flex-row flex-wrap gap-1 border-b border-hairline bg-surface px-3 py-3 md:flex-col md:gap-0.5 md:border-b-0 md:border-r md:px-2.5 md:py-4">
          <p className="hidden px-2.5 pb-3 text-[14px] font-semibold text-ink md:block">{t(locale, 'wizard.title')}</p>
          {WIZARD_STEPS.map((step, index) => {
            const entry = state.rail.find((item) => item.step === step);
            const standing = entry?.standing ?? 'todo';
            return (
              <div
                key={step}
                data-rail-step={step}
                data-standing={standing}
                className={`flex items-center gap-2.5 rounded-control px-2.5 py-[7px] ${standing === 'cur' ? 'bg-raised' : ''}`}
                aria-current={standing === 'cur' ? 'step' : undefined}
              >
                <span aria-hidden="true" className={railNumberClass(standing)}>
                  {standing === 'done' ? '✓' : standing === 'skipped' ? t(locale, 'wizard.rail.skipped') : index + 1}
                </span>
                <span className={`text-[13.5px] max-md:hidden ${standing === 'cur' ? 'font-semibold text-ink' : standing === 'done' ? 'text-ink' : 'text-inkdim'}`}>
                  {t(locale, STEP_KEY[step])}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-col p-5 md:p-6">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid content-start gap-4">
              <div className="grid gap-1">
                <h2 className="text-[20px] font-bold tracking-[-0.01em] text-ink">{t(locale, STEP_KEY[state.step])}</h2>
                {leadKey !== null ? <p className="text-[13.5px] text-inkdim">{t(locale, leadKey)}</p> : null}
              </div>
              {failure !== null ? <OutcomeNotice ok={false} text={t(locale, failure.labelKey)} code={failure.result.ok ? undefined : failure.result.code} /> : null}
              {state.step === 'welcome' ? <Welcome locale={locale} localeStore={localeStore} themeStore={themeStore} /> : null}
              {state.step === 'accounts' ? <Accounts state={state} store={store} locale={locale} marks={marks} onEdit={onEdit} /> : null}
              {state.step === 'capabilities' ? <Capabilities state={state} store={store} locale={locale} /> : null}
              {state.step === 'order' ? <Order state={state} store={store} locale={locale} marks={marks} /> : null}
              {state.step === 'budget' ? <Budget state={state} store={store} locale={locale} marks={marks} onEdit={onEdit} /> : null}
              {isDone && state.summary !== null ? (
                <p className="font-mono text-[13px] text-ink" data-wizard-summary="">
                  {fill(t(locale, 'wizard.done.summary'), {
                    accounts: String(state.summary.accounts),
                    capabilities: String(state.summary.capabilities),
                    first: state.summary.firstLabel,
                  })}
                </p>
              ) : null}
            </div>
          </div>

          <footer className="mt-4 flex items-center gap-2 border-t border-hairline pt-3" data-wizard-footer="">
            <div className="flex flex-none items-center gap-2">
              <span className={state.step === 'welcome' || isDone ? 'invisible' : ''}>
                <ActionButton variant="neutral" size="md" onClick={() => store.back()}>
                  {t(locale, 'wizard.back')}
                </ActionButton>
              </span>
              <span className={state.canSkip ? '' : 'invisible'}>
                <ActionButton variant="ghost" size="md" onClick={() => void store.skip()}>
                  {t(locale, 'wizard.skip')}
                </ActionButton>
              </span>
            </div>
            <span className="min-w-0 flex-1 text-right text-[12.5px] text-inkdim">
              {state.reasonKey !== null ? (
                <>
                  <span aria-hidden="true" className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-signal align-middle" />
                  {t(locale, state.reasonKey)}
                </>
              ) : null}
            </span>
            <span className="min-w-[152px] flex-none [&>button]:w-full">
              <ActionButton variant="primary" size="md" disabled={!isDone && !state.nextEnabled} onClick={() => (isDone ? store.attachProject() : void store.next())}>
                {t(locale, primaryKey)}
              </ActionButton>
            </span>
          </footer>
        </div>

        {state.editor !== null ? <EditorWindow key={state.editor.key} store={store} account={state.editor.account} locale={locale} /> : null}
      </div>
    </div>
  );
}
