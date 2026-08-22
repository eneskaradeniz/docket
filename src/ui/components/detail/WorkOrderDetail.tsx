import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveSessionState, PermissionAsk } from '../../../core/runner';
import { initialSessionState, seedLiveState, summarizeToolInput } from '../../../core/runner';
import type { StepRole, StepSpec, StepView, TrackId, WorkOrderDetailView } from '../../../core/types';
import type { TurnState } from '../../../core/derive';
import { derivePhase, deriveSessionAudit, deriveTurnState } from '../../../core/derive';
import { applyStepEdits, parsePlanSteps } from '../../../core/plan-steps';
import { parseOrderMd } from '../../../core/order-md';
import type { PermissionRule, UpdateWorkOrderInput } from '../../../core/source';
import { useLabels } from '../../data/locale';
import { Button, Dialog, Input, cn } from '../../kit';
import { toast } from '../../chrome/ToastHost';
import { ActionCard } from './ActionCard';
import { ActionRail, type RailAction } from './ActionRail';
import { buildRecordSections, RecordStack } from './DetailSections';
import { DetailStrip } from './DetailStrip';
import { EvidencePanel } from './EvidencePanel';
import { PlanSection } from './PlanSection';
import { StepList } from './StepList';
import { useDetailKeys } from './useDetailKeys';
import { VerdictCard } from './VerdictCard';
import type { LampTone } from '../session/pane-chrome';
import { SessionPane } from '../session/SessionPane';
import { StepPane } from '../session/StepPane';
import { ReviewPane } from '../session/ReviewPane';
import { StopAndAskCard } from '../session/StopAndAskCard';
import { useDrive, useDriveStore } from '../session/drive-store';

