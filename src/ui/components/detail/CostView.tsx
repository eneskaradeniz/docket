import type { CostSummary } from '../../../core/types';
import { formatUsd, UI } from '../../data/labels';

export function CostView({ cost, hasSessions }: { cost: CostSummary; hasSessions: boolean }) {
  // No sessions yet → a stated reason, not a misleading $0.00 (ADR-0001 spirit).
  if (!hasSessions) {
    return <div className="text-right text-xs text-slate-400">{UI.costNoSessions}</div>;
  }
  const tokens = cost.tokensIn + cost.tokensOut;
  return (
    <div className="text-right text-xs text-slate-500">
      <div className="font-medium text-slate-700">{formatUsd(cost.usd)}</div>
      <div>
        {tokens.toLocaleString()} {UI.tokens}
      </div>
    </div>
  );
}
