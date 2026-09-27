// screens/wizard.tsx — the first-run wizard (U-7's window): the store's four-step machine rendered
// as an overlay the shell mounts; the store decides visibility through `open`, the screen only
// mirrors it. `next` is gated by the store's `nextEnabled` (the store re-validates at click time —
// it stays the authority), and a step that cannot advance says why in place instead of leaving a
// dead grey control. Entered state lives in the store, so `back` preserves it without screen work.
// Secret values have no surface here — account names only — and every user-visible string arrives
// through a label key (U-1).
import { useState, useSyncExternalStore } from 'react';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { DiscoveryBadges } from '../components/discovery-badges';
import { OutcomeNotice } from '../components/outcome-notice';
import { StateBadge } from '../components/state-badge';
import type { WizardState, WizardStore, WizardStep } from '../stores/wizard';

export interface WizardScreenProps {
  readonly store: WizardStore;
  readonly locale: Locale;
}

/** The record's closed auth-mode set, as the account step's select options; the api rejects an
 *  unknown value at the edge, so the screen offers exactly these. */
const AUTH_MODES: readonly { readonly value: string; readonly key: LabelKey }[] = [
  { value: 'subscription', key: 'auth.mode.subscription' },
  { value: 'api_key', key: 'auth.mode.api_key' },
  { value: 'cloud', key: 'auth.mode.cloud' },
  { value: 'byok', key: 'auth.mode.byok' },
];

const STEP_KEY: Readonly<Record<WizardStep, LabelKey>> = {
  source: 'wizard.step.source',
  account: 'wizard.step.account',
  binding: 'wizard.step.binding',
  done: 'wizard.step.done',
};

const STEPS: readonly WizardStep[] = ['source', 'account', 'binding', 'done'];

/** Why the current step cannot advance — the reason line that keeps a gated control legible. */
const HINT_KEY: Readonly<Record<WizardStep, LabelKey>> = {
  source: 'wizard.hint.source',
  account: 'wizard.hint.account',
  binding: 'wizard.hint.binding',
  done: 'wizard.step.done',
};

function SourceStep({ state, store, locale }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale }) {
  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'wizard.source.label')}</span>
        <input
          value={state.source}
          onChange={(event) => store.enterSource(event.target.value)}
          placeholder={t(locale, 'wizard.source.placeholder')}
          className="rounded-md border border-hairline bg-raised px-2 py-1 font-mono text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton variant="neutral" disabled={state.probing || state.source.trim() === ''} onClick={() => void store.checkSource()}>
          {t(locale, 'wizard.source.check')}
        </ActionButton>
        {state.probing ? (
          <span className="flex items-center gap-2 font-mono text-[11px] text-inkdim">
            <span className="h-2 w-2 flex-none rounded-full bg-info motion-safe:animate-pulse" />
            {t(locale, 'wizard.source.probing')}
          </span>
        ) : state.sourceChecked !== null ? (
          <StateBadge tone={state.sourceOk ? 'proceed' : 'error'}>
            {t(locale, state.sourceOk ? 'wizard.source.ok' : 'wizard.source.failed')}
          </StateBadge>
        ) : null}
      </div>
    </div>
  );
}

