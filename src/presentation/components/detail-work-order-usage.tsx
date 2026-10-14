// components/detail-work-order-usage.tsx — the work order's folded usage (U-327, U-328): one
// collapsible line under the stage strip, waste findings and the per-stage breakdown inside.
// Money follows billing per run — pay-per-use dollars only, subscription equivalent behind ⓘ.
import { useState } from 'react';
import type { UsageSummaryView } from '../../api/queries';
import type { FlowDef, WasteFinding } from '../../domain/index';
import { t, type Locale } from '../labels/t';
import type { WorkOrderUsageMoney } from '../stores/work-order-detail';
import { ActionButton } from './action-button';
import { formatMoney, formatTokensCompact } from './detail-format';

export interface DetailWorkOrderUsageProps {
  readonly locale: Locale;
  readonly flow: FlowDef;
  readonly usage: UsageSummaryView | null;
  readonly usageFailed: boolean;
  readonly money: WorkOrderUsageMoney;
  readonly onRetry: () => void;
}

const stageNameOf = (flow: FlowDef, stageId: string): string =>
  flow.stages.find((stage) => stage.id === stageId)?.name ?? stageId;

export const wasteFindingLine = (locale: Locale, finding: WasteFinding, flow: FlowDef): string => {
  if (finding.kind === 'planning_heavy') {
    const share = finding.values.share;
    const runs = finding.values.runs;
    return t(locale, 'detail.usage.waste.planning')
      .replace('{s}', String(Math.round(share * 100)))
      .replace('{r}', String(runs));
  }
  if (finding.kind === 'retry_loop') {
    const attempts = finding.values.attempts;
    const stage = finding.stage === undefined ? '' : stageNameOf(flow, finding.stage);
    return t(locale, 'detail.usage.waste.retry').replace('{st}', stage).replace('{a}', String(attempts));
  }
  const ratio = finding.values.ratio;
  const inputTokens = finding.values.inputTokens;
  return t(locale, 'detail.usage.waste.cache')
    .replace('{r}', String(Math.round(ratio * 100)))
    .replace('{in}', formatTokensCompact(locale, inputTokens));
};

