// SessionCards (WO-0038) — the session ledger as CARDS, replacing the audit table (operator ruling
// 2026-08-22: "terminali görmek isteyen görsün, aç kapa yapabiliriz"). Each card carries the three
// things a reader wants of ANY session — active or past: the META (role lamp + name + range ·
// duration · cost; a breathing dot while it runs), a one-line SUMMARY — the session's ARTIFACT
// HEADLINE (operator-approved 2026-08-22: plan → the fence's count, review → the architect's
// verdict, step/free → the agent's closing sentence; NEVER invented — no artifact, no line; the
// LLM-written summary is the recorded upgrade path, only if these disappoint), and the FULL
// HISTORY exactly one click away (the Ray transcript, tool blocks collapsed — the aç/kapa IS the
// old SADE/DETAY distinction, now living on the card). History sits CLOSED; the RUNNING session's
// card opens itself.
import { useRef, useState } from 'react';
import type { SessionAuditRow } from '../../../core/derive';
import { deriveSessionAudit } from '../../../core/derive';
import type { SessionRef, SessionRole, StepView } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { cn } from '../../kit';
import { ChatTranscript } from '../session/ChatTranscript';
import { RoleChip } from './RoleChip';

/** Faz 1 summary trim (operator, 2026-08-22: "özet çok taşıyor"): the last message's FIRST
 *  sentence, clamped at 140 chars — a teaser, never the message. */
function summaryOf(text: string): string {
  const firstSentence = text.split('. ')[0] ?? text;
  return firstSentence.length > 140 ? `${firstSentence.slice(0, 140).trimEnd()}…` : firstSentence;
}

function rowName(row: SessionAuditRow, UI: ReturnType<typeof useLabels>['UI']): string {
  switch (row.name.kind) {
    case 'plan':
      return UI.auditNamePlan;
    case 'step':
      return UI.auditNameStep(row.name.idx, row.name.aim);
    case 'review':
      return UI.auditNameReview(row.name.idx);
    case 'unscoped':
      return UI.auditNameUnscoped;
  }
}

