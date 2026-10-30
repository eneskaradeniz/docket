// setup-import-repos.tsx — attach several existing repositories (U-319).
import { ActionButton } from './action-button';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { ImportQueueRow } from '../stores/new-project';

export interface SetupImportReposProps {
  readonly locale: Locale;
  readonly mode: 'multi' | 'parent';
  readonly parentPath: string;
  readonly loading: boolean;
  readonly overflow: number;
  readonly rows: readonly ImportQueueRow[];
  readonly busy: boolean;
  readonly onMode: (mode: 'multi' | 'parent') => void;
  readonly onParent: (path: string) => void;
  readonly onPickFolders: () => void;
  readonly onScan: () => void;
  readonly onReview: (path: string) => void;
  readonly onApprove: (path: string) => void;
  readonly onApproveAll: () => void;
  readonly onToSummary: () => void;
  readonly onBack: () => void;
}

const statusKey = (row: ImportQueueRow): LabelKey => {
  switch (row.status) {
    case 'added':
      return 'setup.multi.status.added';
    case 'ready':
      return 'setup.multi.status.ready';
    case 'review':
      return 'setup.multi.status.review';
    case 'skipped':
      return 'setup.multi.status.skipped';
  }
};

export function SetupImportRepos({
  locale,
  mode,
  parentPath,
  loading,
  overflow,
  rows,
  busy,
  onMode,
  onParent,
  onPickFolders,
  onScan,
  onReview,
  onApprove,
  onApproveAll,
  onToSummary,
  onBack,
}: SetupImportReposProps) {
  const hasReview = rows.some((row) => row.status === 'review');
  const readyCount = rows.filter((row) => row.status === 'ready').length;
  const NOTE = 'text-[0.78rem] leading-[1.125rem]';
  const INPUT =
    'w-full rounded-control border border-bord bg-transparent px-2.5 py-1.5 text-[0.8125rem] leading-[1.25rem] text-ink focus:border-signal focus:outline-none';

  return (
    <section className="mt-4 grid gap-3" data-setup-import="" aria-busy={loading ? 'true' : undefined}>
      <header className="grid gap-1">
        <h2 className="m-0 text-[0.9375rem] font-semibold text-ink">{t(locale, 'setup.multi.batch.title')}</h2>
        <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'setup.multi.batch.lead')}</p>
      </header>
      <div role="group" aria-label={t(locale, 'setup.multi.batch.title')} className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={mode === 'multi'}
          data-import-mode="multi"
          onClick={() => onMode('multi')}
          className={`rounded-control border px-3 py-1.5 text-[0.8125rem] font-semibold ${mode === 'multi' ? 'border-bord bg-raised text-ink' : 'border-hairline text-inkdim hover:border-bord'}`}
        >
          {t(locale, 'setup.multi.batch.mode.multi')}
        </button>
        <button
          type="button"
          aria-pressed={mode === 'parent'}
          data-import-mode="parent"
          onClick={() => onMode('parent')}
          className={`rounded-control border px-3 py-1.5 text-[0.8125rem] font-semibold ${mode === 'parent' ? 'border-bord bg-raised text-ink' : 'border-hairline text-inkdim hover:border-bord'}`}
        >
          {t(locale, 'setup.multi.batch.mode.parent')}
        </button>
      </div>
      {mode === 'multi' ? (
        <ActionButton variant="neutral" size="md" disabled={busy || loading} onClick={onPickFolders}>
          {t(locale, 'setup.multi.batch.mode.multi')}
        </ActionButton>
      ) : (
        <div className="grid gap-2">
          <p className={`m-0 ${NOTE} text-inkdim`}>{t(locale, 'setup.multi.batch.scanNote')}</p>
          <input value={parentPath} onChange={(event) => onParent(event.target.value)} className={`${INPUT} font-mono`} data-import-parent="" />
          <ActionButton variant="neutral" size="md" disabled={busy || loading || parentPath.trim() === ''} onClick={onScan}>
            {t(locale, 'setup.multi.batch.mode.parent')}
          </ActionButton>
        </div>
      )}
      {loading ? <p className={`${NOTE} text-inkdim`}>{t(locale, 'setup.multi.batch.loading')}</p> : null}
      {overflow > 0 ? (
        <div role="alert" className="rounded-card border border-signal-soft bg-raised px-3.5 py-2.5">
          <p className="m-0 text-[0.8125rem] font-semibold text-ink">{t(locale, 'setup.multi.batch.limitAlert')}</p>
          <p className={`m-0 ${NOTE} text-inkdim`}>{t(locale, 'setup.multi.batch.limitSub')}</p>
        </div>
      ) : null}
      {rows.length === 0 && !loading ? (
        <div className="grid gap-1 rounded-card border border-hairline px-3.5 py-3">
          <p className="m-0 text-[0.8125rem] font-semibold text-ink">{t(locale, 'setup.multi.batch.empty.title')}</p>
          <p className={`m-0 ${NOTE} text-inkdim`}>{t(locale, 'setup.multi.batch.empty.line')}</p>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <>
          <p className="m-0 text-[0.8125rem] font-semibold text-inkdim">{t(locale, 'setup.multi.batch.queueHead')}</p>
          <ul role="list" className="grid gap-2" data-setup-import-queue="">
            {rows.map((row) => (
              <li key={row.path} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-hairline px-3.5 py-2.5">
                <div className="grid min-w-0 gap-0.5">
                  <span className="truncate font-mono text-[0.8125rem] text-ink">{row.name}</span>
                  {row.reasonKey !== undefined ? <span className={`${NOTE} text-inkdim`}>{t(locale, row.reasonKey)}</span> : null}
                </div>
                <span className="rounded-control border border-hairline px-2 py-0.5 text-[0.75rem] font-semibold text-inkdim">{t(locale, statusKey(row))}</span>
                {row.status === 'review' ? (
                  <button type="button" disabled={busy} onClick={() => onReview(row.path)} data-import-review="" className="rounded-control border border-bord px-2 py-0.5 text-[0.75rem] font-semibold text-ink enabled:hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45">
                    {t(locale, 'setup.multi.list.reviewBtn')}
                  </button>
                ) : null}
                {row.status === 'ready' ? (
                  <button type="button" disabled={busy} onClick={() => onApprove(row.path)} data-import-approve="" className="rounded-control border border-bord px-2 py-0.5 text-[0.75rem] font-semibold text-ink enabled:hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45">
                    {t(locale, 'setup.multi.batch.approveOne')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {hasReview ? <p className={`m-0 ${NOTE} text-inkdim`}>{t(locale, 'setup.multi.batch.reviewGuard')}</p> : null}
      <div className="flex flex-wrap gap-2">
        <ActionButton variant="neutral" size="md" disabled={busy} onClick={onBack}>
          {t(locale, 'newProject.cancel')}
        </ActionButton>
        {!hasReview && readyCount > 0 ? (
          <ActionButton variant="neutral" size="md" disabled={busy || loading} onClick={onApproveAll}>
            {t(locale, 'setup.multi.batch.approveAll')}
          </ActionButton>
        ) : null}
        <ActionButton variant="primary" size="md" disabled={busy} onClick={onToSummary}>
          {t(locale, 'setup.multi.batch.toSummary')}
        </ActionButton>
      </div>
    </section>
  );
}
