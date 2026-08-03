import type { CostSummary } from '../../../core/types';
import { UI } from '../../data/labels';

export function CostView({ cost }: { cost: CostSummary }) {
  const tokens = cost.tokensIn + cost.tokensOut;
  return (
    <div className="text-right text-xs text-slate-500">
      <div className="font-medium text-slate-700">${cost.usd.toFixed(2)}</div>
      <div>
        {tokens.toLocaleString()} {UI.tokens}
      </div>
    </div>
  );
}
