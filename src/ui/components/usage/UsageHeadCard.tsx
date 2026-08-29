// UsageHeadCard (WO-0054) — the month head: the EXISTING budget view rendered, never re-derived
// (plan D6 / AC2 — WO-0047's math and copy stay that WO's; the head's data is App's `budget`
// prop, refreshed at the same four drive hooks). Bar + readout + status line on a configured
// cap; the no-cap arm renders the ledger's own observed figure with NO bar and NO cap copy — a
// missing denominator is absent, never invented (the token tour's note: most workspaces have no
// budget key). The basis-divergence line (architect F1) NARRATES the two bases (head:
// `cost_usd` over `started_at`; breakdown: `usd_delta` over `at`) when they disagree — never a
// reconciliation, never a third figure, and ABSENT on the no-cap arm: the predicate needs
// `budget.monthUsd`, and with no threshold there is no head figure to differ from (amendment 3).
// The known-basis note is COUNT-FREE (amendment 2 — the budget view carries `hasUnknown` only).
// Figures are static text — the cost counter never animates (ADR-0012); the ONE transition on
// this screen is the bar's own `.36s` width fill, inherited from `.hairline-progress`.
import type { WorkspaceBudgetView } from '../../../core/budget';
import type { WorkspaceUsageView } from '../../../core/usage';
import { basisDiverges } from '../../../core/usage';
import { useLabels } from '../../data/locale';

export function UsageHeadCard({ budget, usage }: { budget?: WorkspaceBudgetView; usage: WorkspaceUsageView }) {
  // budgetLine sits on the labels ASSEMBLY (the UI object's sibling, like formatUsd) — the head's
  // status line re-uses WO-0047's sentence, never a second word for one state.
  const { UI, budgetLine } = useLabels();
  const pctWidth =
    budget !== undefined && budget.threshold.capUsd > 0
      ? Math.min(100, Math.round((budget.monthUsd / budget.threshold.capUsd) * 100))
      : undefined;
  const divergent = budget !== undefined && basisDiverges(budget.monthUsd, usage.totalsRawUsd);
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2.5 shadow-sm">
      <div className="flex items-baseline gap-2.5">
        <p className="readout text-signal">{UI.usageMonthTitle}</p>
        <span className="ml-auto font-mono text-[11px] text-inkdim">{UI.usageMonthMeta(new Date())}</span>
      </div>
      {pctWidth !== undefined ? (
        <div className="hairline-progress mt-2" aria-hidden="true">
          <div style={{ width: `${pctWidth}%` }} />
        </div>
      ) : null}
      {budget !== undefined ? (
        <>
          {/* the board card's shape (the review round): ONE month line — budgetLine carries the
              figures + the status when the cap is breached; the plain readout only when ok */}
          {budget.status !== 'ok' ? (
            <p className="mt-2 text-xs text-signal">{budgetLine(budget.status, budget.hasUnknown, budget.monthUsd, budget.threshold.capUsd)}</p>
          ) : (
            <p className="mt-2 text-sm text-ink">
              {budget.hasUnknown
                ? UI.budgetMonthReadoutKnown(budget.monthUsd, budget.threshold.capUsd)
                : UI.budgetMonthReadout(budget.monthUsd, budget.threshold.capUsd)}
            </p>
          )}
          {budget.hasUnknown ? <p className="mt-1 text-xs text-inkdim">{UI.usageKnownBasisNote}</p> : null}
          {divergent ? (
            <p data-usage-divergence className="mt-1 text-xs text-inkdim">
              {UI.usageBasisDivergence}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-ink">{UI.usageMonthObserved(usage.totals.usd)}</p>
      )}
    </div>
  );
}
