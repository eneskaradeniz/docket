// setup-summary.tsx — multi-repo setup finish screen (U-316): counters and primary open/add actions.
import { ActionButton } from './action-button';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { AddedRepoRecord } from '../stores/new-project';

export interface SetupSummaryProps {
  readonly locale: Locale;
  readonly added: readonly AddedRepoRecord[];
  readonly skipped: number;
  readonly pending: number;
  readonly busy: boolean;
  readonly onOpenProject: () => void;
  readonly onAddRepo: () => void;
  readonly onViewList: () => void;
}

export function SetupSummary({
  locale,
  added,
  skipped,
  pending,
  busy,
  onOpenProject,
  onAddRepo,
  onViewList,
}: SetupSummaryProps) {
  const counter = (labelKey: LabelKey, value: number) => (
    <span role="status" className="inline-flex items-center gap-1.5 text-[0.8125rem] text-ink">
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-inkdim">{t(locale, labelKey)}</span>
    </span>
  );

  return (
    <section className="mt-4 grid gap-4" data-setup-summary="">
      <header className="grid gap-1">
        <h2 className="m-0 text-[0.9375rem] font-semibold text-ink">{t(locale, 'setup.multi.summary.title')}</h2>
        <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'setup.multi.summary.lead')}</p>
      </header>
      {added.some((repo) => repo.noTestGate === true) ? (
        <p role="status" data-setup-no-test-gate="" className="m-0 text-[0.8125rem] text-inkdim">
          {t(locale, 'setup.multi.summary.noTestGate')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-4">{counter('setup.multi.summary.addedCount', added.length)}{counter('setup.multi.summary.skippedCount', skipped)}{counter('setup.multi.summary.pendingCount', pending)}</div>
      <div className="flex flex-wrap gap-2">
        <ActionButton variant="primary" size="md" disabled={busy} onClick={onOpenProject}>
          {t(locale, 'setup.multi.summary.openProject')}
        </ActionButton>
        <ActionButton variant="neutral" size="md" disabled={busy} onClick={onAddRepo}>
          {t(locale, 'setup.multi.summary.addMore')}
        </ActionButton>
        <ActionButton variant="neutral" size="md" disabled={busy} onClick={onViewList}>
          {t(locale, 'setup.multi.summary.viewList')}
        </ActionButton>
      </div>
    </section>
  );
}

export interface SetupRepoListProps {
  readonly locale: Locale;
  readonly repos: readonly AddedRepoRecord[];
  readonly busy: boolean;
  readonly onAddRepo: () => void;
  readonly onFinish: () => void;
  readonly onBack: () => void;
}

export function SetupRepoList({ locale, repos, busy, onAddRepo, onFinish, onBack }: SetupRepoListProps) {
  return (
    <section className="mt-4 grid gap-3" data-setup-repo-list="">
      <header className="grid gap-1">
        <h2 className="m-0 text-[0.9375rem] font-semibold text-ink">{t(locale, 'setup.multi.list.title')}</h2>
        <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'setup.multi.list.lead')}</p>
      </header>
      <p className="m-0 text-[0.8125rem] font-semibold text-inkdim">{t(locale, 'setup.multi.list.sub')}</p>
      <ul role="list" className="grid gap-2">
        {repos.map((repo) => (
          <li
            key={repo.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-hairline px-3.5 py-2.5"
            data-setup-repo-row=""
          >
            <span className="font-mono text-[0.8125rem] text-ink">{repo.id}</span>
            <span className="rounded-control border border-hairline px-2 py-0.5 text-[0.75rem] font-semibold text-inkdim">
              {t(locale, 'setup.multi.status.added')}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <ActionButton variant="neutral" size="md" disabled={busy} onClick={onBack}>
          {t(locale, 'newProject.cancel')}
        </ActionButton>
        <ActionButton variant="neutral" size="md" disabled={busy} onClick={onAddRepo}>
          {t(locale, 'setup.multi.list.addBtn')}
        </ActionButton>
        <ActionButton variant="primary" size="md" disabled={busy} onClick={onFinish}>
          {t(locale, 'setup.multi.list.finishBtn')}
        </ActionButton>
      </div>
    </section>
  );
}
