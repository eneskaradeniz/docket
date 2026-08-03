import type { CostSummary } from '../../../core/types';
import { formatUsd, UI } from '../../data/labels';

export function CostView({ cost }: { cost: CostSummary }) {
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
