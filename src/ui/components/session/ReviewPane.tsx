import { useEffect, useRef, useState } from 'react';
import { initialSessionState, simplePhaseFromState } from '../../../core/runner';
import type { StepView, WorkOrderId } from '../../../core/types';
import { PROVIDER_ERROR_LABELS, formatCost, SIMPLE_PHASE_LABELS, UI } from '../../data/labels';
import { Button } from '../../kit';
import { CostReadout, PaneError, PaneHeader, PaneShell, PhaseLine, ViewModeToggle } from './pane-chrome';
import { useDrive, useDriveStore } from './drive-store';
import { StopAndAskCard } from './StopAndAskCard';
import { Terminal } from './Terminal';

// The architect REVIEW pane (WO-0020). After a step's report is written, this drives the architect to review
// it and emit a VERDICT. Sibling to StepPane: reuses the event fold, Terminal, StopAndAskCard and the SADE/DETAY
// toggle, but drives role:'architect' + reviewStepIndex (main fills the review prompt + captures the verdict).
// Auto-drives on mount (the review was triggered because the step is done + has no verdict); on turn_complete
// the drive ends and onReviewDone reloads the detail so the step's verdict shows + the loop branches.

export function ReviewPane({
  step,
  workOrderId,
}: {
  step: StepView;
  workOrderId: WorkOrderId;
}) {
  const store = useDriveStore();
  // WO-0028 / Bulgu 12: review drives live in the app-level store like every other drive — the pane is
  // just a window onto them; the store's onEnd refreshes the detail when the review completes.
  const driveKey = `${workOrderId}:review:${step.idx}`;
  const state = useDrive(store, driveKey, () => initialSessionState);
  const running = store.get(driveKey)?.running ?? false;
  const [viewMode, setViewMode] = useState<'sade' | 'detail'>('sade');
  const lastDriven = useRef<number | undefined>(undefined);

  function drive(): void {
    store.start(driveKey, { role: 'architect', workOrderId, mode: 'direct', reviewStepIndex: step.idx, prompt: '' }, initialSessionState);
  }

  useEffect(() => {
    if (lastDriven.current !== step.idx) {
      lastDriven.current = step.idx;
      drive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.idx]);

  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const phase = simplePhaseFromState(state);
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;

  return (
    <PaneShell tone={state.status === 'error' ? 'error' : state.status === 'stopped_asking' ? 'signal' : state.status === 'running' ? 'run' : state.status === 'done' ? 'done' : 'idle'}>
      <PaneHeader
        title={`${UI.reviewHeader} · ${step.idx}`}
        status={state.status}
        right={
          <>
            {running ? <Button variant="ghost" size="sm" onClick={stop}>{UI.interrupt}</Button> : null}
            {hasStream ? <ViewModeToggle value={viewMode} onValueChange={setViewMode} /> : null}
            <CostReadout cost={state.cost.usd > 0 ? formatCost(state.cost) : undefined} />
          </>
        }
      />

      {!hasStream ? <p className="text-xs text-inkdim">{UI.reviewHint}</p> : null}

      {running ? (
        <div className="mb-2">
          <button type="button" onClick={() => void store.interrupt()} className="rounded-md border border-hairline px-3 py-1 text-xs text-inkdim transition-colors hover:bg-raised hover:text-ink">
            {UI.interrupt}
          </button>
        </div>
      ) : null}

      {showAsk ? (
        <div className="mb-2">
          {state.pendingAsks.length > 1 ? (
            <div className="mb-1 flex items-center gap-2">
              <p className="readout text-signal">{UI.asksPending(state.pendingAsks.length)}</p>
              <Button variant="signal" size="sm" onClick={() => { for (const a of state.pendingAsks) void store.decide(a.requestId, { allow: true }); }}>{UI.allowAll}</Button>
            </div>
          ) : null}
          {state.pendingAsks.map((a) => (
            <StopAndAskCard
              key={a.requestId}
              tool={a.tool}
              input={a.input}
              reason={a.reason}
              planContext={false}
              onAllow={() => void store.decide(a.requestId, { allow: true })}
              onDeny={() => void store.decide(a.requestId, { allow: false, reason: 'Denied by operator' })}
            />
          ))}
        </div>
      ) : null}

      {hasStream ? (
        viewMode === 'sade' ? (
          <PhaseLine phase={phase} label={phase === 'asking_permission' ? UI.askingRole('architect') : SIMPLE_PHASE_LABELS[phase]} />
        ) : (
          <Terminal entries={state.entries} resetKey={state.sessionId ?? ''} />
        )
      ) : null}

      {state.lastError ? (
        <PaneError message={state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : state.lastError} />
      ) : null}
    </PaneShell>
  );
}
