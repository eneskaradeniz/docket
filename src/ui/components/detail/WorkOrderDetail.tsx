import type { StageId, WorkOrderDetailView } from '../../../core/types';
import { UI } from '../../data/labels';
import { SessionPane } from '../session/SessionPane';
import { EvidencePanel } from './EvidencePanel';
import { Header } from './Header';
import { MarkdownDoc } from './MarkdownDoc';
import { PrimaryActionBar } from './PrimaryActionBar';
import { SourceLinks } from './SourceLinks';
import { StageRail } from './StageRail';
import { TrackLane } from './TrackLane';

export function WorkOrderDetail({
  detail,
  docs,
  workspaceLabel,
  onBack,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  workspaceLabel: string;
  onBack: () => void;
}) {
  const step = detail.rail.find((s) => s.status === 'current' || s.status === 'locked');
  const stageLabel: StageId | undefined = step?.stage;

  return (
    <div className="flex flex-col gap-4">
      <Header detail={detail} workspaceLabel={workspaceLabel} stageLabel={stageLabel} onBack={onBack} />
      <StageRail steps={detail.rail} />
      <PrimaryActionBar action={detail.primaryAction} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-1">
          {/* Evidence panel is always visible — the product's most valuable surface (ADR-0005). */}
          <EvidencePanel items={detail.evidence} />
        </div>
        <div className="flex flex-col gap-4 md:col-span-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">{UI.tracks}</h2>
            <ul className="flex flex-col gap-2">
              {detail.tracks.map((ln) => (
                <TrackLane key={ln.track.id as string} lane={ln} />
              ))}
            </ul>
          </section>
          <SessionPane mode={detail.mode} workOrderId={detail.id} sessions={detail.sessions} />
          <SourceLinks sources={detail.sources} />
          {/* Owned documents render inline read-only (ccd463e); referenced docs are links above. */}
          <MarkdownDoc title={UI.orderDoc} content={docs.order} />
          <MarkdownDoc title={UI.planDoc} content={docs.plan} />
        </div>
      </div>
    </div>
  );
}
