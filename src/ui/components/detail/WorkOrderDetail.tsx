import { useEffect, useMemo, useState } from 'react';
import type { LiveSessionState } from '../../../core/runner';
import { initialSessionState, seedLiveState } from '../../../core/runner';
import type { StepRole, StepView, WoEvent, WorkOrderDetailView } from '../../../core/types';
import { derivePhase, deriveTurnState } from '../../../core/derive';
import { UI } from '../../data/labels';
import { Button, Input, cn } from '../../kit';
import { ActionCard } from './ActionCard';
import { ActionRail, type RailAction } from './ActionRail';
import { DetailBody } from './DetailBody';
import { buildDetailSections } from './DetailSections';
import { DetailStrip } from './DetailStrip';
import { PlanApprovalCards } from './PlanApprovalCards';
import { StepReport } from './StepReport';
import { Substrip, turnGlowClass } from './Substrip';
import { useDetailKeys } from './useDetailKeys';
import { VerdictCard } from './VerdictCard';
import type { LampTone } from '../session/pane-chrome';
import { SessionPane } from '../session/SessionPane';
import { StepPane } from '../session/StepPane';
import { ReviewPane } from '../session/ReviewPane';
import { StopAndAskCard } from '../session/StopAndAskCard';
import { useDrive, useDriveStore } from '../session/drive-store';
import { useViewMode } from '../../data/view-mode';

