import { useEffect, useState } from 'react';
import type { StepRole, StepView, WoEvent, WorkOrderDetailView } from '../../../core/types';
import { derivePhase } from '../../../core/derive';
import { UI } from '../../data/labels';
import { Button, Input } from '../../kit';
import { ActionCard } from './ActionCard';
import { ContextRail } from './ContextRail';
import { DetailHeader } from './DetailHeader';
import { SessionPane } from '../session/SessionPane';
import { StepPane } from '../session/StepPane';
import { ReviewPane } from '../session/ReviewPane';
import { StepReport } from './StepReport';
import { VerdictCard } from './VerdictCard';

// Session-centric detail, Kontrol Konsolu layout (WO-0031b): the merged DetailHeader readout, the
// action/decision card, the session instrument as the primary column, and the ContextRail (steps,
// evidence, tracks, timeline, docs, sources) beside it — the old "Akışı göster" expander and the
// dead StageRail are gone (audit P2-6). All drive/verdict/close logic is unchanged from WO-0020..0030.
export function WorkOrderDetail({
  detail,
  docs,
  events,
  onBack,
  onApprovePlan,
  onGetStepReport,
  onGetStepVerdict,
  onResetStep,
  onCloseWorkOrder,
  onOverrideVerdict,
  reloadDetail,
  onDelete,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  events: WoEvent[];
  onBack: () => void;
  onApprovePlan: (planText: string) => Promise<void>;
  onGetStepReport: (idx: number, role: StepRole) => Promise<string>;
  onGetStepVerdict: (idx: number) => Promise<string>;
  onResetStep: (idx: number) => Promise<void>;
  onCloseWorkOrder: (note: string) => Promise<void>;
  onOverrideVerdict: (idx: number) => Promise<void>;
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
  const [closing, setClosing] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [closeError, setCloseError] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const handleClose = async (): Promise<void> => {
    setClosing(true);
    setCloseError(false);
    try {
      await onCloseWorkOrder(closeNote.trim() || detail.title);
    } catch {
      setCloseError(true);
    } finally {
      setClosing(false);
    }
  };
  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  const activeRole = detail.sessions.find((s) => s.status === 'running' || s.status === 'stopped_asking')?.role;
  // WO-0027 / Bulgu 2 + İstek 7: cost is claimed only when some session actually carries one (a NULL-cost
  // plan row is "unknown", not $0.00); the summed wall-clock rides the header readout.
  const durationMs = detail.sessions.reduce((acc, s) => {
    if (!s.startedAt || !s.endedAt) return acc;
    return acc + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime());
  }, 0);
  const durationText = durationMs > 0 ? UI.formatDuration(durationMs) : undefined;

  // At written/architect_approval the plan flow owns the session pane (architect proposes, operator approves).
  // Once approved (implementation+): if the plan has steps, the step list + step pane own the session region;
  // otherwise fall back to the free-form session pane + a "no runnable steps" hint (honest degradation).
  const planStage = detail.stage === 'written' || detail.stage === 'architect_approval';
  const hasSteps = detail.steps.length > 0;
  const allStepsDone = hasSteps && detail.steps.every((s) => s.status === 'done');
  // WO-0029 / B19: a revise verdict is an OPEN decision — on mount (the live flow may have come and gone)
  // it must still be surfaced: override (Devam et) or re-run. Closing is blocked until resolved.
  const unresolvedRevise = detail.steps.find((s) => s.verdict === 'revise' && s.status === 'done');
  const activeStep = runIdx !== undefined ? detail.steps.find((s) => s.idx === runIdx) : undefined;

  const phase = derivePhase(detail, detail.steps, !!docs.plan);

  // The primary column: the action/decision card + the session instrument (and the no-steps hint).
  const sessionColumn = (
    <div className="flex min-w-0 flex-col gap-4">
      {detail.stage === 'closed' ? (
        <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface">
          <div className="lamp lamp-done" />
          <div className="flex-1 px-3.5 py-3">
            <p className="readout text-proceed">{UI.closeWoDoneTitle}</p>
            <p className="mt-1 font-mono text-[11px] text-inkdim">{detail.gateInputs.closureDocsSha}</p>
          </div>
        </div>
      ) : unresolvedRevise && allStepsDone ? (
        <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface">
          <div className="lamp lamp-signal" />
          <div className="flex-1 px-3.5 py-3">
            <p className="readout text-signal">{UI.verdictCardReviseTitle}</p>
            <p className="mt-1 text-[12px] text-inkdim">
              {UI.overrideVerdictHint} — <span className="font-mono">adım {unresolvedRevise.idx}</span>
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => void onResetStep(unresolvedRevise.idx)}>{UI.rerunStep}</Button>
              <Button variant="primary" size="sm" onClick={() => void onOverrideVerdict(unresolvedRevise.idx).then(reloadDetail)}>{UI.overrideVerdictBtn}</Button>
            </div>
          </div>
        </div>
      ) : allStepsDone ? (
        <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface">
          <div className="lamp lamp-done" />
          <div className="flex-1 px-3.5 py-3">
            <p className="readout text-proceed">{UI.stepsAllDone}</p>
            <p className="mt-1 text-[12px] text-inkdim">{UI.stepsAllDoneHint}</p>
            {confirmClose ? (
              <div className="mt-2">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.closeNoteLabel}</label>
                <Input
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  placeholder={UI.closeNotePlaceholder}
                  className="mb-2"
                />
                <p className="mb-2 text-[12px] text-inkdim">{UI.closeWoHint}</p>
                {closeError ? <p className="mb-2 text-xs text-error">{UI.closeWoFailed}</p> : null}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)}>{UI.cancel}</Button>
                  <Button variant="primary" size="sm" busy={closing} onClick={() => void handleClose()}>{UI.closeWoConfirm}</Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => setConfirmClose(true)}>
                {UI.closeWo}
              </Button>
            )}
          </div>
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
          {reviewIdx !== undefined ? (
            <ReviewPane
              step={detail.steps.find((s) => s.idx === reviewIdx)!}
              workOrderId={detail.id}
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
            <StepPane step={activeStep} workOrderId={detail.id} sessions={detail.sessions} />
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
          {docs.plan ? <p className="text-xs text-error">{UI.noSteps}</p> : null}
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <DetailHeader
        detail={detail}
        phase={phase}
        activeRole={activeRole}
        duration={durationText}
        onBack={onBack}
        onDelete={() => setConfirmDelete(true)}
      />

      {confirmDelete ? (
        <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface">
          <div className="lamp lamp-error" />
          <div className="flex-1 px-3.5 py-3">
            <p className="readout text-error">{UI.deleteWo}</p>
            <p className="mb-2 mt-1 text-[12px] text-inkdim">{UI.deleteWoHint}</p>
            {deleting ? (
              <p className="text-right text-xs text-error">{UI.deleteWoInFlight}</p>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>{UI.cancel}</Button>
                <Button variant="danger" size="sm" onClick={() => void handleDelete()}>{UI.deleteWoConfirm}</Button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-x-6 gap-y-5 min-[1120px]:grid-cols-[minmax(0,1fr)_320px]">
        {sessionColumn}
        <ContextRail detail={detail} steps={detail.steps} events={events} docs={docs} onOpenReport={setReportStep} />
      </div>
    </div>
  );
}
