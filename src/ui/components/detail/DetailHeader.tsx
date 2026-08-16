// DetailHeader — the detail's title block (WO-0031b): back · id+stage Badge · title · the merged
// instrument readout (meta + phase in ONE line, lamp toned by phase — kills the old always-blue dot,
// audit H6). Delete lives here as a quiet icon; its confirmation stays in WorkOrderDetail's body.
import { ChevronLeft, Trash2 } from 'lucide-react';
import type { WoPhase } from '../../../core/derive';
import type { WorkOrderDetailView } from '../../../core/types';
import { Badge } from '../../kit';
import { formatCost, phaseLabelText, ROLE_LABELS, STAGE_LABELS, UI, woIdLabel } from '../../data/labels';
import { cn } from '../../kit';
import type { LampTone } from '../session/pane-chrome';
import { lampClass } from '../session/pane-chrome';

// phase → lamp tone: the readout dot tells the truth the old banner didn't (H6).
// WoPhase is a discriminated union — tone keys on `kind`.
const PHASE_KIND_TONE: Record<WoPhase['kind'], LampTone> = {
  just_written: 'idle',
  planning: 'run',
  plan_ready: 'signal',
  implementing: 'run',
  reviewing: 'run',
  closing: 'signal',
  done: 'done',
};

export function DetailHeader({
  detail,
  phase,
  activeRole,
  duration,
  onBack,
  onDelete,
}: {
  detail: WorkOrderDetailView;
  phase: WoPhase;
  activeRole?: WorkOrderDetailView['sessions'][number]['role'];
  duration?: string;
  onBack: () => void;
  onDelete: () => void;
}) {
  const stepsTotal = detail.steps.length;
  const stepsDone = detail.steps.filter((s) => s.status === 'done').length;
  const anyCost = detail.sessions.some((s) => s.cost);
  const tone = PHASE_KIND_TONE[phase.kind];

  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex shrink-0 items-center gap-1 rounded text-[12px] text-inkdim transition-colors hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {UI.backToBoard}
        </button>
        <div className="flex min-w-0 items-center gap-3">
          {anyCost || duration ? (
            <span className="truncate font-mono text-[11px] text-inkdim">
              {anyCost ? formatCost(detail.cost) : null}
              {anyCost && duration ? ' · ' : ''}
              {duration ? `⏱ ${duration}` : null}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            aria-label={UI.deleteWo}
            className="shrink-0 rounded-md p-1.5 text-inkdim transition-colors hover:bg-raised hover:text-ink"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] text-inkdim">{woIdLabel(detail.id)}</span>
        <Badge>{STAGE_LABELS[detail.stage]}</Badge>
        {activeRole ? (
          <span className="text-[11px] text-inkdim">{ROLE_LABELS[activeRole]}</span>
        ) : null}
      </div>
      <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">{detail.title}</h1>

      <p className="readout flex items-center gap-2">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', lampClass(tone, tone === 'signal'))} aria-hidden="true" />
        {phaseLabelText(phase)}
        {stepsTotal > 0 ? (
          <span className="text-inkdim/70">
            {UI.metaSep}
            {stepsDone}/{stepsTotal} {UI.stepsUnit}
          </span>
        ) : null}
      </p>
    </header>
  );
}
