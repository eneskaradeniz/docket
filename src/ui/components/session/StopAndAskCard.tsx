import { FilePen, SquareTerminal } from 'lucide-react';
import { summarizeToolInput } from '../../../core/runner';
import { permissionPrompt, UI } from '../../data/labels';
import { Button } from '../../kit';

// The signal card (WO-0031b restyle): a permission ask is THE amber moment — the one thing in the
// whole app that breathes. Pinned ABOVE the transcript (ADR-0005): a question that scrolls away is a
// question unasked. Vendor-neutral — the provider's own prompt sentence is not used; the question is
// composed from the tool label + path/command. Buttons: İzin ver is primary (the common path).
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
  const detail = summarizeToolInput(input);
  const isShell = detail !== '' && !detail.includes('/');
  return (
    <div className="mb-2 flex items-stretch overflow-hidden rounded-md border border-signal/40 bg-surface shadow-sm">
      <div className="lamp lamp-signal-breathe" />
      <div className="min-w-0 w-full px-3.5 py-3">
        <p className="readout flex items-center gap-1.5 text-signal">
          {isShell ? (
            <SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <FilePen className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {planContext ? UI.architectRequest : UI.permissionRequested}
        </p>
        <p className="mt-1.5 text-sm text-ink">
          {permissionPrompt(tool, detail)}
        </p>
        {reason ? <p className="mt-1 text-xs text-inkdim">{reason}</p> : null}
        <div className="mt-2.5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDeny}>{UI.deny}</Button>
          <Button variant="primary" size="sm" onClick={onAllow}>{UI.allow}</Button>
        </div>
      </div>
    </div>
  );
}
