// UsageBreakdownCard (WO-0054) — ONE card, three blocks (roles / models / cache) + the total row.
// The app-card idiom with NO lamp: the lamp is a WO state signal, it would lie here (karar 6).
// Roles through ROLE_LABELS; model ids verbatim in mono — row DATA, the ADR-0006 WO-0052
// carve-out's sanctioned display; the modelUnknown bucket renders LAST. The models-split note
// (architect F2) narrates the provider's own split when it does not total to the row-scalar sum —
// the view's `modelSplitDiverges` (computed in core against RAW accumulates), never Docket
// arithmetic, absent when they agree. The cache block renders ONLY when the month reported cache
// figures (AC4) — never a 0/0/0 row. Figures are static text (ADR-0012): readouts, no animation.
import type { WorkspaceUsageView } from '../../../core/usage';
import { useLabels } from '../../data/locale';

export function UsageBreakdownCard({ view }: { view: WorkspaceUsageView }) {
  const { UI, ROLE_LABELS, formatUsd, formatTokens } = useLabels();
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2.5 shadow-sm">
      <div className="flex items-baseline gap-2.5">
        <p className="readout text-signal">{UI.usageBreakdownTitle}</p>
        <span className="ml-auto font-mono text-[11px] text-inkdim">{UI.usageBreakdownMeta}</span>
      </div>

      <p className="readout mt-2.5 text-inkdim">{UI.usageRolesTitle}</p>
      <div className="mt-0.5">
        {view.byRole.map((b) => (
          <div key={b.role} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-0.5">
            <span className="min-w-0 text-[12.5px] text-ink">
              {ROLE_LABELS[b.role]}{' '}
              <span className="text-[11.5px] text-inkdim">{UI.usageRoleSub(b.sessionCount, b.tokensIn, b.tokensOut)}</span>
            </span>
            <span className="whitespace-nowrap font-mono text-[11.5px] text-inkdim">{UI.usageRoleValue(b.usd, b.pct)}</span>
          </div>
        ))}
      </div>

      <p className="readout mt-2.5 text-inkdim">{UI.usageModelsTitle}</p>
      <div className="mt-0.5">
        {view.byModel.map((b) => (
          <div key={b.model ?? 'unknown'} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-0.5">
            <span className="min-w-0 text-[12.5px] text-ink">
              {b.model !== undefined ? (
                <>
                  <span className="font-mono text-[11.5px]">{b.model}</span>{' '}
                  <span className="text-[11.5px] text-inkdim">{UI.usageModelSub(b.tokensIn, b.tokensOut)}</span>
                </>
              ) : (
                <span className="text-[11.5px] text-inkdim">{UI.usageModelUnknownLabel}</span>
              )}
            </span>
            <span className="whitespace-nowrap font-mono text-[11.5px] text-inkdim">
              <span className="font-semibold text-ink">{formatUsd(b.usd)}</span>
            </span>
          </div>
        ))}
      </div>
      {view.modelSplitDiverges ? (
        <p data-usage-models-note className="mt-1 text-xs text-inkdim">
          {UI.usageModelSplitNote}
        </p>
      ) : null}

      {view.cache.hasCacheFigures ? (
        <>
          <p className="readout mt-2.5 text-inkdim">{UI.usageCacheTitle}</p>
          <p className="mt-0.5 font-mono text-[11.5px] text-inkdim">
            {UI.usageCacheLine(view.cache.freshIn, view.cache.cacheRead, view.cache.cacheCreation)}
          </p>
        </>
      ) : null}

      <div className="mt-2 grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-t border-hairline pt-1.5">
        <span className="text-[12.5px] text-ink">{UI.usageTotalLabel}</span>
        <span className="whitespace-nowrap font-mono text-[11.5px] text-inkdim">
          <span className="font-semibold text-ink">{formatUsd(view.totals.usd)}</span>
          {' · '}
          {formatTokens(view.totals.tokensIn)}→{formatTokens(view.totals.tokensOut)}
        </span>
      </div>
    </div>
  );
}
