// PlanApprovalCards (WO-0031c / v4) — the plan's PRIMARY surface at the approval moment: "Mimar N adım
// önerdi" over a grid of StepCards (the markdown prose stays a document, read in DETAY · Belgeler).
// The approval ACTIONS live in the rail (Onayla / İtiraz et) — this card only speaks. Pre-approval
// editing (c2) turns this grid into the inline editor.
import { parsePlanSteps } from '../../../core/plan-steps';
import { UI } from '../../data/labels';
import { StepCard } from './StepCard';

export function PlanApprovalCards({ plan }: { plan: string }) {
  const specs = parsePlanSteps(plan);
  return (
    <section className="rounded-md border border-hairline bg-surface p-3.5 shadow-sm">
      <header className="mb-2.5 flex items-baseline gap-2.5">
        <p className="readout text-signal">{UI.planReadyHeader}</p>
        <p className="text-[13px] font-semibold text-ink">{UI.planProposedSteps(specs.length)}</p>
      </header>
      {specs.length === 0 ? (
        <p className="rounded-md border border-signal/40 bg-signal/5 px-3 py-2 text-[12px] text-signal">
          {UI.planNoStepsWarn}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 min-[640px]:grid-cols-2">
          {specs.map((s) => (
            <StepCard key={s.idx} step={s} statusLine={UI.stepReady} next />
          ))}
        </div>
      )}
    </section>
  );
}
