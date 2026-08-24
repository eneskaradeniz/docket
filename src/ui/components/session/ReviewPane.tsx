import { useEffect, useRef } from 'react';
import { initialSessionState } from '../../../core/runner';
import type { StepView, WorkOrderId } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { PaneError, PaneShell } from './pane-chrome';
import { DriveControls, type DriveState } from './DriveControls';
import { useDrive, useDriveStore } from './drive-store';
import { ChatTranscript } from './ChatTranscript';

// The architect REVIEW instrument (WO-0020 → WO-0031c). After a step's report is written, this drives
// the architect to review it and emit a VERDICT (role:'architect' + reviewStepIndex; main fills the
// review prompt + captures the verdict). Chrome moved out (strip/rail/controller, as StepPane); what
// remains is the auto-drive, the fold subscription, and the instrument. On turn_complete the App-level
// onEnd reloads the detail so the step's verdict shows + the loop branches.
export function ReviewPane({
  step,
  workOrderId,
  drive,
}: {
  step: StepView;
  workOrderId: WorkOrderId;
  /** WO-0039: the active drive's process controls in this pane's header (the dead rail's job). */
  drive?: DriveState;
}) {
  const { PROVIDER_ERROR_LABELS, UI } = useLabels();
  const store = useDriveStore();
  // WO-0028 / Bulgu 12: review drives live in the app-level store like every other drive — the pane is
  // just a window onto them; the store's onEnd refreshes the detail when the review completes.
  const driveKey = `${workOrderId}:review:${step.idx}`;
  const state = useDrive(store, driveKey, () => initialSessionState);
  const lastDriven = useRef<number | undefined>(undefined);

  function startDrive(): void {
    store.start(driveKey, { role: 'architect', workOrderId, mode: 'direct', reviewStepIndex: step.idx, prompt: '' }, initialSessionState);
  }

  useEffect(() => {
    if (lastDriven.current !== step.idx) {
      lastDriven.current = step.idx;
      startDrive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.idx]);

  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;

  return (
    <PaneShell tone={state.status === 'error' ? 'error' : state.status === 'stopped_asking' ? 'signal' : state.status === 'running' ? 'run' : state.status === 'done' ? 'done' : 'idle'}>
      {/* WO-0039: the process-control header (readout + Durdur/Zorla kes/▶ Sürdür). */}
      {drive ? (
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 items-center gap-2">
            {store.get(driveKey)?.running && !(store.get(driveKey)?.booting ?? false) ? (
              <span className="dot-run shrink-0" aria-hidden="true" />
            ) : null}
            <span className="readout truncate">{UI.reviewHeader}</span>
          </span>
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2.5">
            <DriveControls drive={drive} />
          </div>
        </div>
      ) : null}
      {!hasStream ? <p className="text-xs text-inkdim">{UI.reviewHint}</p> : null}

      {hasStream ? (
        <ChatTranscript entries={state.entries} role="architect" resetKey={state.sessionId ?? ''} />
      ) : null}

      {state.status === 'error' || state.lastError ? (
        <PaneError message={state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : (state.lastError ?? UI.driveStreamCrashed)} />
      ) : null}
    </PaneShell>
  );
}
