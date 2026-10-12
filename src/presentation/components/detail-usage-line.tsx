// components/detail-usage-line.tsx — one run's usage line (U-229): tokens always, and the cost
// the billing dictates — money for pay-per-use (≈ while an estimate), tokens only for an
// included run with the API-equivalent behind the ⓘ control (“tahmini, ücret değil”, never a
// dollar as a charge), credits in the provider's own unit. The ⓘ is a real focusable control
// whose note is in the accessibility tree once open (A7), not a hover-only title.
import { useState } from 'react';
import type { CostDisplay } from '../../domain/index';
import { t, type Locale } from '../labels/t';
import { formatMoney, formatTokensCompact } from './detail-format';

export interface DetailUsageLineProps {
  readonly locale: Locale;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: CostDisplay | null;
}

export function DetailUsageLine({ locale, inputTokens, outputTokens, cost }: DetailUsageLineProps) {
  const [estimateOpen, setEstimateOpen] = useState(false);
  const tokens = t(locale, 'detail.run.tokens')
    .replace('{in}', formatTokensCompact(locale, inputTokens))
    .replace('{out}', formatTokensCompact(locale, outputTokens));
  return (
    <span data-detail-usage className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-[0.6875rem] text-inkdim">
      <span>{tokens}</span>
      {cost?.kind === 'money' ? <span className="font-medium text-ink">{formatMoney(locale, cost.usd, cost.estimate)}</span> : null}
      {cost?.kind === 'credits' ? (
        <span className="font-medium text-ink">{t(locale, 'detail.run.credits').replace('{n}', formatTokensCompact(locale, cost.credits))}</span>
      ) : null}
      {cost?.kind === 'tokens' && cost.equivalentUsd !== undefined ? (
        <span className="relative inline-flex">
          <button
            type="button"
            aria-expanded={estimateOpen}
            aria-label={t(locale, 'detail.run.estimateInfo')}
            onClick={() => setEstimateOpen((open) => !open)}
            className="grid h-8 w-8 place-items-center rounded-control text-[0.75rem] text-inkdim hover:text-ink"
            data-detail-estimate
          >
            <span aria-hidden="true">ⓘ</span>
          </button>
          {estimateOpen ? (
            <span role="note" className="absolute left-0 top-9 z-20 w-72 rounded-card border border-bord bg-surface px-3 py-2 text-[0.78125rem] text-inkdim">
              {t(locale, 'detail.run.estimate').replace('{n}', formatMoney(locale, cost.equivalentUsd, true))}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
