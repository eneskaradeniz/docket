import { useEffect, useMemo, useRef } from 'react';
import { initialSessionState, simplePhaseFromState, seedLiveState, type DriveInput, type LiveSessionState } from '../../../core/runner';
import type { SessionRef, StepView, WorkOrderId } from '../../../core/types';
import { PROVIDER_ERROR_LABELS, ROLE_LABELS, SIMPLE_PHASE_LABELS, UI } from '../../data/labels';
import { PaneError, PaneShell, PhaseLine, StreamLine } from './pane-chrome';
import { useDrive, useDriveStore } from './drive-store';
import { Terminal } from './Terminal';
import { useViewMode } from '../../data/view-mode';
import { formatUsd } from '../../data/labels';

// The step session INSTRUMENT (WO-0017 → WO-0031c → WO-0031f). Drives ONE plan step through the
// SessionRunner port — role/scope/stepIndex come from the step; main assembles the prompt server-side.
// The console chrome moved out of the pane long ago (strip = cost/status, rail = Durdur + Sürdür,
// controller = ask cards). What remains: the auto-drive of a pending step, the fold subscription, and
// the instrument itself. On turn_complete the drive ends and the App-level onEnd reloads the detail so
// the step shows done + the next is runnable.
//
// WO-0031f v6: DETAY no longer has an instrument card for steps — the pane renders INSIDE its spine
// row, pinned open while the session runs (the live thing is never hidden behind a toggle): a
// `Rol · canlı` readout + the live `$ · ⏱` costline over a compact terminal. SADE keeps the one calm
// card (PhaseLine) — the two modes share the drive logic verbatim.
export function StepPane({
  step,
  workOrderId,
  sessions,
  now,
}: {
  step: StepView;
  workOrderId: WorkOrderId;
  sessions: SessionRef[];
  /** The controller's one-second ticker (the strip's) — the live costline's elapsed reuses it. */
  now?: number;
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
  // F7: running but nothing written yet — one honest line instead of a blank canvas.
  const emptyRun = state.status === 'running' && state.entries.length === 0;

  // The DETAY row form's live costline (v6: `$3.60 · 00:14`) — the drive's cost plus its elapsed.
  const running = store.get(driveKey)?.running ?? false;
  const liveStart = store.get(driveKey)?.startedAt;
  const costline = [
    state.cost.usd > 0 ? formatUsd(state.cost.usd) : undefined,
    running && liveStart && now ? UI.formatDuration(Math.max(0, now - liveStart)) : undefined,
  ]
    .filter((x): x is string => x !== undefined)
    .join(' · ');

  if (viewMode === 'detail') {
    return (
      <div className="mt-2 flex flex-col gap-1.5" data-step-live={step.idx}>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="readout truncate">
            {ROLE_LABELS[step.role]} · {UI.termLive}
          </span>
          {costline ? <span className="shrink-0 font-mono text-[10.5px] text-inkdim">{costline}</span> : null}
        </div>
        {emptyRun ? (
          <StreamLine />
        ) : hasStream ? (
          <Terminal entries={state.entries} resetKey={state.sessionId ?? ''} compact />
        ) : (
          <p className="text-xs text-inkdim">{UI.noSession}</p>
        )}
        {state.lastError ? (
          <PaneError message={state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : state.lastError} />
        ) : null}
      </div>
    );
  }

  return (
    <PaneShell tone={state.status === 'error' ? 'error' : state.status === 'stopped_asking' ? 'signal' : state.status === 'running' ? 'run' : state.status === 'done' ? 'done' : 'idle'}>
      {hasStream ? (
        // F7 rides the SADE phase line while the stream is empty — the same line, calmer skin.
        <PhaseLine
          phase={phase}
          label={emptyRun ? UI.streamOpened : phase === 'asking_permission' ? UI.askingRole(step.role) : SIMPLE_PHASE_LABELS[phase]}
        />
      ) : (
        <p className="text-xs text-inkdim">{UI.noSession}</p>
      )}

      {state.lastError ? (
        <PaneError message={state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : state.lastError} />
      ) : null}
    </PaneShell>
  );
}
