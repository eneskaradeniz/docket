// components/flow-strip.tsx — fixed read-only repo flow strip (U-290).
import { fill } from './chat-style';
import { t, type Locale } from '../labels/t';
import type { PinnedFlowView } from '../stores/work-order-window';

export interface FlowStripProps {
  readonly locale: Locale;
  readonly flow: PinnedFlowView;
  readonly skippedStageIds: readonly string[];
}

export function FlowStrip({ locale, flow, skippedStageIds }: FlowStripProps) {
  const skipped = new Set(skippedStageIds);
  return (
    <section
      role="region"
      aria-label={t(locale, 'workOrder.flowStrip.label')}
      className="rounded-card border border-bord bg-surface px-3 py-2"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'workOrder.flowStrip.label')}</span>
        <span className="rounded-full border border-bord bg-raised px-2 py-0.5 font-mono text-[10px] text-inkdim">
          {fill(t(locale, 'workOrder.flowStrip.version'), { version: flow.flowVersion })}
        </span>
      </div>
      <ol className="flex min-h-[2.25rem] flex-wrap items-center gap-1.5">
        {flow.stages.map((tile, index) => {
          const isSkipped = skipped.has(tile.stageId);
          return (
            <li key={tile.stageId} className="flex items-center gap-1.5">
              {index > 0 ? <span className="text-inkdim" aria-hidden="true">→</span> : null}
              <span
                className={[
                  'inline-flex items-center gap-1.5 rounded-card border border-bord bg-raised px-2 py-1 text-[12px] text-ink',
                  isSkipped ? 'opacity-50' : '',
                ].join(' ')}
              >
                <span>{tile.stageName}</span>
                {tile.roleVersion !== null ? (
                  <span className="rounded-full border border-bord px-1.5 py-0 font-mono text-[10px] text-inkdim">
                    {fill(t(locale, 'workOrder.flowStrip.version'), { version: tile.roleVersion })}
                  </span>
                ) : null}
                {isSkipped ? (
                  <span className="rounded-full bg-raised px-1.5 py-0 text-[10px] text-inkdim">
                    {t(locale, 'workOrder.skipProposal.skippedBadge')}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
