import { useMemo, useState } from 'react';
import { initialSessionState, seedLiveState, type DriveInput } from '../../../core/runner';
import type { SessionRef, SessionRole, StageId, WorkOrderId } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { Button, Segmented, Textarea } from '../../kit';
import { PaneCostline, PaneError, PaneShell, PaneLogChip, PaneSteerBar, PaneWarnline, usePaneActivity, usePaneLog } from './pane-chrome';
import { DriveControls, type DriveState } from './DriveControls';
import { useDrive, useDriveStore, type DriveStore } from './drive-store';
import { ChatTranscript } from './ChatTranscript';

// The free-form / plan-stage session INSTRUMENT (WO-0008 → WO-0039). The console chrome moved out:
// cost/duration/status live in the header band, process control (Durdur / Zorla kes / ▶ Sürdür) rides
// THIS pane's header via DriveControls, ask cards are pinned by the controller above the instrument,
// and the body is the SADE activity line + the Ray column behind the döküm chip. What remains here is
// the drive machinery: role tabs (free-form), the prompt + start/resume row, the architect question
// card, and the instrument itself (the chat transcript — WO-0037, xterm retired). At the
// plan-APPROVAL moment this pane does not render at all (the plan rows + the decision band carry the
// decision — see the instrument selector below).
const ROLE_ORDER: SessionRole[] = ['implementer', 'architect', 'verifier'];