function SessionCard({
  row,
  session,
  steps,
  defaultOpen,
}: {
  row: SessionAuditRow;
  session: SessionRef;
  /** The WO's step views — the review headline reads the verdict, the plan headline counts them. */
  steps: StepView[];
  defaultOpen: boolean;
}) {
  const { formatUsd, UI } = useLabels();
  const [open, setOpen] = useState(defaultOpen);
  const cardRef = useRef<HTMLDivElement>(null);
  // Operator ruling (2026-08-22): opening a card brings ITS HEADER to the scroll's top — the
  // terminal reads from its start without a manual scroll hunt; the page's .flow-scroll gives the
  // motion (the one sanctioned smooth route; reduced-motion kills it to an instant jump).
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next) requestAnimationFrame(() => cardRef.current?.scrollIntoView({ block: 'start' }));
  };
  const live = session.status === 'running';
  // The ARTIFACT HEADLINE (operator-approved): each kind reads its own artifact; nothing invented.
  let summary: string | undefined;
  if (row.name.kind === 'plan') {
    if (steps.length > 0) summary = UI.sessionSummaryPlan(steps.length);
  } else if (row.name.kind === 'review') {
    const reviewStepIdx = row.name.idx; // narrowed here; a closure would lose the narrowing
    const verdict = steps.find((s) => s.idx === reviewStepIdx)?.verdict;
    if (verdict === 'proceed') summary = UI.sessionSummaryProceed;
    else if (verdict === 'revise') summary = UI.sessionSummaryRevise;
  } else {
    // step / free: the agent's closing sentence — the report body IS the last assistant statement
    // (the pipeline writes reports from result ?? assistantText), so the transcript's tail is the
    // report's head without a decision-store file read.
    const lastAssistant = [...session.transcript].reverse().find((e) => e.speaker === 'assistant');
    if (lastAssistant) summary = summaryOf(lastAssistant.text);
  }
  const range =
    row.startedAt && row.endedAt
      ? UI.auditRange(row.startedAt, row.endedAt)
      : row.startedAt
        ? UI.auditClock(row.startedAt)
        : UI.auditCostNone;

  return (
    <div ref={cardRef} className="overflow-hidden rounded-md border border-hairline bg-surface" data-session-card="">
      {/* ONE interactive zone — header + özet are a single button (operator, 2026-08-22: the whole
          surface toggles BOTH ways, one hover wash across it); the transcript body lives OUTSIDE
          the button, so clicks inside it (tool toggles, selection, scroll) never collapse the card. */}
      <button
        type="button"
        data-session-toggle=""
        aria-expanded={open}
        onClick={toggle}
        className="irow block w-full px-3 pt-2 text-left"
      >
        <span className="flex w-full items-center gap-2.5">
          <span className="shrink-0 font-mono text-[10px] text-inkdim" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className={cn('rlamp', `rlamp-${row.role}`)} aria-hidden="true" />
          <span className="min-w-0 shrink-0 truncate text-[12.5px] font-semibold text-ink">{rowName(row, UI)}</span>
          <RoleChip role={row.role} />
          <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2.5 font-mono text-[10.5px] text-inkdim">
            {live ? (
              <>
                <span className="h-[5px] w-[5px] shrink-0 rounded-full lamp-run" aria-hidden="true" />
                <span className="text-info">{UI.actionRunning}</span>
              </>
            ) : null}
            <span className="whitespace-nowrap">{range}</span>
            <span className="whitespace-nowrap">{UI.formatDuration(row.durationMs)}</span>
            {row.costUsd !== undefined ? <span className="whitespace-nowrap">{formatUsd(row.costUsd)}</span> : null}
          </span>
        </span>
        {summary ? (
          <span
            data-session-summary=""
            className="mt-1 block pb-2 pl-9 pr-3 text-[12px] leading-snug text-inkdim line-clamp-2"
          >
            <span className="font-semibold text-ink">{UI.sessionSummary} — </span>
            {summary}
          </span>
        ) : (
          <span className="block pb-2" aria-hidden="true" />
        )}
      </button>
      {open ? (
        session.transcript.length > 0 ? (
          <ChatTranscript entries={session.transcript} role={row.role} variant="archived" />
        ) : (
          // 2026-08-23 (döküm kaybı): the ledger's body is THE AGENT'S RECORD — what it did, tool
          // call by tool call. A session whose transcript never got persisted (the incident's
          // pre-checkpoint rows) says so in ONE quiet line instead of opening empty and reading
          // broken; new sessions checkpoint every tool result and are never empty.
          <p className="border-t border-hairline bg-bg px-3 py-2 text-[12px] text-inkdim">
            {UI.auditNoTranscript}
          </p>
        )
      ) : null}
    </div>
  );
}

/** The pointer card's fact shape — shared with the controller's liveRow prop. */
export interface LiveSessionRow {
  role: SessionRole;
  name: { kind: 'plan' } | { kind: 'step'; idx: number; aim?: string } | { kind: 'review'; idx: number } | { kind: 'unscoped' };
  startedAt: number;
  costUsd: number;
}

/** WO-0039/C — the RUNNING drive's POINTER card: the pane owns the live stream (one live
 *  surface); the ledger carries the run's card-level facts + one jump. Card-level only — this
 *  component never subscribes to the transcript fold, so streaming re-renders nothing here. */
