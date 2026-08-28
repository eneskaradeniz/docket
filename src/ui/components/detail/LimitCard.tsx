// LimitCard (WO-0053) — the usage-limit stop's ONE-ACTION resolution, the BudgetRefusalCard's
// sibling grammar (lamp-edged card, readout title, body, right-aligned action row) with the
// refusal's two choices reduced to ONE: there is nothing to decide — the window either has not
// opened (the Sürdür is ABSENT with the clock as its standing reason line, ADR-0001) or it has
// (exactly one primary «Sürdür», ⏎'s target — the fail card's retry precedent, regularized by
// ADR-0013's WO-0053 addendum). The card speaks PROVIDER windows only — no $ figures, no cap
// copy (the budget card owns those, WO-0047); the body names the window (through the label
// bundle — a raw kind string never reaches JSX, ADR-0007) and its reset clock (day-aware: a
// seven-day window outlives today). The stamp came from the adapter's neutralization (the
// ISO epoch→string conversion is the adapter's job, not the UI's); the crossing is core's pure
// `limitCrossing` with the caller's `now` — the card, its tests and the e2e share one truth,
// never a wall-clock wait.
import { Hourglass } from 'lucide-react';
import { limitCrossing } from '../../../core/runner';
import { useLabels } from '../../data/locale';
import { Button } from '../../kit';
import { EnterMark } from '../EnterMark';

export function LimitCard({
  resetAt,
  windowKind,
  now,
  onResume,
}: {
  resetAt: string;
  /** The provider's window kind string (`five_hour`…) — DATA; display maps through the bundle. */
  windowKind?: string;
  /** The caller's clock (the pane/console ticker) — the crossing re-renders when it ticks. */
  now: number;
  /** The one action: re-drive the same leg from the persisted row (the retry channel). */
  onResume: () => void;
}) {
  const { UI } = useLabels();
  const time = UI.limitClock(resetAt);
  const ready = limitCrossing(resetAt, now) === 'ready';
  return (
    <div data-limit-card="" className="flex items-stretch overflow-hidden rounded-md border border-signal/40 bg-surface shadow-sm">
      <div className="lamp lamp-signal-breathe" />
      <div className="min-w-0 w-full px-3.5 py-3">
        <p className="readout flex items-center gap-1.5 text-signal">
          <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
          {UI.limitCardTitle}
        </p>
        <p className="mt-1.5 text-sm text-ink">{UI.limitCardBody(UI.limitWindowLabel(windowKind ?? ''), time)}</p>
        {/* The S4 honesty line (token tour): a Sürdür re-reads the context server-side — no silent surprise. */}
        <p className="mt-1 text-xs text-inkdim">{UI.limitResumeNote}</p>
        <div className="mt-2.5 flex flex-wrap justify-end gap-2">
          {ready ? (
            <Button variant="primary" size="sm" data-limit-resume="" onClick={onResume}>
              {UI.driveResume}
              <EnterMark />
            </Button>
          ) : (
            <span className="text-xs text-inkdim">{UI.limitWaitReason(time)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
