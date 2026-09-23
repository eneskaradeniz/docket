// SessionCards (WO-0038) — the session ledger as CARDS, replacing the audit table (operator ruling
// 2026-08-22: "terminali görmek isteyen görsün, aç kapa yapabiliriz"). Each card carries the three
// things a reader wants of a RECORD: the KİM — ROL head line + meta (range · duration · cost; a
// breathing dot while a stale row still says running — WO-0044 tur 2: ownership reads at a glance,
// the role word in its role hue over the 3px role edge and the visible --bord card border), a
// one-line SUMMARY — the session's ARTIFACT HEADLINE (operator-approved 2026-08-22: plan → the
// fence's count, review → the architect's verdict, step/free → the agent's closing sentence; NEVER
// invented — no artifact, no line; the LLM-written summary is the recorded upgrade path, only if
// these disappoint), and the FULL HISTORY exactly one click away (the Ray transcript, tool blocks
// collapsed — the aç/kapa IS the old SADE/DETAY distinction, now living on the card). History sits
// CLOSED.
//
// WO-0044 (2026-08-25, the first real step-drive dogfood): the ledger is PURE HISTORY — the
// RUNNING drive carries NO card here (WO-0039/C's pointer card died with it: card-level facts +
// "▸ Canlı oturum" duplicated the driven row's live header one scroll below, in a grammar the
// completed cards do not speak). The ONE live surface is the driven row's StepPane instrument;
// a session joins this ledger as a plain card the moment it ends. A first plan run therefore
// renders NO ledger at all (ADR-0012: an empty group is absent, not framed).
import { useRef, useState } from 'react';
import type { SessionAuditRow } from '../../../core/derive';
import { deriveSessionAudit, sessionHeadline } from '../../../core/derive';
import type { SessionRef, SessionRole, StepView } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { cn } from '../../kit';
import { ChatTranscript } from '../session/ChatTranscript';

/** Faz 1 summary trim → WO-0044 tur 3: the headline derivation moved to core as `sessionHeadline`
 *  — markdown tokens leak no more ("## Uygulayıcı Raporu — … **PR: …**" read raw on the card), and
 *  the ui layer never `.replace`s (the ADR-0007 proxy). First sentence, 140-char clamp, undefined
 *  when nothing readable remains. */

function rowName(row: SessionAuditRow, UI: ReturnType<typeof useLabels>['UI']): string {
  switch (row.name.kind) {
    case 'plan':
      return UI.auditNamePlan;
    case 'step':
      return UI.auditNameStep(row.name.idx);
    case 'review':
      return UI.auditNameReview(row.name.idx);
    case 'unscoped':
      return UI.auditNameUnscoped;
  }
}

/** WO-0044 tur 2: the role word's hue — the KİM — ROL line's color leg (architect amber,
 *  implementer blue, verifier green; the word is never color alone — it is the word itself). */
