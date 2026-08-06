import { useEffect, useRef, useState } from 'react';
import {
  foldSessionEvent,
  initialSessionState,
  simplePhaseFromState,
  type DriveInput,
  type LiveSessionState,
  type SimplePhase,
} from '../../../core/runner';
import type { StepView, WorkOrderId } from '../../../core/types';
import { formatCost, LIVE_STATUS_LABELS, SIMPLE_PHASE_LABELS, UI } from '../../data/labels';
import { useRunner } from './runner-context';
import { StopAndAskCard } from './StopAndAskCard';
import { Terminal } from './Terminal';

// The architect REVIEW pane (WO-0020). After a step's report is written, this drives the architect to review
// it and emit a VERDICT. Sibling to StepPane: reuses the event fold, Terminal, StopAndAskCard and the SADE/DETAY
// toggle, but drives role:'architect' + reviewStepIndex (main fills the review prompt + captures the verdict).
// Auto-drives on mount (the review was triggered because the step is done + has no verdict); on turn_complete
// the drive ends and onReviewDone reloads the detail so the step's verdict shows + the loop branches.

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

export function ReviewPane({
  step,
  workOrderId,
  onReviewDone,
}: {
  step: StepView;
  workOrderId: WorkOrderId;
  onReviewDone: () => void;
}) {
  const runner = useRunner();
  const [state, setState] = useState<LiveSessionState>(initialSessionState);
  const [running, setRunning] = useState(false);
  const [viewMode, setViewMode] = useState<'sade' | 'detail'>('sade');
  const sessionId = useRef<string | undefined>(undefined);
  const lastDriven = useRef<number | undefined>(undefined);

  function drive(): void {
    if (running) return;
    setRunning(true);
    setState(initialSessionState);
    const input: DriveInput = { role: 'architect', workOrderId, mode: 'direct', reviewStepIndex: step.idx, prompt: '' };
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
        onReviewDone();
      }
    })();
  }

  useEffect(() => {
    if (lastDriven.current !== step.idx) {
      lastDriven.current = step.idx;
      drive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.idx]);

  const showAsk = state.status === 'stopped_asking' && !!state.pendingAsk;
  const phase = simplePhaseFromState(state);
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;

  return (
    <section className="rounded-sm border border-rule bg-surface2 p-3">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-inkdim">
          {UI.reviewHeader} · {step.idx}
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

      {!hasStream ? <p className="text-xs text-inkdim">{UI.reviewHint}</p> : null}

      {running ? (
        <div className="mb-2">
          <button type="button" onClick={() => void runner.interrupt()} className="btn-ghost rounded px-3 py-1 text-xs">
            {UI.interrupt}
          </button>
        </div>
      ) : null}

      {showAsk && state.pendingAsk ? (
        <StopAndAskCard
          tool={state.pendingAsk.tool}
          input={state.pendingAsk.input}
          reason={state.pendingAsk.reason}
          planContext={false}
          onAllow={() => void runner.decide(state.pendingAsk!.requestId, { allow: true })}
          onDeny={() => void runner.decide(state.pendingAsk!.requestId, { allow: false, reason: 'Denied by operator' })}
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
      ) : null}

      {state.lastError ? <p className="mt-2 text-xs text-clay">{state.lastError}</p> : null}
    </section>
  );
}
