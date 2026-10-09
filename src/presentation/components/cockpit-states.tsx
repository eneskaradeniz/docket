// components/cockpit-states.tsx — the cockpit's non-data standings: the section head, the quiet
// row an empty section shows, the error alert and the first-run card. An empty or failed section
// always says what it means and what happens next — never a bare grey line; the loading standing
// is the shared skeleton composition (components/cockpit-skeleton.tsx).
import type { ReactNode } from 'react';
import { t, type Locale } from '../labels/t';
import { ActionButton } from './action-button';

export interface SectionHeadProps {
  readonly title: string;
  readonly count: number | null;
  /** The count chip turns amber while something waits on the operator. */
  readonly hot?: boolean;
  readonly action?: ReactNode;
}

export function SectionHead({ title, count, hot = false, action }: SectionHeadProps) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[0.8125rem] font-semibold text-ink">{title}</h2>
      {count !== null ? (
        <span
          className={`min-w-5 rounded-full px-1.5 text-center font-mono text-[0.6875rem] leading-[1.125rem] ${hot ? 'bg-signal text-signal-ink' : 'bg-raised text-inkdim'}`}
        >
          {count}
        </span>
      ) : null}
      {action !== undefined ? <span className="ml-auto">{action}</span> : null}
    </div>
  );
}

export interface QuietRowProps {
  readonly title: string;
  readonly hint?: string;
  /** `good` = nothing needs doing (green check); `idle` = nothing to show yet; `unknown` = could not load. */
  readonly tone: 'good' | 'idle' | 'unknown';
}

const QUIET_MARK: Readonly<Record<QuietRowProps['tone'], string>> = { good: '✓', idle: '–', unknown: '?' };

export function QuietRow({ title, hint, tone }: QuietRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-dashed border-bord px-3.5 py-3 text-[0.8125rem] text-inkdim">
      <span
        aria-hidden="true"
        className={`grid h-7 w-7 flex-none place-items-center rounded-full bg-raised ${tone === 'good' ? 'text-proceed' : ''}`}
      >
        {QUIET_MARK[tone]}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <b className="font-semibold text-ink">{title}</b>
        {hint !== undefined ? <span>{hint}</span> : null}
      </span>
    </div>
  );
}

export interface CockpitAlertProps {
  readonly locale: Locale;
  readonly detail: string;
  readonly onRetry: () => void;
}

export function CockpitAlert({ locale, detail, onRetry }: CockpitAlertProps) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-card border border-error/55 bg-surface px-3.5 py-2.5">
      <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-error" />
      <p className="grid min-w-0 gap-0.5 text-[0.8125rem] text-ink">
        {t(locale, 'cockpit.error.title')}
        <small className="text-[0.75rem] text-inkdim">{detail}</small>
      </p>
      <span className="ml-auto">
        <ActionButton variant="neutral" onClick={onRetry}>
          {t(locale, 'action.retry')}
        </ActionButton>
      </span>
    </div>
  );
}

/** The first run: no project, no work, no history. One dashed start card with the two ways in —
 *  both open the Yeni proje page (U-40), whose default is an existing folder. */
export function FirstRunCard({ locale, onNewProject, onAttach }: { readonly locale: Locale; readonly onNewProject: () => void; readonly onAttach: () => void }) {
  return (
    <div className="grid max-w-[35rem] justify-items-start gap-2.5 rounded-panel border border-dashed border-bord p-7" data-start-card="">
      <h2 className="text-[1.0625rem] font-bold text-ink">{t(locale, 'cockpit.first.title')}</h2>
      <p className="max-w-[52ch] text-[0.84375rem] text-inkdim">{t(locale, 'cockpit.first.body')}</p>
      <div className="mt-1.5 flex gap-2">
        <ActionButton variant="primary" size="md" onClick={onNewProject}>
          {t(locale, 'cockpit.first.new')}
        </ActionButton>
        <ActionButton variant="neutral" size="md" onClick={onAttach}>
          {t(locale, 'cockpit.first.attach')}
        </ActionButton>
      </div>
    </div>
  );
}
