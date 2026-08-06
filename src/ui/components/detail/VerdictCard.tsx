import { useEffect, useState } from 'react';
import type { StepView } from '../../../core/types';
import { UI } from '../../data/labels';
import { MarkdownBody } from './MarkdownBody';

// The architect's verdict card (WO-0020). Shown when a review needs the operator: gates+revise (the architect
// wants a revision) or every-step (every verdict surfaces). The operator continues to the next step or sends
// the step back for a re-run. The verdict body (the architect's reasoning) is read lazily from the decision
// store (verdicts/step-NN.md) at view time.
export function VerdictCard({
  step,
  loadVerdict,
  onContinue,
  onRevise,
}: {
  step: StepView;
  loadVerdict: () => Promise<string>;
  onContinue: () => void;
  onRevise: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBody(null);
    loadVerdict().then((b) => {
      if (!cancelled) setBody(b);
    });
    return () => {
      cancelled = true;
    };
  }, [loadVerdict]);

  const revise = step.verdict === 'revise';
  const title = revise ? UI.verdictCardReviseTitle : step.verdict === 'proceed' ? UI.verdictCardProceedTitle : UI.verdictCardUnknown;
  const barTone = revise ? 'bg-brass' : step.verdict === 'proceed' ? 'bg-sage' : 'bg-clay';
  const titleTone = revise ? 'text-brass' : step.verdict === 'proceed' ? 'text-sage' : 'text-clay';

  return (
    <div className="flex items-stretch rounded-sm border border-rule bg-surface">
      <div className={`w-1 self-stretch ${barTone}`} />
      <div className="flex-1 px-3.5 py-3">
        <p className={`text-[11px] font-semibold uppercase tracking-wider ${titleTone}`}>{title}</p>
        <p className="mb-2 mt-1 text-[12px] text-inkdim">{UI.verdictCardHint}</p>
        {body === null ? (
          <p className="text-xs text-inkdim">{UI.loading}</p>
        ) : body.trim() ? (
          <MarkdownBody content={body} />
        ) : (
          <p className="text-xs text-inkdim">{UI.stepVerdictMissing}</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onRevise} className="btn-ghost rounded px-3 py-1 text-xs">
            {UI.rerunStep}
          </button>
          <button type="button" onClick={onContinue} className="btn-primary rounded px-3 py-1 text-xs">
            {UI.devamStep}
          </button>
        </div>
      </div>
    </div>
  );
}
