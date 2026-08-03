import type { StopAndAsk } from '../../../core/types';
import { stoppedAtGate } from '../../data/labels';
import { Badge } from '../primitives/Badge';

// Pinned ABOVE the transcript (ADR-0005): a question that scrolls away is a question unasked.
// PROVISIONAL — its shape depends on WO-0001's permission-prompt finding.
export function StopAndAskCard({ stopAndAsk }: { stopAndAsk: StopAndAsk }) {
  return (
    <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2">
      <div className="mb-1 flex items-center gap-2">
        <Badge tone="warn">{stoppedAtGate(stopAndAsk.gate)}</Badge>
      </div>
      <p className="text-sm text-slate-800">{stopAndAsk.question}</p>
    </div>
  );
}
