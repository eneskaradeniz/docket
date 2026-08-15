import { useEffect, useRef, useState } from 'react';
import {
  foldSessionEvent,
  initialSessionState,
  simplePhaseFromState,
  type DriveInput,
  type LiveSessionState,
  type SimplePhase,
  seedLiveState,
} from '../../../core/runner';
import type { SessionRef, StepView, WorkOrderId } from '../../../core/types';
import { PROVIDER_ERROR_LABELS, formatCost, LIVE_STATUS_LABELS, ROLE_LABELS, SIMPLE_PHASE_LABELS, UI } from '../../data/labels';
import { useRunner } from './runner-context';
import { StopAndAskCard } from './StopAndAskCard';
import { Terminal } from './Terminal';

// The step session pane (WO-0017). Drives ONE plan step through the SessionRunner port — role/scope/stepIndex
// come from the step; main assembles the prompt server-side. It reuses the same event fold, Terminal,
// StopAndAskCard and SADE/DETAY toggle as SessionPane, but has no role tabs and no plan/question cards (those
// belong to the architect plan flow). A pending step auto-drives on mount (the operator clicked Çalıştır in
// the list to get here); an 'active' step (interrupted at restart) offers "Sürdür" instead. On turn_complete
// the drive ends and onDone reloads the detail so the step shows done + the next becomes runnable.

function statusColor(s: LiveSessionState['status']): string {
  switch (s) {
    case 'running':
      return 'text-denim';
    case 'stopped_asking':
      return 'text-brass';
    case 'done':
      return 'text-sage';
    case 'error':
      return 'text-clay';
    default:
      return 'text-inkdim';
  }
}

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

export function StepPane({
  step,
  workOrderId,
  sessions,
  onDone,
}: {
  step: StepView;
  workOrderId: WorkOrderId;
  sessions: SessionRef[];
  onDone: () => void;
}) {
  const runner = useRunner();
  // F14 (WO-0026): seed from this step's persisted session — a reopened step pane shows prior activity.
  const [state, setState] = useState<LiveSessionState>(() =>
    seedLiveState(sessions.find((s) => s.stepIdx === step.idx && s.providerSessionId) ?? { transcript: [] }),
  );
  const [running, setRunning] = useState(false);
  const [viewMode, setViewMode] = useState<'sade' | 'detail'>('sade');
  const sessionId = useRef<string | undefined>(state.sessionId); // seeded (F14)
  const lastDriven = useRef<number | undefined>(undefined);

  function drive(resume?: string): void {
    if (running) return;
    setRunning(true);
    if (!resume) setState(initialSessionState);
    const input: DriveInput = {
      role: step.role,
      workOrderId,
      mode: 'direct',
      scope: step.scopeTrackId,
      stepIndex: step.idx,
      prompt: '',
      ...(resume ? { resume } : {}),
    };
    void (async () => {
      try {
        for await (const ev of runner.drive(input)) {
          if (ev.kind === 'started') sessionId.current = ev.sessionId;
          setState((s) => foldSessionEvent(s, ev));
        }
      } catch (e) {
        setState((s) => ({ ...s, status: 'error', lastError: (e as Error)?.message ?? String(e) }));
      } finally {
        setRunning(false);
        onDone();
      }
    })();
  }

  // Auto-drive a pending step once when it becomes the active step. An 'active' step (interrupted) does not
  // auto-drive — it offers "Sürdür" below so the operator chooses to resume.
  useEffect(() => {
    if (step.status === 'pending' && lastDriven.current !== step.idx) {
      lastDriven.current = step.idx;
      drive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.idx, step.status]);

  const resumeId = sessions.find((s) => s.stepIdx === step.idx && s.providerSessionId)?.providerSessionId;
  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const phase = simplePhaseFromState(state);
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;

  return (
    <section className="rounded-sm border border-rule bg-surface2 p-3">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-inkdim">
          {UI.sessionLog} · {ROLE_LABELS[step.role]} {step.idx}
        </h2>
        <span className={`font-mono text-[11px] ${statusColor(state.status)}`}>{LIVE_STATUS_LABELS[state.status]}</span>
        <div className="ml-auto flex items-center gap-2">
          {hasStream ? (
            <div className="flex gap-1 rounded bg-surface p-1">
              <button type="button" aria-pressed={viewMode === 'sade'} onClick={() => setViewMode('sade')} className={`rounded px-2 py-0.5 text-[11px] ${viewMode === 'sade' ? 'bg-bg text-ink' : 'text-inkdim'}`}>
                {UI.modeSimple}
              </button>
              <button type="button" aria-pressed={viewMode === 'detail'} onClick={() => setViewMode('detail')} className={`rounded px-2 py-0.5 text-[11px] ${viewMode === 'detail' ? 'bg-bg text-ink' : 'text-inkdim'}`}>
                {UI.modeDetail}
              </button>
            </div>
          ) : null}
          {state.cost.usd > 0 ? <span className="font-mono text-[12px] text-inkdim">{formatCost(state.cost)}</span> : null}
        </div>
      </header>

      {step.status === 'active' && !running && resumeId ? (
        <div className="mb-2">
          <button type="button" onClick={() => drive(resumeId)} className="btn-ghost rounded px-3 py-1 text-xs">
            {UI.stepResume}
          </button>
        </div>
      ) : null}

      {running ? (
        <div className="mb-2">
          <button type="button" onClick={() => void runner.interrupt()} className="btn-ghost rounded px-3 py-1 text-xs">
            {UI.interrupt}
          </button>
        </div>
      ) : null}

      {showAsk ? (
        <div className="mb-2">
          {state.pendingAsks.length > 1 ? (
            <div className="mb-1 flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brass">{UI.asksPending(state.pendingAsks.length)}</p>
              <button type="button" onClick={() => { for (const a of state.pendingAsks) void runner.decide(a.requestId, { allow: true }); }} className="alink text-[11px]">{UI.allowAll}</button>
            </div>
          ) : null}
          {state.pendingAsks.map((a) => (
            <StopAndAskCard
              key={a.requestId}
              tool={a.tool}
              input={a.input}
              reason={a.reason}
              planContext={false}
              onAllow={() => void runner.decide(a.requestId, { allow: true })}
              onDeny={() => void runner.decide(a.requestId, { allow: false, reason: 'Denied by operator' })}
            />
          ))}
        </div>
      ) : null}

      {hasStream ? (
        viewMode === 'sade' ? (
          <div className="flex items-center gap-2 py-2">
            <span className={`h-1.5 w-1.5 rounded-full ${phaseTone(phase)} pulse`} />
            <span className="text-[13px] text-inkdim">{phase === 'asking_permission' ? UI.askingRole(step.role) : SIMPLE_PHASE_LABELS[phase]}</span>
          </div>
        ) : (
          <Terminal entries={state.entries} resetKey={state.sessionId ?? ''} />
        )
      ) : (
        <p className="text-xs text-inkdim">{UI.noSession}</p>
      )}

      {state.lastError ? (
        <p className="mt-2 text-xs text-clay">
          {state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : state.lastError}
        </p>
      ) : null}
    </section>
  );
}
