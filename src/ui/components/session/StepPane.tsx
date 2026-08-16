import { useEffect, useRef, useState } from 'react';
import {
  initialSessionState,
  simplePhaseFromState,
  type DriveInput,
  type LiveSessionState,

  seedLiveState,
} from '../../../core/runner';
import type { SessionRef, StepView, WorkOrderId } from '../../../core/types';
import { PROVIDER_ERROR_LABELS, formatCost, ROLE_LABELS, SIMPLE_PHASE_LABELS, UI } from '../../data/labels';
import { Button } from '../../kit';
import { CostReadout, PaneError, PaneHeader, PaneShell, PhaseLine, ViewModeToggle } from './pane-chrome';
import { useDrive, useDriveStore } from './drive-store';
import { StopAndAskCard } from './StopAndAskCard';
import { Terminal } from './Terminal';

// The step session pane (WO-0017). Drives ONE plan step through the SessionRunner port — role/scope/stepIndex
// come from the step; main assembles the prompt server-side. It reuses the same event fold, Terminal,
// StopAndAskCard and SADE/DETAY toggle as SessionPane, but has no role tabs and no plan/question cards (those
// belong to the architect plan flow). A pending step auto-drives on mount (the operator clicked Çalıştır in
// the list to get here); an 'active' step (interrupted at restart) offers "Sürdür" instead. On turn_complete
// the drive ends and onDone reloads the detail so the step shows done + the next becomes runnable.

export function StepPane({
  step,
  workOrderId,
  sessions,
}: {
  step: StepView;
  workOrderId: WorkOrderId;
  sessions: SessionRef[];
}) {
  const store = useDriveStore();
  // WO-0028 / Bulgu 12: the drive lives in the app-level store — navigation keeps it running; this pane
  // re-binds to the LIVE fold state on remount, falling back to the persisted seed (F14) after a restart.
  const driveKey = `${workOrderId}:step:${step.idx}`;
  const seed = (): LiveSessionState =>
    seedLiveState(sessions.find((s) => s.stepIdx === step.idx && s.providerSessionId) ?? { transcript: [] });
  const state = useDrive(store, driveKey, seed);
  const running = store.get(driveKey)?.running ?? false;
  const [viewMode, setViewMode] = useState<'sade' | 'detail'>('sade');
  const lastDriven = useRef<number | undefined>(undefined);

  function drive(resume?: string): void {
    const input: DriveInput = {
      role: step.role,
      workOrderId,
      mode: 'direct',
      scope: step.scopeTrackId,
      stepIndex: step.idx,
      prompt: '',
      ...(resume ? { resume } : {}),
    };
    // A resume seeds from the CURRENT state so the new stream appends (F14); a fresh drive resets.
    store.start(driveKey, input, resume ? state : initialSessionState);
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
  // WO-0029 / 7b+7c: per-step session duration + live ticking elapsed while the step runs.
  const matchedSession = sessions.find((s) => s.stepIdx === step.idx && s.providerSessionId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const liveStart = store.get(driveKey)?.startedAt;
  const durationText = running && liveStart
    ? UI.formatDuration(Math.max(0, now - liveStart))
    : matchedSession?.startedAt && matchedSession?.endedAt
      ? UI.formatDuration(new Date(matchedSession.endedAt).getTime() - new Date(matchedSession.startedAt).getTime())
      : undefined;
  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const phase = simplePhaseFromState(state);
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;

  return (
    <PaneShell tone={state.status === 'error' ? 'error' : state.status === 'stopped_asking' ? 'signal' : state.status === 'running' ? 'run' : state.status === 'done' ? 'done' : 'idle'}>
      <PaneHeader
        title={`${UI.sessionLog} · ${ROLE_LABELS[step.role]} ${step.idx}`}
        status={state.status}
        right={
          <>
            {running ? <Button variant="ghost" size="sm" onClick={stop}>{UI.interrupt}</Button> : null}
            {hasStream ? <ViewModeToggle value={viewMode} onValueChange={setViewMode} /> : null}
            <CostReadout cost={state.cost.usd > 0 ? formatCost(state.cost) : undefined} duration={durationText} />
          </>
        }
      />

      {step.status === 'active' && !running && resumeId ? (
        <div className="mb-2">
          <button type="button" onClick={() => drive(resumeId)} className="rounded-md border border-hairline px-3 py-1 text-xs text-inkdim transition-colors hover:bg-raised hover:text-ink">
            {UI.stepResume}
          </button>
        </div>
      ) : null}

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
          <PhaseLine phase={phase} label={phase === 'asking_permission' ? UI.askingRole(step.role) : SIMPLE_PHASE_LABELS[phase]} />
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
