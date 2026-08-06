import { useRef, useState } from 'react';
import {
  foldSessionEvent,
  initialSessionState,
  simplePhaseFromState,
  type DriveInput,
  type LiveSessionState,
  type SimplePhase,
} from '../../../core/runner';
import type { SessionRef, SessionRole, StageId, WorkOrderId } from '../../../core/types';
import { formatCost, LIVE_STATUS_LABELS, ROLE_LABELS, SIMPLE_PHASE_LABELS, UI } from '../../data/labels';
import { useRunner } from './runner-context';
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

function statusColor(s: LiveSessionState['status']): string {
  switch (s) {
    case 'running':
      return 'text-denim';
    case 'stopped_asking':
      return 'text-brass';
    case 'plan_ready':
      return 'text-brass';
    case 'done':
      return 'text-sage';
    case 'error':
      return 'text-clay';
    default:
      return 'text-inkdim';
  }
}

// SADE mode dot tone by phase — working (denim), writing/asking (brass), ready (sage), error (clay).
function phaseTone(p: SimplePhase): string {
  switch (p) {
    case 'ready':
    case 'done':
      return 'bg-sage';
    case 'errored':
      return 'bg-clay';
    case 'writing_decisions':
    case 'asking_input':
    case 'asking_permission':
      return 'bg-brass';
    default:
      return 'bg-denim';
  }
}

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
  const runner = useRunner();
  // At architect_approval (e.g. restarted mid-plan), default to the architect tab so resume re-surfaces
  // the proposed plan. At written the role tabs are hidden and the architect is implied.
  const [role, setRole] = useState<SessionRole>(stage === 'architect_approval' ? 'architect' : 'implementer');
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<LiveSessionState>(initialSessionState);
  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [objecting, setObjecting] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [viewMode, setViewMode] = useState<'sade' | 'detail'>('sade');
  const sessionId = useRef<string | undefined>(undefined);

  // During the plan stages (written = propose, architect_approval = approve/object) the only session is the
  // architect's — role tabs are hidden. They show only past the plan stage (free-form implementer/verifier).
  const isPlanRequestStage = stage === 'written' || stage === 'architect_approval';

  async function runDrive(input: DriveInput, reset: boolean): Promise<void> {
    if (running) return;
    setRunning(true);
    if (reset) {
      sessionId.current = undefined;
      setState(initialSessionState);
    }
    try {
      for await (const ev of runner.drive(input)) {
        if (ev.kind === 'started') sessionId.current = ev.sessionId;
        setState((s) => foldSessionEvent(s, ev));
      }
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', lastError: (e as Error)?.message ?? String(e) }));
    } finally {
      setRunning(false);
    }
  }

  const requestPlan = (): void => {
    // Prompt is empty by design — main fills it from order.md (architectPromptFor). Architect → plan mode.
    void runDrive({ role: 'architect', workOrderId, mode, prompt: '' }, true);
  };
  const start = (): void => {
    void runDrive({ role, workOrderId, mode, prompt }, true);
  };
  // WO-0016: approving an architect's proposed plan commits plan.md + flips the gate (onApprovePlan),
  // then resets the live state so the reloaded detail (stage→implementation, plan rendered) is clean.
  // The architect session is done at plan_ready — it is NOT resumed off plan mode (steps are WO-0017).
  const approve = async (): Promise<void> => {
    if (role === 'architect' && effectivePlan) {
      setApproving(true);
      try {
        await onApprovePlan(effectivePlan);
        setState(initialSessionState);
      } finally {
        setApproving(false);
      }
    } else {
      void runDrive(
        { role, workOrderId, mode, prompt: 'Approved — proceed with the plan.', resume: sessionId.current, approve: true },
        false,
      );
    }
  };
  // İtiraz et (WO-0016 redesign): send the architect back to revise, in plan mode (no approve flag).
  // resolvePermissionMode keeps an architect resume in 'plan', so the next ExitPlanMode yields a new plan.
  const objectPlan = (feedback: string): void => {
    setObjecting(true);
    void runDrive(
      { role: 'architect', workOrderId, mode, prompt: feedback, resume: sessionId.current },
      false,
    ).finally(() => setObjecting(false));
  };
  // Reply to an architect clarifying question (plan mode turn that ended without a plan): resume the
  // architect with the operator's answer. "Bilmiyorum" lets the architect decide on its own.
  const reply = (answer: string): void => {
    void runDrive(
      { role: 'architect', workOrderId, mode, prompt: answer, resume: sessionId.current },
      false,
    );
    setReplyText('');
  };
  const allow = (): void => {
    if (state.pendingAsk) void runner.decide(state.pendingAsk.requestId, { allow: true });
  };
  const deny = (): void => {
    if (state.pendingAsk) void runner.decide(state.pendingAsk.requestId, { allow: false, reason: 'Denied by operator' });
  };
  const stop = (): void => {
    void runner.interrupt();
  };

  // A live plan_ready takes precedence; otherwise fall back to a plan persisted to plan.md (restart recovery,
  // WO-0020/TD-025) so the operator can still approve after the live state was lost.
  const livePlan = state.status === 'plan_ready' ? state.pendingPlan : undefined;
  const effectivePlan = livePlan ?? pendingPlan;
  const showPlan = !!effectivePlan;
  const showAsk = state.status === 'stopped_asking' && !!state.pendingAsk;
  // The architect stopped without producing a plan (plan mode turn ended, no plan_ready). In plan mode
  // that almost always means it needs input — surface its last message as an answerable question. Walk
  // back to the last assistant message in case the turn ended with a tool_result (e.g. a timed-out tool).
  const lastAssistant = [...state.entries].reverse().find((e) => e.speaker === 'assistant');
  const showQuestion = isPlanRequestStage && state.status === 'done' && !state.pendingPlan && !!lastAssistant;
  const canStart = !running && !showPlan && !approving && !showQuestion;
  // SADE mode derives one calm phase from the live state; DETAY shows the raw themed terminal.
  const phase = simplePhaseFromState(state);
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;
  // A session persisted across restart (WO-0010) — offer resume only when one exists for the role.
  const resumeSessionId = sessions.find((s) => s.role === role && s.providerSessionId)?.providerSessionId;
  const resume = (): void => {
    if (!resumeSessionId) return;
    void runDrive({ role, workOrderId, mode, prompt: prompt.trim() || 'Continue.', resume: resumeSessionId }, true);
  };

  return (
    <section className="rounded-sm border border-rule bg-surface2 p-3">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.sessionLog}</h2>
        <span className={`font-mono text-[11px] ${statusColor(state.status)}`}>{LIVE_STATUS_LABELS[state.status]}</span>
        <div className="ml-auto flex items-center gap-2">
          {hasStream ? (
            <div className="flex gap-1 rounded bg-surface p-1">
              <button type="button" aria-pressed={viewMode === 'sade'} onClick={() => setViewMode('sade')} className={`rounded px-2 py-0.5 text-[11px] ${viewMode === 'sade' ? 'bg-bg text-ink' : 'text-inkdim'}`}>{UI.modeSimple}</button>
              <button type="button" aria-pressed={viewMode === 'detail'} onClick={() => setViewMode('detail')} className={`rounded px-2 py-0.5 text-[11px] ${viewMode === 'detail' ? 'bg-bg text-ink' : 'text-inkdim'}`}>{UI.modeDetail}</button>
            </div>
          ) : null}
          {state.cost.usd > 0 ? <span className="font-mono text-[12px] text-inkdim">{formatCost(state.cost)}</span> : null}
        </div>
      </header>

      {/* Role tabs are hidden on a written work order — the only session is the architect plan session. */}
      {isPlanRequestStage ? null : (
        <div className="mb-2 flex gap-1 rounded bg-surface p-1">
          {ROLE_ORDER.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`flex-1 rounded px-2 py-1 text-xs ${r === role ? 'bg-bg text-ink' : 'text-inkdim'}`}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      )}

      {/* Controls appear only when their precondition holds (ADR-0001). Written → single "Plan iste";
           otherwise the prompt + start/resume controls. */}
      {isPlanRequestStage && canStart ? (
        <div className="mb-2">
          <button type="button" onClick={requestPlan} className="btn-primary rounded px-3 py-1.5 text-xs">
            {UI.requestPlan}
          </button>
        </div>
      ) : null}

      {!isPlanRequestStage && canStart ? (
        <div className="mb-2 flex gap-2">
          <textarea
            className="flex-1 rounded border border-rule bg-bg p-2 text-xs text-ink outline-none"
            rows={2}
            placeholder={UI.promptPlaceholder}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button type="button" onClick={start} className="btn-primary self-stretch rounded px-3 py-1 text-xs">
            {UI.startSession}
          </button>
          {resumeSessionId ? (
            <button type="button" onClick={resume} className="btn-ghost self-stretch rounded px-3 py-1 text-xs">
              {UI.resumeSession}
            </button>
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
        <div className="mb-2 flex items-stretch rounded-sm border border-rule bg-surface">
          <div className="bar bar-brass" />
          <div className="perf" />
          <div className="flex-1 px-3.5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brass">{UI.architectWaiting}</p>
            <p className="mb-1 mt-0.5 text-[12px] text-inkdim">{UI.architectQuestionHint}</p>
            <p className="mb-2 text-[14px] text-ink">{lastAssistant.text}</p>
            <div className="flex flex-col gap-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={2}
                placeholder={UI.replyPlaceholder}
                className="rounded border border-rule bg-bg p-2 text-xs text-ink outline-none"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => reply(replyText.trim() || 'Devam et.')} className="btn-primary rounded px-3 py-1 text-xs">{UI.reply}</button>
                <button type="button" onClick={() => reply('Bilmiyorum, kendin karar ver.')} className="btn-ghost rounded px-3 py-1 text-xs">{UI.skipReply}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {running ? (
        <div className="mb-2">
          <button type="button" onClick={stop} className="btn-ghost rounded px-3 py-1 text-xs">
            {UI.interrupt}
          </button>
        </div>
      ) : null}

      {showAsk && state.pendingAsk ? (
        <StopAndAskCard
          tool={state.pendingAsk.tool}
          input={state.pendingAsk.input}
          reason={state.pendingAsk.reason}
          planContext={isPlanRequestStage}
          onAllow={allow}
          onDeny={deny}
        />
      ) : null}

      {hasStream ? (
        viewMode === 'sade' ? (
          <div className="flex items-center gap-2 py-2">
            <span className={`h-1.5 w-1.5 rounded-full ${phaseTone(phase)} pulse`} />
            <span className="text-[13px] text-inkdim">{SIMPLE_PHASE_LABELS[phase]}</span>
          </div>
        ) : (
          <Terminal entries={state.entries} resetKey={state.sessionId ?? ''} />
        )
      ) : (
        <p className="text-xs text-inkdim">{UI.noSession}</p>
      )}

      {state.lastError ? <p className="mt-2 text-xs text-clay">{state.lastError}</p> : null}
    </section>
  );
}
