// LimitCard (WO-0053) — the usage-limit stop's INFORMATIVE card, the BudgetRefusalCard's sibling
// grammar (lamp-edged card, readout title, body) with NO action row at all (operator round 2,
// 2026-08-29: the card explains the state — «karttan zaten durumu anlarız»; the ONE Sürdür lives
// in its normal home beside it, locked while the limit holds, active once the clock passes and
// this card is GONE — one button, never two). The card renders ONLY while the stamp is future —
// the parent gates the crossing (core's limitCrossing); the body names the window (through the
// label bundle — a raw kind string never reaches JSX, ADR-0007) and its reset clock (day-aware:
// a seven-day window outlives today). The provider windows only — no $ figures, no cap copy
// (the budget card owns those, WO-0047).
import { Hourglass } from 'lucide-react';
import { useLabels } from '../../data/locale';

export function LimitCard({ resetAt, windowKind }: { resetAt: string; windowKind?: string }) {
  const { UI } = useLabels();
  return (
    <div data-limit-card="" className="flex items-stretch overflow-hidden rounded-md border border-signal/40 bg-surface shadow-sm">
      <div className="lamp lamp-signal-breathe" />
      <div className="min-w-0 w-full px-3.5 py-3">
        <p className="readout flex items-center gap-1.5 text-signal">
          <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
          {UI.limitCardTitle}
        </p>
        <p className="mt-1.5 text-sm text-ink">{UI.limitCardBody(UI.limitWindowLabel(windowKind ?? ''), UI.limitClock(resetAt))}</p>
        {/* The S4 honesty line (token tour): a Sürdür re-reads the context server-side — no silent surprise. */}
        <p className="mt-1 text-xs text-inkdim">{UI.limitResumeNote}</p>
      </div>
    </div>
  );
}
