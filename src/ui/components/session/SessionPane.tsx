import { useRef, useState } from 'react';
import {
  foldSessionEvent,
  initialSessionState,
  type DriveInput,
  type LiveSessionState,
} from '../../../core/runner';
import type { SessionRef, SessionRole, StageId, WorkOrderId } from '../../../core/types';
import { formatUsd, LIVE_STATUS_LABELS, ROLE_LABELS, UI } from '../../data/labels';
import { useRunner } from './runner-context';
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

export function SessionPane({
  mode,
  stage,
  workOrderId,
  sessions,
  onApprovePlan,
}: {
  mode: 'plan' | 'direct';
  stage: StageId;
  workOrderId: WorkOrderId;
  sessions: SessionRef[];
  onApprovePlan: (planText: string) => Promise<void>;
}) {
  const runner = useRunner();
  // At architect_approval (e.g. restarted mid-plan), default to the architect tab so resume re-surfaces
  // the proposed plan. At written the role tabs are hidden and the architect is implied.
  const [role, setRole] = useState<SessionRole>(stage === 'architect_approval' ? 'architect' : 'implementer');
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<LiveSessionState>(initialSessionState);
  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);

  const isPlanRequestStage = stage === 'written';

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
    if (role === 'architect' && state.pendingPlan) {
      setApproving(true);
      try {
        await onApprovePlan(state.pendingPlan);
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
  const allow = (): void => {
    if (state.pendingAsk) void runner.decide(state.pendingAsk.requestId, { allow: true });
  };
  const deny = (): void => {
    if (state.pendingAsk) void runner.decide(state.pendingAsk.requestId, { allow: false, reason: 'Denied by operator' });
  };
  const stop = (): void => {
    void runner.interrupt();
  };

  const showPlan = state.status === 'plan_ready' && !!state.pendingPlan;
  const showAsk = state.status === 'stopped_asking' && !!state.pendingAsk;
  const canStart = !running && !showPlan && !approving;
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
        {state.cost.usd > 0 ? <span className="ml-auto font-mono text-[12px] text-inkdim">{formatUsd(state.cost.usd)}</span> : null}
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

      {showPlan ? (
        <div className="mb-2 rounded border border-rule bg-surface p-2">
          <p className="mb-1 text-xs text-inkdim">{UI.awaitingApproval}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-ink">{state.pendingPlan}</pre>
          <div className="mt-2">
            {/* While committing, the approve control is absent — ADR-0001. */}
            {approving ? (
              <span className="text-xs text-inkdim">{UI.approvingPlan}</span>
            ) : (
              <button type="button" onClick={() => void approve()} className="btn-primary rounded px-3 py-1 text-xs">
                {UI.approve}
              </button>
            )}
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
          onAllow={allow}
          onDeny={deny}
        />
      ) : null}

      {state.entries.length > 0 || state.status === 'running' || showAsk ? (
        <Terminal entries={state.entries} resetKey={state.sessionId ?? ''} />
      ) : (
        <p className="text-xs text-inkdim">{UI.noSession}</p>
      )}

      {state.lastError ? <p className="mt-2 text-xs text-clay">{state.lastError}</p> : null}
    </section>
  );
}
