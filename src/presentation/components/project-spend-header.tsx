// components/project-spend-header.tsx — the project roadmap header spend strip (U-329).
import type { ProjectSpendView } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import { formatMoney } from './detail-format';
import { projectSpendDisplay } from '../stores/project-spend';

const fill = (text: string, vars: Readonly<Record<string, string>>): string =>
  Object.entries(vars).reduce((out, [name, value]) => out.split(`{${name}}`).join(value), text);

export interface ProjectSpendHeaderProps {
  readonly locale: Locale;
  readonly spend: ProjectSpendView | null;
  readonly loading: boolean;
  readonly problem: string | null;
  readonly repoOpen: boolean;
  readonly onToggleRepo: () => void;
  readonly onRetry: () => void;
  readonly onEditCap: () => void;
}

const METER_TONE: Readonly<Record<'ok' | 'warn' | 'hard_stop', string>> = {
  ok: 'bg-proceed',
  warn: 'bg-signal',
  hard_stop: 'bg-error',
};

export function ProjectSpendHeader({
  locale,
  spend,
  loading,
  problem,
  repoOpen,
  onToggleRepo,
  onRetry,
  onEditCap,
}: ProjectSpendHeaderProps) {
  const display = projectSpendDisplay(spend, loading, problem);
  if (display.kind === 'hidden') return null;

  const shell = 'rounded-card border border-hairline bg-surface px-3 py-2.5';

  if (display.kind === 'loading') {
    return (
      <div data-project-spend="" role="status" aria-busy="true" className={`${shell} text-[0.75rem] text-inkdim`}>
        {t(locale, 'project.spend.loading')}
      </div>
    );
  }

  if (display.kind === 'error') {
    return (
      <div data-project-spend="" role="alert" className={`${shell} flex flex-wrap items-center gap-2 text-[0.8125rem] text-error`}>
        <span>{t(locale, 'project.spend.error')}</span>
        <button type="button" onClick={onRetry} className="h-7 rounded-control border border-bord px-2 text-[0.75rem] font-semibold text-ink hover:bg-raised">
          {t(locale, 'project.spend.retry')}
        </button>
      </div>
    );
  }

  const spentText = formatMoney(locale, display.kind === 'counter' ? display.totalUsd : display.totalUsd, false);
  const repoRows = spend?.perRepo ?? [];

  if (display.kind === 'counter') {
    return (
      <section data-project-spend="" role="status" aria-label={t(locale, 'project.spend.heading')} className={`${shell} grid gap-2`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-semibold text-ink">{t(locale, 'project.spend.heading')}</p>
            <p className="text-[0.75rem] text-inkdim">
              {fill(t(locale, 'project.spend.noCapText'), { spent: spentText })}
            </p>
          </div>
          <span className="rounded-control border border-hairline px-2 py-0.5 font-mono text-[0.6875rem] text-inkdim">
            {t(locale, 'project.spend.noCapBadge')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={repoOpen}
            onClick={onToggleRepo}
            className="h-7 rounded-control border border-bord px-2 text-[0.75rem] font-semibold text-ink hover:bg-raised"
          >
            {t(locale, 'project.spend.repoToggle')}
          </button>
        </div>
        {repoOpen ? (
          <div className="flex flex-wrap gap-1.5 border-t border-hairline pt-2">
            {repoRows.map((row) => (
              <span key={row.repo} className="rounded-control border border-hairline bg-raised px-2 py-0.5 font-mono text-[0.6875rem] text-inkdim">
                {row.repo}: {formatMoney(locale, row.usd, false)}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  const capText = formatMoney(locale, display.cap.amountUsd, false);
  const tone = display.status === 'hard_stop' ? 'err' : display.status === 'warn' ? 'warn' : 'ok';
  const barClass = METER_TONE[display.status];

  return (
    <section data-project-spend="" role="region" aria-label={t(locale, 'project.spend.heading')} className={`${shell} grid gap-2`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 grid gap-0.5">
          <p className="text-[0.8125rem] font-semibold text-ink">{t(locale, 'project.spend.heading')}</p>
          <p className="font-mono text-[0.75rem] text-inkdim">
            {fill(t(locale, 'project.spend.ofCap'), { spent: spentText, cap: capText })}
            <span className="text-inkdim"> · </span>
            {fill(t(locale, 'project.spend.percent'), { p: String(display.percent) })}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={repoOpen}
          onClick={onToggleRepo}
          className="h-7 flex-none rounded-control border border-bord px-2 text-[0.75rem] font-semibold text-ink hover:bg-raised"
        >
          {t(locale, 'project.spend.repoToggle')}
        </button>
      </div>
      <div
        role="meter"
        aria-label={t(locale, 'project.spend.heading')}
        aria-valuemin={0}
        aria-valuemax={display.cap.amountUsd}
        aria-valuenow={display.totalUsd}
        className="relative h-2 overflow-hidden rounded-full bg-raised"
        data-tone={tone}
      >
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${display.percent}%` }} />
        <div
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-px bg-inkdim"
          style={{ left: `${display.cap.warnPercent}%` }}
        />
      </div>
      {display.status === 'warn' ? (
        <p role="status" className="text-[0.75rem] text-signal-soft">{t(locale, 'project.spend.warnNote')}</p>
      ) : null}
      {display.status === 'hard_stop' ? (
        <p role="alert" className="text-[0.75rem] text-error">{t(locale, 'project.spend.stopNote')}</p>
      ) : null}
      {repoOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2">
          <div className="flex flex-wrap gap-1.5">
            {repoRows.map((row) => (
              <span key={row.repo} className="rounded-control border border-hairline bg-raised px-2 py-0.5 font-mono text-[0.6875rem] text-inkdim">
                {row.repo}: {formatMoney(locale, row.usd, false)}
              </span>
            ))}
          </div>
          <button type="button" onClick={onEditCap} className="h-7 rounded-control border border-bord px-2 text-[0.75rem] font-semibold text-ink hover:bg-raised">
            {t(locale, 'project.spend.editCap')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
