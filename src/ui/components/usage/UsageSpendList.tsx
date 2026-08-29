// UsageSpendList (WO-0054) — the ledger's list face: per-WO rows (usd desc, zero-spend absent —
// the derivation already filters), the ✦ draft row INSIDE the list (NON-ADDITIVE with the role
// buckets — two views of one row set, the note line says so), then the OTURUMLAR section: the
// role word in its role hue (the SessionCards mapping, verbatim), the where cell (woIdLabel or
// the ✦ draft marker — a raw id never renders, ADR-0007), the cost, in→out, the OBSERVED-RESULT
// count (never num_turns), the last result's clock through the bundle family, and the context
// readout ONLY when the session carried a checkpoint (absent, never zero). The two honesty lines
// ride the foot; usageRoleUnknown speaks RECORDS — the counter counts rows (D2.3's letter), so
// the copy says «kayıt», not «oturum» (the S3 folded ruling). Static text throughout (ADR-0012).
import type { SessionRole } from '../../../core/types';
import type { WorkspaceUsageView } from '../../../core/usage';
import { useLabels } from '../../data/locale';
import { cn } from '../../kit';

// The role word hue — SessionCards' ROLE_WORD_CLASS, copied verbatim (one hue per role).
const ROLE_WORD_CLASS: Record<SessionRole, string> = {
  architect: 'text-signal',
  implementer: 'text-info',
  verifier: 'text-proceed',
};

export function UsageSpendList({ view }: { view: WorkspaceUsageView }) {
  const { UI, ROLE_LABELS, formatUsd, formatTokens, woIdLabel } = useLabels();
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2.5 shadow-sm">
      <div className="flex items-baseline gap-2.5">
        <p className="readout text-signal">{UI.usageByWoTitle}</p>
        <span className="ml-auto font-mono text-[11px] text-inkdim">{UI.usageWoMeta}</span>
      </div>
      <div className="mt-1">
        {view.workOrders.map((o) => (
          <div key={o.id} className="flex items-baseline gap-2.5 border-b border-hairline py-1.5 last:border-b-0">
            <span className="shrink-0 font-mono text-[11px] text-inkdim">{woIdLabel(o.id)}</span>
            <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{o.title}</span>
            <span className="ml-auto whitespace-nowrap font-mono text-[11.5px] text-inkdim">
              {UI.usageWoValue(o.usd, o.sessionCount)}
            </span>
          </div>
        ))}
        {view.draft !== undefined ? (
          <div className="flex items-baseline gap-2.5 py-1.5">
            <span className="shrink-0 font-mono text-[11px] text-signal">✦</span>
            <span className="min-w-0 truncate text-[13px] font-semibold text-signal">{UI.usageDraftRowLabel}</span>
            <span className="ml-auto whitespace-nowrap font-mono text-[11.5px] text-inkdim">
              {UI.usageWoValue(view.draft.usd, view.draft.sessionCount)}
            </span>
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-inkdim">{UI.usageDraftNonAdditive}</p>

      <p className="readout mt-3 text-inkdim">{UI.usageSessionsTitle}</p>
      <div className="mt-0.5">
        {view.sessions.map((s) => (
          <div key={s.providerSessionId} className="flex items-baseline gap-2.5 border-b border-hairline py-1.5 last:border-b-0">
            {s.role !== undefined ? (
              <span className={cn('shrink-0 text-[12px] font-semibold', ROLE_WORD_CLASS[s.role])}>{ROLE_LABELS[s.role]}</span>
            ) : null}
            <span className="min-w-0 shrink font-mono text-[10.5px] text-inkdim">
              {s.workOrderId !== null ? woIdLabel(s.workOrderId) : UI.usageDraftWhere}
            </span>
            <span className="ml-auto flex shrink-0 gap-2.5 whitespace-nowrap font-mono text-[10.5px] text-inkdim">
              <span className="font-semibold text-ink">{formatUsd(s.usd)}</span>
              <span>
                {formatTokens(s.tokensIn)}→{formatTokens(s.tokensOut)}
              </span>
              <span>{UI.usageSessionTurns(s.turnCount)}</span>
              <span>{UI.auditClock(s.lastAt)}</span>
              {s.ctxPct !== undefined && s.ctx ? (
                <span>{UI.contextReadout(s.ctxPct, s.ctx.usedTokens, s.ctx.maxTokens)}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {view.unledgeredCount > 0 ? <p className="mt-1.5 text-xs text-inkdim">{UI.usageUnledgeredLine(view.unledgeredCount)}</p> : null}
      {view.roleUnknownCount > 0 ? <p className="mt-1 text-xs text-inkdim">{UI.usageRoleUnknown(view.roleUnknownCount)}</p> : null}
    </div>
  );
}
