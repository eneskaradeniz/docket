import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveSessionState, PermissionAsk } from '../../../core/runner';
import { initialSessionState, seedLiveState, summarizeToolInput } from '../../../core/runner';
import type { StepRole, StepSpec, StepView, WoEvent, WorkOrderDetailView } from '../../../core/types';
import { derivePhase, deriveSessionAudit, deriveTurnState } from '../../../core/derive';
import { applyStepEdits, parsePlanSteps } from '../../../core/plan-steps';
import { parseOrderMd } from '../../../core/order-md';
import type { PermissionRule, UpdateWorkOrderInput } from '../../../core/source';
import { PROVIDER_ERROR_LABELS, formatCost, formatUsd, transcriptLineText, UI } from '../../data/labels';
import { Button, Dialog, Input, cn } from '../../kit';
import { toast } from '../../chrome/ToastHost';
import { ActionCard } from './ActionCard';
import { ActionRail, type RailAction } from './ActionRail';
import { AuditTable } from './AuditTable';
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
//
// c2 additions: the permission rule surfaces (badge/ask-card lift), pre-approval plan EDITING with the
// "düzenlenmiş onay" counter, the Durdur wind-down + 5s Zorla kes, the step-fail card, ⏎ on the rail's
// primary, permission decisions into the timeline, and the Denetim surfaces.
// WO-0031d: Düzenle/Sil/Kapat confirmations are kit Dialogs (screen intact); the strip's order.md
// writers stand down while a drive is live; closure renders the results card with the one-shot seal.
export function WorkOrderDetail({
  detail,
  docs,
  events,
  permissionRule,
  onBack,
  onApprovePlan,
  onUpdateWorkOrder,
  onRecordPermissionDecision,
  onGetStepReport,
  onGetStepVerdict,
  onResetStep,
  onCloseWorkOrder,
  onOverrideVerdict,
  reloadDetail,
  onDelete,
  autoRequestPlan,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  events: WoEvent[];
  permissionRule: PermissionRule;
  onBack: () => void;
  onApprovePlan: (planText: string, opts?: { editedCount?: number }) => Promise<void>;
  onUpdateWorkOrder: (patch: UpdateWorkOrderInput) => Promise<void>;
  onRecordPermissionDecision: (input: { allowed: boolean; tool: string; target: string }) => Promise<void>;
  onGetStepReport: (idx: number, role: StepRole) => Promise<string>;
  onGetStepVerdict: (idx: number) => Promise<string>;
  onResetStep: (idx: number) => Promise<void>;
  onCloseWorkOrder: (note: string) => Promise<void>;
  onOverrideVerdict: (idx: number) => Promise<void>;
  reloadDetail: () => void;
  onDelete: () => Promise<void>;
  autoRequestPlan?: boolean;
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
  // The Durdur wind-down (c2): interrupt sent → Durduruluyor; the drive's end closes it; 5s stuck arms
  // Zorla kes. `stopped` feeds deriveTurnState until Sürdür resumes.
  const [stopping, setStopping] = useState(false);
  const [forceArmed, setForceArmed] = useState(false);
  const [stopped, setStopped] = useState(false);
  // Pre-approval plan editing (c2): editSteps mirrors the parsed plan; editCount is the honest diff.
  const [editOpen, setEditOpen] = useState(false);
  const [editSteps, setEditSteps] = useState<StepSpec[]>([]);
  // "Bu iş emri için hep otomatik" in flight.
  const [liftingRule, setLiftingRule] = useState(false);
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

  // The seal's one-shot rule (WO-0031d / ADR-0012 r7): the ref seeds with the CURRENT kind, so a mount
  // that starts at done (reopening a closed work order) never pops; only a live flip to done does.
  const [sealPop, setSealPop] = useState(0);
  const prevPhaseKind = useRef<string | null>(null);
  if (prevPhaseKind.current === null) prevPhaseKind.current = phase.kind;
  useEffect(() => {
    const prev = prevPhaseKind.current;
    prevPhaseKind.current = phase.kind;
    if (prev !== 'done' && phase.kind === 'done') setSealPop((n) => n + 1);
  }, [phase.kind]);

  // The substrip's step segments (WO-0031d): adım N/T + filled cells, absent before a plan has steps.
  const segTotal = detail.steps.length;
  const segDone = detail.steps.filter((s) => s.status === 'done').length;
  const segActive = detail.steps.find((s) => s.status === 'active')?.idx;

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
  // WO-0031d: a live drive (running, or winding down — still spending) closes the strip's order.md
  // writers. `stopped` does not gate: the session is over, nothing is being written against.
  const driveLive = running || stopping;

  // A live plan_ready takes precedence; otherwise fall back to a plan persisted to plan.md (restart recovery,
  // WO-0020/TD-025) so the operator can still approve after the live state was lost.
  const livePlan = state.status === 'plan_ready' ? state.pendingPlan : undefined;
  const effectivePlan = livePlan ?? (planStage ? docs.plan || undefined : undefined);
  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const lastAssistant = [...state.entries].reverse().find((e) => e.speaker === 'assistant');
  const showQuestion = planStage && state.status === 'done' && !state.pendingPlan && !!lastAssistant;

  const turn = deriveTurnState({
    phase,
    liveStatus: state.status,
    hasPendingAsks: state.pendingAsks.length > 0,
    ...(stopping ? { stopping: true } : {}),
    ...(stopped ? { stopped: true } : {}),
  });

  // The wind-down's bookkeeping: when the drive ends after an interrupt, freeze visibly (the close note
  // carries the last known cost + elapsed) and hold the `stopped` turn state until Sürdür.
  useEffect(() => {
    if (!stopping || running) return;
    setStopping(false);
    setForceArmed(false);
    setStopped(true);
    const cost = state.cost.usd > 0 ? formatCost(state.cost) : formatUsd(0);
    const liveStart = store.get(driveKey)?.startedAt;
    const elapsed = liveStart ? UI.formatDuration(Math.max(0, Date.now() - liveStart)) : UI.auditCostNone;
    store.note(driveKey, { speaker: 'note', kind: 'session_closed', detail: `${cost} · ${elapsed}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, stopping]);
  // 5s stuck → arm Zorla kes.
  useEffect(() => {
    if (!(stopping && running)) return;
    const t = setTimeout(() => setForceArmed(true), 5000);
    return () => clearTimeout(t);
  }, [stopping, running]);

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
      // The edited approval requires a fence to rewrite — a fence-less plan is approved verbatim
      // (the editor cannot be open for one; the belt guards the suspenders).
      if (editOpen && editSteps.length > 0 && proposedSteps.length > 0) {
        const editedCount = planEditCount;
        await onApprovePlan(applyStepEdits(effectivePlan, editSteps), { editedCount });
        setEditOpen(false);
      } else {
        await onApprovePlan(effectivePlan);
      }
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
    setStopped(false);
    // Prompt is empty by design — main fills it from order.md (architectPromptFor). Architect → plan mode.
    // WO-0031d: a plan retry/Sürdür RESUMES the persisted architect session when one survived (same
    // pattern as the step retry below) instead of silently starting a fresh conversation.
    const resumeId =
      state.sessionId ??
      detail.sessions.find((s) => s.role === 'architect' && s.stepIdx === undefined && s.providerSessionId)?.providerSessionId;
    store.start(
      driveKey,
      { role: 'architect', workOrderId: detail.id, mode: detail.mode, prompt: '', ...(resumeId ? { resume: resumeId } : {}) },
      resumeId ? state : initialSessionState,
    );
  };
  // "Oluştur ve plan iste" (c2): fire once on arrival, then hand control back to the operator.
  const autoPlanDone = useRef(false);
  useEffect(() => {
    if (!autoRequestPlan || autoPlanDone.current) return;
    autoPlanDone.current = true;
    requestPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRequestPlan]);

  // Ask answers: decide resolves the held ask; the timeline records WHAT was decided and on what target.
  const answerAsk = (a: PermissionAsk, allowed: boolean): void => {
    void store.decide(a.requestId, allowed ? { allow: true } : { allow: false, reason: 'Denied by operator' });
    void onRecordPermissionDecision({ allowed, tool: a.tool, target: summarizeToolInput(a.input) });
  };
  const allowAsk = (a: PermissionAsk): void => answerAsk(a, true);
  const denyAsk = (a: PermissionAsk): void => answerAsk(a, false);
  // "Bu iş emri için hep otomatik": lift the WO to full_auto AND allow the current ask — one promise,
  // both facts land (rule_changed + permission_decision on the timeline; the strip badge flips).
  const alwaysAuto = async (a: PermissionAsk): Promise<void> => {
    setLiftingRule(true);
    try {
      await onUpdateWorkOrder({ permissionRule: 'full_auto' });
      answerAsk(a, true);
      toast.push({ kind: 'confirm', title: UI.toastRuleSaved, body: UI.toastRuleSavedBody });
    } finally {
      setLiftingRule(false);
    }
  };
  // An interrupted step ('active' at restart, not running) — the rail's Sürdür resumes it (F14 append).
  const stepResumeId =
    !planStage && hasSteps && activeStep?.status === 'active' && !running
      ? detail.sessions.find((s) => s.stepIdx === activeStep.idx && s.providerSessionId)?.providerSessionId
      : undefined;
  const resumeStep = (): void => {
    if (!activeStep || stepResumeId === undefined) return;
    setStopped(false);
    store.start(
      driveKey,
      { role: activeStep.role, workOrderId: detail.id, mode: 'direct', scope: activeStep.scopeTrackId, stepIndex: activeStep.idx, prompt: '', resume: stepResumeId },
      state,
    );
  };
  // Zorla kes: the 5s-stuck escape hatch — the generator's injected return runs the completion guarantee.
  const forceKill = (): void => {
    void store.abort();
    store.note(driveKey, { speaker: 'note', kind: 'force_killed' });
    setStopping(false);
    setForceArmed(false);
    setStopped(true);
  };
  // The wind-down: one click, no confirm dialog — the note lands in the terminal, the glow flips amber.
  const stop = (): void => {
    setStopping(true);
    store.note(driveKey, { speaker: 'note', kind: 'interrupt_sent' });
    void store.interrupt();
  };
  // Retry after a dead session: re-drive — resume when a session survived, fresh otherwise.
  const retry = (): void => {
    setStopped(false);
    if (planStage || !hasSteps) {
      requestPlan();
      return;
    }
    if (runIdx === undefined) return;
    const step = detail.steps.find((s) => s.idx === runIdx);
    if (!step) return;
    const resumeId = detail.sessions.find((s) => s.stepIdx === runIdx && s.providerSessionId)?.providerSessionId;
    store.start(
      driveKey,
      { role: step.role, workOrderId: detail.id, mode: 'direct', scope: step.scopeTrackId, stepIndex: runIdx, prompt: '', ...(resumeId ? { resume: resumeId } : {}) },
      resumeId ? state : initialSessionState,
    );
  };

  // --- Pre-approval plan editing: the count is the honest diff against the proposed plan. ---
  const proposedSteps = useMemo(() => (effectivePlan !== undefined ? parsePlanSteps(effectivePlan) : []), [effectivePlan]);
  const planEditCount = useMemo(() => {
    if (!editOpen) return 0;
    let n = Math.abs(editSteps.length - proposedSteps.length);
    const shared = Math.min(editSteps.length, proposedSteps.length);
    for (let i = 0; i < shared; i++) {
      if (editSteps[i]!.aim !== proposedSteps[i]!.aim || editSteps[i]!.role !== proposedSteps[i]!.role) n++;
    }
    return n;
  }, [editOpen, editSteps, proposedSteps]);
  const editEmptyAim = editOpen && editSteps.some((s) => !s.aim.trim());
  const openEditor = (): void => {
    if (proposedSteps.length === 0) return; // no fence → nothing to edit (see the rail's Düzenle rule)
    setEditSteps(proposedSteps.map((s) => ({ ...s })));
    setEditOpen(true);
  };

  // --- The rail contract. Absent when closed ("arşivde ray yok"); quiet (message only) when nothing is
  //     asked of the operator; the ONE Durdur lives here; ⏎ fires the primary (never on close — v4).
  const railTone: LampTone = turn === 'yours' ? 'signal' : turn === 'running' ? 'run' : turn === 'retry' ? 'error' : 'idle';
  let railMessage: string | undefined;
  let railActions: RailAction[] | undefined;
  let railPrimary: (() => void) | undefined;
  if (phase.kind !== 'done') {
    if (showAsk) {
      railMessage = UI.railAskHint;
    } else if (turn === 'retry') {
      railActions = [{ id: 'retry', label: UI.railRetry, variant: 'primary', onActivate: retry }];
      railPrimary = retry;
    } else if (running) {
      // While running the rail carries ONLY the stop — no filler line ("Çalışıyor" already lives in the
      // substrip; the operator's copy-trim rule bans reassurance sentences).
      railActions = forceArmed
        ? [
            { id: 'force', label: UI.railForceKill, variant: 'danger', onActivate: forceKill },
            { id: 'stop', label: UI.railStopping, variant: 'secondary', busy: stopping, locked: true, onActivate: () => undefined },
          ]
        : [{ id: 'stop', label: stopping ? UI.railStopping : UI.interrupt, variant: 'secondary', busy: stopping, locked: stopping, onActivate: stop }];
    } else if (stopped) {
      railActions = [{ id: 'resume', label: UI.railResume, variant: 'primary', onActivate: stepResumeId !== undefined ? resumeStep : planStage || !hasSteps ? requestPlan : retry }];
      railPrimary = stepResumeId !== undefined ? resumeStep : planStage || !hasSteps ? requestPlan : retry;
      railMessage = UI.railStoppedMsg;
    } else if (planStage && effectivePlan) {
      if (editOpen) {
        railMessage = editEmptyAim ? UI.editAimMissing : planEditCount > 0 ? UI.editCounter(planEditCount) : undefined;
        railActions = [
          { id: 'edit-done', label: UI.editPlanDone, variant: 'secondary', onActivate: () => setEditOpen(false) },
          ...(editEmptyAim
            ? []
            : [{ id: 'approve', label: UI.railApprove, variant: 'primary' as const, busy: approving, locked: approving, onActivate: () => void approvePlan() }]),
        ];
        if (!editEmptyAim) railPrimary = () => void approvePlan();
      } else {
        railMessage = UI.railApproveHint;
        // Editing needs a parsed steps fence: a fence-less plan has nothing to edit, and approving
        // editor-added steps would SILENTLY DROP them (applyStepEdits has no fence to rewrite) — the
        // Düzenle action is absent there, and the planNoStepsWarn banner already says object (ADR-0001).
        railActions = [
          { id: 'object', label: UI.object, variant: 'ghost', locked: approving, onActivate: () => setObjectionOpen(true) },
          ...(proposedSteps.length > 0
            ? [{ id: 'edit', label: UI.editPlan, variant: 'secondary' as const, locked: approving, onActivate: openEditor }]
            : []),
          { id: 'approve', label: UI.railApprove, variant: 'primary', busy: approving, locked: approving, onActivate: () => void approvePlan() },
        ];
        railPrimary = () => void approvePlan();
      }
    } else if (planStage && !effectivePlan && !showQuestion) {
      // "Plan iste" covers BOTH plan stages — written (fresh) and architect_approval after an
      // interrupted plan drive (the stage flips on the first recorded session, Faz B's isPlanRequestStage).
      railActions = [{ id: 'request-plan', label: UI.requestPlan, variant: 'primary', onActivate: requestPlan }];
      railPrimary = requestPlan;
    } else if (stepResumeId !== undefined) {
      railActions = [{ id: 'resume', label: UI.railResume, variant: 'primary', onActivate: resumeStep }];
      railPrimary = resumeStep;
    } else if (allStepsDone) {
      railMessage = UI.railCloseHint; // the close card owns the action; close has NO ⏎ (v4)
    }
  }

  // --- Esc layering + ⏎: peel one inline layer at a time; only a bare esc leaves the screen; Enter
  //     (outside inputs, outside dialogs) fires the rail's primary when one exists. The Sil/Kapat/Düzenle
  //     dialogs are Radix-owned — their Esc never reaches here (WO-0031d). ---
  const closeTopLayer = (): boolean => {
    if (objectionOpen) {
      setObjectionOpen(false);
      return true;
    }
    if (editOpen) {
      setEditOpen(false);
      return true;
    }
    return false;
  };
  useDetailKeys({ closeTopLayer, onBack, onPrimary: railPrimary });

  const { mode: viewMode, setMode: setViewMode } = useViewMode();
  const objective = useMemo(() => parseOrderMd(docs.order).objective, [docs.order]);
  const sections = useMemo(
    () => buildDetailSections({ detail, steps: detail.steps, events, docs, onOpenReport: setReportStep }),
    [detail, events, docs],
  );

  // Ask cards are pinned above everything in every mode (v4: the amber moment outranks). Rule lift +
  // the diff peek ride them; risky writes wear the tag (core/risky decides).
  const askCards = showAsk ? (
    <div className="flex flex-col gap-2">
      {state.pendingAsks.length > 1 ? (
        <div className="flex items-center gap-2">
          <p className="readout text-signal">{UI.asksPending(state.pendingAsks.length)}</p>
          <Button variant="signal" size="sm" onClick={() => { for (const a of state.pendingAsks) allowAsk(a); }}>{UI.allowAll}</Button>
        </div>
      ) : null}
      {state.pendingAsks.map((a) => (
        <StopAndAskCard
          key={a.requestId}
          tool={a.tool}
          input={a.input}
          reason={a.reason}
          planContext={planStage}
          onAllow={() => allowAsk(a)}
          onDeny={() => denyAsk(a)}
          {...(permissionRule === 'full_auto' ? {} : { onAlwaysAuto: () => void alwaysAuto(a), alwaysAutoBusy: liftingRule })}
          diffPeek={(filePath, newContent) => window.docket.diffPeek(detail.id, filePath, newContent)}
        />
      ))}
    </div>
  ) : null;

  // The failed-session card (c2): the error is a one-button stop, not a dead end. The sub-line is the
  // honest "spent so far"; the expandable detail carries the code + message + the last transcript lines
  // (v4 d4) and a Kopyala that puts the whole diagnostic on the clipboard.
  const [failDetailOpen, setFailDetailOpen] = useState(false);
  const [failCopied, setFailCopied] = useState(false);
  const failTail = [...state.entries].slice(-8);
  const failCopyText = [
    state.lastErrorCode ? `code: ${state.lastErrorCode}` : null,
    state.lastError ? `message: ${state.lastError}` : null,
    UI.failLastTitle + ':',
    ...failTail.map(transcriptLineText),
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
  const copyFailDetail = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(failCopyText);
      setFailCopied(true);
      setTimeout(() => setFailCopied(false), 2000);
    } catch {
      // clipboard unavailable — the text stays selectable on screen
    }
  };
  const failCard =
    turn === 'retry' ? (
      <div className="flex items-stretch overflow-hidden rounded-md border border-error/50 bg-surface">
        <div className="lamp lamp-error" />
        <div className="min-w-0 flex-1 px-3.5 py-3">
          <p className="readout text-error">{state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : UI.failTitle}</p>
          <p className="mt-1 text-[12px] text-inkdim">{UI.failSpent(state.cost.usd > 0 ? formatCost(state.cost) : formatUsd(0))}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <button type="button" className="alink text-[11px]" onClick={() => setFailDetailOpen((o) => !o)}>
              {failDetailOpen ? '▾' : '▸'} {UI.failDetail}
            </button>
            {failDetailOpen ? (
              <button type="button" className="alink text-[11px]" onClick={() => void copyFailDetail()}>
                {failCopied ? UI.failCopied : UI.failCopy}
              </button>
            ) : null}
          </div>
          {failDetailOpen ? (
            <pre className="mt-2 max-h-56 overflow-auto rounded border border-hairline bg-bg p-2 font-mono text-[11px] leading-relaxed text-inkdim">
              {state.lastErrorCode ? <span className="block text-error">code: {state.lastErrorCode}</span> : null}
              {state.lastError ? <span className="block whitespace-pre-wrap break-words">{state.lastError}</span> : null}
              {failTail.length > 0 ? (
                <>
                  <span className="mt-1 block text-ink">{UI.failLastTitle}</span>
                  {failTail.map((l, i) => (
                    <span key={i} className="block whitespace-pre-wrap">{transcriptLineText(l)}</span>
                  ))}
                </>
              ) : null}
            </pre>
          ) : null}
        </div>
      </div>
    ) : null;

  // The decision surfaces (was Faz B's action-card branch + the report reader + the verdict card).
  const decision = (
    <div className="flex flex-col gap-3">
      {askCards}
      {failCard}

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

      {planStage && effectivePlan ? (
        <PlanApprovalCards
          plan={editOpen ? undefined : effectivePlan}
          editing={editOpen}
          steps={editSteps}
          onAimChange={(idx, aim) => setEditSteps((ss) => ss.map((s) => (s.idx === idx ? { ...s, aim } : s)))}
          onRoleCycle={(idx) =>
            setEditSteps((ss) =>
              ss.map((s) =>
                s.idx === idx
                  ? { ...s, role: s.role === 'implementer' ? 'architect' : s.role === 'architect' ? 'verifier' : 'implementer' }
                  : s,
              ),
            )
          }
          onMove={(idx, dir) =>
            setEditSteps((ss) => {
              const at = ss.findIndex((s) => s.idx === idx);
              const to = at + dir;
              if (at < 0 || to < 0 || to >= ss.length) return ss;
              const next = [...ss];
              const [moved] = next.splice(at, 1);
              next.splice(to, 0, moved!);
              return next.map((s, i) => ({ ...s, idx: i + 1 }));
            })
          }
          onRemove={(idx) => setEditSteps((ss) => (ss.length <= 1 ? ss : ss.filter((s) => s.idx !== idx).map((s, i) => ({ ...s, idx: i + 1 }))))}
          onAdd={() => setEditSteps((ss) => [...ss, { idx: ss.length + 1, role: 'implementer', aim: '', scope: { kind: 'all' } }])}
        />
      ) : null}

      {!planStage || !effectivePlan ? (
        detail.stage === 'closed' ? (
          // WO-0031d / v4 §7: closure is a RESULTS card, not a flat line — the seal pops ONCE on the
          // in-session flip to done (prevPhaseKind ref, seeded with the current kind → reopening an
          // already-closed WO is calm); the stats row is plain mono text (money never animates).
          (() => {
            const audit = deriveSessionAudit(detail.sessions, parsePlanSteps(docs.plan));
            const reviews = detail.sessions.filter((s) => s.role === 'architect' && s.stepIdx !== undefined).length;
            const satisfied = detail.evidence.filter((e) => e.status === 'satisfied').length;
            const doneSteps = detail.steps.filter((s) => s.status === 'done').length;
            return (
              <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface" data-closure-card="">
                <div className="lamp lamp-done" />
                <div className="flex-1 px-3.5 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      key={sealPop}
                      data-seal=""
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-proceed ${sealPop > 0 ? 'sealpop' : ''}`}
                    >
                      <svg className="checkmark" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                        <path d="M3 8.5 6.5 12 13 4.5" />
                      </svg>
                    </span>
                    <p className="readout text-proceed">{UI.closeWoDoneTitle}</p>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-inkdim">
                    {UI.stripDuration} {UI.formatDuration(audit.total.durationMs)} · {UI.stripCost} {formatUsd(detail.cost.usd)} · {doneSteps}/{detail.steps.length} {UI.stepsUnit} · {UI.closeStatEvidence} {satisfied}/{detail.evidence.length} · {UI.closeStatReviews} {reviews}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-inkdim">{detail.gateInputs.closureDocsSha}</p>
                </div>
              </div>
            );
          })()
        ) : unresolvedRevise && allStepsDone ? (
          <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface">
            <div className="lamp lamp-signal" />
            <div className="flex-1 px-3.5 py-3">
              <p className="readout text-signal">{UI.verdictCardReviseTitle}</p>
              <p className="mt-1 text-[12px] text-inkdim">
                {UI.overrideVerdictHint} — <span className="font-mono">{UI.stepRef(unresolvedRevise.idx)}</span>
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
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => { setCloseError(false); setConfirmClose(true); }}>
                {UI.closeWo}
              </Button>
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

  // The archive's default body is the session ledger (v4 §4: "Tablo arşivde varsayılan").
  const auditTable = detail.sessions.length > 0 ? <AuditTable sessions={detail.sessions} steps={parsePlanSteps(docs.plan)} /> : null;
  const bodyDecision = phase.kind === 'done' && auditTable ? (
    <div className="flex flex-col gap-3">
      {decision}
      {auditTable}
    </div>
  ) : (
    decision
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', turnGlowClass(turn, phase.kind === 'done'))}>
      <DetailStrip
        detail={detail}
        objective={objective}
        phase={phase}
        duration={durationText}
        driveLive={driveLive}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onBack={onBack}
        onDelete={() => setConfirmDelete(true)}
        permissionRule={permissionRule}
        onUpdateWorkOrder={onUpdateWorkOrder}
      />
      <Substrip
        turn={turn}
        {...(segTotal > 0
          ? { segments: { done: segDone, total: segTotal, ...(segActive !== undefined ? { activeIdx: segActive } : {}) } }
          : {})}
      />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <DetailBody viewMode={viewMode} decision={bodyDecision} instrument={instrument} sections={sections} />
      </div>
      <ActionRail tone={railTone} message={railMessage} actions={railActions} />

      {/* WO-0031d: the destructive/edit confirmations are dialogs over an intact screen (operator's
          explicit reversal of the old inline-confirm preference). No <form> anywhere — Enter in the
          note input does nothing, and useDetailKeys stands down while any dialog is open, so kapat
          stays ⏎'süz (v4: deliberate friction on the irreversible). */}
      {confirmDelete ? (
        <Dialog
          open
          onOpenChange={(o) => { if (!o && !deleting) setConfirmDelete(false); }}
          title={UI.deleteWo}
          closeAria={UI.dialogCloseAria}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>{UI.cancel}</Button>
              <Button variant="danger" size="sm" busy={deleting} onClick={() => void handleDelete()}>{UI.deleteWoConfirm}</Button>
            </>
          }
        >
          <p className="text-[12px] text-inkdim">{UI.deleteWoHint}</p>
        </Dialog>
      ) : null}
      {confirmClose ? (
        <Dialog
          open
          onOpenChange={(o) => { if (!o && !closing) setConfirmClose(false); }}
          title={UI.closeWo}
          closeAria={UI.dialogCloseAria}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)}>{UI.cancel}</Button>
              <Button variant="primary" size="sm" busy={closing} onClick={() => void handleClose()}>{UI.closeWoConfirm}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-inkdim" htmlFor="wo-close-note">{UI.closeNoteLabel}</label>
            <Input
              id="wo-close-note"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              placeholder={UI.closeNotePlaceholder}
              className="font-sans text-[13px]"
            />
            {closeError ? <p className="text-xs text-error">{UI.closeWoFailed}</p> : null}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
