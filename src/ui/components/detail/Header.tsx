import type { StageId, WorkOrderDetailView } from '../../../core/types';
import { modeText, STAGE_LABELS, UI } from '../../data/labels';
import { Badge } from '../primitives/Badge';
import { CostView } from './CostView';

export function Header({
  detail,
  workspaceLabel,
  stageLabel,
  onBack,
}: {
  detail: WorkOrderDetailView;
  workspaceLabel: string;
  stageLabel?: StageId;
  onBack: () => void;
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div>
        <button type="button" onClick={onBack} className="text-xs text-slate-500 hover:text-slate-800">
          {UI.backToBoard}
        </button>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">{detail.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge>{detail.id}</Badge>
          <Badge tone="info">{workspaceLabel}</Badge>
          <Badge tone="neutral">{modeText(detail.mode)}</Badge>
          <Badge tone="neutral">{stageLabel ? STAGE_LABELS[stageLabel] : '—'}</Badge>
        </div>
      </div>
      <CostView cost={detail.cost} />
    </header>
  );
}