export function DetailWorkOrderUsage({ locale, flow, usage, usageFailed, money, onRetry }: DetailWorkOrderUsageProps) {
  const [expanded, setExpanded] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);

  if (usageFailed) {
    return (
      <div
        role="alert"
        data-detail-wo-usage
        className="flex flex-wrap items-center gap-3 rounded-card border border-error/50 bg-surface px-3 py-2 text-[0.8125rem] text-error"
      >
        <span>{t(locale, 'detail.usage.loadFailed')}</span>
        <ActionButton variant="neutral" onClick={onRetry}>{t(locale, 'detail.usage.retry')}</ActionButton>
      </div>
    );
  }

  if (usage === null) {
    return (
      <div role="status" aria-busy="true" data-detail-wo-usage className="rounded-card border border-hairline bg-surface px-3 py-2">
        <span className="text-[0.78125rem] text-inkdim">{t(locale, 'detail.usage.loading')}</span>
      </div>
    );
  }

  const { summary, findings, runsWithoutUsage } = usage;
  const outputTokens = summary.tokens - summary.inputTokens;
  const tokenLine = t(locale, 'detail.usage.tokens')
    .replace('{in}', formatTokensCompact(locale, summary.inputTokens))
    .replace('{out}', formatTokensCompact(locale, outputTokens));
  const runsLine = t(locale, 'detail.usage.runs').replace('{n}', String(summary.runs));
  const cacheLine = t(locale, 'detail.usage.cache').replace('{p}', String(Math.round(summary.cacheRatio * 100)));
  const planLine = t(locale, 'detail.usage.planShare').replace('{p}', String(Math.round(summary.planningShare * 100)));
  const hasWaste = findings.length > 0;

  const payLine =
    money.payPerUseUsd !== null
      ? t(locale, 'detail.usage.payPerUse').replace('{n}', formatMoney(locale, money.payPerUseUsd, money.payPerUseEstimate))
      : null;

  return (
    <section aria-label={t(locale, 'detail.usage.heading')} data-detail-wo-usage className="rounded-card border border-hairline bg-surface">
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          data-detail-wo-usage-toggle
          aria-expanded={expanded}
          aria-label={t(locale, 'detail.usage.foldLabel')}
          onClick={() => setExpanded((open) => !open)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-control px-1 py-1 text-left hover:bg-raised"
        >
          <span className="font-mono text-[0.6875rem] text-inkdim" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          <span className="text-[0.78125rem] font-semibold text-ink">{t(locale, 'detail.usage.heading')}</span>
          <span className="font-mono text-[0.6875rem] text-inkdim">{tokenLine}</span>
          <span className="font-mono text-[0.6875rem] text-inkdim">· {runsLine}</span>
          <span className="font-mono text-[0.6875rem] text-inkdim">· {cacheLine}</span>
          {hasWaste ? (
            <span className="inline-flex items-center gap-1.5 text-[0.78125rem] text-signal-soft">
              <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-signal" />
              {t(locale, 'detail.usage.wasteCollapsed')}
            </span>
          ) : null}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {payLine !== null ? <span className="font-mono text-[0.6875rem] font-medium text-ink">{payLine}</span> : null}
          {money.includedEquivalentUsd !== null ? (
            <span className="relative inline-flex items-center">
              <button
                type="button"
                data-detail-wo-estimate
                aria-expanded={estimateOpen}
                aria-label={t(locale, 'detail.usage.estimateAria')}
                onClick={() => setEstimateOpen((open) => !open)}
                className="grid h-8 w-8 place-items-center rounded-control text-[0.75rem] text-inkdim hover:text-ink"
              >
                <span aria-hidden="true">ⓘ</span>
              </button>
              {estimateOpen ? (
                <span role="note" className="absolute right-0 top-9 z-20 w-72 rounded-card border border-bord bg-surface px-3 py-2 text-[0.78125rem] text-inkdim">
                  {t(locale, 'detail.usage.estimateNote').replace(
                    '{n}',
                    formatMoney(locale, money.includedEquivalentUsd, true),
                  )}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div data-detail-wo-usage-expanded className="grid gap-3 border-t border-hairline px-3 py-3">
          {runsWithoutUsage > 0 ? (
            <p role="status" className="m-0 flex items-center gap-2 text-[0.78125rem] text-inkdim">
              <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-signal" />
              {t(locale, 'detail.usage.noUsageRuns').replace('{n}', String(runsWithoutUsage))}
            </p>
          ) : null}
          {findings.length > 0 ? (
            <ul
              role="list"
              aria-label={t(locale, 'detail.usage.wasteCount').replace('{n}', String(findings.length))}
              className="m-0 grid list-none gap-2 p-0"
            >
              {findings.map((finding) => (
                <li key={`${finding.rule}-${finding.kind}-${finding.stage ?? ''}`} className="text-[0.78125rem] text-signal-soft">
                  {wasteFindingLine(locale, finding, flow)}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[0.78125rem] font-semibold text-inkdim">{t(locale, 'detail.usage.stageHeading')}</span>
            <span className="font-mono text-[0.6875rem] text-inkdim">{planLine}</span>
          </div>
          <ul className="m-0 grid list-none gap-2 p-0">
            {summary.byStage.map((row) => {
              const rowOut = row.tokens - row.inputTokens;
              const rowTok = t(locale, 'detail.usage.tokens')
                .replace('{in}', formatTokensCompact(locale, row.inputTokens))
                .replace('{out}', formatTokensCompact(locale, rowOut));
              const rowRuns = t(locale, 'detail.usage.stageRuns')
                .replace('{r}', String(row.runs))
                .replace('{a}', String(row.maxAttempt));
              const rowCache = t(locale, 'detail.usage.stageCache').replace(
                '{c}',
                formatTokensCompact(locale, row.cachedInputTokens),
              );
              return (
                <li
                  key={row.stage}
                  className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 rounded-card border border-hairline bg-raised px-3 py-2"
                >
                  <span className="text-[0.8125rem] font-medium text-ink">{stageNameOf(flow, row.stage)}</span>
                  <span className="font-mono text-[0.6875rem] text-inkdim">
                    {rowTok} · {rowRuns} · {rowCache}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
