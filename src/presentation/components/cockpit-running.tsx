// components/cockpit-running.tsx — Koşanlar (U-21): one calm line per run — the account's
// monogram, the work-order code, the title (A-35) over the stage and its progress strip, the
// account name and the live duration. A queued row (A-36) is dashed and dimmed, says why it waits
// (A-37) and shows how long instead of a running spinner.
import type { CockpitView } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import { isQueued, stageStrip } from '../stores/cockpit';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { formatAge, formatInstant } from './cockpit-format';

export interface CockpitRunningRowProps {
  readonly run: CockpitView['running'][number];
  readonly locale: Locale;
  readonly accountLabel: string;
  readonly sinceMs: number;
  readonly onOpen: () => void;
}

function StageStrip({ index, count }: { readonly index: number; readonly count: number }) {
  return (
    <span aria-hidden="true" title={`${index}/${count}`} className="ml-2 inline-flex items-center gap-[3px] align-middle">
      {Array.from({ length: count }, (_, at) => (
        <i
          key={at}
          className={`h-[3px] w-3.5 rounded-full ${at + 1 < index ? 'bg-proceed' : at + 1 === index ? 'bg-signal' : 'bg-hairline'}`}
        />
      ))}
    </span>
  );
}

const queuedNote = (run: CockpitView['running'][number], locale: Locale): string => {
  if (run.queuedReason !== 'limit') return t(locale, 'cockpit.queued.queue');
  const at = run.limitResetsAt;
  return at === null || at === undefined
    ? t(locale, 'cockpit.queued.limit')
    : `${t(locale, 'cockpit.queued.limitAt')} ${formatInstant(locale, at)}`;
};

export function CockpitRunningRow({ run, locale, accountLabel, sinceMs, onOpen }: CockpitRunningRowProps) {
  const queued = isQueued(run);
  const strip = queued ? null : stageStrip(run);
  const title = run.title !== undefined && run.title !== '' ? run.title : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-card border px-3 text-left transition-colors hover:border-bord ${
        title !== null ? 'min-h-12' : 'min-h-9'
      } ${queued ? 'border-dashed border-hairline bg-transparent opacity-60' : 'border-hairline bg-surface'}`}
    >
      <span
        aria-hidden="true"
        className="grid h-[22px] w-[22px] place-items-center rounded-control border border-hairline bg-raised font-mono text-[11px] text-inkdim"
      >
        {accountLabel.slice(0, 1).toUpperCase()}
      </span>
      <span className="font-mono text-[11.5px] text-inkdim">{formatWorkOrderCode(run.number, locale)}</span>
      <span className="grid min-w-0">
        {title !== null ? (
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-ink" title={title}>
            {title}
          </span>
        ) : null}
        <span
          className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${title !== null ? 'text-[11.5px] text-inkdim' : 'text-[13px] font-semibold text-ink'}`}
          title={run.stage}
        >
          {run.stage}
          {queued ? ` · ${queuedNote(run, locale)}` : null}
          {strip !== null ? <StageStrip index={strip.index} count={strip.count} /> : null}
        </span>
      </span>
      <span className="whitespace-nowrap text-[12px] text-inkdim">{accountLabel}</span>
      <span className="whitespace-nowrap font-mono text-[11.5px] text-inkdim">{formatAge(locale, sinceMs)}</span>
      <span
        aria-hidden="true"
        className={`h-[11px] w-[11px] rounded-full border-[1.5px] border-inkdim ${queued ? 'border-dotted' : 'border-t-transparent motion-safe:animate-spin'}`}
      />
    </button>
  );
}
