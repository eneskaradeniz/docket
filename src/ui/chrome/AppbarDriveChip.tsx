// AppbarDriveChip (WO-0060) — the top bar's ONE glance fact: account health. A PASSIVE indicator —
// never a button, never navigation, never a second live surface (the drive's work surface is the
// detail pane; the limit's is the LimitCard). Idle renders NOTHING (ADR-0001 — absent, not dim).
// The LOCKED ladder lives in core (`appbarDriveTier` — red > amber > green > none); this file only
// speaks it: green = the drive count, amber = the provider's own warning (figure-free body — the
// tooltip carries window + % + clock, the pane warnline's own sentence so the account has ONE amber
// voice), red = the countdown with the absolute clock on hover. Red's 1s ticker exists ONLY while
// the red tier is visible (ADR-0012 — no standing timers; the WorkOrderDetail pattern): the
// crossing recomputes the tier, the chip unmounts itself, and the stale App memo heals at the next
// rows refresh.
import { useEffect, useState } from 'react';
import { Hourglass } from 'lucide-react';
import { appbarDriveTier } from '../../core/derive';
import { useLabels } from '../data/locale';
import { Badge, Tooltip } from '../kit';
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

  if (tier === 'none') return null;

  // The guards under an impossible-by-contract tier read as documentation: core's appbarDriveTier
  // never says 'limit' without a stamp or 'warn' without a subject (App folds it only when present).
  if (tier === 'limit' && activity.limitResetAt !== undefined) {
    const clock = UI.limitClock(activity.limitResetAt);
    return (
      <Tooltip label={UI.usageLimitResetLine(clock)}>
        <span data-appbar-drive="" data-tier="limit" aria-label={UI.appbarLimitAria(clock)} className="shrink-0">
          <Badge tone="error" caps={false} className="gap-1">
            <Hourglass className="h-3 w-3" aria-hidden="true" />
            {UI.limitCountdown(Date.parse(activity.limitResetAt) - now)}
          </Badge>
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
        <span data-appbar-drive="" data-tier="warn" aria-label={tip} className="shrink-0">
          <Badge tone="signal" caps={false}>
            {UI.appbarLimitWarn}
          </Badge>
        </span>
      </Tooltip>
    );
  }

  return (
    <span data-appbar-drive="" data-tier="running" className="shrink-0">
      <Badge tone="proceed" caps={false} className="gap-1">
        <span className="dot-run" aria-hidden="true" />
        {UI.appbarRunningCount(activity.running)}
      </Badge>
    </span>
  );
}
