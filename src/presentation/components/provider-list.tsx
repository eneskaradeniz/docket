// components/provider-list.tsx — Settings → Sağlayıcılar (U-38): one row per discovered provider
// (mark, name, version in mono, status word, binary path in mono and dim with the full path in
// `title`, and U-338's version-drift note under the row when the installed CLI is newer than the
// registry's measured-on version), the shared "Yeniden tara" button in the header row (rows settle
// as their provider answers; the list never blanks on a rescan, and a skeleton stands only before
// the first result), and the
// providers not found on the machine folded into one closed group whose rows show the install
// URL as copyable text. The store decides every state; a null field renders nothing.
import { useSyncExternalStore } from 'react';
import { t, type Locale } from '../labels/t';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { providerStatusTone, type ProviderViewRow, type ProvidersStore } from '../stores/providers';
import { ActionButton } from './action-button';
import { countedLabel } from './counted-label';
import { ProviderMark } from './provider-mark';
import { RescanButton } from './rescan-button';
import { EmptyCard } from './settings-cards';
import { Skeleton, SkeletonStyle } from './skeleton';
import { StatusLamp } from './status-lamp';

export interface ProviderListProps {
  readonly store: ProvidersStore;
  readonly marks: ProviderMarksStore;
  readonly locale: Locale;
}

function Row({ row, marks, locale }: { readonly row: ProviderViewRow; readonly marks: ProviderMarksStore; readonly locale: Locale }) {
  return (
    <li className="grid gap-1.5 border-t border-hairline px-3.5 py-3 first:border-t-0" aria-busy={row.scanning}>
      <div className="flex items-center gap-3.5">
        <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-control border border-hairline bg-raised text-ink">
          <ProviderMark provider={row.markKey} mark={marks.markFor(row.markKey)} size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate font-bold text-ink">{row.name}</span>
        {row.version !== null ? (
          <span title={row.versionFull ?? undefined} className="max-w-[160px] flex-none truncate font-mono text-[12px] text-inkdim">
            {row.version}
          </span>
        ) : null}
        {row.scanning ? (
          <span className="flex-none text-[12.5px] text-inkdim">{t(locale, 'providers.scanning')}</span>
        ) : (
          <StatusLamp tone={providerStatusTone(row.statusKey)}>{t(locale, row.statusKey)}</StatusLamp>
        )}
      </div>
      {row.binPath !== null ? (
        <span title={row.binPath} className="block truncate pl-10 font-mono text-[12px] text-inkdim">
          {row.binPath}
        </span>
      ) : null}
      {row.drift !== null ? (
        <p className="m-0 pl-10 text-[12px] text-signal-soft" data-provider-drift="">
          {t(locale, 'providers.versionDrift')
            .replace('{installed}', row.drift.installed)
            .replace('{measured}', row.drift.measured)}
        </p>
      ) : null}
      {row.installUrl !== null ? (
        <div className="flex items-center gap-2 rounded-control bg-band px-2 py-1">
          <code className="min-w-0 flex-1 select-all truncate font-mono text-[11.5px] text-ink">{row.installUrl}</code>
          <ActionButton onClick={() => void navigator.clipboard?.writeText(row.installUrl ?? '')}>
            {t(locale, 'providers.copy')}
          </ActionButton>
        </div>
      ) : null}
    </li>
  );
}

/** The first load's placeholder: two rows about the size of a real one. */
function ProviderSkeleton({ locale }: { readonly locale: Locale }) {
  return (
    <ul data-provider-skeleton="" aria-busy="true" aria-label={t(locale, 'scan.scanning')} className="m-0 list-none overflow-hidden rounded-card border border-hairline bg-surface p-0">
      <SkeletonStyle />
      {[0, 1, 2].map((index) => (
        <li key={index} className="flex items-center gap-3.5 border-t border-hairline px-3.5 py-3 first:border-t-0">
          <Skeleton width="1.625rem" height="1.625rem" radius="control" className="flex-none" />
          <Skeleton width="34%" height="0.875rem" radius="control" />
          <Skeleton width="5rem" height="0.75rem" radius="control" className="ml-auto flex-none" />
        </li>
      ))}
    </ul>
  );
}

export function ProviderList({ store, marks, locale }: ProviderListProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  const firstLoad = !state.loaded && state.scanning;
  const failedEmpty = !state.loaded && state.failed && !state.scanning;
  const empty = state.installed.length === 0 && state.notInstalled.length === 0;
  const folded = state.notInstalled.length;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <RescanButton locale={locale} busy={state.scanning} scannedAt={state.scannedAt} now={Date.now()} onRescan={() => void store.rescan()} />
      </div>

      {firstLoad ? <ProviderSkeleton locale={locale} /> : null}
      {failedEmpty ? <p className="text-[0.8125rem] leading-5 text-inkdim">{t(locale, 'scan.failed')}</p> : null}
      {state.loaded && state.failed ? <p className="text-[0.75rem] leading-4 text-error">{t(locale, 'scan.failed')}</p> : null}

      {empty && state.loaded && !state.scanning && !state.failed ? (
        <EmptyCard mark="providers" title={t(locale, 'providers.empty')} line={t(locale, 'providers.empty.line')} />
      ) : null}

      {state.installed.length > 0 ? (
        <ul className="m-0 list-none overflow-hidden rounded-card border border-hairline bg-surface p-0">
          {state.installed.map((row) => (
            <Row key={row.id} row={row} marks={marks} locale={locale} />
          ))}
        </ul>
      ) : null}

      {folded > 0 ? (
        <div className="grid gap-2">
          <button
            type="button"
            aria-expanded={state.groupOpen}
            onClick={() => store.toggleGroup()}
            className="flex w-fit items-center gap-1.5 rounded-control text-[13px] text-inkdim hover:text-ink"
          >
            <span aria-hidden="true" className={`inline-block transition-transform motion-reduce:transition-none ${state.groupOpen ? 'rotate-90' : ''}`}>
              ›
            </span>
            {countedLabel(t(locale, 'providers.group'), folded)}
          </button>
          {state.groupOpen ? (
            <ul className="m-0 list-none overflow-hidden rounded-card border border-hairline bg-surface p-0">
              {state.notInstalled.map((row) => (
                <Row key={row.id} row={row} marks={marks} locale={locale} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
