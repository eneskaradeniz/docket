import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveSessionState, PermissionAsk } from '../../../core/runner';
import { initialSessionState, limitCrossing, seedLiveState, summarizeToolInput } from '../../../core/runner';
import { type AskAnswer, type AskQuestion, askDecisionAll, parseAskRequest } from '../../../core/askq';
import type { StepRole, StepSpec, StepView, TrackId, WorkOrderDetailView } from '../../../core/types';
import type { TurnState } from '../../../core/derive';
import { derivePhase, deriveSessionAudit, deriveTurnState, nextManuelAction } from '../../../core/derive';
import { applyStepEdits, moveStep, parsePlanSteps } from '../../../core/plan-steps';
import { parseOrderMd } from '../../../core/order-md';
import type { PermissionRule, UpdateWorkOrderInput } from '../../../core/source';
import type { WorkspaceBudgetView } from '../../../core/budget';
import type { RepoChanges } from '../../../core/console';
import { useLabels } from '../../data/locale';
import { Button, Dialog, Input, cn } from '../../kit';
import { toast } from '../../chrome/ToastHost';
import { EnterMark } from '../EnterMark';
import { ActionCard } from './ActionCard';
import { buildRecordSections, RecordStack } from './DetailSections';
import type { ChangesBridge } from './ChangesSection';
import { DetailStrip } from './DetailStrip';
import { BudgetRefusalCard } from './BudgetRefusalCard';
import { LimitCard } from './LimitCard';
import { EvidencePanel } from './EvidencePanel';
import { PlanSection } from './PlanSection';
import { StepList } from './StepList';
import { useDetailKeys } from './useDetailKeys';
import { VerdictCard } from './VerdictCard';
import { DriveControls, type DriveState } from '../session/DriveControls';
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

