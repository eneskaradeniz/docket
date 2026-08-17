import { useEffect, useState } from 'react';
import type { StepView } from '../../../core/types';
import { UI } from '../../data/labels';
import { Button } from '../../kit';
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
  const lampTone = revise ? 'lamp-signal' : step.verdict === 'proceed' ? 'lamp-done' : 'lamp-error';
  const titleTone = revise ? 'text-signal' : step.verdict === 'proceed' ? 'text-proceed' : 'text-error';

  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface shadow-sm">
      <div className={`lamp ${lampTone}`} />
      <div className="flex-1 px-3.5 py-3">
        <p className={`readout ${titleTone}`}>{title}</p>
        {body === null ? (
          <p className="text-xs text-inkdim">{UI.loading}</p>
        ) : body.trim() ? (
          <MarkdownBody content={body} />
        ) : (
          <p className="text-xs text-inkdim">{UI.stepVerdictMissing}</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onRevise}>{UI.rerunStep}</Button>
          <Button variant="primary" size="sm" onClick={onContinue}>{UI.devamStep}</Button>
        </div>
      </div>
    </div>
  );
}
