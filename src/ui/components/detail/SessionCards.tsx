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
import type { SessionRef, StepView } from '../../../core/types';
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
      {open && session.transcript.length > 0 ? (
        <ChatTranscript entries={session.transcript} role={row.role} variant="archived" />
      ) : null}
    </div>
  );
}

export function SessionCards({ sessions, steps }: { sessions: SessionRef[]; steps: StepView[] }) {
  const { rows } = deriveSessionAudit(sessions, steps);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <SessionCard
          key={row.sourceIdx}
          row={row}
          session={sessions[row.sourceIdx]!}
          steps={steps}
          defaultOpen={sessions[row.sourceIdx]?.status === 'running'}
        />
      ))}
    </div>
  );
}