// The console CONTROLLER (WO-0031c / v4 → WO-0038 DOSYA → WO-0039 rail-free). The spine is the
// HEADER BAND → the ONE scroll (ADR-0013); the content of every row is CONTENT-AWARE (derived from
// the phase + the live drive fold). All sequencing logic is unchanged from WO-0020..0030 (the
// runIdx/reviewIdx/verdictFor effects live verbatim below); what moved over the years is chrome:
// cost/duration/status to the band (ONE ticker), then WO-0039 dissolved the bottom rail — decisions
// into the flow (the plan section's decision band + heading Düzenle, the empty-state card, the fail
// card's retry), process control into the live pane headers (DriveControls), ask cards pinned above
// the instrument.
//
// c2 additions: the permission rule surfaces (badge/ask-card lift), pre-approval plan EDITING with the
// "düzenlenmiş onay" counter, the Durdur wind-down + 5s Zorla kes, the step-fail card, ⏎ on the ONE
// derived primary, permission decisions into the timeline, and the Denetim surfaces.
// WO-0031d: Düzenle/Sil/Kapat confirmations are kit Dialogs (screen intact); the strip's order.md
// writers stand down while a drive is live; closure renders the results card with the one-shot seal.
export function WorkOrderDetail({
  detail,
  docs,
  permissionRule,
  onBack,
  onApprovePlan,
  onSavePlanDraft,
  onGetOriginalPlan,
  onRestoreOriginalPlan,
  onUpdateWorkOrder,
  onRecordPermissionDecision,
  onGetStepReport,
  onGetStepVerdict,
  onResetStep,
  onCloseWorkOrder,
  onOverrideVerdict,
  budget,
  onRaiseBudget,
  reloadDetail,
  onDelete,
  autoRequestPlan,
  onRetractSteerNote,
  taskChip,
  changes: changesBridge,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  permissionRule: PermissionRule;
  onBack: () => void;
  onApprovePlan: (planText: string, opts?: { editedCount?: number }) => Promise<void>;
  onSavePlanDraft: (planText: string) => Promise<void>;
  onGetOriginalPlan: () => Promise<string | null>;
  onRestoreOriginalPlan: () => Promise<void>;
  onUpdateWorkOrder: (patch: UpdateWorkOrderInput) => Promise<void>;
  onRecordPermissionDecision: (input: { allowed: boolean; tool: string; target: string }) => Promise<void>;
  onGetStepReport: (idx: number, role: StepRole) => Promise<string>;
  onGetStepVerdict: (idx: number) => Promise<string>;
  onResetStep: (idx: number) => Promise<void>;
  onCloseWorkOrder: (note: string) => Promise<void>;
  onOverrideVerdict: (idx: number) => Promise<void>;
  /** WO-0047: the workspace's budget view — the band's warn line + the refusal card's context. */
  budget?: WorkspaceBudgetView;
  /** WO-0047: the refusal card's RAISE action (a permanent settings write + refresh). */
  onRaiseBudget: (capUsd: number) => Promise<void>;
  reloadDetail: () => void;
  onDelete: () => Promise<void>;
  autoRequestPlan?: boolean;
  /** WO-0045: retract a queued note from a STOPPED drive — the data-port mirror route (the store
   *  rewrites the row + audits); the pane patches its fold when this resolves true. */
  onRetractSteerNote?: (sessionId: string, noteId: string) => Promise<boolean>;
  /** WO-0049 (mockup kare 07): the linked task — resolved / 'missing' / undefined, straight to the strip. */
  taskChip?: { fazId: string; taskTitle: string } | 'missing';
  /** WO-0068: the operator's console bridge (the optional `changes` group) — present only when
   *  the composition root wired the console; the section is absent without it. */
  changes?: ChangesBridge;
}) {
  const { PROVIDER_ERROR_LABELS, ROLE_LABELS, formatCost, formatUsd, transcriptLineText, UI, woIdLabel } = useLabels();
  // The step currently being driven. Auto-sequencing (gates cadence): on approval the first pending step runs,
  // and when it completes the next pending step runs automatically — the operator does NOT click each step
  // (review_mode gates = autonomous between steps; the operator engages at plan approval, revisions, merge).
  // An 'active' step at restart offers "Sürdür" (DriveControls) instead; a 'done' step whose review was interrupted
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
  // architect for review — instead of auto-advancing straight to the next step. WO-0045: in `Akış:
  // manual` nothing starts itself — the review card in the decision stack is the offer. flowMode is
  // deliberately NOT a dependency: flipping the mode mid-wait must never fire (or un-fire) anything —
  // it is read fresh at the boundary this effect runs on (operator ruling 2026-08-26, pin 2).
  useEffect(() => {
    if (detail.flowMode === 'manual') return;
    if (reviewIdx !== undefined || verdictFor || runIdx === undefined) return;
    const cur = detail.steps.find((s) => s.idx === runIdx);
    if (cur?.status === 'done' && !cur.verdict) {
      setReviewIdx(cur.idx);
      setRunIdx(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.steps, runIdx, reviewIdx, verdictFor]);
  // Verdict-branch (WO-0020): once the reviewed step has a verdict, either auto-advance (gates + proceed) or
  // surface the verdict card (gates + revise, every-step, or unknown → revise). This is review_mode branching.
  // WO-0045: manual mode never auto-advances — a proceed verdict simply closes the review; the manuel
  // card derives the next leg from the steps. Same no-flowMode-dep rule as above.
  useEffect(() => {
    if (reviewIdx === undefined || verdictFor) return;
    const cur = detail.steps.find((s) => s.idx === reviewIdx);
    if (cur?.verdict) {
      setReviewIdx(undefined);
      if (detail.flowMode === 'manual') return;
      if (detail.reviewMode === 'gates' && cur.verdict === 'proceed') {
        setRunIdx(detail.steps.find((s) => s.status === 'pending')?.idx);
      } else {
        setVerdictFor(cur);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.steps, reviewIdx, verdictFor, detail.reviewMode]);
  // TD-053 (operator repro 2026-08-26, WO-0046 checkpoint): a WO opened BEFORE its plan existed
  // mounted with no steps, so runIdx's initializer found nothing — and being an initializer, it
  // never ran again. Approving while staying on the detail then rendered NO instrument (activeStep
  // derives from runIdx) and the first step sat unstarted ("Seni bekliyor") until a re-entry
  // remounted the detail. Fill runIdx when it is unset and a step exists. flowMode is deliberately
  // NOT a dependency (the WO-0045 pin-2 rule: a mode flip never fires a start) — it is read at the
  // boundary this effect runs on; in manual the manuel card's Başlat is what sets runIdx (the click
  // is the consent), and the review handoff parks runIdx undefined on purpose (reviewIdx precedes).
  useEffect(() => {
    if (detail.flowMode === 'manual') return;
    if (runIdx !== undefined || reviewIdx !== undefined || verdictFor) return;
    const next =
      detail.steps.find((s) => s.status === 'active')?.idx ??
      detail.steps.find((s) => s.status === 'done' && !s.verdict)?.idx ??
      detail.steps.find((s) => s.status === 'pending')?.idx;
    if (next !== undefined) setRunIdx(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.steps, runIdx, reviewIdx, verdictFor]);
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
  // The editor's stage rows carry a STABLE uid (2026-08-23): drag keys by position made the drop
  // remount rows — every transform reset at once (the "animation resets" jank). The uid rides
  // reorders; applyStepEdits serializes role/aim/scope explicitly, so it never reaches the fence.
  const [editSteps, setEditSteps] = useState<(StepSpec & { uid: string })[]>([]);
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
  //     only ever started by the panes' auto-drive effects or the in-flow actions below). The seed mirrors
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
    return reviewIdx !== undefined ? initialSessionState : seedLiveState(found ?? { status: 'none', transcript: [] }, asks);
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
  // 2026-08-23 (canlı panel revizyonu, §6): the plan surface is gated on SESSION END, not on the
  // plan_ready fold. S2 (plan delivered, drive winding down ≤5s) shows NO plan — the pane's SADE
  // line carries "Plan hazır — oturum kapanıyor" and Durdur stays armed; S3 (turn_complete, or a
  // Durdur mid-grace — "ended" is the gate, not "completed") flips the stage on reload and the
  // plan rows + decision row land in ONE transition. Without this, a re-proposal's STALE
  // docs.plan leaked through during the wind-down (the fold's fresh plan hid it; the buttons raced).
  const planClosing = running && state.status === 'plan_ready';
  // WO-0039/C (mockup 04, the closed hole): an objection RE-PLAN (a live drive while a plan is on
  // the table, fold not plan_ready) renders the instrument — the run was watchable NOWHERE before
  // (the plan hid the pane; the ledger was blind). Only the plan_ready wind-down keeps the slim
  // strip (WO-0038's no-instrument-at-approval ruling, preserved for the deliberation it made).
  const replanning = planStage && running && state.status !== 'plan_ready';
  const livePlan = !planClosing && state.status === 'plan_ready' ? state.pendingPlan : undefined;
  const effectivePlan = planClosing ? undefined : livePlan ?? (planStage ? docs.plan || undefined : undefined);
  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const lastAssistant = [...state.entries].reverse().find((e) => e.speaker === 'assistant');
  // WO-0039 stabilization (2026-08-23): a plan on DISK closes the question card at the controller
  // too (SessionPane's twin gate) — the overwrite incident's re-entry resume answered a plan that
  // already existed. A plan on the table IS the answer.
  const showQuestion = planStage && state.status === 'done' && !state.pendingPlan && !docs.plan && !!lastAssistant;

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
  // 2026-08-23 (operator, round 3): the stopped OFFER must survive navigation — the controller's
  // `stopped` flag dies with the component, but the app-level fold (status 'stopped', made durable
  // by the `interrupted` event) does not. `stoppedNow` derives from BOTH: the flag for the
  // just-wound-down moment, the fold for every re-entry.
  const stoppedNow = stopped || state.status === 'stopped';
  useEffect(() => {
    if (!stopping || running) return;
    setStopping(false);
    setForceArmed(false);
    setStopped(true);
    // 2026-08-24 (operator: "hangi saniye"): the close note leads with the clock — the döküm reads
    // as a timeline, not events floating outside of time.
    const clock = UI.auditClock(new Date().toISOString());
    const cost = state.cost.usd > 0 ? formatCost(state.cost) : formatUsd(0);
    const liveStart = store.get(driveKey)?.startedAt;
    const elapsed = liveStart ? UI.formatDuration(Math.max(0, Date.now() - liveStart)) : UI.auditCostNone;
    store.note(driveKey, { speaker: 'note', kind: 'session_closed', detail: `${clock} · ${cost} · ${elapsed}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, stopping]);
  // 5s stuck → arm Zorla kes.
  useEffect(() => {
    if (!(stopping && running)) return;
    const t = setTimeout(() => setForceArmed(true), 5000);
    return () => clearTimeout(t);
  }, [stopping, running]);

  // ONE ticker for the whole console (Faz B had three, one per pane): the strip's live duration.
  // WO-0053 (architect finding 2): it also runs while the limit card WAITS on a future stamp — the
  // card renders exactly where nothing else re-rendered (the drive is dead, the instrument is
  // suppressed), so the absent→present crossing rides THIS tick; once crossed, it stands down.
  const [now, setNow] = useState(Date.now());
  const limitWaiting =
    state.lastLimit !== undefined && !running && limitCrossing(state.lastLimit.resetAt, now) === 'wait';
  useEffect(() => {
    if (!running && !limitWaiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, limitWaiting]);
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
    } catch {
      // 2026-08-23 (süre şişmesi turu): a failed approval was a SILENT unhandled rejection — the
      // button just went quiet and the stage never flipped. It surfaces as an error toast now
      // (the same form contract as the dialogs' save failures).
      toast.push({ kind: 'error', title: UI.saveFailed });
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
  // 2026-08-23 (operator, round 3): the persisted architect PLAN session, when one exists — the
  // empty-state button's honest label ("Sürdür", not "Plan iste": requestPlan RESUMES this session)
  // and requestPlan's resume id, derived ONCE from the rows. Survives app restarts (the fold does
  // not); the fold covers the in-app re-entry (stoppedNow).
  const planResumeId = detail.sessions.find((s) => s.role === 'architect' && s.stepIdx === undefined && s.providerSessionId)?.providerSessionId;
  const requestPlan = (): void => {
    setStopped(false);
    // Prompt is empty by design — main fills it from order.md (architectPromptFor). Architect → plan mode.
    // WO-0031d: a plan retry/Sürdür RESUMES the persisted architect session when one survived (same
    // pattern as the step retry below) instead of silently starting a fresh conversation.
    const resumeId = state.sessionId ?? planResumeId;
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
  // WO-0077 — the structured ask's answer: the fold (core/askq.askDecisionAll — WO-0085: every
  // answered question merges its key) rides decide() and reaches the runner's held callback as the
  // measured permission response (WO-0076 Q3). The record names each resolution — header + the
  // folded value — the target a question has none.
  const answerStructuredAsk = (a: PermissionAsk, answered: Array<{ question: AskQuestion; answer: AskAnswer }>): void => {
    const decision = askDecisionAll(a.input, answered);
    void store.decide(a.requestId, decision);
    for (const { question, answer } of answered) {
      void onRecordPermissionDecision({
        allowed: decision.allow,
        tool: a.tool,
        target:
          answer.kind === 'selection' || answer.kind === 'other'
            ? `${question.header}: ${answer.kind === 'selection' ? answer.labels.join(', ') : answer.text}`
            : question.question,
      });
    }
  };
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
  // An interrupted step ('active' at restart, not running) — DriveControls' Sürdür resumes it (F14 append).
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
  // WO-0045 (reviewer finding 2): a stopped drive's Sürdür resumes THE STOPPED DRIVE — its own fold
  // session id + its own input shape. The table lookups in resumeStep/retry cannot tell a step row
  // from its review row (both persist step_idx), so the old chain resumed the STEP session under a
  // stopped REVIEW pane (and Sürdür's carry would read the wrong row's mirror). Plan/free drives keep
  // the old chain — their panes own their resume paths.
  const resumeStopped = (): void => {
    if (!state.sessionId) {
      (stepResumeId !== undefined ? resumeStep : planStage || !hasSteps ? requestPlan : retry)();
      return;
    }
    setStopped(false);
    if (reviewIdx !== undefined) {
      store.start(
        driveKey,
        { role: 'architect', workOrderId: detail.id, mode: 'direct', reviewStepIndex: reviewIdx, prompt: '', resume: state.sessionId },
        state,
      );
      return;
    }
    const step = runIdx !== undefined ? detail.steps.find((st) => st.idx === runIdx) : undefined;
    if (step) {
      store.start(
        driveKey,
        { role: step.role, workOrderId: detail.id, mode: 'direct', scope: step.scopeTrackId, stepIndex: step.idx, prompt: '', resume: state.sessionId },
        state,
      );
      return;
    }
    (planStage || !hasSteps ? requestPlan : retry)();
  };

  // Zorla kes: the 5s-stuck escape hatch — the generator's injected return runs the completion guarantee.
  const forceKill = (): void => {
    void store.abort(driveKey);
    store.note(driveKey, { speaker: 'note', kind: 'force_killed' });
    setStopping(false);
    setForceArmed(false);
    setStopped(true);
  };
  // The wind-down: one click, no confirm dialog — the note lands in the terminal, the glow flips amber.
  const stop = (): void => {
    setStopping(true);
    store.note(driveKey, { speaker: 'note', kind: 'interrupt_sent', detail: UI.auditClock(new Date().toISOString()) });
    void store.interrupt(driveKey);
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
    if (proposedSteps.length === 0) return; // no fence → nothing to edit (the section heading's Düzenle rule)
    // Seed from the proposal ONLY when the stage is empty — reopening after Bitti must not wipe drafts.
    setEditSteps((cur) => (cur.length > 0 ? cur : proposedSteps.map((s) => ({ ...s, uid: crypto.randomUUID() }))));
    setEditOpen(true);
  };
  const cancelEdit = (): void => {
    setEditSteps([]);
    setEditOpen(false);
  };
  // "Bitti = kaydet" (operator ruling, 2026-08-23): finishing the editor PERSISTS a valid stage to
  // the pending plan.md — the old memory-only stage died with navigation, silently discarding a
  // "saved" edit. An empty aim, a fence-less stage, or a NO-DIFF stage (e.g. right after Önerine dön)
  // writes nothing; those close the chrome only, drafts staying in memory as before. Esc keeps
  // its old meaning too (close the chrome, keep the drafts).
  const finishEditing = async (): Promise<void> => {
    setEditOpen(false);
    if (!effectivePlan || !staged || editEmptyAim || proposedSteps.length === 0 || planEditCount === 0) return;
    try {
      await onSavePlanDraft(applyStepEdits(effectivePlan, editSteps));
      setEditSteps([]); // the proposal now IS the stage — reopening re-seeds from it
    } catch {
      toast.push({ kind: 'error', title: UI.saveFailed });
    }
  };
  // "İlk öneriye dön" (operator ruling, 2026-08-23 — replaces the in-session Sıfırla): restore
  // the AGENT's originally proposed steps, discarding saved AND unsaved operator edits. The
  // original is snapshotted at the first operator overwrite (store.plan_original) and cleared
  // when the architect re-proposes; a confirm dialog guards the destructive act.
  const [originalPlan, setOriginalPlan] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!planStage) {
      setOriginalPlan(null);
      return;
    }
    void onGetOriginalPlan().then((t) => {
      if (!cancelled) setOriginalPlan(t);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id, docs.plan, planStage]);
  // Guarded when there is no original to restore, or the table already shows it with nothing
  // unsaved on top (a bright nothing-button reads broken).
  const restoreAvailable = originalPlan !== null && (originalPlan !== effectivePlan || planEditCount > 0);
  const doRestore = async (): Promise<void> => {
    setRestoring(true);
    setRestoreError(false);
    try {
      await onRestoreOriginalPlan();
      setEditSteps([]);
      setEditOpen(false);
      setRestoreOpen(false);
      reloadDetail();
    } catch {
      setRestoreError(true);
    } finally {
      setRestoring(false);
    }
  };

  // --- WO-0039 — the rail is DEAD (operator ruling, mockup-approved). Its two jobs split:
  //     DOSSIER DECISIONS render in the flow — İtiraz/Onayla in the plan section's decision band,
  //     Düzenle in that section's heading, Plan iste in the empty-state card, Yeniden dene on the
  //     fail card; the ask hint sits on the ask cards and the close hint on the close card.
  //     PROCESS CONTROL (Durdur / Zorla kes / ▶ Sürdür) rides the LIVE PANE's header via the
  //     `drive` bundle below. ⏎ still fires ONE derived primary — its badge marks that button
  //     wherever it lives; close keeps NO ⏎ (v4 deliberate friction). ---
  // 2026-08-23 (süre şişmesi, C katmanı): a plan-mode drive whose fold says plan_ready has
  // DELIVERED its plan and is awaiting the operator — that is the approval moment, not work
  // (the SDK stream lingers waiting for an in-session approval Docket never gives).
  const planAwaitingOperator = planStage && state.status === 'plan_ready';
  // WO-0053 (review findings 1-3 + operator round 2, 2026-08-29): the limit surfaces branch on
  // their OWN discriminators, never the derived turn — the primary real death is a RESULT message
  // (error then turn_complete), which folds 'done', so a turn-gated card/⏎ would never fire on the
  // real path. A stamped stop opens the INFORMATIVE LimitCard while the stamp is FUTURE only (the
  // operator's round-2 ruling: the card carries NO button — the ONE Sürdür lives in its normal
  // home beside it, locked while the limit holds; the clock crossing unmounts the card and
  // unlocks the button — «kart gider, Sürdür düğmesi gelir»); a stamp-less one DEGRADES to the
  // fail card's localized title (mockup frame 04). Neither renders over the operator's own Durdur
  // (the seed boundary, mirrored live: `interrupted` folds 'stopped' and keeps the stamp).
  const limitCardOpen =
    state.lastLimit !== undefined
    && !running
    && state.status !== 'stopped'
    && state.lastRefusal === undefined
    && limitCrossing(state.lastLimit.resetAt, now) === 'wait';
  const limitDegrade =
    state.lastErrorCode === 'rate_limited' && state.lastLimit === undefined && !running && state.status !== 'stopped' && state.lastRefusal === undefined;
  let primary: (() => void) | undefined;
  // What primary IS (not just which closure) — DriveControls draws the ⏎ on ▶ Sürdür only when
  // the resume is really the screen's primary (the decision row outranks it when both render).
  let primaryKind: 'retry' | 'resume' | 'done' | 'approve' | 'request' | 'object' | undefined;
  if (phase.kind !== 'done') {
    if (showAsk) {
      // No primary while an ask is pending — the ask cards own the moment (v4 rule, unchanged).
    } else if (objectionOpen) {
      // WO-0039 (2026-08-23 fifth pass): while the objection layer is open ⏎ = GÖNDER — never
      // Onayla (the operator hit exactly that ambiguity). The empty text holds the primary absent.
      if (objectionText.trim()) {
        primary = () => objectPlan(objectionText.trim());
        primaryKind = 'object';
      }
    } else if ((turn === 'retry' || limitDegrade) && !state.lastRefusal && state.lastLimit === undefined) {
      primary = retry; // ⏎ = Yeniden dene — the fail card's button (incl. the stamp-less degrade tier)
      primaryKind = 'retry';
      // WO-0047: a budget REFUSAL owns the moment instead — the two-choice card renders, the fail
      // card stands down, and ⏎ holds (the card's own input carries Enter while valid; the ask-
      // cards-own-the-moment rule in the refusal's register).
    } else if (running && !planAwaitingOperator) {
      // No primary while running — Durdur is deliberately NOT ⏎'s target (v4 rule, unchanged).
      // The exception: a plan-mode drive that already DELIVERED its plan (the SDK awaits an
      // in-session approval Docket never gives — süre şişmesi, 2026-08-23) is the approval
      // moment, not work: the decision row stays and Onayla keeps the ⏎.
    } else if (planStage && effectivePlan && !stopping) {
      // The plan is on the table and no drive is rewriting it: ⏎ = Bitti while the editor chrome
      // is open, Onayla once it is closed (absent while an aim is empty or a fence-less stage
      // holds — the decision row's hint says why). Outranks ▶ Sürdür: at a stopped re-plan the
      // DECISION on the plan in hand is the fresher intent.
      if (editOpen) {
        primary = () => void finishEditing(); // ⏎ = Bitti — and Bitti saves (2026-08-23)
        primaryKind = 'done';
      } else if (!editEmptyAim && !(staged && proposedSteps.length === 0)) {
        primary = () => void approvePlan();
        primaryKind = 'approve';
      }
    } else if (stoppedNow) {
      primary = resumeStopped; // ⏎ = ▶ Sürdür — the stopped drive's OWN session (WO-0045 finding 2)
      primaryKind = 'resume';
    } else if (planStage && !effectivePlan && !showQuestion && !limitCardOpen) {
      primary = requestPlan; // ⏎ = Plan iste / Sürdür (the decision row's lone button)
      primaryKind = 'request';
    } else if (stepResumeId !== undefined && !limitCardOpen) {
      primary = resumeStep; // an interrupted 'active' step at restart
      primaryKind = 'resume';
    }
    // allStepsDone: close keeps NO ⏎ — the close card's button is a deliberate, aimed click (v4).
  }
  // The process-control bundle for the ACTIVE drive — handed to whichever pane renders the TOP
  // instrument (SessionPane / ReviewPane / StepPane — WO-0044 tur 2: all three ride the one seat).
  // The old rail's precedence, kept: while an ASK is pending the ask cards own the moment (no
  // controls), and the retry turn belongs to the fail card's Yeniden dene — never a second
  // primary. `enter` says whether ▶ Sürdür carries the ONE ⏎ (the decision row outranks it when
  // both render).
  const drive: DriveState | undefined =
    !showAsk && turn !== 'retry' && (running || stopping || stoppedNow || stepResumeId !== undefined)
      ? {
          running,
          stopping,
          forceArmed,
          // The stopped readout rides only the STOPPED moment — not the resume's boot window (the
          // fold stays 'stopped' until the resumed drive's first event lands).
          stopped: stoppedNow && !running && !stopping,
          resumable: stoppedNow || stepResumeId !== undefined,
          enter: primaryKind === 'resume',
          onStop: stop,
          onForceKill: forceKill,
          onResume: stoppedNow ? resumeStopped : stepResumeId !== undefined ? resumeStep : planStage || !hasSteps ? requestPlan : retry,
        }
      : undefined;
  // WO-0039 revizyon (operator, 2026-08-23): TEK KARAR KONUMU — the plan flow's actions sit in ONE
  // slot (the old lone Plan iste pixels), in the dead rail's grammar. 2026-08-23 (süre şişmesi,
  // C katmanı): a plan-mode drive that already DELIVERED its plan (the fold says plan_ready) is
  // AWAITING THE OPERATOR, not rewriting — the row stays (the stand-down was hiding Onayla for the
  // whole deliberation; the operator had to Durdur first). Only an actual RE-plan (an objection
  // drive — running without a plan_ready fold) hides the row; a bare plan stage hides for any drive.
  const decisionRowHidden =
    !planStage ||
    showQuestion ||
    objectionOpen || // the objection layer owns the moment — its own Gönder/Vazgeç carry it
    (drive !== undefined && effectivePlan === undefined) ||
    (drive !== undefined && (running || stopping) && !planAwaitingOperator);
  // The hint chain (2026-08-23 fourth pass): the standing consequence lines DIED with the operator's
  // ruling ("Onayla — adımlar sırayla koşar. kaldır") — no reassurance text beside decisions. What
  // survives is the GATE reason and only that: an empty aim must say why Onayla is absent (ADR-0001).
  // The staged edit count lives in the record (plan_approved → "düzenlenmiş onay · N değişiklik"),
  // not on the row.
  const planHint = effectivePlan && editEmptyAim ? UI.editAimMissing(firstEmptyIdx ?? 0) : undefined;
  // Every editOpen FLIP anchors the decision row to reading position (the report-open precedent:
  // the operator must see the ⏎ primary the moment it changes identity). First mount stays calm.
  const prevEditOpen = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevEditOpen.current;
    prevEditOpen.current = editOpen;
    if (prev === null || prev === editOpen) return;
    requestAnimationFrame(() => {
      document.getElementById('plan-decision-row')?.scrollIntoView({ block: 'start' });
    });
  }, [editOpen]);

  // --- Esc layering + ⏎: peel one inline layer at a time; only a bare esc leaves the screen; Enter
  //     (outside inputs, outside dialogs) fires the ONE derived primary when it exists. The Sil/Kapat/Düzenle
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
  useDetailKeys({ closeTopLayer, onBack, onPrimary: primary });

  // WO-0088: one parse carries both the Objective (the description editor's seed) and the `cwd:`
  // working-copy override (the edit dialog's prefill).
  const parsedDocs = useMemo(() => parseOrderMd(docs.order), [docs.order]);
  const objective = parsedDocs.objective;
  const cwdOverride = parsedDocs.cwd;
  // WO-0044 (2026-08-25): the ledger is PURE HISTORY — no liveRow pointer, no goLive jump, no
  // logOpenSignal nonce (WO-0039/C's pointer card died: it duplicated the driven row's live
  // header one scroll below in a grammar the completed cards do not speak). The record stack
  // rides only the WO view + ONE live fact (reviewer round): the live drive's session id — the
  // persisted 'running' row it matches is skipped, so even the mid-run re-entry renders no card
  // for the run in flight. The ONE live surface is the instrument.
  const liveSessionId = running || stopping ? store.sessionId(driveKey) : undefined;
  // WO-0068 — the Changes look, fetched HERE (the detail effect idiom) so the record builder can
  // gate the section ABSENT with nothing to show (ADR-0012) — an empty frame never renders. The
  // read re-runs on every detail reload and on the section's own Yenile; a failed look degrades to
  // [] (absent) and the next reload re-reads. The bridge is optional: no composition-root console,
  // no section.
  const [changesRepos, setChangesRepos] = useState<RepoChanges[] | undefined>(undefined);
  const [changesNonce, setChangesNonce] = useState(0);
  const refreshChanges = useCallback(() => setChangesNonce((n) => n + 1), []);
  useEffect(() => {
    if (!changesBridge) {
      setChangesRepos(undefined);
      return;
    }
    let cancelled = false;
    changesBridge
      .changesFor(detail.id)
      .then((repos) => {
        if (!cancelled) setChangesRepos(repos);
      })
      .catch(() => {
        if (!cancelled) setChangesRepos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [changesBridge, detail, changesNonce]);
  const recordSections = useMemo(
    () =>
      buildRecordSections({
        detail,
        docs,
        UI,
        ...(liveSessionId ? { liveSessionId } : {}),
        ...(changesBridge && changesRepos && changesRepos.length > 0
          ? { changes: { bridge: changesBridge, repos: changesRepos, onRefresh: refreshChanges } }
          : {}),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail, docs, UI, liveSessionId, changesBridge, changesRepos, refreshChanges],
  );
  // The report toggle (WO-0031f R1): one report open at a time — clicking its row flips it.
  const toggleReport = (step: StepView): void => {
    setReportStep((cur) => (cur?.idx === step.idx ? undefined : step));
  };

  // Ask cards are pinned above everything in every mode (v4: the amber moment outranks). Rule lift +
  // the diff peek ride them; risky writes wear the tag (core/risky decides). WO-0039: the dead
  // rail's ask hint rides the stack — one informative line, not chrome.
  const askCards = showAsk ? (
    <div className="flex flex-col gap-2">
      {state.pendingAsks.length > 1 ? (
        <div className="flex items-center gap-2">
          <p className="readout text-signal">{UI.asksPending(state.pendingAsks.length)}</p>
          <Button variant="signal" size="sm" onClick={() => { for (const a of state.pendingAsks) if (parseAskRequest(a.tool, a.input) === undefined) allowAsk(a); }}>{UI.allowAll}</Button>
        </div>
      ) : null}
      <p className="text-[11.5px] text-inkdim">{UI.askHint}</p>
      {state.pendingAsks.map((a) => (
        <StopAndAskCard
          key={a.requestId}
          tool={a.tool}
          input={a.input}
          reason={a.reason}
          planContext={planStage}
          subject={woIdLabel(detail.id)} /* WO-0088: the card names WHICH work order asks */
          onAllow={() => allowAsk(a)}
          onDeny={() => denyAsk(a)}
          onAnswer={(answered) => answerStructuredAsk(a, answered)}
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
  // WO-0045 — the manuel card: what a `Akış: manual` work order waits on (nextManuelAction is pure:
  //  the review leg precedes an unreviewed report, else the first pending step; an 'active' step
  //  owns the flow — Sürdür is DriveControls'). The card is the OFFER, the click is the consent; a
  //  mode flip to auto never fires it (nothing depends on flowMode here — pin 2).
  const manuelAction = detail.flowMode === 'manual' && !planStage && hasSteps && !running && !stopping
    ? nextManuelAction(detail.steps)
    : undefined;
  const startManuelLeg = (): void => {
    if (!manuelAction) return;
    if (manuelAction.kind === 'review') {
      setReviewIdx(manuelAction.idx);
      store.start(
        `${detail.id}:review:${manuelAction.idx}`,
        { role: 'architect', workOrderId: detail.id, mode: 'direct', reviewStepIndex: manuelAction.idx, prompt: '' },
        initialSessionState,
      );
      return;
    }
    const step = detail.steps.find((st) => st.idx === manuelAction.idx);
    if (!step) return;
    setRunIdx(step.idx);
    store.start(
      `${detail.id}:step:${step.idx}`,
      { role: step.role, workOrderId: detail.id, mode: 'direct', scope: step.scopeTrackId, stepIndex: step.idx, prompt: '' },
      initialSessionState,
    );
  };
  const manuelCard =
    manuelAction && turn !== 'running' ? (
      <div
        data-manuel-card={manuelAction.idx}
        className="flex items-stretch overflow-hidden rounded-md border border-signal/40 bg-surface"
      >
        <div className="lamp lamp-signal-breathe" />
        <div className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5">
          <p className="readout min-w-0 flex-1 truncate text-signal">
            {manuelAction.kind === 'review' ? UI.manuelReviewCard(manuelAction.idx) : UI.manuelNextStepCard(manuelAction.idx)}
          </p>
          <Button variant="primary" size="sm" className="shrink-0" onClick={startManuelLeg}>{UI.manuelStartCard}</Button>
        </div>
      </div>
    ) : null;

  const failCard =
    (turn === 'retry' || limitDegrade) && !state.lastRefusal && state.lastLimit === undefined ? (
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
            {/* WO-0039: the dead rail's retry — the error card IS the one-button stop's home. ⏎'s
                target while the retry turn holds. */}
            <Button variant="primary" size="sm" className="ml-auto" onClick={retry}>
              {UI.driveRetry}
              <EnterMark />
            </Button>
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

  // WO-0047 — the budget refusal card: the gate's TWO-CHOICE resolution (raise-and-re-run /
  // keep-the-cap), rendered when the drive's error carried the refusal facts. A KEEP dismissal is
  // per-mount and re-arms on a NEW refusal identity (honest: drives still refuse — the standing
  // stop line on the band/card carries the reason meanwhile). The raise persists the new cap
  // (permanent) then re-issues the SAME drive input through the store's restart.
  const [budgetKept, setBudgetKept] = useState(false);
  const [raiseBusy, setRaiseBusy] = useState(false);
  useEffect(() => {
    if (state.lastRefusal) setBudgetKept(false);
  }, [state.lastRefusal]);
  const raiseBudget = async (capUsd: number): Promise<void> => {
    setRaiseBusy(true);
    try {
      await onRaiseBudget(capUsd);
      store.restart(driveKey);
    } finally {
      setRaiseBusy(false);
    }
  };
  const refusalCard =
    state.lastRefusal && !running && !budgetKept ? (
      <BudgetRefusalCard
        observedUsd={state.lastRefusal.observedUsd}
        capUsd={state.lastRefusal.capUsd}
        hasUnknown={budget?.hasUnknown ?? false}
        busy={raiseBusy}
        onRaise={(cap) => void raiseBudget(cap)}
        onKeep={() => setBudgetKept(true)}
      />
    ) : null;

  // WO-0053 — the limit stop's INFORMATIVE card (round 2: no action row — the ONE Sürdür lives
  // beside it, locked). It renders only when the refusal card does NOT (a budget refusal is the
  // fresher intent in the both-set case), never over the operator's own stop, and only while the
  // stamp is FUTURE (the crossing unmounts it — the Sürdür takes over alone).
  const limitCard = limitCardOpen && refusalCard === null ? (
    <LimitCard resetAt={state.lastLimit!.resetAt} windowKind={state.lastLimit!.window} />
  ) : null;
  const limitOpen = limitCard !== null;

  // The decision surfaces (was Faz B's action-card branch + the report reader + the verdict card).
  const decision = (
    <div className="flex flex-col gap-3">
      {askCards}
      {refusalCard}
      {limitCard}
      {failCard}

      {objectionOpen ? (
        // WO-0039 (2026-08-23 fifth pass) — the objection layer redesigned in the current idiom:
        // the amber moment's own card (breathing signal lamp), the readout question, a full-width
        // one-line input, and the decision grammar — GÖNDER primary LEFT carrying the ⏎, Vazgeç
        // right. While this layer is open the decision row stands down and ⏎ IS Gönder (never
        // Onayla); Enter in the input sends too (the same action, both focus paths agree).
        <div data-objection-card="" className="flex items-stretch overflow-hidden rounded-md border border-signal/40 bg-surface">
          <div className="lamp lamp-signal-breathe" />
          <div className="min-w-0 flex-1 px-3.5 py-3">
            <p className="readout text-signal">{UI.objectTitle}</p>
            <Input
              autoFocus
              value={objectionText}
              onChange={(e) => setObjectionText(e.target.value)}
              placeholder={UI.objectLinePlaceholder}
              className="mt-2 font-sans text-[13px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && objectionText.trim()) objectPlan(objectionText.trim());
              }}
            />
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                className="min-w-[92px]"
                locked={!objectionText.trim()}
                onClick={() => objectPlan(objectionText.trim())}
              >
                {UI.objectSend}
                {objectionText.trim() ? <EnterMark /> : null}
              </Button>
              <Button variant="ghost" size="sm" className="min-w-[92px]" onClick={() => setObjectionOpen(false)}>
                {UI.objectCancel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {planStage && effectivePlan && drive && !replanning ? (
        // WO-0039: while a plan IS on the table no instrument renders (WO-0038 ruling) — but a LIVE
        // drive (a stop mid-drive, the plan_ready wind-down) still needs its controls now that the
        // rail is dead. This slim strip is that home: readout + DriveControls, nothing else; the
        // drive's transcript keeps living in its Oturum card. WO-0039/C: an objection RE-PLAN
        // renders the full instrument instead (the run is watchable work, not a wind-down).
        <div data-plan-drive="" className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface">
          <div className={cn('lamp', drive.running || drive.stopping ? 'lamp-run' : 'lamp-idle')} />
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3.5 py-2">
            <span className="flex min-w-0 items-center gap-2">
              {running && !booting ? <span className="dot-run shrink-0" aria-hidden="true" /> : null}
              <span className="readout truncate">{ROLE_LABELS.architect}</span>
            </span>
            <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2.5">
              <DriveControls drive={drive} />
            </div>
          </div>
        </div>
      ) : null}

      {planStage && !showQuestion && !decisionRowHidden ? (
        // WO-0039 revizyon (2026-08-23, beşinci tur düzeltmesi): TEK KARAR KONUMU — Onayla ve
        // İtiraz et YAN YANA solda (birincil önde; kenarlara yayılma yok); editörde Bitti + Vazgeç
        // aynı biçimde. Ayakta ipucu yok; düğme çiftinin sağı yalnız KAPI gerekçesini taşır (boş
        // aim — Onayla'nın yokluğunun sebebi, ADR-0001). İtiraz et SECONDARY (yeniden iş, kayıp
        // değil).
        <div
          id="plan-decision-row"
          {...(effectivePlan ? { 'data-plan-decision': '' } : { 'data-plan-empty': '' })}
          className="flex min-w-0 items-center gap-3"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {effectivePlan ? (
              <>
                {editOpen ? (
                  // 2026-08-23 seventh pass: while the editor owns the moment the decision pair
                  // stays VISIBLE, inert — the kit `locked` form (attribute-free, ADR-0001's
                  // terminal-lock exception), no ⏎ (Bitti owns it from the section heading).
                  <Button variant="primary" size="sm" className="min-w-[92px]" locked onClick={() => void approvePlan()}>
                    {UI.planApprove}
                  </Button>
                ) : editEmptyAim || (staged && proposedSteps.length === 0) ? null : (
                  // Onayla needs a fence to rewrite: a fence-less re-proposal while the stage holds
                  // would approve the VERBATIM plan, not the staged rows (reviewer note 5).
                  <Button variant="primary" size="sm" className="min-w-[92px]" busy={approving} locked={approving} onClick={() => void approvePlan()}>
                    {UI.planApprove}
                    <EnterMark />
                  </Button>
                )}
                {/* 2026-08-23 sixth pass: İtiraz et = SIGNAL (amber — the operator-judgment action,
                    the ask cards' allowAll grammar; red stays the machine stop) and the same
                    min-width as Onayla — the pair reads as one equal-sized decision. */}
                <Button variant="signal" size="sm" className="min-w-[92px]" locked={approving || editOpen} onClick={() => setObjectionOpen(true)}>
                  {UI.object}
                </Button>
                {planHint ? <p className="min-w-0 flex-1 truncate text-[12px] text-inkdim">{planHint}</p> : null}
              </>
            ) : (
              // WO-0053 operator round 2: while the limit holds, the ONE Sürdür renders in place,
              // LOCKED (the kit's attribute-free lock — ADR-0001's guarded-action register; the
              // limit card right above carries the reason, no tooltip needed) and holds the ⏎
              // badge off. The clock crossing unmounts the card and unlocks this button.
              <Button variant="primary" size="sm" className="min-w-[92px]" locked={limitCardOpen} onClick={requestPlan}>
                {planResumeId ? UI.driveResume : UI.requestPlan}
                {limitCardOpen ? null : <EnterMark />}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {planStage && effectivePlan ? (
        <PlanSection
          editing={editOpen}
          steps={editOpen || staged ? editSteps : proposedSteps}
          onAimChange={(idx, aim) => setEditSteps((ss) => ss.map((s) => (s.idx === idx ? { ...s, aim } : s)))}
          onRoleSelect={(idx, role) => setEditSteps((ss) => ss.map((s) => (s.idx === idx ? { ...s, role } : s)))}
          // 2026-08-23 drag-and-drop: the ▲▼ dir-move died; the drop carries array positions and
          // the pure core moveStep renumbers (test-first in plan-steps).
          onReorder={(from, to) => setEditSteps((ss) => moveStep(ss, from, to))}
          onRemove={(idx) => setEditSteps((ss) => (ss.length <= 1 ? ss : ss.filter((s) => s.idx !== idx).map((s, i) => ({ ...s, idx: i + 1 }))))}
          onAdd={() => setEditSteps((ss) => [...ss, { idx: ss.length + 1, role: 'implementer', aim: '', scope: { kind: 'all' }, uid: crypto.randomUUID() }])}
          // Düzenle needs a parsed steps fence: a fence-less plan has nothing to edit, and approving
          // editor-added steps would SILENTLY DROP them (applyStepEdits has no fence to rewrite) —
          // absent there; the planNoStepsWarn banner already says object (ADR-0001).
          onEdit={proposedSteps.length > 0 ? openEditor : undefined}
          editLocked={approving}
          editorActions={{ onDone: () => void finishEditing(), onCancel: cancelEdit, ...(restoreAvailable ? { onRestore: () => setRestoreOpen(true) } : {}) }}
        />
      ) : null}

      {!planStage ? (
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
        ) : manuelCard ? (
          // WO-0045: in `Akış: manual` the next-leg card IS the decision surface — it outranks the
          // all-done close card (allStepsDone ignores verdicts; the last review leg still needs the
          // operator's click before this WO is closeable). The unresolvedRevise decision above keeps
          // its seat: an open revision outranks any next-leg offer.
          manuelCard
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
                  {/* WO-0039: the dead rail's close hint moved INTO the card (the "Kapat —" prefix
                      died; the button is right here). Close keeps NO ⏎ — a deliberate, aimed click. */}
                  <p className="mt-2 text-[12px] text-inkdim">{UI.closeHint}</p>
                  <Button variant="secondary" size="sm" className="mt-2" onClick={() => { setCloseError(false); setConfirmClose(true); }}>
                    {UI.closeWo}
                  </Button>
                </div>
              </div>
            );
          })()
        ) : turn === 'running' ? null : (
          // WO-0044 (operator, 2026-08-25): while a drive is live NOTHING needs you — the ActionCard
          // is absent, not a read-only "Çalışıyor / Oturumu sürdür" banner (the band's lamp + phase
          // line and the driven row's instrument already carry the state; the old prompt was the
          // label of a button that died in WO-0027). The gate is the turn state, not the card's own
          // persisted-row check — a first-run drive has no persisted row yet.
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
  // WO-0039: at the plan stages the SessionPane renders only when there is something to READ — a
  // live drive, a transcript, an ask, or the architect's question card. A bare plan stage belongs
  // to the lone Plan iste button (2026-08-23 ruling), not to a tall instrument that repeats the
  // invitation (the pane's own invitation line stands down with it).
  const planPaneLive = running || showAsk || state.entries.length > 0 || showQuestion;
  // WO-0047: a budget REFUSAL owns the moment — the two-choice card in the decision stack is the
  // surface. No transcript exists to read (the drive was refused pre-spawn), so a pane would only
  // repeat the error under the card. The pane returns the moment the raise's re-run boots
  // (`started` clears the refusal) — or on a re-entry's fresh auto-drive, honestly refused again.
  const refusalOpen = state.lastRefusal !== undefined && !running;
  // WO-0053: the limit card owns the moment the same way (karar 5) — but unlike a refusal there IS
  // a transcript to read; it lives one click away in the Oturum card's döküm (the card grammar's
  // own rule — no forked read-only instrument beneath the card).
  const instrument = refusalOpen || limitOpen ? null : planStage ? (
    (effectivePlan && !replanning) || (!planPaneLive && !replanning) ? null : (
      <SessionPane
        mode={detail.mode}
        stage={detail.stage}
        workOrderId={detail.id}
        sessions={detail.sessions}
        planOnTable={!!docs.plan}
        now={now}
        {...(onRetractSteerNote ? { onRetractStoppedSteer: onRetractSteerNote } : {})}
        {...(drive ? { drive } : {})}
      />
    )
  ) : !hasSteps ? (
    <SessionPane
      mode={detail.mode}
      stage={detail.stage}
      workOrderId={detail.id}
      sessions={detail.sessions}
      planOnTable={!!docs.plan}
      now={now}
      {...(onRetractSteerNote ? { onRetractStoppedSteer: onRetractSteerNote } : {})}
      {...(drive ? { drive } : {})}
    />
  ) : reviewIdx !== undefined ? (
    <ReviewPane
      step={detail.steps.find((s) => s.idx === reviewIdx)!}
      workOrderId={detail.id}
      now={now}
      autoStart={detail.flowMode !== 'manual'}
      {...(onRetractSteerNote ? { onRetractStoppedSteer: onRetractSteerNote } : {})}
      {...(drive ? { drive } : {})}
    />
  ) : activeStep ? (
    <StepPane
      step={activeStep}
      workOrderId={detail.id}
      sessions={detail.sessions}
      now={now}
      autoStart={detail.flowMode !== 'manual'}
      {...(onRetractSteerNote ? { onRetractStoppedSteer: onRetractSteerNote } : {})}
      {...(drive ? { drive } : {})}
    />
  ) : null;

  // WO-0038 DOSYA → WO-0044 tur 2 (mockup-approved 2026-08-25): the ONE scroll reads
  // decision cards (what needs you) → THE LIVE INSTRUMENT, band-adjacent — every drive kind sits
  // here now; the spine row stopped carrying the pane (the driven row is a plain status row) →
  // the plan/step spine (a pure status list: Aktif / Bekliyor / tamam) → the record sections
  // (Belgeler rows · Kaynaklar · the session ledger). No tabs, no rack, no archive special-case —
  // a closed WO is the same document, sealed.
  const spine =
    !planStage && hasSteps ? (
      <StepList
        steps={detail.steps}
        sessions={detail.sessions}
        {...(reviewIdx === undefined && activeStep ? { activeIdx: activeStep.idx } : {})}
        {...(reportStep ? { reportStep } : {})}
        onToggleReport={toggleReport}
        onGetStepReport={onGetStepReport}
      />
    ) : null;

  // WO-0041 — the detail's entrance: ADR-0012 r7's sibling case. The DOSYA's bands glide in
  // reading order (strip → decision → instrument → steps → records), the board's 30ms step,
  // once per mount. A CLOSED work order opens calm (r1 — a record, not a celebration). The
  // wrappers are deliberately UNKEYED: a reloadDetail re-render must never restart the glide.
  const entrance = (slot: number) =>
    phase.kind === 'done'
      ? {}
      : { className: 'glide min-w-0', style: { animationDelay: `${slot * 30}ms` } };

  return (
    <div className={cn('flex h-full min-h-0 flex-col', turnGlowClass(turn, phase.kind === 'done'))}>
      <div {...entrance(0)}>
        <DetailStrip
          detail={detail}
          objective={objective}
          cwdOverride={cwdOverride}
          phase={phase}
          turn={turn}
          duration={durationText}
          driveLive={driveLive}
          pendingSteer={state.pendingNotes.length}
          budget={budget}
          onBack={onBack}
          onDelete={() => setConfirmDelete(true)}
          permissionRule={permissionRule}
          onUpdateWorkOrder={onUpdateWorkOrder}
          taskChip={taskChip}
        />
      </div>
      <div className="flow-scroll mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex min-w-0 flex-col gap-3">
          <div {...entrance(1)}>{decision}</div>
          {instrument ? <div {...entrance(2)}>{instrument}</div> : null}
          {spine ? <div {...entrance(3)}>{spine}</div> : null}
          <div {...entrance(4)}>
            <RecordStack sections={recordSections} />
          </div>
        </div>
      </div>

      {/* WO-0031d: the destructive/edit confirmations are dialogs over an intact screen (operator's
          explicit reversal of the old inline-confirm preference). No <form> anywhere — Enter in the
          note input does nothing, and useDetailKeys stands down while any dialog is open, so kapat
          stays ⏎'süz (v4: deliberate friction on the irreversible). */}
      {/* "İlk öneriye dön" (2026-08-23): the destructive restore asks first — the operator's saved
          and unsaved edits die with it. A failed restore keeps the dialog open for a retry. */}
      {restoreOpen ? (
        <Dialog
          open
          narrow
          onOpenChange={(o) => { if (!o && !restoring) setRestoreOpen(false); }}
          title={UI.restoreTitle}
          closeAria={UI.dialogCloseAria}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setRestoreOpen(false)}>{UI.cancel}</Button>
              <Button variant="danger" size="sm" busy={restoring} onClick={() => void doRestore()}>{UI.restoreConfirm}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-inkdim">{UI.restoreBody}</p>
            {restoreError ? <p className="text-xs text-error">{UI.saveFailed}</p> : null}
          </div>
        </Dialog>
      ) : null}
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
