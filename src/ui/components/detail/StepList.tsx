import { useEffect, useRef, useState } from 'react';
import type { SessionRef, StepRole, StepView, WorkOrderId } from '../../../core/types';
import { ROLE_LABELS, STEP_MARK, UI, VERDICT_MARK, formatUsd } from '../../data/labels';
import { cn } from '../../kit';
import { MarkdownBody } from './MarkdownBody';
import { RoleChip } from './RoleChip';
import { StepPane } from '../session/StepPane';

// The step SPINE (WO-0017 → WO-0031f v6): the step list is Akış's body — a bare <ul> of rows (the
// old outer card + "Plan n/toplam" header died; the Akış tab count carries the number). Anatomy per
// v6 §01: state mark · mono idx · role · aim, right-aligned meta; a DONE row is a real button
// (aria-expanded) whose report opens UNDER the row — one report open at a time (the lifted
// `reportStep`); the ACTIVE row carries its live terminal INLINE (StepPane's row form, pinned — the
// live thing is never hidden behind a toggle); pending rows stay quiet. Scope text survives only for
// SCOPED rows (a non-'all' scope is the notable fact; 'hepsi' is the quiet default — v6's meta line).
//
// Sequencing is unchanged (WO-0017): the runnable step is the first non-done one; the auto-drive and
// the fold live in StepPane, which the driven row renders.
//
// WO-0031d / v4 §7 — juice on TRANSITIONS only (never mount): a flip to done flashes the row green
// and the proceed ✓ DRAWS; a flip to blocked flashes red; a done row fills its 2px mini bar. The
// prev-state ref is fresh per mount, so a remount (SADE↔DETAY, reload) reads as "already seen" and
// stays calm (ADR-0012 r7).
export function StepList({
  steps,
  sessions,
  workOrderId,
  activeIdx,
  reportStep,
  onToggleReport,
  onGetStepReport,
  now,
}: {
  steps: StepView[];
  /** The WO's sessions — the per-step duration/cost summary + the report header's clock. */
  sessions?: SessionRef[];
  workOrderId: WorkOrderId;
  /** The driven step (runIdx) — its row renders StepPane inline (the terminal is pinned open). */
  activeIdx?: number;
  /** The one open report (lifted to the controller: one at a time + the substrip focus reads it). */
  reportStep?: StepView;
  onToggleReport: (step: StepView) => void;
  onGetStepReport: (idx: number, role: StepRole) => Promise<string>;
  /** The controller's one-second ticker — StepPane's live costline reuses it. */
  now?: number;
}) {
  // A step's ⏱/$ sums ITS sessions (the run + the review of that step) — the ledger's summary form.
  const stepMeta = (idx: number): string | undefined => {
    const own = (sessions ?? []).filter((s) => s.stepIdx === idx);
    if (own.length === 0) return undefined;
    const ms = own.reduce((acc, s) => acc + (s.startedAt && s.endedAt ? new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime() : 0), 0);
    const usd = own.reduce((acc, s) => acc + (s.cost?.usd ?? 0), 0);
    return UI.stepCostMeta(UI.formatDuration(ms), formatUsd(usd));
  };
  // The report header's aside clock — the step's last finished session (v6: "Rapor · Adım 1 + rol + 14:22").
  const stepClock = (idx: number): string | undefined => {
    const last = [...(sessions ?? [])].filter((s) => s.stepIdx === idx && s.endedAt).at(-1);
    return last?.endedAt ? UI.auditClock(last.endedAt) : undefined;
  };

  const markTone = (status: StepView['status']): string =>
    status === 'blocked' ? 'text-error' : status === 'done' ? 'text-proceed' : status === 'active' ? 'text-info' : 'text-inkdim';

  // --- Transition detection (WO-0031d): state = status + verdict; a CHANGED key vs the previous render
  //     arms a one-window flash. The window clears itself so a remount never replays a stale class. ---
  const prevStates = useRef<Map<number, string>>(new Map());
  const [flashes, setFlashes] = useState<Record<number, { tone: 'ok' | 'err'; n: number }>>({});
  useEffect(() => {
    const armed: Array<[number, 'ok' | 'err']> = [];
    for (const s of steps) {
      const key = `${s.status}:${s.verdict ?? ''}`;
      const prev = prevStates.current.get(s.idx);
      if (prev !== undefined && prev !== key) {
        if (s.status === 'done') armed.push([s.idx, 'ok']);
        else if (s.status === 'blocked') armed.push([s.idx, 'err']);
      }
      prevStates.current.set(s.idx, key);
    }
    if (armed.length === 0) return;
    setFlashes((f) => {
      const next = { ...f };
      for (const [idx, tone] of armed) next[idx] = { tone, n: (next[idx]?.n ?? 0) + 1 };
      return next;
    });
    const t = setTimeout(() => {
      setFlashes((f) => {
        const next = { ...f };
        for (const [idx] of armed) delete next[idx];
        return next;
      });
    }, 400);
    return () => clearTimeout(t);
  }, [steps]);

  return (
    <ul className="flex flex-col gap-1.5" data-steps={steps.length}>
      {steps.map((s) => {
        const hasReport = s.status === 'done' && !!s.reportPath;
        const open = reportStep?.idx === s.idx;
        const driven = activeIdx === s.idx && (s.status === 'active' || s.status === 'pending');
        const flash = flashes[s.idx];
        const drewProceed = s.status === 'done' && s.verdict === 'proceed';
        // Done step's mark: proceed draws the ✓ (animated only inside the flash window), revise ↻,
        // no-verdict '…' (review pending) (WO-0020).
        const tone = s.status === 'done' && s.verdict === 'revise' ? 'text-signal' : markTone(s.status);
        const scopeSuffix = s.scope.kind === 'all' ? '' : ` · ${s.scope.ref}`;
        // v6's meta line: done = the session sum (+ the report toggle when one exists); the driven
        // row = çalışıyor (the LIVE $ · ⏱ rides the terminal head, not duplicated here); pending quiet.
        const meta =
          s.status === 'done'
            ? `${stepMeta(s.idx) ?? ''}${hasReport ? `${stepMeta(s.idx) ? ' · ' : ''}${open ? UI.repClose : UI.repOpen}` : ''}`
            : driven
              ? `${UI.stepRunningShort}${scopeSuffix}`
              : s.status === 'active'
                ? `${UI.stepRunningShort}${scopeSuffix}`
                : `${UI.stepQueued}${scopeSuffix}`;

        const rowLine = (
          <>
            <span className={`w-4 shrink-0 text-center ${tone}`} aria-label={s.status}>
              {drewProceed ? (
                <svg
                  key={flash?.n ?? 0}
                  className={`checkmark ${flash?.tone === 'ok' ? 'draw' : ''}`}
                  viewBox="0 0 16 16"
                  width="12"
                  height="12"
                  aria-hidden="true"
                >
                  <path d="M3 8.5 6.5 12 13 4.5" />
                </svg>
              ) : s.status === 'done' ? (
                s.verdict === 'revise' ? VERDICT_MARK.revise : '…'
              ) : (
                STEP_MARK[s.status]
              )}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-inkdim">{s.idx}</span>
            <span className={cn('min-w-0 truncate text-[12.5px] font-semibold', s.status === 'blocked' ? 'text-error' : 'text-ink')}>
              {ROLE_LABELS[s.role]} · {s.aim}
              {s.status === 'blocked' ? <span className="ml-2 font-normal text-[11px] text-error">— {UI.stepBlockedHint}</span> : null}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-inkdim">{meta}</span>
            <div className="stepfill absolute inset-x-0 bottom-0" aria-hidden="true">
              <div style={{ width: s.status === 'done' ? '100%' : '0%' }} />
            </div>
          </>
        );

        return (
          <li key={s.idx} data-step-idx={s.idx} className="relative">
            <div
              className={cn(
                'relative flex items-center gap-2 overflow-hidden rounded-md border border-hairline bg-surface px-2.5 py-1.5',
                // D3: the row's 3px state edge — done speaks proceed, the driven/active row info,
                // the rest the quiet hairline base.
                s.status === 'done' ? 'step-edge-done' : s.status === 'active' || driven ? 'step-edge-act' : 'step-edge',
                flash ? (flash.tone === 'ok' ? 'flash' : 'flash-err') : '',
              )}
            >
              {hasReport ? (
                // v6: the done row IS the toggle — one real button, the .irow hover token (TD-038.2's
                // hand-rolled hover:underline dies with the old text-link form).
                <button
                  type="button"
                  data-step-toggle={s.idx}
                  aria-expanded={open}
                  aria-controls={`step-${s.idx}-report`}
                  onClick={() => onToggleReport(s)}
                  className="irow flex w-full items-center gap-2 text-left"
                >
                  {rowLine}
                </button>
              ) : (
                <div className="flex w-full items-center gap-2">{rowLine}</div>
              )}
            </div>
            {driven ? (
              // The live thing in front (v6): the driven step's terminal pinned inside its row.
              <StepPane step={s} workOrderId={workOrderId} sessions={sessions ?? []} now={now} />
            ) : null}
            {open && hasReport ? (
              <StepReportBody step={s} clock={stepClock(s.idx)} loadReport={() => onGetStepReport(s.idx, s.role)} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// The report under its own row (WO-0031f v6 R1 — the universal step-detail pattern; the detached
// StepReport card retired). The body lives in the decision store (reports/step-NN-<role>.md) and is
// read at view time — never cached (ADR-0010) — fetched lazily only while the row is open, with the
// cancel guard the old card carried. An empty body (the report file is absent) shows the missing copy.
function StepReportBody({
  step,
  clock,
  loadReport,
}: {
  step: StepView;
  clock?: string;
  loadReport: () => Promise<string>;
}) {
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBody(null);
    loadReport().then((b) => {
      if (!cancelled) setBody(b);
    });
    return () => {
      cancelled = true;
    };
  }, [loadReport]);

  return (
    <div id={`step-${step.idx}-report`} data-step-report={step.idx} className="repbody">
      <div className="mb-1 flex items-center gap-2">
        <span className="readout">{UI.reportTitle(step.idx)}</span>
        <RoleChip role={step.role} />
        {clock ? <span className="ml-auto font-mono text-[10px] text-inkdim">{clock}</span> : null}
      </div>
      {body === null ? (
        <p className="text-xs text-inkdim">{UI.loading}</p>
      ) : body.trim() ? (
        <MarkdownBody content={body} />
      ) : (
        <p className="text-xs text-inkdim">{UI.stepReportMissing}</p>
      )}
    </div>
  );
}
