import type { SessionRef, StepView } from '../../../core/types';
import { ROLE_LABELS, STEP_MARK, UI, VERDICT_MARK, formatUsd } from '../../data/labels';

// The plan's step list (WO-0017) — the primary surface once a plan is approved. Mirrors the design mock's
// renderPlan: a status mark (✓/►/○/⊘), `ROLE_LABELS[role] · aim`, and the scope right-aligned, with a
// "n/toplam adım" header. ADR-0001: the one runnable step shows a "Çalıştır" control; the others show only a
// mark — nothing is `disabled`. Done steps with a report are clickable to open it.
//
// Sequencing is strict: the runnable step is the FIRST non-done step, and only if it is 'pending' — an
// 'active' step (a run in progress) or a 'blocked' step (unresolvable scope) halts the sequence, so at most
// one Çalıştır exists and steps run one at a time on the single runner.
export function StepList({
  steps,
  sessions,
  onOpenReport,
}: {
  steps: StepView[];
  /** The WO's sessions — the per-step duration/cost summary (WO-0031c: adım kartları ⏱ + $ taşır). */
  sessions?: SessionRef[];
  onOpenReport: (step: StepView) => void;
}) {
  const done = steps.filter((s) => s.status === 'done').length;
  // A step's ⏱/$ sums ITS sessions (the run + the review of that step) — the ledger's summary form.
  const stepMeta = (idx: number): string | undefined => {
    const own = (sessions ?? []).filter((s) => s.stepIdx === idx);
    if (own.length === 0) return undefined;
    const ms = own.reduce((acc, s) => acc + (s.startedAt && s.endedAt ? new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime() : 0), 0);
    const usd = own.reduce((acc, s) => acc + (s.cost?.usd ?? 0), 0);
    return UI.stepCostMeta(UI.formatDuration(ms), formatUsd(usd));
  };

  const markTone = (status: StepView['status']): string =>
    status === 'blocked' ? 'text-error' : status === 'done' ? 'text-proceed' : status === 'active' ? 'text-info' : 'text-inkdim';

  return (
    <section className="rounded-md border border-hairline bg-surface p-3 shadow-sm">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.stepsHeader}</h2>
        <span className="font-mono text-[11px] text-inkdim">
          {done}/{steps.length} {UI.stepsUnit}
        </span>
      </header>
      <ul className="flex flex-col gap-1">
        {steps.map((s) => {
          const hasReport = s.status === 'done' && !!s.reportPath;
          const scopeText = s.scope.kind === 'all' ? UI.stepScopeAll : s.scope.ref;
          // Done step's mark reflects the verdict: revise ↻, proceed ✓, no-verdict '…' (review pending) (WO-0020).
          const mark = s.status === 'done'
            ? s.verdict === 'revise' ? VERDICT_MARK.revise : s.verdict === 'proceed' ? STEP_MARK.done : '…'
            : STEP_MARK[s.status];
          const tone = s.status === 'done' && s.verdict === 'revise' ? 'text-signal' : markTone(s.status);
          return (
            <li
              key={s.idx}
              className={`flex items-center gap-2 rounded px-2 py-1 text-[13px] ${s.status === 'active' ? 'bg-surface' : ''}`}
            >
              <span className={`w-4 text-center ${tone}`} aria-label={s.status}>
                {mark}
              </span>
              <span className="font-mono text-[11px] text-inkdim">{s.idx}</span>
              {hasReport ? (
                <button type="button" onClick={() => onOpenReport(s)} className="text-left text-ink hover:underline">
                  {ROLE_LABELS[s.role]} · {s.aim}
                </button>
              ) : (
                <span className={s.status === 'blocked' ? 'text-error' : 'text-ink'}>
                  {ROLE_LABELS[s.role]} · {s.aim}
                  {s.status === 'blocked' ? <span className="ml-2 text-[11px] text-error">— {UI.stepBlockedHint}</span> : null}
                </span>
              )}
              <span className="ml-auto font-mono text-[11px] text-inkdim">
                {s.status === 'done' && stepMeta(s.idx) ? <span className="mr-2 text-proceed/80">{stepMeta(s.idx)}</span> : null}
                {scopeText}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
