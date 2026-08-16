import { useEffect, useState } from 'react';
import {
  initialSessionState,
  seedLiveState,
  simplePhaseFromState,
  type DriveInput,
  type SimplePhase,
} from '../../../core/runner';
import type { SessionRef, SessionRole, StageId, WorkOrderId } from '../../../core/types';
import { PROVIDER_ERROR_LABELS, formatCost, ROLE_LABELS, SIMPLE_PHASE_LABELS, UI } from '../../data/labels';
import { Button, Segmented, Textarea } from '../../kit';
import { CostReadout, PaneError, PaneHeader, PaneShell, PhaseLine, ViewModeToggle } from './pane-chrome';
import { useDrive, useDriveStore, type DriveStore } from './drive-store';
import { PlanReadyCard } from './PlanReadyCard';
import { StopAndAskCard } from './StopAndAskCard';
import { Terminal } from './Terminal';

// Live session pane (WO-0008). Drives a real session through the SessionRunner port, folds the event
// stream into state (core's foldSessionEvent), and maps each event kind to a region — an xterm
// terminal (WO-0012), stop-and-ask card, plan approval, cost. Sessions persist + resume (WO-0010).
//
// Stage-aware (WO-0016): a `written` work order shows a single "Plan iste" surface (architect implied,
// prompt assembled server-side from order.md); plan approval writes plan.md via onApprovePlan rather
// than resuming the architect off plan mode.
const ROLE_ORDER: SessionRole[] = ['implementer', 'architect', 'verifier'];

