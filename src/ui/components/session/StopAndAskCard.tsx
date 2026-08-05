import { summarizeToolInput } from '../../../core/runner';
import { permissionPrompt, UI } from '../../data/labels';
import { Badge } from '../primitives/Badge';

// Pinned ABOVE the transcript (ADR-0005): a question that scrolls away is a question unasked.
// Live (WO-0008): surfaces a permission_request from the runner. Vendor-neutral — the
// provider's own prompt sentence (which names the vendor) is not used; the question is
// composed from the tool label + the attempt's path/command (ADR-0006/0007).
export function StopAndAskCard({
  tool,
  input,
  reason,
  onAllow,
  onDeny,
}: {
  tool: string;
  input: Record<string, unknown>;
  reason?: string;
  onAllow: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2">
      <div className="mb-1 flex items-center gap-2">
        <Badge tone="warn">{UI.permissionRequested}</Badge>
      </div>
      <p className="mb-2 text-sm text-slate-800">{permissionPrompt(tool, summarizeToolInput(input))}</p>
      {reason ? <p className="mb-2 text-xs text-slate-500">{reason}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAllow}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
        >
          {UI.allow}
        </button>
        <button
          type="button"
          onClick={onDeny}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {UI.deny}
        </button>
      </div>
    </div>
  );
}
