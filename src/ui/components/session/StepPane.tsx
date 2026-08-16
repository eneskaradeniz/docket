import { useEffect, useMemo, useRef } from 'react';
import { initialSessionState, simplePhaseFromState, seedLiveState, type DriveInput, type LiveSessionState } from '../../../core/runner';
import type { SessionRef, StepView, WorkOrderId } from '../../../core/types';
import { PROVIDER_ERROR_LABELS, SIMPLE_PHASE_LABELS, UI } from '../../data/labels';
import { PaneError, PaneShell, PhaseLine } from './pane-chrome';
import { useDrive, useDriveStore } from './drive-store';
import { Terminal } from './Terminal';
import { useViewMode } from '../../data/view-mode';

// The step session INSTRUMENT (WO-0017 → WO-0031c). Drives ONE plan step through the SessionRunner
// port — role/scope/stepIndex come from the step; main assembles the prompt server-side. The console
// chrome moved out of the pane (strip = cost/status, rail = Durdur + Sürdür, controller = ask cards;
// the Faz B dead `onClick={stop}` and its duplicate button are GONE). What remains: the auto-drive of
// a pending step, the fold subscription, and the instrument (PhaseLine / terminal). On turn_complete
// the drive ends and the App-level onEnd reloads the detail so the step shows done + next is runnable.
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
  // The seed RESULT is memoized: useSyncExternalStore re-samples getSnapshot after mount, and a fresh
  // object per call (any session with a transcript) force-rerenders forever (React #185 — surfaced by
  // WO-0031c's persisted-session E2E seed; latent since F14).
  const seedState = useMemo<LiveSessionState>(
    () => seedLiveState(sessions.find((s) => s.stepIdx === step.idx && s.providerSessionId) ?? { transcript: [] }),
    [sessions, step.idx],
  );
  const state = useDrive(store, driveKey, () => seedState);
  const { mode: viewMode } = useViewMode();
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
  // auto-drive — the rail offers "Sürdür" so the operator chooses to resume.
  useEffect(() => {
    if (step.status === 'pending' && lastDriven.current !== step.idx) {
      lastDriven.current = step.idx;
      drive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.idx, step.status]);

  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const phase = simplePhaseFromState(state);
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;

  return (
    <PaneShell tone={state.status === 'error' ? 'error' : state.status === 'stopped_asking' ? 'signal' : state.status === 'running' ? 'run' : state.status === 'done' ? 'done' : 'idle'}>
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