export function SessionPane({
  mode,
  stage,
  workOrderId,
  sessions,
  onApprovePlan,
  pendingPlan,
}: {
  mode: 'plan' | 'direct';
  stage: StageId;
  workOrderId: WorkOrderId;
  sessions: SessionRef[];
  onApprovePlan: (planText: string) => Promise<void>;
  /** A plan persisted to plan.md but not yet approved (e.g. restart mid-proposal, WO-0020/TD-025). Rendered like a
   *  live plan_ready so the operator can still approve/object after a restart. */
  pendingPlan?: string;
}) {
  const store: DriveStore = useDriveStore();
  // WO-0028 / Bulgu 12: the drive lives in the app-level store, NOT this pane — navigating away keeps the
  // session running in the background; a remounted pane re-binds to the live fold state instantly.
  const driveKey = `${workOrderId}:free`;
  // At architect_approval (e.g. restarted mid-plan), default to the architect tab so resume re-surfaces
  // the proposed plan. At written the role tabs are hidden and the architect is implied.
  const [role, setRole] = useState<SessionRole>(stage === 'architect_approval' ? 'architect' : 'implementer');
  const [prompt, setPrompt] = useState('');
  // F14 (WO-0026): the persisted-session seed is the FALLBACK when this key has no live drive in the store
  // (fresh mount after a restart). While a background drive exists, the store's state wins.
  const seedFor = (r: SessionRole) => seedLiveState(sessions.find((s) => s.role === r && s.providerSessionId) ?? { transcript: [] });
  const state = useDrive(store, driveKey, () => seedFor(role));
  const running = store.get(driveKey)?.running ?? false;
  const [approving, setApproving] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [viewMode, setViewMode] = useState<'sade' | 'detail'>('sade');
  const sessionId = (reset: boolean): string | undefined => (reset ? undefined : store.sessionId(driveKey) ?? state.sessionId);

  // During the plan stages (written = propose, architect_approval = approve/object) the only session is the
  // architect's — role tabs are hidden. They show only past the plan stage (free-form implementer/verifier).
  const isPlanRequestStage = stage === 'written' || stage === 'architect_approval';

  // WO-0028: start() hands the drive to the app-level store. Completion refresh (WO-0027 / Bulgu 5) is
  // the store's onEnd → the App reloads detail + board wherever the operator is.
  const runDrive = (input: DriveInput, reset: boolean): boolean =>
    store.start(driveKey, input, reset ? initialSessionState : state);

  const requestPlan = (): void => {
    // Prompt is empty by design — main fills it from order.md (architectPromptFor). Architect → plan mode.
    store.start(driveKey, { role: 'architect', workOrderId, mode, prompt: '' }, initialSessionState);
  };
  const start = (): void => {
    store.start(driveKey, { role, workOrderId, mode, prompt }, initialSessionState);
  };
  // WO-0016: approving an architect's proposed plan commits plan.md + flips the gate (onApprovePlan),
  // then resets the live state so the reloaded detail (stage→implementation, plan rendered) is clean.
  // The architect session is done at plan_ready — it is NOT resumed off plan mode (steps are WO-0017).
  const approve = async (): Promise<void> => {
    if (role === 'architect' && effectivePlan) {
      setApproving(true);
      try {
        await onApprovePlan(effectivePlan);
      } finally {
        setApproving(false);
      }
    } else {
      runDrive(
        { role, workOrderId, mode, prompt: 'Approved — proceed with the plan.', resume: sessionId(false), approve: true },
        false,
      );
    }
  };
  // İtiraz et (WO-0016 redesign): send the architect back to revise, in plan mode (no approve flag).
  // resolvePermissionMode keeps an architect resume in 'plan', so the next ExitPlanMode yields a new plan.
  const objectPlan = (feedback: string): void => {
    runDrive({ role: 'architect', workOrderId, mode, prompt: feedback, resume: sessionId(false) }, false);
  };
  // Reply to an architect clarifying question (plan mode turn that ended without a plan): resume the
  // architect with the operator's answer. "Bilmiyorum" lets the architect decide on its own.
  const reply = (answer: string): void => {
    runDrive({ role: 'architect', workOrderId, mode, prompt: answer, resume: sessionId(false) }, false);
    setReplyText('');
  };
  const allowAsk = (requestId: string): void => {
    void store.decide(requestId, { allow: true });
  };
  const denyAsk = (requestId: string): void => {
    void store.decide(requestId, { allow: false, reason: 'Denied by operator' });
  };
  const allowAllAsks = (): void => {
    for (const a of state.pendingAsks) allowAsk(a.requestId);
  };
  const stop = (): void => {
    void store.interrupt();
  };

  // A live plan_ready takes precedence; otherwise fall back to a plan persisted to plan.md (restart recovery,
  // WO-0020/TD-025) so the operator can still approve after the live state was lost.
  const livePlan = state.status === 'plan_ready' ? state.pendingPlan : undefined;
  const effectivePlan = livePlan ?? pendingPlan;
  const showPlan = !!effectivePlan;
  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  // The architect stopped without producing a plan (plan mode turn ended, no plan_ready). In plan mode
  // that almost always means it needs input — surface its last message as an answerable question. Walk
  // back to the last assistant message in case the turn ended with a tool_result (e.g. a timed-out tool).
  const lastAssistant = [...state.entries].reverse().find((e) => e.speaker === 'assistant');
  const showQuestion = isPlanRequestStage && state.status === 'done' && !state.pendingPlan && !!lastAssistant;
  // WO-0029 / B16: an objection drive is live (plan stage, no pending plan yet) — the card shows the
  // "yeniden planlıyor" line and hides its buttons INSTANTLY (derived from the store, not a local flag).
  const objecting = running && isPlanRequestStage && !state.pendingPlan;
  const canStart = !running && !showPlan && !approving && !showQuestion;
  // SADE mode derives one calm phase from the live state; DETAY shows the raw themed terminal.
  // WO-0027 / Bulgu 3: a seeded pane (idle + entries) derived "Plan düşünülüyor…" even when the plan IS
  // ready — the plan context outranks the last-entry heuristic whenever nothing is running.
  const phase: SimplePhase = showPlan && !running && state.status !== 'error' ? 'ready' : simplePhaseFromState(state);
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;
  // A session persisted across restart (WO-0010) — offer resume only when one exists for the role.
  const resumeSessionId = sessions.find((s) => s.role === role && s.providerSessionId)?.providerSessionId;
  // WO-0029 / 7b+7c: the session's own duration (persisted span) + a live ticking elapsed while running.
  const matchedSession = sessions.find((s) => s.providerSessionId === state.sessionId || (state.sessionId === undefined && s.role === role));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const liveStart = store.get(driveKey)?.startedAt;
  const durationText = running && liveStart
    ? UI.formatDuration(Math.max(0, now - liveStart))
    : matchedSession?.startedAt && matchedSession.endedAt
      ? UI.formatDuration(new Date(matchedSession.endedAt).getTime() - new Date(matchedSession.startedAt).getTime())
      : undefined;
  const resume = (): void => {
    if (!resumeSessionId) return;
    // reset=false (WO-0026/F14): keep the seeded transcript — the new stream appends to it.
    runDrive({ role, workOrderId, mode, prompt: prompt.trim() || 'Continue.', resume: resumeSessionId }, false);
  };

  return (
    <PaneShell tone={state.status === 'error' ? 'error' : state.status === 'stopped_asking' || state.status === 'plan_ready' ? 'signal' : state.status === 'running' ? 'run' : state.status === 'done' ? 'done' : 'idle'}>
      <PaneHeader
        title={UI.sessionLog}
        status={state.status}
        right={
          <>
            {running ? <Button variant="ghost" size="sm" onClick={stop}>{UI.interrupt}</Button> : null}
            {hasStream ? <ViewModeToggle value={viewMode} onValueChange={setViewMode} /> : null}
            <CostReadout cost={state.cost.usd > 0 ? formatCost(state.cost) : undefined} duration={durationText} />
          </>
        }
      />

      {/* Role tabs are hidden on a written work order — the only session is the architect plan session. */}
      {isPlanRequestStage ? null : (
        <Segmented
          className="mb-2"
          value={role}
          onValueChange={setRole}
          options={ROLE_ORDER.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        />
      )}

      {/* Controls appear only when their precondition holds (ADR-0001). Written → single "Plan iste";
           otherwise the prompt + start/resume controls. */}
      {isPlanRequestStage && canStart ? (
        <div className="mb-2">
          <Button variant="primary" onClick={requestPlan}>{UI.requestPlan}</Button>
        </div>
      ) : null}

      {!isPlanRequestStage && canStart ? (
        <div className="mb-2 flex gap-2">
          <Textarea
            className="flex-1 font-sans text-[13px]"
            rows={2}
            placeholder={UI.promptPlaceholder}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Button variant="primary" className="self-stretch" onClick={start}>{UI.startSession}</Button>
          {resumeSessionId ? (
            <Button variant="secondary" className="self-stretch" onClick={resume}>{UI.resumeSession}</Button>
          ) : null}
        </div>
      ) : null}

      {showPlan && effectivePlan ? (
        <PlanReadyCard
          plan={effectivePlan}
          cost={state.cost}
          approving={approving}
          objecting={objecting}
          onApprove={() => void approve()}
          onObject={(feedback) => objectPlan(feedback)}
        />
      ) : null}

      {showQuestion && lastAssistant ? (
        <div className="mb-2 flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface shadow-sm">
          <div className="lamp lamp-signal" />
          <div className="flex-1 px-3.5 py-3">
            <p className="readout text-signal">{UI.architectWaiting}</p>
            <p className="mb-1 mt-0.5 text-[12px] text-inkdim">{UI.architectQuestionHint}</p>
            <p className="mb-2 text-[14px] text-ink">{lastAssistant.text}</p>
            <div className="flex flex-col gap-2">
              <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={2} placeholder={UI.replyPlaceholder} className="font-sans text-[13px]" />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => reply('Bilmiyorum, kendin karar ver.')}>{UI.skipReply}</Button>
                <Button variant="primary" size="sm" onClick={() => reply(replyText.trim() || 'Devam et.')}>{UI.reply}</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showAsk ? (
        <div className="mb-2">
          {state.pendingAsks.length > 1 ? (
            <div className="mb-1 flex items-center gap-2">
              <p className="readout text-signal">{UI.asksPending(state.pendingAsks.length)}</p>
              <Button variant="signal" size="sm" onClick={allowAllAsks}>{UI.allowAll}</Button>
            </div>
          ) : null}
          {state.pendingAsks.map((a) => (
            <StopAndAskCard
              key={a.requestId}
              tool={a.tool}
              input={a.input}
              reason={a.reason}
              planContext={isPlanRequestStage}
              onAllow={() => allowAsk(a.requestId)}
              onDeny={() => denyAsk(a.requestId)}
            />
          ))}
        </div>
      ) : null}

      {hasStream ? (
        viewMode === 'sade' ? (
          <PhaseLine phase={phase} label={phase === 'asking_permission' ? UI.askingRole(role) : SIMPLE_PHASE_LABELS[phase]} />
        ) : (
          <Terminal entries={state.entries} resetKey={state.sessionId ?? ''} />
        )
      ) : (
        <p className="text-xs text-inkdim">{UI.noSession}</p>
      )}

      {state.lastError ? (
        <PaneError message={state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : state.lastError} />
      ) : null}
    </PaneShell>
  );
}
