import { useEffect, useState } from 'react';
import type { StepRole, StepView, WorkOrderDetailView } from '../../../core/types';
import { derivePhase } from '../../../core/derive';
import { EVIDENCE_LABELS, EVIDENCE_MARK, ROLE_LABELS, STAGE_LABELS, UI, formatCost, phaseLabelText } from '../../data/labels';
import { ActionCard } from './ActionCard';
import { SessionPane } from '../session/SessionPane';
import { StepPane } from '../session/StepPane';
import { ReviewPane } from '../session/ReviewPane';
import { EvidencePanel } from './EvidencePanel';
import { MarkdownDoc } from './MarkdownDoc';
import { SourceLinks } from './SourceLinks';
import { StageRail } from './StageRail';
import { StepList } from './StepList';
import { StepReport } from './StepReport';
import { VerdictCard } from './VerdictCard';
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
  onGetStepVerdict,
  onResetStep,
  reloadDetail,
  onDelete,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  onBack: () => void;
  onApprovePlan: (planText: string) => Promise<void>;
  onGetStepReport: (idx: number, role: StepRole) => Promise<string>;
  onGetStepVerdict: (idx: number) => Promise<string>;
  onResetStep: (idx: number) => Promise<void>;
  reloadDetail: () => void;
  onDelete: () => Promise<void>;
}) {
  // The step currently being driven. Auto-sequencing (gates cadence): on approval the first pending step runs,
  // and when it completes the next pending step runs automatically — the operator does NOT click each step
  // (review_mode gates = autonomous between steps; the operator engages at plan approval, revisions, merge).
  // An 'active' step at restart offers "Sürdür" instead; a 'done' step whose review was interrupted (no verdict
  // yet) resumes the review before any pending step runs (WO-0023 / P1-3 — restart no longer skips the review).
  const [runIdx, setRunIdx] = useState<number | undefined>(
    () =>
      detail.steps.find((s) => s.status === 'active')?.idx ??
      detail.steps.find((s) => s.status === 'done' && !s.verdict)?.idx ??
      detail.steps.find((s) => s.status === 'pending')?.idx,
  );
  const [reportStep, setReportStep] = useState<StepView | undefined>(undefined);
  const [reviewIdx, setReviewIdx] = useState<number | undefined>(undefined);
  const [verdictFor, setVerdictFor] = useState<StepView | undefined>(undefined);
  // Review-trigger (WO-0020): when the driven step becomes 'done' and has no verdict yet, hand it to the
  // architect for review — instead of auto-advancing straight to the next step.
  useEffect(() => {
    if (reviewIdx !== undefined || verdictFor || runIdx === undefined) return;
    const cur = detail.steps.find((s) => s.idx === runIdx);
    if (cur?.status === 'done' && !cur.verdict) {
      setReviewIdx(cur.idx);
      setRunIdx(undefined);
    }
  }, [detail.steps, runIdx, reviewIdx, verdictFor]);
  // Verdict-branch (WO-0020): once the reviewed step has a verdict, either auto-advance (gates + proceed) or
  // surface the verdict card (gates + revise, every-step, or unknown → revise). This is review_mode branching.
  useEffect(() => {
    if (reviewIdx === undefined || verdictFor) return;
    const cur = detail.steps.find((s) => s.idx === reviewIdx);
    if (cur?.verdict) {
      setReviewIdx(undefined);
      if (detail.reviewMode === 'gates' && cur.verdict === 'proceed') {
        setRunIdx(detail.steps.find((s) => s.status === 'pending')?.idx);
      } else {
        setVerdictFor(cur);
      }
    }
  }, [detail.steps, reviewIdx, verdictFor, detail.reviewMode]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  const activeRole = detail.sessions.find((s) => s.status === 'running' || s.status === 'stopped_asking')?.role;
  const stageStep = detail.rail.find((s) => s.status === 'current' || s.status === 'locked');
  const meta = [
    detail.id,
    activeRole ? ROLE_LABELS[activeRole] : null,
    stageStep ? STAGE_LABELS[stageStep.stage] : null,
    formatCost(detail.cost),
  ]
    .filter(Boolean)
    .join(UI.metaSep);

  // At written/architect_approval the plan flow owns the session pane (architect proposes, operator approves).
  // Once approved (implementation+): if the plan has steps, the step list + step pane own the session region;
  // otherwise fall back to the free-form session pane + a "no runnable steps" hint (honest degradation).
  const planStage = detail.stage === 'written' || detail.stage === 'architect_approval';
  const hasSteps = detail.steps.length > 0;
  const allStepsDone = hasSteps && detail.steps.every((s) => s.status === 'done');
  const activeStep = runIdx !== undefined ? detail.steps.find((s) => s.idx === runIdx) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
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
        <button type="button" onClick={() => setConfirmDelete(true)} className="text-[12px] text-clay hover:underline">
          {UI.deleteWo}
        </button>
      </div>

      {confirmDelete ? (
        <div className="flex items-stretch rounded-sm border border-rule bg-surface">
          <div className="w-1 self-stretch bg-clay" />
          <div className="flex-1 px-3.5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-clay">{UI.deleteWo}</p>
            <p className="mb-2 mt-1 text-[12px] text-inkdim">{UI.deleteWoHint}</p>
            {deleting ? (
              <p className="text-right text-xs text-clay">{UI.deleteWoInFlight}</p>
            ) : (
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmDelete(false)} className="btn-ghost rounded px-3 py-1 text-xs">{UI.cancel}</button>
                <button type="button" onClick={() => void handleDelete()} className="rounded bg-clay px-3 py-1 text-xs text-bg">{UI.deleteWoConfirm}</button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div>
        <p className="text-[12px] text-inkdim">{meta}</p>
        <h1 className="mt-0.5 text-[20px] font-semibold tracking-tight text-ink">{detail.title}</h1>
      </div>

      {/* WO-level faz göstergesi (WO-0021) — plan-driven akışın birincil yüzeyi; ray ikincil (Akışı göster). */}
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-denim pulse" />
        <span className="text-[14px] text-ink">{phaseLabelText(derivePhase(detail, detail.steps, !!docs.plan))}</span>
      </div>

      {allStepsDone ? (
        <div className="rounded-sm border border-rule bg-surface p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sage">{UI.stepsAllDone}</p>
          <p className="mt-1 text-[12px] text-inkdim">{UI.stepsAllDoneHint}</p>
        </div>
      ) : (
        <ActionCard detail={detail} />
      )}

      {planStage ? (
        <SessionPane
          mode={detail.mode}
          stage={detail.stage}
          workOrderId={detail.id}
          sessions={detail.sessions}
          onApprovePlan={onApprovePlan}
          pendingPlan={docs.plan || undefined}
        />
      ) : hasSteps ? (
        <>
          <StepList steps={detail.steps} onOpenReport={setReportStep} />
          {reviewIdx !== undefined ? (
            <ReviewPane
              step={detail.steps.find((s) => s.idx === reviewIdx)!}
              workOrderId={detail.id}
              onReviewDone={reloadDetail}
            />
          ) : verdictFor ? (
            <VerdictCard
              step={verdictFor}
              loadVerdict={() => onGetStepVerdict(verdictFor.idx)}
              onContinue={() => {
                setVerdictFor(undefined);
                setRunIdx(detail.steps.find((s) => s.status === 'pending')?.idx);
              }}
              onRevise={async () => {
                const idx = verdictFor.idx;
                await onResetStep(idx);
                setVerdictFor(undefined);
                setRunIdx(idx);
                reloadDetail();
              }}
            />
          ) : activeStep ? (
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

      {/* Approved plan — shown as a reference once PAST the plan stage. During plan approval the PlanReadyCard in
          the session pane already renders it; showing both is a duplicate. The structured step list renders
          above (WO-0017) when the plan has a ```steps fence. */}
      {docs.plan && !planStage ? <MarkdownDoc title={UI.planDoc} content={docs.plan} /> : null}

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
