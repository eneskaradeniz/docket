import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { CostSummary } from '../../../core/types';
import { MarkdownBody } from '../detail/MarkdownBody';
import { parsePlanSteps } from '../../../core/plan-steps';
import { formatCost, UI } from '../../data/labels';
import { Button, Textarea } from '../../kit';

// The plan document panel (WO-0031b restyle): the architect proposed a plan — a document, not a ticket.
// Steady signal lamp (no breathing — the wait is YOURS, not the machine's), readout meta header with the
// architect byline (role-aware — the old hardcoded 'mimar'), markdown body, footer actions. While an
// action is in flight the controls are absent (not inactive — ADR-0001).
export function PlanReadyCard({
  plan,
  cost,
  approving,
  objecting,
  onApprove,
  onObject,
}: {
  plan: string;
  cost?: CostSummary;
  approving: boolean;
  objecting: boolean;
  onApprove: () => void;
  onObject: (feedback: string) => void;
}) {
  const [objectMode, setObjectMode] = useState(false);
  const [feedback, setFeedback] = useState('');
  const inFlight = approving || objecting;
  // WO-0029 / B15: a plan without a ```steps fence would silently fall to the free-form flow on approval —
  // warn BEFORE the operator clicks (the run's first plan had exactly this).
  const noSteps = parsePlanSteps(plan).length === 0;

  return (
    <div className="mb-2 flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface shadow-sm">
      <div className="lamp lamp-signal" />
      <div className="min-w-0 flex-1 px-3.5 py-3">
        {noSteps ? (
          <p className="mb-2 flex items-start gap-1.5 rounded border border-signal/40 bg-signal/10 px-2 py-1.5 text-xs text-signal">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {UI.planNoStepsWarn}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <p className="readout text-signal">{UI.planReadyHeader}</p>
          <span className="font-mono text-[11px] text-inkdim">{UI.askingRole('architect')}</span>
          <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-inkdim">
            {objecting ? <span className="text-signal">{UI.objectingLine}</span> : null}
            {cost && cost.usd > 0 ? <span>{formatCost(cost)}</span> : null}
          </span>
        </div>
        <p className="mb-2 mt-1 text-[12px] text-inkdim">{UI.planReviewHint}</p>
        <MarkdownBody content={plan} />

        <div className="mt-3 border-t border-hairline pt-3">
          {inFlight ? (
            <span className="text-xs text-inkdim">{approving ? UI.approvingPlan : UI.objectingPlan}</span>
          ) : objectMode ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={2}
                placeholder={UI.objectPlaceholder}
                className="font-sans text-[13px]"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setObjectMode(false); setFeedback(''); }}>{UI.objectCancel}</Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const f = feedback.trim();
                    if (f) { onObject(f); setObjectMode(false); setFeedback(''); }
                  }}
                >
                  {UI.objectSend}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setObjectMode(true)}>{UI.object}</Button>
              <Button variant="primary" size="sm" onClick={onApprove}>{UI.approve}</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
