import { useMemo, useState } from 'react';
import { initialSessionState, simplePhaseFromState, seedLiveState, type DriveInput } from '../../../core/runner';
import type { SessionRef, SessionRole, StageId, WorkOrderId } from '../../../core/types';
import { PROVIDER_ERROR_LABELS, ROLE_LABELS, SIMPLE_PHASE_LABELS, UI } from '../../data/labels';
import { Button, Segmented, Textarea } from '../../kit';
import { PaneError, PaneShell, PhaseLine, StreamLine } from './pane-chrome';
import { useDrive, useDriveStore, type DriveStore } from './drive-store';
import { Terminal } from './Terminal';
import { useViewMode } from '../../data/view-mode';

// The free-form / plan-stage session INSTRUMENT (WO-0008 → WO-0031c). The console chrome moved out:
// cost/duration/status live in the strip, the stop control and the plan-approval actions live in the
// rail, ask cards are pinned by the controller above the instrument, and SADE/DETAY is the global view
// mode. What remains here is the drive machinery: role tabs (free-form), the prompt + start/resume row,
// the architect question card, and the instrument itself (PhaseLine or the xterm terminal).
const ROLE_ORDER: SessionRole[] = ['implementer', 'architect', 'verifier'];

export function SessionPane({
  mode,
  stage,
  workOrderId,
  sessions,
}: {
  mode: 'plan' | 'direct';
  stage: StageId;
  workOrderId: WorkOrderId;
  sessions: SessionRef[];
}) {
  const store: DriveStore = useDriveStore();
  // WO-0028 / Bulgu 12: the drive lives in the app-level store, NOT this pane — navigating away keeps the
  // session running in the background; a remounted pane re-binds to the live fold state instantly.
  const driveKey = `${workOrderId}:free`;
  // At architect_approval (e.g. restarted mid-plan), default to the architect tab so resume re-surfaces
  // the proposed plan. At written the role tabs are hidden and the architect is implied.
  const [role, setRole] = useState<SessionRole>(stage === 'architect_approval' ? 'architect' : 'implementer');
  const [prompt, setPrompt] = useState('');
  const [replyText, setReplyText] = useState('');
  const { mode: viewMode } = useViewMode();
  // F14 (WO-0026): the persisted-session seed is the FALLBACK when this key has no live drive in the store
  // (fresh mount after a restart). While a background drive exists, the store's state wins. The seed
  // RESULT is memoized — a fresh object per getSnapshot call loops React (#185, see StepPane).
  const seedState = useMemo(
    () => seedLiveState(sessions.find((s) => s.role === role && s.providerSessionId) ?? { transcript: [] }),
    [sessions, role],
  );
  const state = useDrive(store, driveKey, () => seedState);
  const running = store.get(driveKey)?.running ?? false;

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
  const lastAssistant = [...state.entries].reverse().find((e) => e.speaker === 'assistant');
  const showQuestion = isPlanRequestStage && state.status === 'done' && !state.pendingPlan && !!lastAssistant;
  const showAsk = state.status === 'stopped_asking' && state.pendingAsks.length > 0;
  const canStart = !running && !showAsk && !showQuestion;
  // SADE mode derives one calm phase from the live state; DETAY shows the raw themed terminal.
  const phase = simplePhaseFromState(state);
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

  return (
    <PaneShell tone={state.status === 'error' ? 'error' : state.status === 'stopped_asking' || state.status === 'plan_ready' ? 'signal' : state.status === 'running' ? 'run' : state.status === 'done' ? 'done' : 'idle'}>
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

      {emptyRun ? (
        viewMode === 'sade' ? (
          <PhaseLine phase={phase} label={UI.streamOpened} />
        ) : (
          <StreamLine />
        )
      ) : hasStream ? (
        viewMode === 'sade' ? (
          <PhaseLine phase={phase} label={phase === 'asking_permission' ? UI.askingRole(role) : SIMPLE_PHASE_LABELS[phase]} />
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
