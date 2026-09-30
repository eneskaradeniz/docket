// components/cockpit-running.tsx — Koşanlar (U-21): one calm line per run — the account's
// monogram, the work-order code, the stage, the account name and the live duration.
import type { CockpitView } from '../../api/queries';
import type { Locale } from '../labels/t';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { formatAge } from './cockpit-format';

export interface CockpitRunningRowProps {
  readonly run: CockpitView['running'][number];
  readonly locale: Locale;
  readonly accountLabel: string;
  readonly sinceMs: number;
  readonly onOpen: () => void;
}

export function CockpitRunningRow({ run, locale, accountLabel, sinceMs, onOpen }: CockpitRunningRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid min-h-9 w-full grid-cols-[auto_auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-card border border-hairline bg-surface px-3 text-left transition-colors hover:border-bord"
    >
      <span
        aria-hidden="true"
        className="grid h-[22px] w-[22px] place-items-center rounded-control border border-hairline bg-raised font-mono text-[11px] text-inkdim"
      >
        {accountLabel.slice(0, 1).toUpperCase()}
      </span>
      <span className="font-mono text-[11.5px] text-inkdim">{formatWorkOrderCode(run.number, locale)}</span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-ink" title={run.stage}>
        {run.stage}
      </span>
      <span className="whitespace-nowrap text-[12px] text-inkdim">{accountLabel}</span>
      <span className="whitespace-nowrap font-mono text-[11.5px] text-inkdim">{formatAge(locale, sinceMs)}</span>
      <span aria-hidden="true" className="h-[11px] w-[11px] rounded-full border-[1.5px] border-inkdim border-t-transparent motion-safe:animate-spin" />
    </button>
  );
}
