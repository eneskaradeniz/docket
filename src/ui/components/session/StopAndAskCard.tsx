import { useState } from 'react';
import { FilePen, SquareTerminal } from 'lucide-react';
import { summarizeToolInput } from '../../../core/runner';
import { isRiskyPermission } from '../../../core/risky';
import { permissionPrompt, UI } from '../../data/labels';
import { Button, cn } from '../../kit';

// The signal card (WO-0031b restyle; WO-0031c additions): a permission ask is THE amber moment — the
// one thing in the whole app that breathes. Pinned ABOVE the transcript (ADR-0005): a question that
// scrolls away is a question unasked. Vendor-neutral — the provider's own prompt sentence is not used;
// the question is composed from the tool label + path/command. Buttons: İzin ver is primary (the common
// path). WO-0031c: a RISKY write wears the "riskli yazım" readout (core/risky.ts decides), write cards
// offer the diff peek (▸ fark — the old content is read main-side), and the operator may lift the whole
// WO to full-auto from here ("Bu iş emri için hep otomatik") — which also answers the current ask.
export function StopAndAskCard({
  tool,
  input,
  reason,
  planContext,
  onAllow,
  onDeny,
  onAlwaysAuto,
  alwaysAutoBusy,
  diffPeek,
}: {
  tool: string;
  input: Record<string, unknown>;
  reason?: string;
  /** In the architect plan flow a permission reads as "the architect wants to do X", not an alarm. */
  planContext?: boolean;
  onAllow: () => void;
  onDeny: () => void;
  /** WO-0031c: "Bu iş emri için hep otomatik" — persists full_auto AND allows this ask. Absent = the
   *  surface hides it (already full_auto: the ask wouldn't exist). */
  onAlwaysAuto?: () => void;
  alwaysAutoBusy?: boolean;
  /** WO-0031c: the diff peek loader for write tools — returns capped diff structure (or null). */
  diffPeek?: (filePath: string, newContent: string) => Promise<{ lines: Array<{ op: 'add' | 'del' | 'ctx'; text: string }>; truncated: number } | null>;
}) {
  const detail = summarizeToolInput(input);
  const isShell = detail !== '' && !detail.includes('/');
  const risky = isRiskyPermission(tool, input);
  const filePath = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : undefined;
  const newContent = typeof input.content === 'string' ? input.content : typeof input.new_string === 'string' ? input.new_string : '';
  const canPeek = diffPeek !== undefined && filePath !== undefined && newContent !== '';
  const [peek, setPeek] = useState<{ lines: Array<{ op: 'add' | 'del' | 'ctx'; text: string }>; truncated: number } | null>(null);
  const [peekOpen, setPeekOpen] = useState(false);
  const [peekLoading, setPeekLoading] = useState(false);
  const togglePeek = async (): Promise<void> => {
    if (!diffPeek || filePath === undefined) return;
    if (peekOpen) {
      setPeekOpen(false);
      return;
    }
    if (peek === null) {
      setPeekLoading(true);
      try {
        setPeek(await diffPeek(filePath, newContent));
      } catch {
        setPeek(null);
      } finally {
        setPeekLoading(false);
      }
    }
    setPeekOpen(true);
  };
  return (
    <div className="mb-2 flex items-stretch overflow-hidden rounded-md border border-signal/40 bg-surface shadow-sm">
      <div className="lamp lamp-signal-breathe" />
      <div className="min-w-0 w-full px-3.5 py-3">
        <p className="readout flex flex-wrap items-center gap-1.5 text-signal">
          {isShell ? (
            <SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <FilePen className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {planContext ? UI.architectRequest : UI.permissionRequested}
          {risky ? <span className="rounded border border-signal/50 px-1.5 py-px text-[10px]">{UI.askRiskyTag}</span> : null}
          {canPeek ? (
            <button type="button" className="irow ml-auto px-1.5 text-[10px] normal-case tracking-normal" onClick={() => void togglePeek()}>
              {peekLoading ? UI.loading : peekOpen ? UI.diffPeekHide : UI.diffPeek}
            </button>
          ) : null}
        </p>
        <p className="mt-1.5 text-sm text-ink">
          {permissionPrompt(tool, detail)}
        </p>
        {reason ? <p className="mt-1 text-xs text-inkdim">{reason}</p> : null}
        {peekOpen && peek ? (
          <pre className="mt-2 max-h-48 overflow-auto rounded border border-hairline bg-bg p-2 font-mono text-[11px] leading-relaxed">
            {peek.lines.length === 0
              ? UI.diffEmpty
              : peek.lines.map((l, i) => (
                  <span key={i} className={cn('block whitespace-pre-wrap', l.op === 'add' ? 'text-proceed' : l.op === 'del' ? 'text-error' : 'text-inkdim')}>
                    {l.op === 'add' ? '+ ' : l.op === 'del' ? '- ' : '  '}
                    {l.text}
                  </span>
                ))}
            {peek.truncated > 0 ? <span className="block text-inkdim">{UI.diffTruncated(peek.truncated)}</span> : null}
          </pre>
        ) : null}
        <div className="mt-2.5 flex flex-wrap justify-end gap-2">
          {onAlwaysAuto ? (
            <Button variant="ghost" size="sm" busy={alwaysAutoBusy} locked={alwaysAutoBusy} className="mr-auto" onClick={onAlwaysAuto}>
              {UI.askAlwaysAuto}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onDeny}>{UI.deny}</Button>
          <Button variant="primary" size="sm" onClick={onAllow}>{UI.allow}</Button>
        </div>
      </div>
    </div>
  );
}
