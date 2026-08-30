// RoadmapPane (WO-0050, mockup kare 05) — the roadmap screen's LIVE INSTRUMENT: the ✦ architect
// draft session, WO-less (workspace-scoped). It speaks the shared pane-chrome grammar verbatim
// (PaneShell + the activity machine + costline + DriveControls + the döküm chip — ADR-0013's
// one-live-surface language, the console's SECOND live surface after the detail's instrument)
// with ONE substitution: the header readout is the draft identity (`MİMAR — TASLAK`), never a
// role word — the draft has no work order to borrow one from. No role tabs, no composer: the ✦
// dialog owns STARTING, İtiraz et owns the note path (steer is WO-only, D15 — no PaneSteerBar).
// The pane unmounts with the surface; the drive lives in the app-level store (the WO-0028
// precedent) and the head meta says `taslak sürüyor` while it runs (the honest minimum).
import { useEffect, useMemo, useState } from 'react';
import { initialSessionState, type LiveSessionState } from '../../../core/runner';
import type { WorkspaceId } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { PaneCostline, PaneError, PaneShell, PaneLogChip, PaneAgentStrip, PaneWarnline, usePaneActivity, usePaneLog } from '../session/pane-chrome';
import { DriveControls, type DriveState } from '../session/DriveControls';
import { useDrive, useDriveStore, type DriveStore } from '../session/drive-store';
import { ChatTranscript } from '../session/ChatTranscript';

export function RoadmapPane({
  workspaceId,
  seed,
  now,
}: {
  workspaceId: WorkspaceId;
  /** The draft session row's seed (after an İtiraz from the card, the pane opens on the row's
   *  transcript — the stream appends to what already happened, the SessionPane F14 precedent). */
  seed?: LiveSessionState;
  /** The screen's one-second ticker (the live costline's elapsed). */
  now?: number;
}) {
  const { PROVIDER_ERROR_LABELS, UI } = useLabels();
  const store: DriveStore = useDriveStore();
  const driveKey = `${workspaceId}:draft`;
  const seedState = useMemo(() => seed ?? initialSessionState, [seed]);
  const state = useDrive(store, driveKey, () => seedState);
  const running = store.get(driveKey)?.running ?? false;
  const booting = store.get(driveKey)?.booting ?? false;
  const liveStart = store.get(driveKey)?.startedAt;

  const { logOpen, toggleLog, headRef } = usePaneLog();
  const { show: showActivity, line: activityLine, stale } = usePaneActivity(state, running, now);

  // The wind-down bookkeeping (the WorkOrderDetail precedent, pane-local): stopping freezes into
  // the stopped offer, 5s stuck arms Zorla kes.
  const [stopping, setStopping] = useState(false);
  const [forceArmed, setForceArmed] = useState(false);
  const stoppedNow = state.status === 'stopped';
  useEffect(() => {
    if (!stopping || running) return;
    setStopping(false);
    setForceArmed(false);
  }, [running, stopping]);
  useEffect(() => {
    if (!(stopping && running)) return;
    const t = setTimeout(() => setForceArmed(true), 5000);
    return () => clearTimeout(t);
  }, [stopping, running]);

  const stop = (): void => {
    setStopping(true);
    store.note(driveKey, { speaker: 'note', kind: 'interrupt_sent' });
    void store.interrupt();
  };
  const forceKill = (): void => {
    void store.abort();
    store.note(driveKey, { speaker: 'note', kind: 'force_killed' });
    setStopping(false);
    setForceArmed(false);
  };
  // Sürdür re-issues the CAPTURED draft input (the store's own capture — no goal note retyping),
  // carrying the resume id; the pane's fold seed keeps the transcript.
  const resume = (): void => {
    const input = store.inputOf(driveKey);
    if (!input || !state.sessionId) return;
    store.start(driveKey, { ...input, prompt: 'Continue.', resume: state.sessionId }, state);
  };

  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const drive: DriveState | undefined =
    !showAsk && (running || stopping || stoppedNow)
      ? {
          running,
          stopping,
          forceArmed,
          stopped: stoppedNow && !running && !stopping,
          resumable: stoppedNow,
          enter: false, // the TASLAK card's Onayla owns ⏎ while a proposal waits — never Sürdür
          onStop: stop,
          onForceKill: forceKill,
          onResume: resume,
        }
      : undefined;

  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;
  const emptyRun = state.status === 'running' && state.entries.length === 0;
  // The source readout (`kaynak: 9 belge + 1 dışarıdan`) — the dialog's composition, read from
  // the captured input (paths die with the dialog; the COUNTS are the pane's one honest echo).
  // WO-0051: the composition line when the input carries it; the single-count line stays the
  // fallback for a pre-WO-0051 capture (an İtiraz resume seeds from the session row).
  const input = store.inputOf(driveKey);
  const docCount = input !== undefined && 'docPaths' in input ? input.docPaths.length : undefined;
  const sourceLine =
    input !== undefined && 'docSource' in input && input.docSource !== undefined
      ? UI.roadmapDraftSourceCompose(input.docSource.store, input.docSource.external, input.freeExplore === true)
      : docCount !== undefined
        ? UI.roadmapDraftSourceLine(docCount)
        : undefined;

  return (
    <PaneShell
      tone={
        state.status === 'error' ? 'error'
        : state.status === 'stopped_asking' || state.status === 'plan_ready' ? 'signal'
        : state.status === 'running' ? 'run'
        : state.status === 'done' ? 'done'
        : 'idle'
      }
    >
      <div ref={headRef} data-roadmap-pane className="flex min-w-0 shrink-0 items-center gap-2">
        {running && !booting ? <span className="dot-run shrink-0" aria-hidden="true" /> : null}
        <span className="readout shrink-0 truncate">{UI.roadmapDraftIdentity}</span>
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
      <PaneAgentStrip state={state} now={now} />
      <PaneWarnline state={state} running={running} />

      {sourceLine !== undefined && running ? (
        <p data-draft-source className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-inkdim">
          {sourceLine}
        </p>
      ) : null}

      {hasStream && !emptyRun && logOpen ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <ChatTranscript entries={state.entries} role="architect" resetKey={state.sessionId ?? ''} />
        </div>
      ) : null}
      {!hasStream && !running ? <p className="text-xs text-inkdim">{UI.noSession}</p> : null}

      {state.status === 'error' || state.lastError ? (
        <PaneError message={state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : (state.lastError ?? UI.driveStreamCrashed)} />
      ) : null}
    </PaneShell>
  );
}
