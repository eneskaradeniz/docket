import { useState } from 'react';
import type { StepRole, StepView, WorkOrderDetailView } from '../../../core/types';
import { EVIDENCE_LABELS, EVIDENCE_MARK, ROLE_LABELS, STAGE_LABELS, UI, formatUsd } from '../../data/labels';
import { ActionCard } from './ActionCard';
import { SessionPane } from '../session/SessionPane';
import { StepPane } from '../session/StepPane';
import { EvidencePanel } from './EvidencePanel';
import { MarkdownDoc } from './MarkdownDoc';
import { SourceLinks } from './SourceLinks';
import { StageRail } from './StageRail';
import { StepList } from './StepList';
import { StepReport } from './StepReport';
import { TrackLane } from './TrackLane';

// Session-centric detail (WO-0013). The session log is the spine; the action card surfaces the one
// thing that matters up top (read-only); stages/evidence/tracks/sources/docs are demoted behind a
// "Akışı göster" expander. Evidence keeps its three values (satisfied/unsatisfied/exempt).
export function WorkOrderDetail({
  detail,
  docs,
  onBack,
  onApprovePlan,
  onGetStepReport,
  reloadDetail,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  onBack: () => void;
  onApprovePlan: (planText: string) => Promise<void>;
  onGetStepReport: (idx: number, role: StepRole) => Promise<string>;
  reloadDetail: () => void;
}) {
  // The step currently shown in the StepPane. Default to an 'active' (interrupted) step so the operator can
  // resume after a restart; otherwise undefined until the operator clicks Çalıştır on a step.
  const [runIdx, setRunIdx] = useState<number | undefined>(() => detail.steps.find((s) => s.status === 'active')?.idx);
  const [reportStep, setReportStep] = useState<StepView | undefined>(undefined);

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

  // At written/architect_approval the plan flow owns the session pane (architect proposes, operator approves).
  // Once approved (implementation+): if the plan has steps, the step list + step pane own the session region;
  // otherwise fall back to the free-form session pane + a "no runnable steps" hint (honest degradation).
  const planStage = detail.stage === 'written' || detail.stage === 'architect_approval';
  const hasSteps = detail.steps.length > 0;
  const activeStep = runIdx !== undefined ? detail.steps.find((s) => s.idx === runIdx) : undefined;

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

      {planStage ? (
        <SessionPane
          mode={detail.mode}
          stage={detail.stage}
          workOrderId={detail.id}
          sessions={detail.sessions}
          onApprovePlan={onApprovePlan}
        />
      ) : hasSteps ? (
        <>
          <StepList steps={detail.steps} onRunStep={setRunIdx} onOpenReport={setReportStep} />
          {activeStep ? (
            <StepPane step={activeStep} workOrderId={detail.id} sessions={detail.sessions} onDone={reloadDetail} />
          ) : null}
          {reportStep ? (
            <StepReport
              step={reportStep}
              loadReport={() => onGetStepReport(reportStep.idx, reportStep.role)}
              onClose={() => setReportStep(undefined)}
            />
          ) : null}
        </>
      ) : (
        <>
          <SessionPane
            mode={detail.mode}
            stage={detail.stage}
            workOrderId={detail.id}
            sessions={detail.sessions}
            onApprovePlan={onApprovePlan}
          />
          {docs.plan ? <p className="text-xs text-clay">{UI.noSteps}</p> : null}
        </>
      )}

      {/* Approved plan (WO-0016) — promoted above the expander once plan.md exists. The structured step list
          (status/role/aim/scope) renders above when the plan has a ```steps fence (WO-0017). */}
      {docs.plan ? <MarkdownDoc title={UI.planDoc} content={docs.plan} /> : null}

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
