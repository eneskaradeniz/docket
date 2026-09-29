// screens/wizard.tsx — the first-run wizard (U-7's window): the store's four-step machine rendered
// as an overlay the shell mounts; the store decides visibility through `open`, the screen only
// mirrors it. `next` is gated by the store's `nextEnabled` (the store re-validates at click time —
// it stays the authority), and a step that cannot advance says why in place instead of leaving a
// dead grey control. Entered state lives in the store, so `back` preserves it without screen work.
// Secret values have no surface here — account names only — and every user-visible string arrives
// through a label key (U-1). The layout is the design's setup window: a numbered rail on the left
// (done steps fill green, the current one signs amber) and a single pane whose footer carries the
// navigation — the rail mirrors the machine, it does not drive it.
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

const INPUT_CLASS =
  'rounded-sm border border-bord bg-raised px-2 py-[5px] text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal';
const MONO_INPUT_CLASS = `${INPUT_CLASS} font-mono`;
const LABEL_CLASS = 'font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim';

/** The rail entry's standing: the current step reads ink on the raised ground with its number
 *  signed amber, a finished step fills its number green, the rest stay quiet. */
const railClass = (standing: 'todo' | 'cur' | 'done'): string =>
  `flex items-center gap-2.5 rounded-md px-2.5 py-[7px] ${standing === 'cur' ? 'bg-raised' : ''}`;

const railNumberClass = (standing: 'todo' | 'cur' | 'done'): string => {
  const base = 'grid h-5 w-5 flex-none place-items-center rounded-full border font-mono text-[11px]';
  if (standing === 'cur') return `${base} border-signal text-signal`;
  if (standing === 'done') return `${base} border-proceed bg-proceed text-bg`;
  return `${base} border-bord text-inkdim`;
};