const ROLE_WORD_CLASS: Record<SessionRole, string> = {
  architect: 'text-signal',
  implementer: 'text-info',
  verifier: 'text-proceed',
};

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
  const { formatUsd, ROLE_LABELS, UI } = useLabels();
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
    if (lastAssistant) summary = sessionHeadline(lastAssistant.text);
  }
  const range =
    row.startedAt && row.endedAt
      ? UI.auditRange(row.startedAt, row.endedAt)
      : row.startedAt
        ? UI.auditClock(row.startedAt)
        : UI.auditCostNone;

  return (
    <div
      ref={cardRef}
      data-session-card=""
      data-open={open ? '1' : undefined}
      className={cn('rcard overflow-hidden rounded-md bg-surface', `rcard-${row.role}`)}
    >
      {/* ONE interactive zone — the whole header toggles BOTH ways (operator, 2026-08-22: one hover
          wash across it); the transcript body lives OUTSIDE the button, so clicks inside it (tool
          toggles, selection, scroll) never collapse the card. WO-0044 tur 2 anatomy (mockup
          wo-0044-live-top): head line = the KİM — ROL readout (whose session this was reads at a
          glance — the role word in its role hue) + the meta; the step's aim rides its own line;
          then the özet. The card carries the visible --bord edge + the 3px role edge. */}
      <button
        type="button"
        data-session-toggle=""
        aria-expanded={open}
        onClick={toggle}
        className="irow block w-full text-left"
      >
        <span className="flex w-full items-center gap-2.5 pb-0.5 pl-4 pr-3 pt-2.5">
          <span className="shrink-0 font-mono text-[10px] text-inkdim" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="readout min-w-0 shrink truncate">
            {rowName(row, UI)} — <span className={cn('font-semibold', ROLE_WORD_CLASS[row.role])}>{ROLE_LABELS[row.role]}</span>
          </span>
          <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2.5 pl-2 font-mono text-[10.5px] text-inkdim">
            {live ? (
              <>
                <span className="h-[5px] w-[5px] shrink-0 rounded-full lamp-run" aria-hidden="true" />
                <span className="text-info">{UI.actionRunning}</span>
              </>
            ) : null}
            {/* WO-0098: which backend drove it — the profile + the model the session REPORTED
                (only when a named profile drove; the built-in passthrough adds nothing). */}
            {session.profile ? (
              <span data-session-backend="" className="max-w-[220px] truncate whitespace-nowrap">
                {[session.profile, session.reportedModel].filter((x): x is string => !!x).join(' · ')}
              </span>
            ) : null}
            <span className="whitespace-nowrap">{range}</span>
            <span className="whitespace-nowrap">{UI.formatDuration(row.durationMs)}</span>
            {row.costUsd !== undefined ? <span className="whitespace-nowrap">{formatUsd(row.costUsd)}</span> : null}
          </span>
        </span>
        {row.name.kind === 'step' && row.name.aim ? (
          <span className="block truncate pb-0.5 pl-10 pr-3 text-[12.5px] font-semibold text-ink">{row.name.aim}</span>
        ) : null}
        {summary ? (
          <span
            data-session-summary=""
            className="mt-0.5 block pb-2.5 pl-10 pr-3 text-[12px] leading-snug text-inkdim line-clamp-2"
          >
            <span className="font-semibold text-ink">{UI.sessionSummary} — </span>
            {summary}
          </span>
        ) : (
          <span className="block pb-2.5" aria-hidden="true" />
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

/** WO-0044 (reviewer round): the row whose provider session IS the live drive — the pipeline
 *  persists it 'running' at start (and a Sürdür CONTINUES the same provider session), so a
 *  mid-run re-entry WOULD see it. Pure history means no card for it while the leg runs, however
 *  much ended history the same row carries; the row joins the ledger when the drive ends. */
export function isLiveSessionRow(s: SessionRef | undefined, liveSessionId: string | undefined): boolean {
  return liveSessionId !== undefined && s?.providerSessionId !== undefined && s.providerSessionId === liveSessionId;
}

/** WO-0044: the ledger is history only — every row is the same SessionCard. The live drive's row
 *  carries no card; a 'running' row with NO live counterpart is the crash/restart leftover — it
 *  opens itself, honestly incomplete. */
export function SessionCards({ sessions, steps, liveSessionId }: { sessions: SessionRef[]; steps: StepView[]; liveSessionId?: string }) {
  const { rows } = deriveSessionAudit(sessions, steps);
  return (
    <div className="flex flex-col gap-2">
      {rows
        .filter((row) => !isLiveSessionRow(sessions[row.sourceIdx], liveSessionId))
        .map((row) => {
          const session = sessions[row.sourceIdx]!;
          return (
            <SessionCard
              key={row.sourceIdx}
              row={row}
              session={session}
              steps={steps}
              defaultOpen={session.status === 'running'}
            />
          );
        })}
    </div>
  );
}
