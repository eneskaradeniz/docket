// UsageLimitPanel (WO-0054) — the running drive's live quota windows, the WO-0053 rule inherited:
// the provider's OWN feed only — never the usage rows, never a `limit_reset_at` stamp (that is
// LimitCard's), never a locally invented threshold. The screen resolves the ONE live fold of THIS
// workspace (the WO arm through activeSnapshot + the `${wsId}:draft` arm — a draft key never
// enters activeSnapshot, drive-store.ts:101-105) and mounts this panel only when a signal exists;
// no signal, no drive, or another workspace's drive → the section is ABSENT (AC3). Utilization is
// TEXT, no bar — the denominator is the provider's, not Docket's (karar 4); the pct is signal on
// the provider's own warning/blocked status, dim otherwise (the mockup's `.pct`/`.pct.steady`
// pair). NO breathing dot (Ruling 7 — the recorded drop; liveness is the CANLI readout + who).
// Resets through the day-aware bundle clock family (`limitClock`, Ruling 5). Mono-dim, the pane
// warn line's voice (PaneWarnline) — text, never a fill bar (ADR-0012).
import type { LimitWindow } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { cn } from '../../kit';

export function UsageLimitPanel({ windows, status, who }: {
  windows: LimitWindow[];
  status?: 'ok' | 'warning' | 'blocked';
  /** The drive's name — role word + work order (or the ✦ draft marker) through the labels. */
  who: string;
}) {
  const { UI } = useLabels();
  const pctTone = status === 'warning' || status === 'blocked' ? 'text-signal font-semibold' : 'text-inkdim';
  return (
    <div data-usage-limit="" className="rounded-md border border-hairline bg-surface px-3 py-2.5 shadow-sm">
      <div className="flex items-baseline gap-2.5">
        <p className="readout text-signal">{UI.usageLimitTitle}</p>
        <span className="ml-auto font-mono text-[11px] text-inkdim">{who}</span>
      </div>
      <div className="mt-1 flex flex-col">
        {windows.map((w) => (
          <p key={w.window} className="font-mono text-[11px] text-inkdim">
            {UI.limitWindowLabel(w.window)}
            {w.utilization !== null ? (
              <span className={cn('ml-1.5', pctTone)}>{UI.usageLimitUtilization(w.utilization)}</span>
            ) : null}
            {w.resetAt !== null ? (
              <span className="ml-1.5">— {UI.usageLimitResetLine(UI.limitClock(w.resetAt))}</span>
            ) : null}
          </p>
        ))}
      </div>
      <p className="mt-1 text-xs text-inkdim">{UI.usageLimitProviderNote}</p>
    </div>
  );
}
