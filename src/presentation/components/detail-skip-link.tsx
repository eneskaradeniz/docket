// components/detail-skip-link.tsx — the detail's first focusable element (A1, U-232): a quiet
// skip link that is invisible until focused, moves keyboard focus straight to the decision
// zone's heading, and never takes part in the visual layout otherwise. The zone is where a
// person's decision waits; the files and history behind it are reading, not action.
import { t, type Locale } from '../labels/t';

export interface DetailSkipLinkProps {
  readonly locale: Locale;
  /** The id of the zone's heading — the link focuses it (the heading carries tabindex="-1"). */
  readonly targetId: string;
}

export function DetailSkipLink({ locale, targetId }: DetailSkipLinkProps) {
  return (
    <button
      type="button"
      data-detail-skip
      onClick={() => {
        const target = document.getElementById(targetId);
        target?.focus();
      }}
      className="sr-only focus:not-sr-only focus:absolute focus:left-0 focus:top-0 focus:z-40 focus:rounded-control focus:bg-signal focus:px-4 focus:py-2 focus:text-[0.8125rem] focus:font-semibold focus:text-signal-ink"
    >
      {t(locale, 'detail.skip.toDecision')}
    </button>
  );
}
