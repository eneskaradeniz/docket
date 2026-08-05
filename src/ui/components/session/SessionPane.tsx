import { useRef, useState } from 'react';
import {
  foldSessionEvent,
  initialSessionState,
  type DriveInput,
  type LiveSessionState,
} from '../../../core/runner';
import type { SessionRef, SessionRole, WorkOrderId } from '../../../core/types';
import { formatUsd, LIVE_STATUS_LABELS, ROLE_LABELS, UI } from '../../data/labels';
import { useRunner } from './runner-context';
import { StopAndAskCard } from './StopAndAskCard';
import { Terminal } from './Terminal';

// Live session pane (WO-0008). Drives a real session through the SessionRunner port, folds the event
// stream into state (core's foldSessionEvent), and maps each event kind to a region — an xterm
// terminal (WO-0012), stop-and-ask card, plan approval, cost. Sessions persist + resume (WO-0010).
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
  workOrderId,
  sessions,
}: {
  mode: 'plan' | 'direct';
  workOrderId: WorkOrderId;
  sessions: SessionRef[];
}) {
  const runner = useRunner();
  const [role, setRole] = useState<SessionRole>('implementer');
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<LiveSessionState>(initialSessionState);
  const [running, setRunning] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);

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

  const start = (): void => {
    void runDrive({ role, workOrderId, mode, prompt }, true);
  };
  const approve = (): void => {
    void runDrive(
      { role, workOrderId, mode, prompt: 'Approved — proceed with the plan.', resume: sessionId.current, approve: true },
      false,
    );
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
  const canStart = !running && !showPlan;
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

      {/* Controls appear only when their precondition holds (ADR-0001): Start needs a non-running
          state; Approve appears only at plan_ready; Stop only while running. Unmet → absent. */}
      {canStart ? (
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
            <button type="button" onClick={approve} className="btn-primary rounded px-3 py-1 text-xs">
              {UI.approve}
            </button>
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