function SourceStep({ state, store, locale }: { readonly state: WizardState; readonly store: WizardStore; readonly locale: Locale }) {
  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className={LABEL_CLASS}>{t(locale, 'wizard.source.label')}</span>
        <input
          value={state.source}
          onChange={(event) => store.enterSource(event.target.value)}
          placeholder={t(locale, 'wizard.source.placeholder')}
          className={MONO_INPUT_CLASS}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2.5">
        <ActionButton variant="neutral" disabled={state.probing || state.source.trim() === ''} onClick={() => void store.checkSource()}>
          {t(locale, 'wizard.source.check')}
        </ActionButton>
        {state.probing ? (
          <span className="flex items-center gap-2.5 font-mono text-[11px] text-inkdim">
            <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-info motion-safe:animate-pulse" />
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
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={LABEL_CLASS}>{t(locale, 'wizard.account.title')}</span>
          <ActionButton variant="neutral" disabled={state.discovering} onClick={() => void store.refreshDiscovery()}>
            {t(locale, 'wizard.account.refresh')}
          </ActionButton>
        </div>
        {state.discovering ? (
          <p className="flex items-center gap-2.5 font-mono text-[11px] text-inkdim">
            <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-info motion-safe:animate-pulse" />
            {t(locale, 'wizard.source.probing')}
          </p>
        ) : null}
        {state.discovered.length === 0 ? (
          state.discovering ? null : (
            <p className="text-[13px] text-inkdim">{t(locale, 'wizard.account.empty')}</p>
          )
        ) : (
          <ul className="grid gap-2">
            {state.discovered.map((row) => {
              const selected = state.provider === row.defId;
              return (
                <li key={row.defId}>
                  <button
                    type="button"
                    onClick={() => store.chooseProvider(row.defId)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-md border bg-surface px-3 py-2 text-left transition-colors hover:bg-raised ${
                      selected ? 'border-signal' : 'border-hairline hover:border-bord'
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
          <span className={LABEL_CLASS}>{t(locale, 'wizard.account.label')}</span>
          <input
            value={state.draft.label}
            onChange={(event) => enterDraft({ label: event.target.value })}
            placeholder={t(locale, 'wizard.account.labelPlaceholder')}
            className={INPUT_CLASS}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>{t(locale, 'wizard.account.authMode')}</span>
          <select
            value={state.draft.authMode}
            onChange={(event) => enterDraft({ authMode: event.target.value })}
            className="rounded-sm border border-bord bg-raised px-2 py-[5px] text-[13px] text-ink outline-none focus:border-signal"
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
          <span className={LABEL_CLASS}>{t(locale, 'wizard.account.plan')}</span>
          <input
            value={plan}
            onChange={(event) => enterDraft({ plan: event.target.value })}
            placeholder={t(locale, 'wizard.account.planPlaceholder')}
            className={INPUT_CLASS}
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
          <span className={LABEL_CLASS}>{t(locale, 'wizard.binding.role')}</span>
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder={t(locale, 'wizard.binding.rolePlaceholder')}
            className={MONO_INPUT_CLASS}
          />
        </label>
        <ActionButton variant="primary" size="md" disabled={role.trim() === ''} onClick={() => void store.bind(role.trim())}>
          {t(locale, 'wizard.binding.bind')}
        </ActionButton>
      </div>
      <div className="grid gap-1.5">
        <span className={LABEL_CLASS}>{t(locale, 'wizard.binding.bound')}</span>
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
  // While `open` is still proving repo existence, and when it answered "one exists", the
  // wizard has nothing to show — the overlay stays away entirely.
  if (state.checking || !state.visible) return null;

  const enabled = store.nextEnabled();
  const stepIndex = STEPS.indexOf(state.step);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div
        className="grid w-full max-w-[720px] overflow-hidden rounded-xl border border-bord bg-bg md:grid-cols-[200px_minmax(0,1fr)]"
        role="dialog"
        aria-label={t(locale, 'wizard.title')}
      >
        <div className="flex flex-row flex-wrap gap-1 border-b border-hairline bg-surface px-3 py-3 md:flex-col md:gap-0.5 md:border-b-0 md:border-r md:px-2.5 md:py-4">
          <p className="hidden px-2.5 pb-3 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-inkdim md:block">
            {t(locale, 'wizard.title')}
          </p>
          {STEPS.map((step, index) => {
            const standing = index < stepIndex ? 'done' : index === stepIndex ? 'cur' : 'todo';
            return (
              <div key={step} className={railClass(standing)} aria-current={standing === 'cur' ? 'step' : undefined}>
                <span aria-hidden="true" className={railNumberClass(standing)}>
                  {index + 1}
                </span>
                <span
                  className={`text-[13.5px] max-md:hidden ${
                    standing === 'cur' ? 'font-semibold text-ink' : standing === 'done' ? 'text-ink' : 'text-inkdim'
                  }`}
                >
                  {t(locale, STEP_KEY[step])}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex min-h-[420px] flex-col gap-4 p-5 md:p-6">
          {/* The done step is its own headline — the centered card carries the word, so the pane
             header would only repeat it. */}
          {state.step !== 'done' ? (
            <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">{t(locale, STEP_KEY[state.step])}</h2>
          ) : null}

          {state.lastOutcome !== null ? (
            <OutcomeNotice
              ok={state.lastOutcome.result.ok}
              text={t(locale, state.lastOutcome.labelKey)}
              code={state.lastOutcome.result.ok ? undefined : state.lastOutcome.result.code}
            />
          ) : null}

          {state.step === 'done' ? (
            <div className="grid flex-1 place-content-center gap-2 text-center">
              <p className="text-[22px] font-bold text-ink">{t(locale, 'wizard.step.done')}</p>
            </div>
          ) : (
            <div className="grid content-start gap-4">
              {state.step === 'source' ? <SourceStep state={state} store={store} locale={locale} /> : null}
              {state.step === 'account' ? <AccountStep state={state} store={store} locale={locale} /> : null}
              {state.step === 'binding' ? <BindingStep state={state} store={store} locale={locale} /> : null}
            </div>
          )}

          <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
            <ActionButton variant="ghost" disabled={state.step === 'source'} onClick={() => store.back()}>
              {t(locale, 'wizard.back')}
            </ActionButton>
            {!enabled && state.step !== 'done' ? (
              <span className="text-[13px] text-inkdim">{t(locale, HINT_KEY[state.step])}</span>
            ) : null}
            <span className="flex-1"></span>
            <ActionButton variant="primary" size="md" disabled={!enabled} onClick={() => void store.next()}>
              {t(locale, 'wizard.next')}
            </ActionButton>
          </footer>
        </div>
      </div>
    </div>
  );
}
