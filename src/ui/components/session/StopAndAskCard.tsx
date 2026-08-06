import { summarizeToolInput } from '../../../core/runner';
import { permissionPrompt, UI } from '../../data/labels';

// Pinned ABOVE the transcript (ADR-0005): a question that scrolls away is a question unasked.
// Live (WO-0008): surfaces a permission_request from the runner. Vendor-neutral — the provider's
// own prompt sentence is not used; the question is composed from the tool label + path/command.
export function StopAndAskCard({
  tool,
  input,
  reason,
  planContext,
  onAllow,
  onDeny,
}: {
  tool: string;
  input: Record<string, unknown>;
  reason?: string;
  /** In the architect plan flow a permission reads as "the architect wants to do X", not an alarm. */
  planContext?: boolean;
  onAllow: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="mb-2 flex items-stretch rounded-sm border border-rule bg-surface">
      <div className="bar bar-brass pulse" />
      <div className="perf" />
      <div className="w-full px-3.5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brass">{planContext ? UI.architectRequest : UI.permissionRequested}</p>
        <p className="mt-1 text-sm text-ink">{permissionPrompt(tool, summarizeToolInput(input))}</p>
        {reason ? <p className="mt-1 text-xs text-inkdim">{reason}</p> : null}
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={onAllow} className="btn-primary rounded px-3 py-1 text-xs">
            {UI.allow}
          </button>
          <button type="button" onClick={onDeny} className="btn-ghost rounded px-3 py-1 text-xs">
            {UI.deny}
          </button>
        </div>
      </div>
    </div>
  );
}
