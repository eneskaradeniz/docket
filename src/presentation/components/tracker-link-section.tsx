import type { SyncMode } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from './action-button';
import { InfoBanner } from './settings-cards';
import { ModalWindow } from './new-work-order-window';
import type { LampTone } from '../stores/candidates';
import { StatusLamp } from './status-lamp';
import { WindowTitle } from './window-frame';
import {
  TRACKER_MODES,
  TRACKER_RECOMMENDED_MODE,
  type TrackerLinkStore,
  type TrackerLinkStoreState,
  type TrackerUiState,
  trackerClampLabelKey,
  trackerModeLabelKey,
} from '../stores/tracker-link';

export interface TrackerLinkSectionProps {
  readonly locale: Locale;
  readonly store: TrackerLinkStore;
  readonly state: TrackerLinkStoreState;
}

const statusLabelKey = (ui: TrackerUiState): LabelKey => {
  switch (ui) {
    case 'unlinked':
      return 'tracker.status.unlinked';
    case 'syncing':
      return 'tracker.status.syncing';
    case 'clamped':
      return 'tracker.status.clamped';
    case 'disconnected':
      return 'tracker.status.disconnected';
    default:
      return 'tracker.status.connected';
  }
};

const lampTone = (ui: TrackerUiState): LampTone => {
  if (ui === 'unlinked') return 'dim';
  if (ui === 'disconnected') return 'error';
  if (ui === 'syncing' || ui === 'clamped') return 'signal';
  return 'proceed';
};

function StatusChip({ locale, ui }: { readonly locale: Locale; readonly ui: TrackerUiState }) {
  const tone = lampTone(ui);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-control border border-hairline px-2 py-0.5 text-[12px]">
      <StatusLamp tone={tone}>{t(locale, statusLabelKey(ui))}</StatusLamp>
    </span>
  );
}

