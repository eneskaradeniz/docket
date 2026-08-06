import { useState } from 'react';
import type { CostSummary } from '../../../core/types';
import { MarkdownBody } from '../detail/MarkdownBody';
import { formatUsd, UI } from '../../data/labels';

// The plan-ready card (WO-0016 redesign): the architect proposed a plan — render it as markdown inside an
// evidence-ticket shell, then Onayla (commit plan.md + flip the gate) or İtiraz et (send the architect back
// to revise, in plan mode). While an action is in flight the controls are absent (not disabled — ADR-0001).
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

  return (
    <div className="mb-2 flex items-stretch rounded-sm border border-rule bg-surface">
      <div className={`bar bar-brass${inFlight ? '' : ' pulse'}`} />
      <div className="perf" />
      <div className="flex-1 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brass">{UI.planReadyHeader}</p>
          <span className="ml-auto font-mono text-[11px] text-inkdim">mimar</span>
          {cost && cost.usd > 0 ? <span className="font-mono text-[11px] text-inkdim">{formatUsd(cost.usd)}</span> : null}
        </div>
        <p className="mb-2 mt-1 text-[12px] text-inkdim">{UI.planReviewHint}</p>
        <MarkdownBody content={plan} />

        <div className="mt-3">
          {inFlight ? (
            <span className="text-xs text-inkdim">{approving ? UI.approvingPlan : UI.objectingPlan}</span>
          ) : objectMode ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={2}
                placeholder={UI.objectPlaceholder}
                className="rounded border border-rule bg-bg p-2 text-xs text-ink outline-none"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setObjectMode(false); setFeedback(''); }} className="btn-ghost rounded px-3 py-1 text-xs">{UI.objectCancel}</button>
                <button
                  type="button"
                  onClick={() => {
                    const f = feedback.trim();
                    if (f) { onObject(f); setObjectMode(false); setFeedback(''); }
                  }}
                  className="btn-primary rounded px-3 py-1 text-xs"
                >
                  {UI.objectSend}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onApprove} className="btn-primary rounded px-3 py-1 text-xs">{UI.approve}</button>
              <button type="button" onClick={() => setObjectMode(true)} className="btn-ghost rounded px-3 py-1 text-xs">{UI.object}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
