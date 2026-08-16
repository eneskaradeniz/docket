// DetailStrip (WO-0031c / v4) — the console's top row: ‹ back · WO badge + stage · the phase readout ·
// right-aligned metrics (Maliyet, Süre — hidden at the narrowest sizes) · the GLOBAL SADE|DETAY
// segment · the quiet delete icon. The work-order title rides underneath. This replaces Faz B's
// DetailHeader; cost/duration/status that lived in per-pane headers now live here, once.
import { ChevronLeft, Trash2 } from 'lucide-react';
import type { WoPhase } from '../../../core/derive';
import type { WorkOrderDetailView } from '../../../core/types';
import { Badge, Button, Segmented } from '../../kit';
import { cn } from '../../kit';
import { formatUsd, phaseLabelText, STAGE_LABELS, UI, woIdLabel } from '../../data/labels';
import type { ViewMode } from '../../data/view-mode';
import type { LampTone } from '../session/pane-chrome';
import { lampClass } from '../session/pane-chrome';

// phase → lamp tone (carried over from Faz B's DetailHeader — the readout dot tells the truth).
const PHASE_KIND_TONE: Record<WoPhase['kind'], LampTone> = {
  just_written: 'idle',
  planning: 'run',
  plan_ready: 'signal',
  implementing: 'run',
  reviewing: 'run',
  closing: 'signal',
  done: 'done',
};

export function DetailStrip({
  detail,
  phase,
  duration,
  viewMode,
  onViewModeChange,
  onBack,
  onDelete,
}: {
  detail: WorkOrderDetailView;
  phase: WoPhase;
  duration?: string;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const tone = PHASE_KIND_TONE[phase.kind];
  const anyCost = detail.sessions.some((s) => s.cost);
  const breathe = tone === 'signal';
  // The juice hairline (v4 §7): fills with done/total steps — a quiet progress read under the strip.
  const stepsTotal = detail.steps.length;
  const stepsDone = detail.steps.filter((s) => s.status === 'done').length;

  return (
    <header className="flex flex-col gap-1.5 pb-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={UI.backToBoard}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-inkdim transition-colors hover:bg-raised hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="shrink-0 font-mono text-[12px] text-inkdim">{woIdLabel(detail.id)}</span>
        <Badge>{STAGE_LABELS[detail.stage]}</Badge>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', lampClass(tone, breathe))}
            aria-hidden="true"
          />
          <span className="truncate text-[12px] text-inkdim">{phaseLabelText(phase)}</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          {anyCost ? (
            <span className="hidden whitespace-nowrap font-mono text-[11px] text-inkdim min-[520px]:inline">
              {UI.stripCost} {formatUsd(detail.cost.usd)}
            </span>
          ) : null}
          {duration ? (
            <span className="hidden whitespace-nowrap font-mono text-[11px] text-inkdim min-[820px]:inline">
              {UI.stripDuration} {duration}
            </span>
          ) : null}
          <Segmented
            size="sm"
            aria-label={UI.viewModeAria}
            value={viewMode}
            onValueChange={(v) => onViewModeChange(v as ViewMode)}
            options={[
              { value: 'sade', label: UI.viewModeSimple },
              { value: 'detail', label: UI.viewModeDetail },
            ]}
          />
          <Button variant="ghost" size="icon" aria-label={UI.deleteWo} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">{detail.title}</h1>
      {stepsTotal > 0 ? (
        <div className="hairline-progress" aria-hidden="true">
          <div style={{ width: `${Math.round((stepsDone / stepsTotal) * 100)}%` }} />
        </div>
      ) : null}
    </header>
  );
}