/** The console glow (was Substrip's) — the ambient wash behind the whole screen, by turn. */
function turnGlowClass(turn: TurnState, phaseDone: boolean): string {
  if (phaseDone) return 'glow-done';
  switch (turn) {
    case 'yours':
      return 'glow-signal';
    case 'running':
      return 'glow-run';
    case 'retry':
      return 'glow-error';
    case 'stopped':
      return ''; // the wash is removed while stopped (v4: "signal removed when stopped")
    case 'done':
      return 'glow-done'; // unreachable via turn (phaseDone covers it) — the classifier is terminal-safe
  }
}

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
  const { PROVIDER_ERROR_LABELS, formatCost, formatUsd, transcriptLineText, UI } = useLabels();
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
  // TD-038.4 / WO-0031f: a failed delete used to close nothing and say nothing (try/finally, no
  // catch) — the rejection escaped through the void-ed click. The dialog now owns the error line,
  // mirroring the close dialog's closeError.
  const [deleteError, setDeleteError] = useState(false);
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
      setConfirmClose(false); // success closes the dialog (the results card is the payoff); an error keeps it open for retry
    } catch {
      setCloseError(true);
    } finally {
      setClosing(false);
    }
  };
  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(false);
    try {
      await onDelete();
    } catch {
      setDeleteError(true); // the dialog stays open for a retry — a failed delete deletes nothing
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
  // The store's booting flag: set at start(), cleared on the first folded event — the provider
  // subprocess spawn window, including a resume-after-wind-down re-boot (the seed's fold status
  // would misreport that one: a 'done' seed is not 'idle').
  const booting = store.get(driveKey)?.booting ?? false;
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
    ...(booting ? { starting: true } : {}),
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
      // The staging model (2026-08-22): Onayla approves what is ON SCREEN — the STAGE (editSteps),
      // not the editor chrome. The edited approval requires a fence to rewrite; a fence-less plan
      // is approved verbatim (the editor cannot open for one).
      if (staged && proposedSteps.length > 0) {
        const editedCount = planEditCount;
        await onApprovePlan(applyStepEdits(effectivePlan, editSteps), { editedCount });
        setEditOpen(false);
        setEditSteps([]);
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
    // Objecting hands the plan back to the architect — the hand-edited stage dies with it (the
    // architect re-proposes); Vazgeç inside the editor is the other discard path.
    setEditSteps([]);
    setEditOpen(false);
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

  // --- Pre-approval plan editing — the honest STAGING model (operator-approved 2026-08-22, the
  //     ui-ux-designer pass: Bitti used to be a false commit — three paths silently dropped drafts;
  //     the editor chrome and the staged plan are now SEPARATE). editSteps IS the stage: it survives
  //     Bitti and Esc (both just close the chrome), Vazgeç is the only discard (empties the stage),
  //     and Onayla approves whatever is on screen — staged edits applied, "düzenlenmiş onay" logged. ---
  const proposedSteps = useMemo(() => (effectivePlan !== undefined ? parsePlanSteps(effectivePlan) : []), [effectivePlan]);
  const staged = editSteps.length > 0;
  const planEditCount = useMemo(() => {
    if (!staged) return 0;
    let n = Math.abs(editSteps.length - proposedSteps.length);
    const shared = Math.min(editSteps.length, proposedSteps.length);
    for (let i = 0; i < shared; i++) {
      if (editSteps[i]!.aim !== proposedSteps[i]!.aim || editSteps[i]!.role !== proposedSteps[i]!.role) n++;
    }
    return n;
  }, [staged, editSteps, proposedSteps]);
  // Empty-aim is a property of the STAGE, not the editor chrome — after Bitti the gate and the
  // reason line must hold just the same (an Onayla that submits an empty aim, or vanishes without
  // saying why, are both wrong).
  const editEmptyAim = editSteps.some((s) => !s.aim.trim());
  const firstEmptyIdx = editSteps.find((s) => !s.aim.trim())?.idx;
  const openEditor = (): void => {
    if (proposedSteps.length === 0) return; // no fence → nothing to edit (see the rail's Düzenle rule)
    // Seed from the proposal ONLY when the stage is empty — reopening after Bitti must not wipe drafts.
    setEditSteps((cur) => (cur.length > 0 ? cur : proposedSteps.map((s) => ({ ...s }))));
    setEditOpen(true);
  };
  const cancelEdit = (): void => {
    setEditSteps([]);
    setEditOpen(false);
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
        // Operator rulings (2026-08-22, after hands-on testing): the EDITOR carries only editing —
        // Vazgeç (discard the stage) + Bitti (close the chrome, keep the stage). Onayla does NOT
        // render here (deciding happens once the editor is closed); ⏎ = Bitti.
        railMessage = editEmptyAim ? UI.editAimMissing(firstEmptyIdx ?? 0) : undefined;
        railActions = [
          { id: 'edit-cancel', label: UI.cancel, variant: 'ghost', onActivate: cancelEdit },
          { id: 'edit-done', label: UI.editPlanDone, variant: 'secondary', onActivate: () => setEditOpen(false) },
        ];
        railPrimary = () => setEditOpen(false);
      } else {
        // Bitti returns HERE — the NORMAL decision rail (İtiraz · Düzenle · Onayla), no special
        // staged state: the staged edits stay visible in the rows, Onayla approves what is on
        // screen (approvePlan applies the stage), and İtiraz hands the work order back to the
        // architect (objectPlan clears the stage — objecting discards the hand edits).
        railMessage = editEmptyAim ? UI.editAimMissing(firstEmptyIdx ?? 0) : UI.railApproveHint;
        // Editing needs a parsed steps fence: a fence-less plan has nothing to edit, and approving
        // editor-added steps would SILENTLY DROP them (applyStepEdits has no fence to rewrite) — the
        // Düzenle action is absent there, and the planNoStepsWarn banner already says object (ADR-0001).
        railActions = [
          { id: 'object', label: UI.object, variant: 'ghost', locked: approving, onActivate: () => setObjectionOpen(true) },
          ...(proposedSteps.length > 0
            ? [{ id: 'edit', label: UI.editPlan, variant: 'secondary' as const, locked: approving, onActivate: openEditor }]
            : []),
          ...(editEmptyAim
            ? []
            : [{ id: 'approve', label: UI.railApprove, variant: 'primary' as const, busy: approving, locked: approving, onActivate: () => void approvePlan() }]),
        ];
        if (!editEmptyAim) railPrimary = () => void approvePlan();
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

  const objective = useMemo(() => parseOrderMd(docs.order).objective, [docs.order]);
  const recordSections = useMemo(() => buildRecordSections({ detail, docs, UI }), [detail, docs, UI]);
  // The report toggle (WO-0031f R1): one report open at a time — clicking its row flips it.
  const toggleReport = (step: StepView): void => {
    setReportStep((cur) => (cur?.idx === step.idx ? undefined : step));
  };

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
          <p className="readout text-error">{state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : state.lastError ? UI.failTitle : UI.driveStreamCrashed}</p>
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
        <PlanSection
          editing={editOpen}
          steps={editOpen || staged ? editSteps : proposedSteps}
          onAimChange={(idx, aim) => setEditSteps((ss) => ss.map((s) => (s.idx === idx ? { ...s, aim } : s)))}
          onRoleSelect={(idx, role) => setEditSteps((ss) => ss.map((s) => (s.idx === idx ? { ...s, role } : s)))}
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
            const sha = detail.gateInputs.closureDocsSha;
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
                    {UI.stripDuration} {UI.formatDuration(audit.total.durationMs)} · {formatUsd(detail.cost.usd)} · {doneSteps}/{detail.steps.length} {UI.stepsUnit} · {UI.closeStatEvidence} {satisfied}/{detail.evidence.length} · {UI.closeStatReviews} {reviews}
                  </p>
                  {sha ? (
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(sha)
                          .then(() => toast.push({ kind: 'confirm', title: UI.copyDone }))
                          .catch(() => undefined); // clipboard unavailable — the title still carries the full sha
                      }}
                      title={sha}
                      aria-label={`${UI.closeShaAria} ${sha}`}
                      className="irow mt-1 px-1 font-mono text-[11px] text-inkdim"
                    >
                      {sha.slice(0, 7)}
                    </button>
                  ) : null}
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
          (() => {
            // WO-0038: the evidence CHECKLIST lives HERE now — the close decision's own card. The
            // standing Kanıt showcase died (operator, 2026-08-22); this is the moment it mattered.
            const repoByTrack = new Map<TrackId, string>(detail.tracks.map((ln) => [ln.track.id, ln.track.repo as string]));
            const repoCount = new Set(repoByTrack.values()).size;
            return (
              <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface">
                <div className="lamp lamp-done" />
                <div className="flex-1 px-3.5 py-3">
                  <p className="readout text-proceed">{UI.stepsAllDone}</p>
                  <div className="mt-2">
                    <EvidencePanel
                      items={detail.evidence}
                      tracks={detail.tracks}
                      repoOf={(id: TrackId) => repoByTrack.get(id)}
                      multiRepo={repoCount > 1}
                    />
                  </div>
                  <Button variant="secondary" size="sm" className="mt-2" onClick={() => { setCloseError(false); setConfirmClose(true); }}>
                    {UI.closeWo}
                  </Button>
                </div>
              </div>
            );
          })()
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
    </div>
  );

  // The instrument: the pane whose drive is active. WO-0038 (operator, 2026-08-22): at the
  // plan-APPROVAL moment (a plan is on the table) NO instrument renders — the decision surface is
  // the plan rows + the rail, and the architect's transcript lives in its Oturum card (özet +
  // aç/kapa). The live plan terminal shows while the plan is still being MADE; free-form work
  // orders keep their session instrument throughout.
  // INCIDENT (2026-08-22, same day): the earlier form of this condition let control fall through
  // to the StepPane branch at the plan stage — and getWorkOrderSteps deliberately parses the plan's
  // fence into 'pending' rows BEFORE approval, so StepPane's mount auto-drive started an
  // unapproved implementer step the moment the detail opened. StepPane now renders ONLY past the
  // plan stage (mirroring the old v4 guard); the pipeline's planApprovedFor guard is the second
  // layer for every other host.
  const instrument = planStage ? (
    effectivePlan ? null : (
      <SessionPane mode={detail.mode} stage={detail.stage} workOrderId={detail.id} sessions={detail.sessions} />
    )
  ) : !hasSteps ? (
    <SessionPane mode={detail.mode} stage={detail.stage} workOrderId={detail.id} sessions={detail.sessions} />
  ) : reviewIdx !== undefined ? (
    <ReviewPane step={detail.steps.find((s) => s.idx === reviewIdx)!} workOrderId={detail.id} />
  ) : activeStep ? (
    <StepPane step={activeStep} workOrderId={detail.id} sessions={detail.sessions} now={now} />
  ) : null;

  // WO-0038 DOSYA — the ONE scroll: decision cards first (what needs you), then the plan/step spine
  // (the driven row carries its chat inline — the StepPane renders ONLY there, never twice; a
  // plan-stage / step-less / reviewing WO keeps its instrument card above whatever flow exists),
  // then the record sections (Belgeler rows · Kaynaklar · the session ledger). No tabs, no rack,
  // no archive special-case — a closed WO is the same document, sealed.
  const stepPaneLivesInSpine = !planStage && hasSteps && reviewIdx === undefined && !!activeStep;
  const spine =
    !planStage && hasSteps ? (
      <StepList
        steps={detail.steps}
        sessions={detail.sessions}
        workOrderId={detail.id}
        {...(reviewIdx === undefined && activeStep ? { activeIdx: activeStep.idx } : {})}
        {...(reportStep ? { reportStep } : {})}
        onToggleReport={toggleReport}
        onGetStepReport={onGetStepReport}
        now={now}
      />
    ) : null;

  return (
    <div className={cn('flex h-full min-h-0 flex-col', turnGlowClass(turn, phase.kind === 'done'))}>
      <DetailStrip
        detail={detail}
        objective={objective}
        phase={phase}
        turn={turn}
        duration={durationText}
        driveLive={driveLive}
        onBack={onBack}
        onDelete={() => setConfirmDelete(true)}
        permissionRule={permissionRule}
        onUpdateWorkOrder={onUpdateWorkOrder}
      />
      <div className="flow-scroll mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex min-w-0 flex-col gap-3.5">
          {decision}
          {stepPaneLivesInSpine ? null : instrument}
          {spine}
          <RecordStack sections={recordSections} />
        </div>
      </div>
      <ActionRail tone={railTone} message={railMessage} actions={railActions} />

      {/* WO-0031d: the destructive/edit confirmations are dialogs over an intact screen (operator's
          explicit reversal of the old inline-confirm preference). No <form> anywhere — Enter in the
          note input does nothing, and useDetailKeys stands down while any dialog is open, so kapat
          stays ⏎'süz (v4: deliberate friction on the irreversible). */}
      {confirmDelete ? (
        <Dialog
          open
          narrow
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
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-inkdim">{UI.deleteWoHint}</p>
            {deleteError ? <p className="text-xs text-error">{UI.deleteWoFailed}</p> : null}
          </div>
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
