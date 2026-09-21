// AppbarDriveChip (WO-0060; WO-0085 operator ruling) — the top bar's ONE glance fact: account
// health, ALWAYS present (a status LED, not an action — ADR-0001 governs actions; a readout that
// vanished when idle left the bar's right edge jumping and the glance question unanswered). Four
// compact states: ○0 idle (dim) · ●n running (green, breathing) · ▲%n warn (amber — the compact
// body carries the figure, the sentence stays in the tooltip) · ⌛countdown limit (red, ticking).
// Never a button, never navigation, never a second live surface (the drive's work surface is the
// detail pane; the limit's is the LimitCard). The LOCKED ladder lives in core (`appbarDriveTier` —
// red > amber > green > none); this file only speaks it. Red's 1s ticker exists ONLY while the red
// tier is visible (ADR-0012 — no standing timers; the WorkOrderDetail pattern): the crossing
// recomputes the tier; a stale App memo heals at the next rows refresh.
import { useEffect, useState } from 'react';
import { Hourglass } from 'lucide-react';
import { appbarDriveTier } from '../../core/derive';
import { useLabels } from '../data/locale';
import { cn, Tooltip } from '../kit';
import type { AppbarActivity } from './AppShell';

export function AppbarDriveChip({ activity }: { activity: AppbarActivity }) {
  const { UI } = useLabels();
  const [now, setNow] = useState(() => Date.now());
  const tier = appbarDriveTier(
    { running: activity.running > 0, limitResetAt: activity.limitResetAt, warn: activity.limitWarn !== undefined },
    now,
  );
  useEffect(() => {
    if (tier !== 'limit') return;
    setNow(Date.now()); // the memo's Date.now() may be minutes stale when red first paints
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [tier]);

  // WO-0085 review (operator: "hepsi aynı hizada değil"): the chip wears the SAME 28px control
  // height, radius and padding as every appbar control — the state speaks through TONE alone
  // (dim / green / amber / red). The tones are the kit's lamp semantics (Badge's map, inlined).
  const cls =
    'inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[11px] font-medium';
  const tones = {
    idle: 'border-hairline text-inkdim opacity-80',
    running: 'border-proceed/50 bg-proceed/10 text-proceed',
    warn: 'border-signal/50 bg-signal/10 text-signal',
    limit: 'border-error/50 bg-error/10 text-error',
  } as const;

  if (tier === 'none') {
    return (
      <Tooltip label={UI.appbarIdleTip}>
        <span data-appbar-drive="" data-tier="idle" className={cn(cls, tones.idle, 'shrink-0')}>
          <span aria-hidden="true" className="inline-block size-[5px] rounded-full border border-current opacity-70" />
          0
        </span>
      </Tooltip>
    );
  }

  // The guards under an impossible-by-contract tier read as documentation: core's appbarDriveTier
  // never says 'limit' without a stamp or 'warn' without a subject (App folds it only when present).
  if (tier === 'limit' && activity.limitResetAt !== undefined) {
    const clock = UI.limitClock(activity.limitResetAt);
    return (
      <Tooltip label={UI.usageLimitResetLine(clock)}>
        <span data-appbar-drive="" data-tier="limit" aria-label={UI.appbarLimitAria(clock)} className={cn(cls, tones.limit, 'shrink-0')}>
          <Hourglass className="h-3 w-3" aria-hidden="true" />
          {UI.limitCountdown(Date.parse(activity.limitResetAt) - now)}
        </span>
      </Tooltip>
    );
  }

  if (tier === 'warn' && activity.limitWarn !== undefined) {
    const w = activity.limitWarn;
    const tip = UI.limitWarnLine(
      UI.limitWindowLabel(w.window),
      w.utilization,
      w.resetAt !== null ? UI.limitClock(w.resetAt) : null,
    );
    return (
      <Tooltip label={tip}>
        <span data-appbar-drive="" data-tier="warn" aria-label={tip} className={cn(cls, tones.warn, 'shrink-0')}>
          <span aria-hidden="true">▲</span>
          {w.utilization}%
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={UI.appbarRunningTip(activity.running)}>
      <span data-appbar-drive="" data-tier="running" className={cn(cls, tones.running, 'shrink-0')}>
        <span className="dot-run" aria-hidden="true" />
        {activity.running}
      </span>
    </Tooltip>
  );
}