function LiveSessionCard({
  liveRow,
  now,
  onGoLive,
}: {
  liveRow: LiveSessionRow;
  now?: number;
  onGoLive: () => void;
}) {
  const { formatUsd, UI } = useLabels();
  const liveName =
    liveRow.name.kind === 'plan'
      ? UI.auditNamePlan
      : liveRow.name.kind === 'step'
        ? UI.auditNameStep(liveRow.name.idx, liveRow.name.aim)
        : liveRow.name.kind === 'review'
          ? UI.auditNameReview(liveRow.name.idx)
          : UI.auditNameUnscoped;
  return (
    // 2026-08-23 (operator: "tamamını kapsasın"): ONE interactive zone — the WHOLE card is the
    // jump (the session-card grammar: one hover wash, one target), not a small text link. It is
    // still NOT a toggle (nothing to expand here — a chevron would promise the ledger's aç/kapa
    // grammar); the pointer line rides where the Özet sits, under the meta row.
    <div className="overflow-hidden rounded-md border border-hairline bg-surface">
    <button
      type="button"
      data-session-card=""
      data-session-live-pointer=""
      onClick={onGoLive}
      className="irow block w-full text-left"
    >
      <span className="flex w-full items-center gap-2.5 px-3 pt-2">
        <span className="dot-run" aria-hidden="true" />
        <span className={cn('rlamp', `rlamp-${liveRow.role}`)} aria-hidden="true" />
        <span className="min-w-0 shrink-0 truncate text-[12.5px] font-semibold text-ink">{liveName}</span>
        <RoleChip role={liveRow.role} />
        <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2.5 font-mono text-[10.5px] text-inkdim">
          <span className="text-info">{UI.actionRunning}</span>
          <span className="whitespace-nowrap">{UI.auditClock(new Date(liveRow.startedAt).toISOString())}</span>
          {now ? <span className="whitespace-nowrap">{UI.formatDuration(Math.max(0, now - liveRow.startedAt))}</span> : null}
          {liveRow.costUsd > 0 ? <span className="whitespace-nowrap">{formatUsd(liveRow.costUsd)}</span> : null}
        </span>
      </span>
      <span className="flex items-center gap-2 px-3 pb-2 pl-9 font-mono text-[11px] text-info">
        <span aria-hidden="true">▸</span> {UI.liveSessionGo}
      </span>
    </button>
    </div>
  );
}

export function SessionCards({
  sessions,
  steps,
  liveRow,
  liveSessionId,
  now,
  onGoLive,
}: {
  sessions: SessionRef[];
  steps: StepView[];
  liveRow?: LiveSessionRow;
  /** WO-0039 stabilization (2026-08-23, the re-entry dupe): the live drive's provider session id.
   *  A session ROW carrying this id IS the live drive — it renders as the POINTER card, in its own
   *  sorted position, and no second card is appended. One session, one card, whatever the reload
   *  timing (the row lands with onStarted's refresh or a re-entry load; the boot window before the
   *  row exists still gets the appended pointer). */
  liveSessionId?: string;
  now?: number;
  onGoLive?: () => void;
}) {
  const { rows } = deriveSessionAudit(sessions, steps);
  const pointer = liveRow && onGoLive ? liveRow : undefined;
  const isLiveRow = (s: SessionRef | undefined): boolean =>
    pointer !== undefined && s?.providerSessionId !== undefined && s.providerSessionId === liveSessionId;
  const hasLiveRow = sessions.some(isLiveRow);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const session = sessions[row.sourceIdx]!;
        // The live drive's own row: the pointer, IN PLACE (WO-0039/C — the pane owns the live
        // stream; the ledger marks it and jumps). Everything else is the archive card.
        if (isLiveRow(session) && pointer) {
          return <LiveSessionCard key={row.sourceIdx} liveRow={pointer} now={now} onGoLive={onGoLive!} />;
        }
        return (
          <SessionCard
            key={row.sourceIdx}
            row={row}
            session={session}
            steps={steps}
            defaultOpen={session.status === 'running' && !isLiveRow(session)}
          />
        );
      })}
      {/* The boot window's pointer: the drive runs but no row exists yet (the provider session has
          not opened / the load predates it). Skipped the moment the row lands. */}
      {pointer && !hasLiveRow ? <LiveSessionCard liveRow={pointer} now={now} onGoLive={onGoLive!} /> : null}
    </div>
  );
}