// The console CONTROLLER (WO-0031c / v4). Faz B's state-blind two-pane grid is gone; the screen is the
// v4 spine — Strip → Substrip → Body → Rail — and the content of every row is CONTENT-AWARE (derived
// from the phase + the live drive fold). All sequencing logic is unchanged from WO-0020..0030 (the
// runIdx/reviewIdx/verdictFor effects live verbatim below); what moved is chrome: cost/duration/status
// to the strip (ONE ticker), stop/resume/plan-approval actions to the rail (the panes' dead
// `onClick={stop}` is deleted with them), ask cards pinned above the instrument, and SADE/DETAY is the
// global view mode.
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
  // An 'active' step at restart offers "Sürdür" (the rail) instead; a 'done' step whose review was interrupted
  // (no verdict yet) resumes the review before any pending step runs (WO-0023 / P1-3).
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
  // The inline layers (v4: objection is a one-line card, not a modal). Esc peels these before leaving.
  const [objectionOpen, setObjectionOpen] = useState(false);
  const [objectionText, setObjectionText] = useState('');
  const [approving, setApproving] = useState(false);
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

  // --- The controller's read-only subscription to the ACTIVE drive (the panes subscribe too; drives are
  //     only ever started by the panes' auto-drive effects or the rail's actions below). The seed mirrors
  //     the panes' seeding (F14) so a remount after restart re-seeds the fold — now including persisted
  //     unanswered asks (WO-0027 / Bulgu 9), so a restart re-surfaces the ask cards.
  const store = useDriveStore();
  const driveKey =
    reviewIdx !== undefined
      ? `${detail.id}:review:${reviewIdx}`
      : runIdx !== undefined
        ? `${detail.id}:step:${runIdx}`
        : `${detail.id}:free`;
  const seedState = useMemo<LiveSessionState>(() => {
    const found =
      reviewIdx !== undefined
        ? undefined
        : !planStage && hasSteps && runIdx !== undefined
          ? detail.sessions.find((s) => s.stepIdx === runIdx && s.providerSessionId)
          : detail.sessions.find((s) => s.role === 'architect' && s.providerSessionId);
    const asks = found?.status === 'stopped_asking' ? (found.stopAndAsk.asks ?? []) : [];
    return reviewIdx !== undefined ? initialSessionState : seedLiveState(found ?? { transcript: [] }, asks);
  }, [reviewIdx, planStage, hasSteps, runIdx, detail.sessions]);
  const state = useDrive(store, driveKey, () => seedState);
  const running = store.get(driveKey)?.running ?? false;

  // A live plan_ready takes precedence; otherwise fall back to a plan persisted to plan.md (restart recovery,
  // WO-0020/TD-025) so the operator can still approve after the live state was lost.
  const livePlan = state.status === 'plan_ready' ? state.pendingPlan : undefined;
  const effectivePlan = livePlan ?? (planStage ? docs.plan || undefined : undefined);
  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const lastAssistant = [...state.entries].reverse().find((e) => e.speaker === 'assistant');
  const showQuestion = planStage && state.status === 'done' && !state.pendingPlan && !!lastAssistant;

  const turn = deriveTurnState({ phase, liveStatus: state.status, hasPendingAsks: state.pendingAsks.length > 0 });

  // ONE ticker for the whole console (Faz B had three, one per pane): the strip's live duration.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const liveStart = store.get(driveKey)?.startedAt;
  const persistedMs = detail.sessions.reduce((acc, s) => {
    if (!s.startedAt || !s.endedAt) return acc;
    return acc + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime());
  }, 0);
  const durationMs = persistedMs + (running && liveStart ? Math.max(0, now - liveStart) : 0);
  const durationText = durationMs > 0 ? UI.formatDuration(durationMs) : undefined;

  // --- Rail-owned drive actions (the panes no longer carry buttons for these). ---
  const approvePlan = async (): Promise<void> => {
    if (!effectivePlan) return;
    setApproving(true);
    try {
      await onApprovePlan(effectivePlan);
    } finally {
      setApproving(false);
    }
  };
  const objectPlan = (feedback: string): void => {
    store.start(driveKey, { role: 'architect', workOrderId: detail.id, mode: detail.mode, prompt: feedback, ...(state.sessionId ? { resume: state.sessionId } : {}) }, state);
    setObjectionOpen(false);
    setObjectionText('');
  };
  const requestPlan = (): void => {
    // Prompt is empty by design — main fills it from order.md (architectPromptFor). Architect → plan mode.
    store.start(driveKey, { role: 'architect', workOrderId: detail.id, mode: detail.mode, prompt: '' }, initialSessionState);
  };
  const allowAsk = (requestId: string): void => {
    void store.decide(requestId, { allow: true });
  };
  const denyAsk = (requestId: string): void => {
    void store.decide(requestId, { allow: false, reason: 'Denied by operator' });
  };
  // An interrupted step ('active' at restart, not running) — the rail's Sürdür resumes it (F14 append).
  const stepResumeId =
    !planStage && hasSteps && activeStep?.status === 'active' && !running
      ? detail.sessions.find((s) => s.stepIdx === activeStep.idx && s.providerSessionId)?.providerSessionId
      : undefined;
  const resumeStep = (): void => {
    if (!activeStep || stepResumeId === undefined) return;
    store.start(
      driveKey,
      { role: activeStep.role, workOrderId: detail.id, mode: 'direct', scope: activeStep.scopeTrackId, stepIndex: activeStep.idx, prompt: '', resume: stepResumeId },
      state,
    );
  };

  // --- The rail contract. Absent when closed ("arşivde ray yok"); quiet (message only) when nothing is
  //     asked of the operator; the ONE Durdur lives here.
  const railTone: LampTone = turn === 'yours' ? 'signal' : turn === 'running' ? 'run' : turn === 'retry' ? 'error' : 'idle';
  let railMessage: string | undefined;
  let railActions: RailAction[] | undefined;
  if (phase.kind !== 'done') {
    if (showAsk) {
      railMessage = UI.railAskHint;
    } else if (running) {
      // While running the rail carries ONLY the stop — no filler line ("Çalışıyor" already lives in the
      // substrip; the operator's copy-trim rule bans reassurance sentences).
      railActions = [{ id: 'stop', label: UI.interrupt, variant: 'secondary', onActivate: () => void store.interrupt() }];
    } else if (planStage && effectivePlan) {
      railMessage = UI.railApproveHint;
      railActions = [
        { id: 'object', label: UI.object, variant: 'ghost', locked: approving, onActivate: () => setObjectionOpen(true) },
        { id: 'approve', label: UI.railApprove, variant: 'primary', busy: approving, locked: approving, onActivate: () => void approvePlan() },
      ];
    } else if (planStage && !effectivePlan && !showQuestion) {
      // "Plan iste" covers BOTH plan stages — written (fresh) and architect_approval after an
      // interrupted plan drive (the stage flips on the first recorded session, Faz B's isPlanRequestStage).
      railActions = [{ id: 'request-plan', label: UI.requestPlan, variant: 'primary', onActivate: requestPlan }];
    } else if (stepResumeId !== undefined) {
      railActions = [{ id: 'resume', label: UI.railResume, variant: 'primary', onActivate: resumeStep }];
    } else if (allStepsDone) {
      railMessage = UI.railCloseHint;
    }
  }

  // --- Esc layering: peel one inline layer at a time; only a bare esc leaves the screen. ---
  const closeTopLayer = (): boolean => {
    if (objectionOpen) {
      setObjectionOpen(false);
      return true;
    }
    if (confirmClose) {
      setConfirmClose(false);
      return true;
    }
    if (confirmDelete) {
      setConfirmDelete(false);
      return true;
    }
    return false;
  };
  useDetailKeys({ closeTopLayer, onBack });

  const { mode: viewMode, setMode: setViewMode } = useViewMode();
  const sections = useMemo(
    () => buildDetailSections({ detail, steps: detail.steps, events, docs, onOpenReport: setReportStep }),
    [detail, events, docs],
  );

  // Ask cards are pinned above everything in every mode (v4: the amber moment outranks).
  const askCards = showAsk ? (
    <div className="flex flex-col gap-2">
      {state.pendingAsks.length > 1 ? (
        <div className="flex items-center gap-2">
          <p className="readout text-signal">{UI.asksPending(state.pendingAsks.length)}</p>
          <Button variant="signal" size="sm" onClick={() => { for (const a of state.pendingAsks) allowAsk(a.requestId); }}>{UI.allowAll}</Button>
        </div>
      ) : null}
      {state.pendingAsks.map((a) => (
        <StopAndAskCard
          key={a.requestId}
          tool={a.tool}
          input={a.input}
          reason={a.reason}
          planContext={planStage}
          onAllow={() => allowAsk(a.requestId)}
          onDeny={() => denyAsk(a.requestId)}
        />
      ))}
    </div>
  ) : null;

  // The decision surfaces (was Faz B's action-card branch + the report reader + the verdict card).
  const decision = (
    <div className="flex flex-col gap-3">
      {askCards}

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

      {objectionOpen ? (
        <div className="flex items-stretch overflow-hidden rounded-md border border-signal/40 bg-surface">
          <div className="lamp lamp-signal" />
          <div className="flex-1 px-3.5 py-3">
            <p className="readout text-signal">{UI.objectTitle}</p>
            <Input
              autoFocus
              value={objectionText}
              onChange={(e) => setObjectionText(e.target.value)}
              placeholder={UI.objectLinePlaceholder}
              className="mb-2 mt-2 font-sans text-[13px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && objectionText.trim()) objectPlan(objectionText.trim());
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setObjectionOpen(false)}>{UI.objectCancel}</Button>
              <Button
                variant="primary"
                size="sm"
                locked={!objectionText.trim()}
                onClick={() => objectPlan(objectionText.trim())}
              >
                {UI.objectSend}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {planStage && effectivePlan ? <PlanApprovalCards plan={effectivePlan} /> : null}

      {!planStage || !effectivePlan ? (
        detail.stage === 'closed' ? (
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
                    className="mb-2 font-sans text-[13px]"
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
        )
      ) : null}

      {verdictFor ? (
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
      ) : null}

      {!planStage && !hasSteps && docs.plan ? <p className="text-xs text-error">{UI.noSteps}</p> : null}

      {reportStep ? (
        <StepReport
          step={reportStep}
          loadReport={() => onGetStepReport(reportStep.idx, reportStep.role)}
          onClose={() => setReportStep(undefined)}
        />
      ) : null}
    </div>
  );

  // The instrument: the pane whose drive is active (plan flow, current step, or the review).
  const instrument = planStage || !hasSteps ? (
    <SessionPane mode={detail.mode} stage={detail.stage} workOrderId={detail.id} sessions={detail.sessions} />
  ) : reviewIdx !== undefined ? (
    <ReviewPane step={detail.steps.find((s) => s.idx === reviewIdx)!} workOrderId={detail.id} />
  ) : activeStep ? (
    <StepPane step={activeStep} workOrderId={detail.id} sessions={detail.sessions} />
  ) : null;

  return (
    <div className={cn('flex h-full min-h-0 flex-col', turnGlowClass(turn, phase.kind === 'done'))}>
      <DetailStrip
        detail={detail}
        phase={phase}
        duration={durationText}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onBack={onBack}
        onDelete={() => setConfirmDelete(true)}
      />
      <Substrip turn={turn} />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <DetailBody viewMode={viewMode} decision={decision} instrument={instrument} sections={sections} />
      </div>
      <ActionRail tone={railTone} message={railMessage} actions={railActions} />
    </div>
  );
}