export function SessionPane({
  mode,
  stage,
  workOrderId,
  sessions,
  planOnTable,
  drive,
  now,
  onRetractStoppedSteer,
}: {
  mode: 'plan' | 'direct';
  stage: StageId;
  workOrderId: WorkOrderId;
  sessions: SessionRef[];
  /** WO-0039 stabilization (2026-08-23): a plan is already on disk (plan.md). A plan on the table
   *  IS the answer — the architect's question card ("Mimar seni bekliyor" + Yanıtla) must not
   *  render over it, whatever resume path restarted the session. */
  planOnTable: boolean;
  /** WO-0039: the active drive's process controls in this pane's header (the dead rail's job). */
  drive?: DriveState;
  /** The controller's one-second ticker — the live costline's elapsed reuses it (StepPane parity). */
  now?: number;
  /** WO-0045: retract a queued note from a STOPPED drive (the data-port mirror route). */
  onRetractStoppedSteer?: (sessionId: string, noteId: string) => Promise<boolean>;
}) {
  const { PROVIDER_ERROR_LABELS, ROLE_LABELS, UI } = useLabels();
  const store: DriveStore = useDriveStore();
  // WO-0028 / Bulgu 12: the drive lives in the app-level store, NOT this pane — navigating away keeps the
  // session running in the background; a remounted pane re-binds to the live fold state instantly.
  const driveKey = `${workOrderId}:free`;
  // At architect_approval (e.g. restarted mid-plan), default to the architect tab so resume re-surfaces
  // the proposed plan. At written the role tabs are hidden and the architect is implied.
  const [role, setRole] = useState<SessionRole>(stage === 'architect_approval' ? 'architect' : 'implementer');
  const [prompt, setPrompt] = useState('');
  const [replyText, setReplyText] = useState('');
  // F14 (WO-0026): the persisted-session seed is the FALLBACK when this key has no live drive in the store
  // (fresh mount after a restart). While a background drive exists, the store's state wins. The seed
  // RESULT is memoized — a fresh object per getSnapshot call loops React (#185, see StepPane).
  const seedState = useMemo(
    () => seedLiveState(sessions.find((s) => s.role === role && s.providerSessionId) ?? { status: 'none', transcript: [] }),
    [sessions, role],
  );
  const state = useDrive(store, driveKey, () => seedState);
  const running = store.get(driveKey)?.running ?? false;
  const booting = store.get(driveKey)?.booting ?? false;

  // WO-0039 (operator, 2026-08-23): the pane's SADE form — the session card's özet→döküm grammar.
  // The body shows ONE activity line (the latest transcript line, truncated); the full Ray column
  // opens behind the ▸ döküm toggle. The old firehose-by-default rendered every tool call and
  // wrapped path walls — "sade detay gibi görünüş olmalı". WO-0044: the machine and the chip live
  // in pane-chrome now — one grammar for all three live surfaces (the ledger pointer that bumped
  // the nonce died with it; the pane opens only by its own chip).
  const { logOpen, toggleLog, headRef } = usePaneLog();
  // 2026-08-23 (canlı panel revizyonu, §3+§6): the SADE line is a STATE, not content —
  // plan_ready + running → the wind-down sentence; running → the newest UNMATCHED tool's
  // progressive verb or "Düşünüyor"; not running → the fold's own state word, frozen.
  // WO-0046: `now` also drives the staleness line.
  const { show: showActivity, line: activityLine, stale } = usePaneActivity(state, running, now);
  // The drive's own live cost/context line (StepPane's costline, mirrored — the strip carries the WO total).
  const liveStart = store.get(driveKey)?.startedAt;

  // During the plan stages (written = propose, architect_approval = approve/object) the only session is the
  // architect's — role tabs are hidden. They show only past the plan stage (free-form implementer/verifier).
  const isPlanRequestStage = stage === 'written' || stage === 'architect_approval';

  const runDrive = (input: DriveInput, reset: boolean): boolean =>
    store.start(driveKey, input, reset ? initialSessionState : state);
  const start = (): void => {
    store.start(driveKey, { role, workOrderId, mode, prompt }, initialSessionState);
  };
  // Reply to an architect clarifying question (plan mode turn that ended without a plan): resume the
  // architect with the operator's answer. "Bilmiyorum" lets the architect decide on its own.
  const reply = (answer: string): void => {
    runDrive({ role: 'architect', workOrderId, mode, prompt: answer, resume: state.sessionId }, false);
    setReplyText('');
  };

  // The architect stopped without producing a plan (plan mode turn ended, no plan_ready). In plan mode
  // that almost always means it needs input — surface its last message as an answerable question. Walk
  // back to the last assistant message in case the turn ended with a tool_result (e.g. a timed-out tool).
  // WO-0039 stabilization (2026-08-23): a plan on the table closes the card — a plan on disk IS the
  // answer (the overwrite incident's re-entry resume rendered "Mimar seni bekliyor" over a saved plan,
  // and its Yantla restarted the session).
  const lastAssistant = [...state.entries].reverse().find((e) => e.speaker === 'assistant');
  const showQuestion = isPlanRequestStage && state.status === 'done' && !state.pendingPlan && !planOnTable && !!lastAssistant;
  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const canStart = !running && !showAsk && !showQuestion;
  const hasStream = state.entries.length > 0 || state.status === 'running' || showAsk;
  // F7: running but nothing written yet — one honest line instead of a blank canvas.
  const emptyRun = state.status === 'running' && state.entries.length === 0;
  // A session persisted across restart (WO-0010) — offer resume only when one exists for the role.
  const resumeSessionId = sessions.find((s) => s.role === role && s.providerSessionId)?.providerSessionId;
  const resume = (): void => {
    if (!resumeSessionId) return;
    // reset=false (WO-0026/F14): keep the seeded transcript — the new stream appends to it.
    runDrive({ role, workOrderId, mode, prompt: prompt.trim() || 'Continue.', resume: resumeSessionId }, false);
  };

  // WO-0039: the plan-stage "invitation" branch died — a bare plan stage (no stream, no question)
  // belongs to the controller's empty-state card ("Henüz plan yok." + Plan iste, 1 line + ≤1
  // action); this pane renders only when there is something to READ (a live drive, a transcript,
  // an ask, or the architect's question card).

  return (
    <PaneShell
      tone={state.status === 'error' ? 'error' : state.status === 'stopped_asking' || state.status === 'plan_ready' ? 'signal' : state.status === 'running' ? 'run' : state.status === 'done' ? 'done' : 'idle'}
    >
      {/* 2026-08-23 (operator, tek satır): the header IS the activity line — `● MİMAR — Düşünüyor···`
          + costline + Durdur + the döküm chip, ONE row (two stacked rows with two dots read
          redundant). The green dot breathes only while actually live (none during the boot
          window); the `— activity` segment rides the same readout voice, and the toggle moved up
          here so opening the döküm pins THIS row (the anchor the scroll targets). */}
      <div ref={headRef} className="flex min-w-0 shrink-0 items-center gap-2">
        {running && !booting ? <span className="dot-run shrink-0" aria-hidden="true" /> : null}
        <span className="readout shrink-0 truncate">{ROLE_LABELS[isPlanRequestStage ? 'architect' : role]}</span>
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

      {/* Role tabs are hidden on a written work order — the only session is the architect plan session. */}
      {isPlanRequestStage ? null : (
        <Segmented
          className="mb-2"
          value={role}
          onValueChange={setRole}
          options={ROLE_ORDER.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        />
      )}

      {/* Free-form start controls appear only when their precondition holds (ADR-0001); at the plan
           stages the rail owns "Plan iste". */}
      {!isPlanRequestStage && canStart ? (
        <div className="mb-2 flex gap-2">
          <Textarea
            className="flex-1 font-sans text-[13px]"
            rows={2}
            placeholder={UI.promptPlaceholder}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Button variant="primary" className="self-stretch" onClick={start}>{UI.startSession}</Button>
          {resumeSessionId ? (
            <Button variant="secondary" className="self-stretch" onClick={resume}>{UI.resumeSession}</Button>
          ) : null}
        </div>
      ) : null}

      {showQuestion && lastAssistant ? (
        <div className="mb-2 flex items-stretch overflow-hidden rounded-md border border-hairline bg-raised/40">
          <div className="lamp lamp-signal" />
          <div className="flex-1 px-3.5 py-3">
            <p className="readout text-signal">{UI.architectWaiting}</p>
            <p className="mb-2 text-[14px] text-ink">{lastAssistant.text}</p>
            <div className="flex flex-col gap-2">
              <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={2} placeholder={UI.replyPlaceholder} className="font-sans text-[13px]" />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => reply('Bilmiyorum, kendin karar ver.')}>{UI.skipReply}</Button>
                <Button variant="primary" size="sm" onClick={() => reply(replyText.trim() || 'Devam et.')}>{UI.reply}</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* The body is JUST the transcript (the SADE state line merged into the header). The
          empty-run window needs NO second line — the header's "Düşünüyor···" is the honest
          state (F7's purpose), and a separate StreamLine here made the pane read two lines then
          jump to one on the first entry (operator, 2026-08-23). */}
      {hasStream && !emptyRun && logOpen ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <ChatTranscript entries={state.entries} role={role} resetKey={state.sessionId ?? ''} />
        </div>
      ) : null}
      {/* noSession only when TRULY nothing — NOT during the boot window (running=true before the
          first folded event; hasStream alone flashed "Çalışan oturum yok." for the provider's
          1-3s spawn, then deleted it — operator, 2026-08-23). */}
      {!hasStream && !running ? <p className="text-xs text-inkdim">{UI.noSession}</p> : null}

      {state.status === 'error' || state.lastError ? (
        <PaneError message={state.lastErrorCode ? PROVIDER_ERROR_LABELS[state.lastErrorCode] : (state.lastError ?? UI.driveStreamCrashed)} />
      ) : null}
    </PaneShell>
  );
}
