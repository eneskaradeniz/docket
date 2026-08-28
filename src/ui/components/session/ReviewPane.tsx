import { useEffect, useRef } from 'react';
import { initialSessionState } from '../../../core/runner';
import type { StepView, WorkOrderId } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { PaneCostline, PaneError, PaneShell, PaneLogChip, PaneSteerBar, PaneWarnline, usePaneActivity, usePaneLog } from './pane-chrome';
import { DriveControls, type DriveState } from './DriveControls';
import { useDrive, useDriveStore } from './drive-store';
import { ChatTranscript } from './ChatTranscript';

// The architect REVIEW instrument (WO-0020 → WO-0031c). After a step's report is written, this drives
// the architect to review it and emit a VERDICT (role:'architect' + reviewStepIndex; main fills the
// review prompt + captures the verdict). Chrome moved out (strip/rail/controller, as StepPane); what
// remains is the auto-drive, the fold subscription, and the instrument. On turn_complete the App-level
// onEnd reloads the detail so the step's verdict shows + the loop branches.
//
// WO-0044 (2026-08-25): the ONE live grammar reaches the review surface too — the header is the
// activity line (`● MİMAR DENETİMİ — Dosya okuyor···` + costline + DriveControls) and the Ray column
// rides behind the döküm chip, closed by default; the always-open transcript died with the step
// surface's. Three live surfaces, one language.
export function ReviewPane({
  step,
  workOrderId,
  drive,
  now,
  autoStart = true,
  onRetractStoppedSteer,
}: {
  step: StepView;
  workOrderId: WorkOrderId;
  /** WO-0039: the active drive's process controls in this pane's header (the dead rail's job). */
  drive?: DriveState;
  /** The controller's one-second ticker — the live costline's elapsed reuses it (pane parity). */
  now?: number;
  /** WO-0045: may this pane AUTO-start the review leg? False in `Akış: manuel` — the review card
   *  in the decision stack is the offer. Not a dependency of the effect (a mode flip never fires). */
  autoStart?: boolean;
  /** WO-0045: retract a queued note from a STOPPED drive (the data-port mirror route). */
  onRetractStoppedSteer?: (sessionId: string, noteId: string) => Promise<boolean>;
}) {
  const { PROVIDER_ERROR_LABELS, UI } = useLabels();
  const store = useDriveStore();
  // WO-0028 / Bulgu 12: review drives live in the app-level store like every other drive — the pane is
  // just a window onto them; the store's onEnd refreshes the detail when the review completes.
  const driveKey = `${workOrderId}:review:${step.idx}`;
  const state = useDrive(store, driveKey, () => initialSessionState);
  const lastDriven = useRef<number | undefined>(undefined);

  function startDrive(): void {
    // WO-0045: the self-starting review spawn — origin-stamped for the pipeline's manual-mode gate.
    store.start(driveKey, { role: 'architect', workOrderId, mode: 'direct', reviewStepIndex: step.idx, prompt: '', origin: 'auto' }, initialSessionState);
  }

  useEffect(() => {
    if (autoStart && lastDriven.current !== step.idx) {
      lastDriven.current = step.idx;
      startDrive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.idx]);

  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;
  // F7 in the SessionPane form: the header's "Düşünüyor···" is the honest empty-run state — no second
  // line (two-then-one was the 2026-08-23 operator complaint).
  const emptyRun = state.status === 'running' && state.entries.length === 0;

  const running = store.get(driveKey)?.running ?? false;
  const booting = store.get(driveKey)?.booting ?? false;
  const liveStart = store.get(driveKey)?.startedAt;

  // WO-0046: `now` also drives the staleness line.
  const { show: showActivity, line: activityLine, stale } = usePaneActivity(state, running, now);
  const { logOpen, toggleLog, headRef } = usePaneLog();

  return (
    <PaneShell tone={state.status === 'error' ? 'error' : state.status === 'stopped_asking' ? 'signal' : state.status === 'running' ? 'run' : state.status === 'done' ? 'done' : 'idle'}>
      {/* WO-0044: the ONE header row — activity verb + costline + controls + the döküm chip. */}
      <div ref={headRef} className="flex min-w-0 shrink-0 items-center gap-2">
        {running && !booting ? <span className="dot-run shrink-0" aria-hidden="true" /> : null}
        <span className="readout shrink-0 truncate">{UI.reviewHeader}</span>
        {showActivity ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.08em] text-info">
            <span className="text-inkdim/60">— </span>
            <span className={running && !stale ? 'live-dots' : undefined}>{activityLine}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1" aria-hidden="true" />
        )}
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2.5">
          <PaneCostline state={state} running={running} liveStart={liveStart} now={now} />
          {drive ? <DriveControls drive={drive} /> : null}
          {hasStream && !emptyRun ? <PaneLogChip open={logOpen} onToggle={toggleLog} /> : null}
        </div>
      </div>
      <PaneWarnline state={state} />
      <PaneSteerBar
        live={running}
        pendingNotes={state.pendingNotes}
        onSend={(note) => store.steer(driveKey, note)}
        onRetract={(noteId) => {
          // Live: the runner route (the SDK's cancel window). Stopped: the row IS the queue — the
          // data port rewrites it + audits; success patches this fold so the row disappears here too.
          if (running) {
            void store.retract(driveKey, noteId);
          } else if (state.sessionId) {
            void onRetractStoppedSteer?.(state.sessionId, noteId).then((ok) => {
              if (ok) store.retractNote(driveKey, noteId);
            });
          }
        }}
      />
      {!hasStream && !running ? <p className="text-xs text-inkdim">{UI.reviewHint}</p> : null}

      {hasStream && !emptyRun && logOpen ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <ChatTranscript entries={state.entries} role="architect" resetKey={state.sessionId ?? ''} />
        </div>
      ) : null}

      {state.status === 'error' || state.lastError ? (
        <PaneError message={state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : (state.lastError ?? UI.driveStreamCrashed)} />
      ) : null}
    </PaneShell>
  );
}