function ModeCards({
  locale,
  draft,
  effective,
  clamped,
  onSelect,
  onReset,
}: {
  readonly locale: Locale;
  readonly draft: SyncMode;
  readonly effective: SyncMode;
  readonly clamped: boolean;
  readonly onSelect: (mode: SyncMode) => void;
  readonly onReset: () => void;
}) {
  const differs = draft !== TRACKER_RECOMMENDED_MODE;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[13px] font-bold text-ink">{t(locale, 'tracker.mode.heading')}</h3>
        {differs ? (
          <span className="ml-auto inline-flex items-center gap-2">
            <span
              aria-label={t(locale, 'editor.recommended.tooltip').replace('{value}', t(locale, trackerModeLabelKey(TRACKER_RECOMMENDED_MODE)))}
              title={t(locale, 'editor.recommended.tooltip').replace('{value}', t(locale, trackerModeLabelKey(TRACKER_RECOMMENDED_MODE)))}
              className="h-2 w-2 rounded-full bg-signal"
            />
            <button
              type="button"
              onClick={onReset}
              aria-label={t(locale, 'tracker.btn.resetRec')}
              title={t(locale, 'tracker.btn.resetRec')}
              className="grid h-8 w-8 place-items-center rounded-control border border-bord text-inkdim hover:bg-raised hover:text-ink"
            >
              <span aria-hidden="true">↺</span>
            </button>
          </span>
        ) : null}
      </div>
      <p className="m-0 text-[12px] text-inkdim">{t(locale, 'tracker.subtaskRule')}</p>
      <div role="radiogroup" aria-labelledby="tracker-mode-heading" className="grid gap-1">
        <span id="tracker-mode-heading" className="sr-only">{t(locale, 'tracker.mode.heading')}</span>
        {TRACKER_MODES.map((mode) => {
          const isEff = clamped && effective === mode;
          return (
            <label
              key={mode}
              className="grid gap-0.5 rounded-control border border-hairline px-2 py-1.5 hover:bg-raised"
            >
              <span className="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name="tracker-sync-mode"
                  checked={draft === mode}
                  onChange={() => onSelect(mode)}
                />
                <span className="text-[13px] font-semibold text-ink">{t(locale, trackerModeLabelKey(mode))}</span>
                {mode === TRACKER_RECOMMENDED_MODE ? (
                  <span className="rounded-control border border-hairline px-1.5 text-[11px] text-inkdim">
                    {t(locale, 'tracker.mode.recBadge')}
                  </span>
                ) : null}
                {isEff ? (
                  <span className="rounded-control border border-signal/40 bg-signal/10 px-1.5 text-[11px] text-signal-soft">
                    {t(locale, 'tracker.meta.effective')} {t(locale, trackerModeLabelKey(mode))}
                  </span>
                ) : null}
              </span>
              <span className="pl-6 text-[12px] text-inkdim">{t(locale, `tracker.mode.${mode}.desc` as const)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function TrackerLinkSection({ locale, store, state }: TrackerLinkSectionProps) {
  const heading = t(locale, 'tracker.heading');
  const busy = state.busy || state.ui === 'loading' || state.ui === 'syncing';

  const unlinkTitle = t(locale, 'tracker.unlink.title');

  if (state.ui === 'loading') {
    return (
      <section role="group" aria-label={heading} aria-busy="true" className="rounded-card border border-hairline bg-surface px-3 py-4">
        <h2 className="m-0 text-[13px] font-bold text-ink">{heading}</h2>
        <p className="m-0 mt-1 text-[12px] text-inkdim">{t(locale, 'tracker.loading.note')}</p>
      </section>
    );
  }

  if (state.ui === 'error') {
    return (
      <section role="group" aria-label={heading} className="rounded-card border border-hairline bg-surface px-3 py-4">
        <div role="alert">
          <h2 className="m-0 text-[13px] font-bold text-error">{t(locale, 'tracker.error.title')}</h2>
          <p className="m-0 mt-1 text-[12px] text-error">{t(locale, 'tracker.error.desc')}</p>
        </div>
        <div className="mt-3">
          <ActionButton variant="neutral" size="sm" onClick={() => state.repo !== null && void store.load(state.repo)}>
            {t(locale, 'tracker.btn.retry')}
          </ActionButton>
        </div>
      </section>
    );
  }

  if (state.ui === 'unlinked' && !state.formOpen && state.view === null) {
    return (
      <section role="group" aria-label={heading} data-empty-card className="rounded-card border border-hairline bg-surface px-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[13px] font-bold text-ink">{heading}</h2>
          <StatusChip locale={locale} ui="unlinked" />
        </div>
        <p className="m-0 mt-2 text-[13px] font-semibold text-ink">{t(locale, 'tracker.empty.title')}</p>
        <p className="m-0 mt-1 text-[12px] text-inkdim">{t(locale, 'tracker.empty.desc')}</p>
        <div className="mt-3">
          <ActionButton variant="primary" size="sm" onClick={() => store.openConnectForm()}>
            {t(locale, 'tracker.btn.connect')}
          </ActionButton>
        </div>
      </section>
    );
  }

  if (state.ui === 'unlinked' && state.formOpen) {
    return (
      <section role="group" aria-label={heading} className="rounded-card border border-hairline bg-surface px-3 py-3">
        <h2 className="m-0 text-[13px] font-bold text-ink">{heading}</h2>
        <div role="group" aria-label={t(locale, 'tracker.form.titleNew')} className="mt-3 grid gap-2">
          <label className="grid gap-1 text-[12px] text-inkdim">
            <span>{t(locale, 'tracker.form.trackerLabel')}</span>
            <select disabled className="rounded-control border border-hairline bg-surface px-2 py-1.5 text-[13px] text-ink">
              <option>GitHub</option>
            </select>
          </label>
          <label className="grid gap-1 text-[12px] text-inkdim">
            <span>{t(locale, 'tracker.form.accountLabel')}</span>
            <input readOnly value="" placeholder={t(locale, 'tracker.form.accountPlaceholder')} className="rounded-control border border-hairline bg-sunk px-2 py-1.5 text-[13px] text-inkdim" />
          </label>
          <label className="grid gap-1 text-[12px] text-inkdim">
            <span>{t(locale, 'tracker.form.scopeLabel')}</span>
            <input value={state.formScope} onChange={(event) => store.setFormScope(event.target.value)} className="rounded-control border border-hairline bg-surface px-2 py-1.5 text-[13px] text-ink" />
          </label>
          <ModeCards locale={locale} draft={state.draftMode} effective={state.draftMode} clamped={false} onSelect={(mode) => store.setDraftMode(mode)} onReset={() => store.resetDraftMode()} />
          <div className="flex justify-end gap-2">
            <ActionButton variant="neutral" size="sm" onClick={() => store.closeForm()}>{t(locale, 'tracker.form.cancel')}</ActionButton>
            <ActionButton variant="primary" size="sm" disabled={state.busy} onClick={() => void store.applyLink()}>{t(locale, 'tracker.form.apply')}</ActionButton>
          </div>
        </div>
        {state.inlineKey !== null ? <p role="status" className="m-0 mt-2 text-[12px] text-error">{t(locale, state.inlineKey)}</p> : null}
      </section>
    );
  }

  const formBlock = state.formOpen ? (
    <div role="group" aria-label={state.view === null ? t(locale, 'tracker.form.titleNew') : t(locale, 'tracker.form.titleEdit')} className="mt-3 grid gap-2 rounded-card border border-hairline bg-raised px-3 py-3">
      <p className="m-0 text-[13px] font-bold text-ink">
        {state.view === null ? t(locale, 'tracker.form.titleNew') : t(locale, 'tracker.form.titleEdit')}
      </p>
      <label className="grid gap-1 text-[12px] text-inkdim">
        <span>{t(locale, 'tracker.form.trackerLabel')}</span>
        <select disabled className="rounded-control border border-hairline bg-surface px-2 py-1.5 text-[13px] text-ink">
          <option>GitHub</option>
        </select>
      </label>
      <label className="grid gap-1 text-[12px] text-inkdim">
        <span>{t(locale, 'tracker.form.accountLabel')}</span>
        <input
          readOnly
          value={state.view?.connection ?? ''}
          placeholder={t(locale, 'tracker.form.accountPlaceholder')}
          className="rounded-control border border-hairline bg-sunk px-2 py-1.5 text-[13px] text-inkdim"
        />
      </label>
      <label className="grid gap-1 text-[12px] text-inkdim">
        <span>{t(locale, 'tracker.form.scopeLabel')}</span>
        <input
          value={state.formScope}
          onChange={(event) => store.setFormScope(event.target.value)}
          className="rounded-control border border-hairline bg-surface px-2 py-1.5 text-[13px] text-ink"
        />
      </label>
      <ModeCards
        locale={locale}
        draft={state.draftMode}
        effective={state.view?.effectiveMode ?? state.draftMode}
        clamped={state.view?.clamped ?? false}
        onSelect={(mode) => store.setDraftMode(mode)}
        onReset={() => store.resetDraftMode()}
      />
      <div className="flex justify-end gap-2">
        <ActionButton variant="neutral" size="sm" onClick={() => store.closeForm()}>
          {t(locale, 'tracker.form.cancel')}
        </ActionButton>
        <ActionButton variant="primary" size="sm" disabled={state.busy} onClick={() => void store.applyLink()}>
          {t(locale, 'tracker.form.apply')}
        </ActionButton>
      </div>
    </div>
  ) : null;

  const view = state.view;
  const chipUi: TrackerUiState = state.ui === 'syncing' ? 'syncing' : state.ui;

  return (
    <section
      role="group"
      aria-label={heading}
      aria-busy={busy ? true : undefined}
      className="rounded-card border border-hairline bg-surface px-3 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="m-0 text-[13px] font-bold text-ink">{heading}</h2>
          <p className="m-0 text-[12px] text-inkdim">{t(locale, 'tracker.sub')}</p>
        </div>
        {view !== null ? <StatusChip locale={locale} ui={chipUi} /> : null}
      </div>

      {state.ui === 'disconnected' ? (
        <div role="alert" className="mt-3 rounded-control border border-error/30 bg-surface px-3 py-2">
          <p className="m-0 text-[13px] font-bold text-error">{t(locale, 'tracker.disc.title')}</p>
          <p className="m-0 mt-1 text-[12px] text-error">{t(locale, 'tracker.disc.desc')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton variant="neutral" size="sm" onClick={() => state.repo !== null && void store.load(state.repo)}>
              {t(locale, 'tracker.btn.retry')}
            </ActionButton>
            <ActionButton variant="primary" size="sm" onClick={() => store.openChangeForm()}>
              {t(locale, 'tracker.btn.change')}
            </ActionButton>
          </div>
        </div>
      ) : null}

      {view !== null && state.ui !== 'disconnected' ? (
        <>
          {view.clamped && view.clampReason !== undefined && view.probed !== undefined ? (
            <div role="status" className="mt-3">
              <InfoBanner mark="data-tracker-clamp">
                <p className="m-0 text-[13px] text-ink">{t(locale, trackerClampLabelKey(view.clampReason))}</p>
                <p className="m-0 mt-1 text-[12px] text-inkdim">
                  {t(locale, 'tracker.meta.configured')} <strong>{t(locale, trackerModeLabelKey(view.configuredMode))}</strong>
                  {' · '}
                  {t(locale, 'tracker.meta.effective')} <strong>{t(locale, trackerModeLabelKey(view.effectiveMode))}</strong>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(['read', 'comment', 'transition', 'edit'] as const).map((perm) => (
                    <span key={perm} className="rounded-control border border-hairline px-1.5 py-0.5 text-[11px]">
                      {t(locale, `tracker.probe.${perm}`)}: {view.probed?.[perm] ? t(locale, 'tracker.probe.allowed') : t(locale, 'tracker.probe.denied')}
                    </span>
                  ))}
                </div>
              </InfoBanner>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-inkdim">
            <span>{t(locale, 'tracker.meta.scope')}: <span className="font-mono text-ink">{view.scope}</span></span>
            <span>{t(locale, 'tracker.meta.account')}: <span className="font-mono text-ink">{view.connection}</span></span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton variant="neutral" size="sm" disabled={busy} onClick={() => void store.syncNow()}>
              {t(locale, 'tracker.btn.sync')}
            </ActionButton>
            <ActionButton variant="neutral" size="sm" onClick={() => store.openChangeForm()}>
              {t(locale, 'tracker.btn.change')}
            </ActionButton>
            <ActionButton variant="neutral" size="sm" onClick={() => store.requestUnlink()}>
              {t(locale, 'tracker.btn.disconnect')}
            </ActionButton>
          </div>

          {state.ui === 'syncing' ? <p className="m-0 mt-2 text-[12px] text-inkdim">{t(locale, 'tracker.syncing.note')}</p> : null}

          {!state.formOpen ? (
            <div className="mt-4">
              <ModeCards
                locale={locale}
                draft={state.draftMode}
                effective={view.effectiveMode}
                clamped={view.clamped}
                onSelect={(mode) => store.setDraftMode(mode)}
                onReset={() => store.resetDraftMode()}
              />
              {state.draftMode !== view.configuredMode ? (
                <div className="mt-2 flex justify-end">
                  <ActionButton variant="primary" size="sm" disabled={state.busy} onClick={() => void store.applyMode()}>
                    {t(locale, 'tracker.form.apply')}
                  </ActionButton>
                </div>
              ) : null}
            </div>
          ) : null}

          {view.conflicts.length > 0 ? (
            <div role="region" aria-label={t(locale, 'tracker.conflict.heading')} className="mt-4 grid gap-2 rounded-card border border-hairline bg-raised px-3 py-3">
              {view.conflicts.map((conflict) => (
                <div key={`${conflict.issue}-${conflict.field}-${conflict.detectedAt}`} className="grid gap-2">
                  <span className="text-[12px] font-semibold text-ink">{t(locale, 'tracker.conflict.heading')}</span>
                  <span className="text-[12px] text-inkdim">{t(locale, 'tracker.conflict.desc')}</span>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton variant="neutral" size="sm" disabled={state.busy} onClick={() => void store.resolveConflict(conflict, 'keep_remote')}>
                      {t(locale, 'tracker.conflict.keepRemote')}
                    </ActionButton>
                    <ActionButton variant="neutral" size="sm" disabled={state.busy} onClick={() => void store.resolveConflict(conflict, 'keep_local')}>
                      {t(locale, 'tracker.conflict.keepLocal')}
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {formBlock}

      {state.inlineKey !== null ? (
        <p role="status" className="m-0 mt-2 text-[12px] text-error">{t(locale, state.inlineKey)}</p>
      ) : null}

      <ModalWindow
        open={state.unlinkOpen}
        label={unlinkTitle}
        titleId="tracker-unlink-title"
        brand={unlinkTitle}
        dataMark="data-tracker-unlink-dialog"
        scrimMark="data-tracker-unlink-scrim"
        compact
        onClose={() => store.cancelUnlink()}
        head={
          <div id="tracker-unlink-title" className="min-w-0">
            <WindowTitle title={unlinkTitle} />
          </div>
        }
        footer={
          <>
            <span className="ml-auto inline-flex [&>button]:h-8">
              <ActionButton variant="neutral" size="md" autoFocus onClick={() => store.cancelUnlink()}>
                {t(locale, 'tracker.form.cancel')}
              </ActionButton>
            </span>
            <span className="inline-flex [&>button]:h-8">
              <ActionButton variant="primary" size="md" onClick={() => void store.confirmUnlink()}>
                {t(locale, 'tracker.unlink.confirm')}
              </ActionButton>
            </span>
          </>
        }
      >
        <p className="m-0 text-[13px] text-ink">{t(locale, 'tracker.unlink.body')}</p>
      </ModalWindow>
    </section>
  );
}
