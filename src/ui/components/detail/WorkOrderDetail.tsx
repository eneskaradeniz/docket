import type { WorkOrderDetailView } from '../../../core/types';
import { EVIDENCE_LABELS, EVIDENCE_MARK, ROLE_LABELS, STAGE_LABELS, UI, formatUsd } from '../../data/labels';
import { ActionCard } from './ActionCard';
import { SessionPane } from '../session/SessionPane';
import { EvidencePanel } from './EvidencePanel';
import { MarkdownDoc } from './MarkdownDoc';
import { SourceLinks } from './SourceLinks';
import { StageRail } from './StageRail';
import { TrackLane } from './TrackLane';

// Session-centric detail (WO-0013). The session log is the spine; the action card surfaces the one
// thing that matters up top (read-only); stages/evidence/tracks/sources/docs are demoted behind a
// "Akışı göster" expander. Evidence keeps its three values (satisfied/unsatisfied/exempt).
export function WorkOrderDetail({
  detail,
  docs,
  onBack,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  onBack: () => void;
}) {
  const activeRole = detail.sessions.find((s) => s.status === 'running' || s.status === 'stopped_asking')?.role;
  const stageStep = detail.rail.find((s) => s.status === 'current' || s.status === 'locked');
  const meta = [
    detail.id,
    activeRole ? ROLE_LABELS[activeRole] : null,
    stageStep ? STAGE_LABELS[stageStep.stage] : null,
    formatUsd(detail.cost.usd),
  ]
    .filter(Boolean)
    .join(UI.metaSep);

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-[12px] text-inkdim hover:text-ink"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M15 18l-6-6l6-6z" />
        </svg>
        {UI.backToBoard}
      </button>

      <div>
        <p className="text-[12px] text-inkdim">{meta}</p>
        <h1 className="mt-0.5 text-[20px] font-semibold tracking-tight text-ink">{detail.title}</h1>
      </div>

      <ActionCard detail={detail} />

      <SessionPane mode={detail.mode} workOrderId={detail.id} sessions={detail.sessions} />

      {/* evidence prose — three-valued (the mock's boolean is not adopted) */}
      <p className="text-[12px] text-inkdim">
        {UI.evidence}:&nbsp;&nbsp;
        {detail.evidence.map((e, i) => (
          <span key={i} className="font-mono">
            {i > 0 ? '   ' : null}
            {EVIDENCE_LABELS[e.kind]}
            {e.scope ? ` (${e.scope})` : ''}{' '}
            <span className={e.status === 'satisfied' ? 'evx' : e.status === 'exempt' ? 'evexempt' : 'evblank'}>
              {EVIDENCE_MARK[e.status]}
            </span>
          </span>
        ))}
      </p>

      <details className="border-t border-rule pt-4">
        <summary className="text-[12px] text-inkdim hover:text-ink">
          ▾ {UI.showPipeline} · {UI.pipelineHint}
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <StageRail steps={detail.rail} />
          <EvidencePanel items={detail.evidence} />
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.tracks}</h2>
            <ul className="flex flex-col gap-2">
              {detail.tracks.map((ln) => (
                <TrackLane key={ln.track.id as string} lane={ln} />
              ))}
            </ul>
          </section>
          <SourceLinks sources={detail.sources} />
          <MarkdownDoc title={UI.orderDoc} content={docs.order} />
          <MarkdownDoc title={UI.planDoc} content={docs.plan} />
        </div>
      </details>
    </div>
  );
}
