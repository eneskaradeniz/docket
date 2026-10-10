// components/concurrency-section.tsx — the Eşzamanlılık section of Settings (U-69 … U-74): the
// dispatcher's mode, cap, per-repo and per-account limits, the machine suggestion and the live
// effective limit, in the operator-approved prototype's structure. Every value is the store's;
// this file only draws and forwards intents. While the section is active it re-reads the live
// status every DISPATCH_POLL_MS (the store skips the read over unsaved edits) and stops when it
// is not. All lengths are rem, spacing sits on the 4·8·12·16·20·24·32 scale, and every text line
// whose height matters carries an explicit leading because the root's line-height is 1.5.
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { DISPATCH_POLL_MS, MAX_DISPATCH_CAP, dispatchErrors, statusCard, type DispatchSettingsStore, type LoadBand } from '../stores/dispatch-settings';
import { failureKey } from '../stores/results';
import { ActionButton } from './action-button';
import { SegmentedControl } from './segmented-control';

export interface ConcurrencyAccount {
  readonly id: string;
  /** Resolved display name ("Provider · label"). */
  readonly name: string;
}

export interface ConcurrencySectionProps {
  readonly store: DispatchSettingsStore;
  readonly locale: Locale;
  readonly accounts: readonly ConcurrencyAccount[];
  /** The section is on screen: it loads on becoming active and polls while it stays so. */
  readonly active: boolean;
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-soft';
const FIELD = 'grid min-h-[3.25rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-hairline px-4 py-2 first:border-t-0';
const NAME = 'text-[0.875rem] font-semibold leading-5 text-ink';
const NOTE = 'text-[0.78125rem] leading-4 text-inkdim';

const LAMP_CLASS: Readonly<Record<LoadBand, string>> = { free: 'bg-proceed', reduced: 'bg-signal', busy: 'bg-error' };
const BAND_KEY: Readonly<Record<LoadBand, LabelKey>> = {
  free: 'dispatch.band.free',
  reduced: 'dispatch.band.reduced',
  busy: 'dispatch.band.busy',
};

interface StepperProps {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly bad: boolean;
  readonly off?: boolean;
  readonly locale: Locale;
  readonly onChange: (value: number) => void;
}

/** A number stepper: the value is machine data, so it is set in mono; 2 rem tall like every control. */
function Stepper({ id, label, value, min, max, bad, off = false, locale, onChange }: StepperProps) {
  const arrow = `h-full w-8 text-[1rem] leading-none text-ink transition-colors hover:bg-hairline motion-reduce:transition-none disabled:pointer-events-none disabled:text-inkdim ${FOCUS}`;
  return (
    <span
      role="group"
      aria-label={label}
      {...(bad ? { 'data-step-bad': id } : {})}
      {...(off ? { 'data-step-off': id } : {})}
      className={`inline-flex h-8 flex-none items-center overflow-hidden rounded-control border bg-raised ${bad ? 'border-error' : 'border-bord'} ${off ? 'opacity-45' : ''}`}
    >
      <button type="button" data-step={id} data-dir="-1" disabled={off || value <= min} aria-label={t(locale, 'dispatch.step.dec')} onClick={() => onChange(value - 1)} className={arrow}>
        −
      </button>
      <output className="min-w-10 text-center font-mono text-[0.8125rem] font-medium leading-none text-ink">{value}</output>
      <button type="button" data-step={id} data-dir="1" disabled={off || value >= max} aria-label={t(locale, 'dispatch.step.inc')} onClick={() => onChange(value + 1)} className={arrow}>
        +
      </button>
    </span>
  );
}

function Field({ name, note, children }: { readonly name: string; readonly note: string; readonly children: ReactNode }) {
  return (
    <div className={FIELD}>
      <span className="grid min-w-0 gap-1">
        <span className={NAME}>{name}</span>
        <span className={NOTE}>{note}</span>
      </span>
      {children}
    </div>
  );
}

export function ConcurrencySection({ store, locale, accounts, active }: ConcurrencySectionProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);

