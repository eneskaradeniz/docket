// components/detail-run-card.tsx — one run row inside its stage (U-229, U-230): the outcome
// word in its tone, the attempt, the clock time, the short run code (never the raw ULID — the
// walk-through decision; the full id rides the title), the “anlık” chip while the run is live,
// the provenance line (account · model; “inceleyen” on the reviewer role's stages), the usage
// line by billing, and the duration. A run whose summary never arrived renders without the
// provenance and usage lines rather than guessing one.
import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import type { WorkOrderRunRow } from '../stores/work-order-detail';
import { formatClock, formatDateTime, formatDurationMs } from './detail-format';
import { DetailUsageLine } from './detail-usage-line';

const OUTCOME_CLASS: Readonly<Record<'running' | 'succeeded' | 'failed' | 'limit' | 'cancelled', string>> = {
  running: 'text-proceed',
  succeeded: 'text-proceed',
  failed: 'text-error',
  limit: 'text-signal-soft',
  cancelled: 'text-inkdim',
};

const OUTCOME_KEY: Readonly<Record<'running' | 'succeeded' | 'failed' | 'limit' | 'cancelled', LabelKey>> = {
  running: 'detail.run.running',
  succeeded: 'run.outcome.succeeded',
  failed: 'run.outcome.failed',
  limit: 'run.outcome.limit',
  cancelled: 'run.outcome.cancelled',
};

export interface DetailRunCardProps {
  readonly run: WorkOrderRunRow;
  readonly locale: Locale;
}

export function DetailRunCard({ run, locale }: DetailRunCardProps) {
  const outcome = run.endedAt === undefined ? 'running' : (run.outcome ?? 'running');
  const duration = run.endedAt !== undefined ? formatDurationMs(locale, run.endedAt - run.startedAt) : null;
  return (
    <li
      data-detail-run={run.id}
      className="grid gap-1 rounded-card border border-hairline bg-surface px-3 py-2"
      title={run.id}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]">
        <span className={`font-semibold ${OUTCOME_CLASS[outcome]}`}>{t(locale, OUTCOME_KEY[outcome])}</span>
        <span className="text-inkdim">{t(locale, 'detail.run.attempt').replace('{n}', String(run.attempt))}</span>
        <span className="text-inkdim" title={formatDateTime(locale, run.startedAt)}>{formatClock(locale, run.startedAt)}</span>
        <code className="font-mono text-[0.6875rem] text-inkdim">{run.shortCode}</code>
        {outcome === 'running' ? (
          <span className="rounded-control border border-signal px-1 text-[0.6875rem] text-signal-soft">
            {t(locale, 'detail.run.liveChip')}
          </span>
        ) : null}
      </div>
      {run.accountLabel !== null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[0.78125rem] text-inkdim">
          <span className="min-w-0 truncate">
            {run.accountLabel}
            {run.model !== null ? ` · ${run.model}` : ''}
          </span>
          {run.usage !== null ? <DetailUsageLine locale={locale} inputTokens={run.usage.inputTokens} outputTokens={run.usage.outputTokens} cost={run.cost} /> : null}
          {duration !== null ? <span>{duration}</span> : null}
        </div>
      ) : null}
    </li>
  );
}
