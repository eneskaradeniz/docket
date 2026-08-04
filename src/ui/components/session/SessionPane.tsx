import { useRef, useState } from 'react';
import {
  foldSessionEvent,
  initialSessionState,
  type DriveInput,
  type LiveSessionState,
} from '../../../core/runner';
import type { SessionRole } from '../../../core/types';
import type { BadgeTone } from '../primitives/Badge';
import { formatUsd, LIVE_STATUS_LABELS, ROLE_LABELS, UI } from '../../data/labels';
import { Badge } from '../primitives/Badge';
import { useRunner } from './runner-context';
import { StopAndAskCard } from './StopAndAskCard';
import { Transcript } from './Transcript';

// Live session pane (WO-0008). Replaces the provisional fixture-driven pane: it drives a
// real session through the SessionRunner port, folds the event stream into state
// (core's foldSessionEvent), and maps each event kind to a region — transcript,
// stop-and-ask card, plan approval, cost. No xterm, no persistence (deferred M2).
const ROLE_ORDER: SessionRole[] = ['implementer', 'architect', 'verifier'];

function statusTone(s: LiveSessionState['status']): BadgeTone {
  switch (s) {
    case 'running':
      return 'info';
    case 'stopped_asking':
      return 'warn';
    case 'plan_ready':
      return 'info';
    case 'done':
      return 'ok';
    case 'error':
      return 'bad';
    default:
      return 'neutral';
  }
}

export function SessionPane({ mode }: { mode: 'plan' | 'direct' }) {
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

  const cwd = window.docket.repoCwd;
  const start = (): void => {
    void runDrive({ role, cwd, mode, prompt }, true);
  };
  const approve = (): void => {
    void runDrive(
      { role, cwd, mode, prompt: 'Approved — proceed with the plan.', resume: sessionId.current, approve: true },
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

  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800">{UI.session}</h2>
        <Badge tone={statusTone(state.status)}>{LIVE_STATUS_LABELS[state.status]}</Badge>
        {state.cost.usd > 0 ? <span className="text-xs text-slate-400">{formatUsd(state.cost.usd)}</span> : null}
      </header>

      <div className="mb-2 flex gap-1">
        {ROLE_ORDER.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`rounded-md px-2 py-1 text-xs ${
              r === role
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>

      {/* Controls appear only when their precondition holds (ADR-0001): Start needs a
          prompt and a non-running state; Approve appears only at plan_ready; Stop only
          while running. An unmet action is absent, never a greyed-out control. */}
      {canStart ? (
        <div className="mb-2 flex gap-2">
          <textarea
            className="flex-1 rounded-md border border-slate-300 bg-white p-2 text-xs text-slate-700"
            rows={2}
            placeholder={UI.promptPlaceholder}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            type="button"
            onClick={start}
            className="self-stretch rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700"
          >
            {UI.startSession}
          </button>
        </div>
      ) : null}

      {showPlan ? (
        <div className="mb-2 rounded-md border border-slate-300 bg-white p-2">
          <p className="mb-1 text-xs text-slate-500">{UI.awaitingApproval}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-700">{state.pendingPlan}</pre>
          <div className="mt-2">
            <button
              type="button"
              onClick={approve}
              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            >
              {UI.approve}
            </button>
          </div>
        </div>
      ) : null}

      {running ? (
        <div className="mb-2">
          <button
            type="button"
            onClick={stop}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
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
        <Transcript entries={state.entries} />
      ) : (
        <p className="text-xs text-slate-400">{UI.noSession}</p>
      )}

      {state.lastError ? <p className="mt-2 text-xs text-rose-600">{state.lastError}</p> : null}
    </section>
  );
}
