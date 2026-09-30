// components/cockpit-states.tsx — the cockpit's non-data standings: the section head, the quiet
// row an empty section shows, the error alert and the first-run card. An empty or failed section
// always says what it means and what happens next — never a bare grey line; the loading standing
// is the shared skeleton composition (components/cockpit-skeleton.tsx).
import type { ReactNode } from 'react';
import type { LabelKey } from '../labels/keys';
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
      <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      {count !== null ? (
        <span
          className={`min-w-5 rounded-full px-1.5 text-center font-mono text-[11px] leading-[18px] ${hot ? 'bg-signal text-signal-ink' : 'bg-raised text-inkdim'}`}
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
    <div className="flex items-center gap-3 rounded-card border border-dashed border-bord px-3.5 py-3 text-[13px] text-inkdim">
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
      <p className="grid min-w-0 gap-0.5 text-[13px] text-ink">
        {t(locale, 'cockpit.error.title')}
        <small className="text-[12px] text-inkdim">{detail}</small>
      </p>
      <span className="ml-auto">
        <ActionButton variant="neutral" onClick={onRetry}>
          {t(locale, 'action.retry')}
        </ActionButton>
      </span>
    </div>
  );
}

const FIRST_STEPS: readonly LabelKey[] = ['cockpit.first.step1', 'cockpit.first.step2', 'cockpit.first.step3'];

/** The first run: no project, no work, no history. It points at the next step and offers no
 *  second way to add a project — that lives in the sidebar. */
export function FirstRunCard({ locale }: { readonly locale: Locale }) {
  return (
    <div className="grid max-w-[560px] justify-items-start gap-3.5 rounded-panel border border-dashed border-bord p-7">
      <h2 className="text-[16px] font-semibold text-ink">{t(locale, 'cockpit.first.title')}</h2>
      <p className="text-[13px] text-inkdim">{t(locale, 'cockpit.first.body')}</p>
      <ol className="grid gap-2 text-[13px] text-ink">
        {FIRST_STEPS.map((key, index) => (
          <li key={key} className="flex items-center gap-2.5">
            <span className="grid h-5 w-5 flex-none place-items-center rounded-full border border-bord font-mono text-[11px] text-inkdim">
              {index + 1}
            </span>
            {t(locale, key)}
          </li>
        ))}
      </ol>
    </div>
  );
}