  useEffect(() => {
    if (!active) return;
    void store.load();
    const timer = window.setInterval(() => void store.refresh(), DISPATCH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [store, active]);

  const { form, suggestion } = state;
  const known = accounts.map((account) => account.id);
  const errors = dispatchErrors(form, known);
  const invalid = errors.first !== null;
  const card = statusCard(state);
  const auto = form.mode === 'auto';
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const message = errors.first !== null ? t(locale, errors.first) : state.failure !== null ? t(locale, failureKey(state.failure)) : state.problem !== null ? t(locale, failureKey(state.problem)) : '';

  // Until the first read lands the form would only show the defaults, not the backend's values —
  // an edit made over them would be overwritten by the reply. So only the read's failure shows.
  if (!state.loaded) {
    return (
      <div className="min-h-5" data-dispatch-settings="" data-dispatch-loading="" aria-busy={state.problem === null}>
        {state.problem === null ? null : (
          <p role="alert" className={NOTE}>
            {t(locale, failureKey(state.problem))}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-5" data-dispatch-settings="">
      <div className="overflow-hidden rounded-card border border-hairline bg-surface">
        <Field name={t(locale, 'dispatch.mode.label')} note={t(locale, auto ? 'dispatch.mode.autoDesc' : 'dispatch.mode.fixedDesc')}>
          <SegmentedControl
            label={t(locale, 'dispatch.mode.label')}
            value={form.mode}
            onPick={(mode) => store.setMode(mode)}
            options={[
              { id: 'fixed', text: t(locale, 'dispatch.mode.fixed') },
              { id: 'auto', text: t(locale, 'dispatch.mode.auto') },
            ]}
          />
        </Field>

        {auto && suggestion !== null ? (
          <div className={FIELD} data-dispatch-machine="">
            <span className="grid min-w-0 gap-1">
              <span className={NAME}>{t(locale, 'dispatch.machine.title')}</span>
              <span className={NOTE}>
                {t(locale, 'dispatch.machine.facts').replace('{cores}', String(suggestion.cores)).replace('{mem}', number.format(suggestion.totalMemGb))}{' '}
                <b className="font-mono font-semibold text-ink">{suggestion.suggested}</b>
              </span>
            </span>
            <ActionButton variant="neutral" disabled={form.global === suggestion.suggested} onClick={() => store.applySuggestion()}>
              {t(locale, 'dispatch.machine.apply')}
            </ActionButton>
          </div>
        ) : null}

        <Field name={t(locale, auto ? 'dispatch.cap.auto' : 'dispatch.cap.fixed')} note={t(locale, auto ? 'dispatch.cap.autoDesc' : 'dispatch.cap.fixedDesc')}>
          <Stepper id="global" label={t(locale, auto ? 'dispatch.cap.auto' : 'dispatch.cap.fixed')} value={form.global} min={1} max={MAX_DISPATCH_CAP} bad={errors.global !== undefined} locale={locale} onChange={(value) => store.setGlobal(value)} />
        </Field>

        <Field name={t(locale, 'dispatch.perRepo.title')} note={t(locale, 'dispatch.perRepo.desc')}>
          <Stepper id="perRepo" label={t(locale, 'dispatch.perRepo.title')} value={form.perRepo} min={1} max={Math.max(1, form.global)} bad={errors.perRepo !== undefined} locale={locale} onChange={(value) => store.setPerRepo(value)} />
        </Field>
      </div>

      {card !== null ? (
        <div className="flex min-h-[3.25rem] flex-wrap items-center gap-3 rounded-card border border-hairline bg-band px-4 py-2" data-dispatch-status={card.band}>
          <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${LAMP_CLASS[card.band]}`} />
          <span className="text-[0.875rem] font-bold leading-5 text-ink">
            {t(locale, 'dispatch.status.now').replace('{effective}', String(card.effective)).replace('{cap}', String(card.cap))}{' '}
            <span className="font-mono text-[0.8125rem] font-medium leading-5 text-inkdim">{t(locale, 'dispatch.status.unit')}</span>
          </span>
          <span className={NOTE}>
            {t(locale, BAND_KEY[card.band])}
            {card.load1 === undefined ? '' : ` · ${t(locale, 'dispatch.status.load').replace('{load}', number.format(card.load1))}`}
          </span>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-card border border-hairline bg-surface">
        <div className="grid gap-1 border-b border-hairline bg-band px-4 py-3">
          <span className={NAME}>{t(locale, 'dispatch.account.title')}</span>
          <span className={NOTE}>{t(locale, 'dispatch.account.desc')}</span>
        </div>
        {accounts.length === 0 ? <p className={`${NOTE} px-4 py-3`}>{t(locale, 'dispatch.account.empty')}</p> : null}
        {accounts.map((account) => {
          const limit = form.perAccount[account.id];
          const limited = limit !== undefined;
          return (
            <div key={account.id} className={FIELD} data-dispatch-account={account.id}>
              <span className={`${NAME} min-w-0 truncate`} title={account.name}>
                {account.name}
              </span>
              <span className="flex items-center gap-3">
                <SegmentedControl
                  label={account.name}
                  value={limited ? 'cap' : 'free'}
                  onPick={(pick) => store.setAccountLimited(account.id, pick === 'cap')}
                  options={[
                    { id: 'free', text: t(locale, 'dispatch.account.free') },
                    { id: 'cap', text: t(locale, 'dispatch.account.cap') },
                  ]}
                />
                <Stepper
                  id={`acc:${account.id}`}
                  label={account.name}
                  value={limit ?? form.global}
                  min={1}
                  max={Math.max(1, form.global)}
                  bad={errors.accounts[account.id] !== undefined}
                  off={!limited}
                  locale={locale}
                  onChange={(value) => store.setAccountLimit(account.id, value)}
                />
              </span>
            </div>
          );
        })}
      </div>

      <p role={message === '' ? undefined : 'alert'} className={`flex min-h-5 items-center gap-2 ${NOTE}`} data-dispatch-message="">
        {message === '' ? null : <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${errors.first !== null || state.failure !== null ? 'bg-error' : 'bg-signal'}`} />}
        {message}
      </p>

      <div className="flex items-center gap-2">
        <ActionButton variant="ghost" size="md" disabled={state.isDefault} onClick={() => store.reset()}>
          {t(locale, 'dispatch.reset')}
        </ActionButton>
        <span className="flex-1" />
        <ActionButton variant="primary" size="md" disabled={invalid || !state.dirty || state.saving} onClick={() => void store.save(known)}>
          {t(locale, 'dispatch.save')}
        </ActionButton>
      </div>
    </div>
  );
}