function AccountStep({ state, store, locale }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale }) {
  const plan = state.draft.plan ?? '';
  const enterDraft = (patch: Partial<{ label: string; authMode: string; plan: string }>): void => {
    const label = patch.label ?? state.draft.label;
    const authMode = patch.authMode ?? state.draft.authMode;
    const nextPlan = patch.plan ?? plan;
    store.enterAccount({ label, authMode, ...(nextPlan !== '' ? { plan: nextPlan } : {}) });
  };
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'wizard.account.title')}</span>
          <ActionButton variant="neutral" disabled={state.discovering} onClick={() => void store.refreshDiscovery()}>
            {t(locale, 'wizard.account.refresh')}
          </ActionButton>
        </div>
        {state.discovering ? (
          <p className="flex items-center gap-2 font-mono text-[11px] text-inkdim">
            <span className="h-2 w-2 flex-none rounded-full bg-info motion-safe:animate-pulse" />
            {t(locale, 'wizard.source.probing')}
          </p>
        ) : null}
        {state.discovered.length === 0 ? (
          state.discovering ? null : (
            <p className="text-[13px] text-inkdim">{t(locale, 'wizard.account.empty')}</p>
          )
        ) : (
          <ul className="grid gap-1">
            {state.discovered.map((row) => {
              const selected = state.provider === row.defId;
              return (
                <li key={row.defId}>
                  <button
                    type="button"
                    onClick={() => store.chooseProvider(row.defId)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-left transition-colors hover:bg-raised ${
                      selected ? 'border-signal' : 'border-hairline'
                    }`}
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <code className="font-mono text-[13px] text-ink">{row.defId}</code>
                      <DiscoveryBadges binPath={row.binPath} loggedIn={row.loggedIn} locale={locale} />
                    </span>
                    {selected ? <StateBadge tone="signal">{t(locale, 'wizard.account.selected')}</StateBadge> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'wizard.account.label')}</span>
          <input
            value={state.draft.label}
            onChange={(event) => enterDraft({ label: event.target.value })}
            placeholder={t(locale, 'wizard.account.labelPlaceholder')}
            className="rounded-md border border-hairline bg-raised px-2 py-1 text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
          />
        </label>
        <label className="grid gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'wizard.account.authMode')}</span>
          <select
            value={state.draft.authMode}
            onChange={(event) => enterDraft({ authMode: event.target.value })}
            className="rounded-md border border-hairline bg-raised px-2 py-1 text-[13px] text-ink outline-none focus:border-signal"
          >
            <option value="" disabled>
              {t(locale, 'wizard.account.authMode')}
            </option>
            {AUTH_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {t(locale, mode.key)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'wizard.account.plan')}</span>
          <input
            value={plan}
            onChange={(event) => enterDraft({ plan: event.target.value })}
            placeholder={t(locale, 'wizard.account.planPlaceholder')}
            className="rounded-md border border-hairline bg-raised px-2 py-1 text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
          />
        </label>
      </div>
    </div>
  );
}

function BindingStep({ state, store, locale }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale }) {
  // The role slug is screen-local input state: the store takes it as bind()'s argument and the api
  // owns the slug's validity, so the screen keeps no gate on it beyond presence.
  const [role, setRole] = useState('');
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'wizard.binding.role')}</span>
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder={t(locale, 'wizard.binding.rolePlaceholder')}
            className="rounded-md border border-hairline bg-raised px-2 py-1 font-mono text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
          />
        </label>
        <ActionButton variant="primary" size="md" disabled={role.trim() === ''} onClick={() => void store.bind(role.trim())}>
          {t(locale, 'wizard.binding.bind')}
        </ActionButton>
      </div>
      <div className="grid gap-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'wizard.binding.bound')}</span>
        {state.boundRoles.length === 0 ? (
          <p className="text-[13px] text-inkdim">{t(locale, 'wizard.binding.empty')}</p>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {state.boundRoles.map((bound) => (
              <StateBadge key={bound} tone="proceed">
                {bound}
              </StateBadge>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

export function WizardScreen({ store, locale }: WizardScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  // While `open` is still proving workspace existence, and when it answered "one exists", the
  // wizard has nothing to show — the overlay stays away entirely.
  if (state.checking || !state.visible) return null;

  const enabled = store.nextEnabled();
  const stepIndex = STEPS.indexOf(state.step);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
      <div
        className="grid w-full max-w-[560px] gap-3 rounded-lg border border-hairline bg-bg p-4 shadow-2xl"
        role="dialog"
        aria-label={t(locale, 'wizard.title')}
      >
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-bold tracking-tight text-ink">{t(locale, 'wizard.title')}</h2>
        </header>

        <ol className="grid grid-cols-4 gap-1.5">
          {STEPS.map((step, index) => (
            <li key={step} className="grid gap-0.5">
              <span className={`font-mono text-[10px] ${index <= stepIndex ? 'text-signal' : 'text-inkdim'}`}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className={`text-[12px] ${index === stepIndex ? 'font-semibold text-ink' : 'text-inkdim'}`}>
                {t(locale, STEP_KEY[step])}
              </span>
            </li>
          ))}
        </ol>

        {state.lastOutcome !== null ? (
          <OutcomeNotice
            ok={state.lastOutcome.result.ok}
            text={t(locale, state.lastOutcome.labelKey)}
            code={state.lastOutcome.result.ok ? undefined : state.lastOutcome.result.code}
          />
        ) : null}

        <div className="grid gap-3 rounded-md border border-hairline bg-surface p-3">
          {state.step === 'source' ? <SourceStep state={state} store={store} locale={locale} /> : null}
          {state.step === 'account' ? <AccountStep state={state} store={store} locale={locale} /> : null}
          {state.step === 'binding' ? <BindingStep state={state} store={store} locale={locale} /> : null}
        </div>

        <footer className="flex flex-wrap items-center gap-2">
          <ActionButton variant="ghost" disabled={state.step === 'source'} onClick={() => store.back()}>
            {t(locale, 'wizard.back')}
          </ActionButton>
          {!enabled && state.step !== 'done' ? (
            <span className="text-[12.5px] text-inkdim">{t(locale, HINT_KEY[state.step])}</span>
          ) : null}
          <span className="flex-1"></span>
          <ActionButton variant="primary" size="md" disabled={!enabled} onClick={() => void store.next()}>
            {t(locale, 'wizard.next')}
          </ActionButton>
        </footer>
      </div>
    </div>
  );
}
