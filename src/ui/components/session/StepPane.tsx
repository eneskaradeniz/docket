import { useEffect, useMemo, useRef } from 'react';
import { initialSessionState, seedLiveState, type DriveInput, type LiveSessionState } from '../../../core/runner';
import type { SessionRef, StepView, WorkOrderId } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { PaneCostline, PaneError, PaneLogChip, PaneShell, PaneSteerBar, PaneWarnline, usePaneActivity, usePaneLog } from './pane-chrome';
import { DriveControls, type DriveState } from './DriveControls';
import { useDrive, useDriveStore } from './drive-store';
import { ChatTranscript } from './ChatTranscript';

// The step session INSTRUMENT (WO-0017 → WO-0031c → WO-0031f). Drives ONE plan step through the
// SessionRunner port — role/scope/stepIndex come from the step; main assembles the prompt server-side.
// The console chrome moved out of the pane long ago (strip = cost/status, rail = Durdur + Sürdür,
// controller = ask cards). What remains: the auto-drive of a pending step, the fold subscription, and
// the instrument itself. On turn_complete the drive ends and the App-level onEnd reloads the detail so
// the step shows done + the next is runnable.
//
// WO-0031f v6 → WO-0038: the pane rendered INSIDE its spine row ("the live thing travels with its
// step"). WO-0044 tur 1 (2026-08-25, the first real step-drive dogfood): the ONE live grammar —
// ONE header row (`● ROL — Dosya okuyor···` + costline + DriveControls + the döküm chip), the Ray
// column BEHIND the chip, closed by default. WO-0044 tur 2 (same day, mockup-approved
// wo-0044-live-top.html): the instrument moves to the TOP, band-adjacent — the architect's live plan
// pane's old seat — and the spine below becomes a pure status list. The ledger is pure history; the
// completed session lands there as a card when this pane unmounts.
export function StepPane({
  step,
  workOrderId,
  sessions,
  now,
  drive,
  autoStart = true,
  onRetractStoppedSteer,
}: {
  step: StepView;
  workOrderId: WorkOrderId;
  sessions: SessionRef[];
  /** The controller's one-second ticker (the strip's) — the live costline's elapsed reuses it. */
  now?: number;
  /** WO-0039: the active drive's process controls (Durdur / Zorla kes / ▶ Sürdür) — the dead
   *  rail's job, riding this pane's header (the controller hands the bundle straight down —
   *  WO-0044 tur 2: no StepList hop, the pane rides the TOP instrument seat). */
  drive?: DriveState;
  /** WO-0045: may this pane AUTO-drive its pending step? False in `Akış: manuel` — the card in the
   *  decision stack is the offer, the click is the consent (the pipeline's origin gate is the
   *  backstop, never the only line). */
  autoStart?: boolean;
  /** WO-0045: retract a queued note from a STOPPED drive (the data-port mirror route). */
  onRetractStoppedSteer?: (sessionId: string, noteId: string) => Promise<boolean>;
}) {
  const { PROVIDER_ERROR_LABELS, ROLE_LABELS, UI } = useLabels();
  const store = useDriveStore();
  // WO-0028 / Bulgu 12: the drive lives in the app-level store — navigation keeps it running; this pane
  // re-binds to the LIVE fold state on remount, falling back to the persisted seed (F14) after a restart.
  const driveKey = `${workOrderId}:step:${step.idx}`;
  // The seed RESULT is memoized: useSyncExternalStore re-samples getSnapshot after mount, and a fresh
  // object per call (any session with a transcript) force-rerenders forever (React #185 — surfaced by
  // WO-0031c's persisted-session E2E seed; latent since F14).
  const seedState = useMemo<LiveSessionState>(
    () => seedLiveState(sessions.find((s) => s.stepIdx === step.idx && s.providerSessionId) ?? { status: 'none', transcript: [] }),
    [sessions, step.idx],
  );
  const state = useDrive(store, driveKey, () => seedState);
  const lastDriven = useRef<number | undefined>(undefined);

  function startDrive(resume?: string): void {
    const input: DriveInput = {
      role: step.role,
      workOrderId,
      mode: 'direct',
      scope: step.scopeTrackId,
      stepIndex: step.idx,
      prompt: '',
      // WO-0045: THIS is the self-starting spawn — stamped so the pipeline's manual-mode gate can
      // refuse it even if a future host forgets the autoStart check (the planApprovedFor net).
      origin: 'auto',
      ...(resume ? { resume } : {}),
    };
    // A resume seeds from the CURRENT state so the new stream appends (F14); a fresh drive resets.
    store.start(driveKey, input, resume ? state : initialSessionState);
  }

  // Auto-drive a pending step once when it becomes the active step. An 'active' step (interrupted) does not
  // auto-drive — the pane header offers "Sürdür" so the operator chooses to resume (WO-0039). WO-0045: in
  // `Akış: manuel` nothing starts itself — autoStart=false leaves the step to the decision-stack card.
  // autoStart is deliberately NOT a dependency: flipping the mode must never fire (or un-fire) a start —
  // it is read at the boundary this effect happens to run on (operator ruling 2026-08-26, pin 2).
  useEffect(() => {
    if (autoStart && step.status === 'pending' && lastDriven.current !== step.idx) {
      lastDriven.current = step.idx;
      startDrive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.idx, step.status]);

  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;
  // F7 (the SessionPane form): running but nothing written yet — the header's "Düşünüyor···" IS the
  // honest state; a second line here read two-then-jumped-to-one (operator, 2026-08-23).
  const emptyRun = state.status === 'running' && state.entries.length === 0;

  const running = store.get(driveKey)?.running ?? false;
  const booting = store.get(driveKey)?.booting ?? false;
  const liveStart = store.get(driveKey)?.startedAt;

  // WO-0044: the shared live grammar — the activity state line + the döküm chip (default closed).
  // WO-0046: `now` also drives the staleness line (the honest heir of the indefinite wait).
  const { show: showActivity, line: activityLine, stale } = usePaneActivity(state, running, now);
  const { logOpen, toggleLog, headRef } = usePaneLog();

  // The TOP instrument (tur 2): the PaneShell card the plan/review panes wear, the ONE header row,
  // the transcript behind its chip.
  return (
    <PaneShell
      tone={state.status === 'error' ? 'error' : state.status === 'stopped_asking' ? 'signal' : state.status === 'running' ? 'run' : state.status === 'done' ? 'done' : 'idle'}
    >
      <div className="flex flex-col" data-step-live={step.idx}>
        <div ref={headRef} className="flex min-w-0 shrink-0 items-center gap-2">
          {running && !booting ? <span className="dot-run shrink-0" aria-hidden="true" /> : null}
          <span className="readout shrink-0 truncate">{ROLE_LABELS[step.role]}</span>
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
        <PaneWarnline state={state} running={running} />
        <PaneSteerBar
          live={running}
          pendingNotes={state.pendingNotes}
          onSend={(note) => store.steer(driveKey, note)}
          onRetract={(noteId) => {
            // The live route while the stream is open (stopped_asking included — the drive holds);
            // once the drive is gone the stopped row's mirror is the only queue — the data port
            // rewrites it + audits, and success patches this fold so the row disappears here too.
            if (running) {
              void store.retract(driveKey, noteId);
            } else if (state.sessionId) {
              void onRetractStoppedSteer?.(state.sessionId, noteId).then((ok) => {
                if (ok) store.retractNote(driveKey, noteId);
              });
            }
          }}
        />
        {hasStream && !emptyRun && logOpen ? (
          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            {/* tur 3: the default live variant — the compact cap (224px) was the spine-row form; the
                TOP seat wears the one expansion height every pane shares (340px, SessionPane parity). */}
            <ChatTranscript entries={state.entries} role={step.role} resetKey={state.sessionId ?? ''} />
          </div>
        ) : null}
        {/* noSession only when TRULY nothing — NOT during the boot window (running=true before the first
            folded event flashed "Çalışan oturum yok." for the provider's 1-3s spawn — operator,
            2026-08-23, the SessionPane ruling, reached here by WO-0044). */}
        {!hasStream && !running ? <p className="text-xs text-inkdim">{UI.noSession}</p> : null}
        {state.status === 'error' || state.lastError ? (
          <PaneError message={state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : (state.lastError ?? UI.driveStreamCrashed)} />
        ) : null}
      </div>
    </PaneShell>
  );
}
