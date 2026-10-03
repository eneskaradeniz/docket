// components/candidate-list.tsx — the discovered accounts (U-34), one list for Settings → Hesaplar →
// "Eklenmemiş" and the wizard's Hesaplar step. A row per candidate: mark, label, status, selection;
// an unreadable row is disabled and says why; a warning tag carries its ⓘ; a selected token
// candidate opens the separate key-move card whose switch starts off. The store decides every
// state; this file renders it and forwards clicks. No secret value is ever shown.
import { useSyncExternalStore } from 'react';
import { t, type Locale } from '../labels/t';
import { candidateStatusTone, listBody, type CandidatesStore } from '../stores/candidates';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { ActionButton } from './action-button';
import { InfoBubble } from './info-bubble';
import { OutcomeNotice } from './outcome-notice';
import { ProviderMark } from './provider-mark';
import { StatusLamp } from './status-lamp';

export interface CandidateListProps {
  readonly store: CandidatesStore;
  readonly marks: ProviderMarksStore;
  readonly locale: Locale;
}

export function CandidateList({ store, marks, locale }: CandidateListProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  const outcome = state.lastOutcome;
  const body = listBody(state);

  return (
    <div className="grid gap-3">
      {body === 'scanning' ? (
        <StatusLamp tone={candidateStatusTone('candidates.status.scanning')}>{t(locale, 'candidates.status.scanning')}</StatusLamp>
      ) : null}
      {body === 'empty' ? <p className="text-[13px] text-inkdim">{t(locale, 'candidates.empty')}</p> : null}

      {state.rows.length > 0 ? (
        <ul className="grid gap-2">
          {state.rows.map((row) => (
            <li key={row.id} className="grid gap-2">
              <div
                className={`flex items-center gap-2.5 rounded-card border px-3 py-2 ${
                  row.selected ? 'border-bord bg-raised' : 'border-hairline bg-surface hover:border-bord'
                } ${row.selectable ? '' : 'opacity-60'}`}
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
                    <span className="block truncate font-mono text-[12.5px] text-ink" title={row.id}>{row.label}</span>
                    {row.endpointHost !== null ? (
                      <span className="block truncate font-mono text-[11px] text-inkdim">{row.endpointHost}</span>
                    ) : null}
                    {row.disabledReasonKey !== null ? (
                      <span className="block text-[12px] text-inkdim">{t(locale, row.disabledReasonKey)}</span>
                    ) : null}
                  </span>
                </button>
                {row.warnKeys.map((key) => (
                  <span key={key} className="inline-flex items-center gap-1 text-[12px] text-signal-soft">
                    {t(locale, key)}
                    <InfoBubble
                      locale={locale}
                      subject={t(locale, key)}
                      body={t(locale, 'candidates.info.env_overrides_login')}
                    />
                  </span>
                ))}
                <StatusLamp tone={candidateStatusTone(row.statusKey)}>{t(locale, row.statusKey)}</StatusLamp>
                <span
                  aria-hidden="true"
                  className={`grid h-[18px] w-[18px] flex-none place-items-center rounded-full border text-[11px] ${
                    row.selected ? 'border-signal bg-signal text-signal-ink' : 'border-bord text-transparent'
                  }`}
                >
                  ✓
                </span>
              </div>

              {row.keyMoveCard ? (
                <div className="grid gap-2 rounded-card border border-hairline bg-band p-3">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 text-[13px] text-ink">{t(locale, 'candidates.keymove.title')}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={state.importToken}
                      aria-label={t(locale, 'candidates.keymove.switch')}
                      onClick={() => store.setImportToken(!state.importToken)}
                      className={`relative h-5 w-9 flex-none rounded-full border transition-colors ${
                        state.importToken ? 'border-signal bg-signal' : 'border-hairline bg-raised'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-ink transition-[left] ${
                          state.importToken ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
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
          <span className="text-[12.5px] font-semibold text-inkdim">
            {t(locale, 'candidates.providers.title')}
          </span>
          <ul className="grid gap-1.5">
            {state.providers.map((provider) => (
              <li key={provider.id} className="grid gap-1.5 rounded-card border border-hairline px-3 py-1.5">
                <div className="flex items-center gap-2.5">
                  <ProviderMark provider={provider.id} mark={marks.markFor(provider.id)} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{provider.name}</span>
                  <StatusLamp tone={candidateStatusTone(provider.statusKey)}>{t(locale, provider.statusKey)}</StatusLamp>
                </div>
                {provider.hintKey !== null ? (
                  <p className="text-[12px] text-inkdim">{t(locale, provider.hintKey).replace('{name}', provider.name)}</p>
                ) : null}
                {provider.installUrl !== null ? (
                  <div className="flex items-center gap-2 rounded-control bg-band px-2 py-1">
                    <code className="min-w-0 flex-1 select-all truncate font-mono text-[11.5px] text-ink">{provider.installUrl}</code>
                    <ActionButton onClick={() => void navigator.clipboard?.writeText(provider.installUrl ?? '')}>
                      {t(locale, 'candidates.install.copy')}
                    </ActionButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {state.addVisible ? (
          <ActionButton variant="primary" disabled={state.adopting} onClick={() => void store.adopt()}>
            {t(locale, 'candidates.add')}
          </ActionButton>
        ) : null}
        <ActionButton disabled={state.loading} onClick={() => void store.rescan()}>
          {t(locale, 'candidates.rescan')}
        </ActionButton>
      </div>

      {outcome !== null ? (
        <OutcomeNotice
          ok={outcome.result.ok}
          text={t(locale, outcome.labelKey)}
          {...(outcome.result.ok ? {} : { code: outcome.result.code })}
        />
      ) : null}
    </div>
  );
}

