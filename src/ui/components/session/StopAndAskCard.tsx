import { useId, useState } from 'react';
import { FilePen, SquareTerminal } from 'lucide-react';
import { summarizeToolInput } from '../../../core/runner';
import { isRiskyPermission } from '../../../core/risky';
import {
  type AskAnswer,
  type AskQuestion,
  askOptionDisplayLabel,
  askOptionIsRecommended,
  parseAskRequest,
} from '../../../core/askq';
import { useLabels } from '../../data/locale';
import { Button, cn } from '../../kit';

// The signal card (WO-0031b restyle; WO-0031c additions): a permission ask is THE amber moment — the
// one thing in the whole app that breathes. Pinned ABOVE the transcript (ADR-0005): a question that
// scrolls away is a question unasked. Vendor-neutral — the provider's own prompt sentence is not used;
// the question is composed from the tool label + path/command. Buttons: İzin ver is primary (the common
// path). WO-0031c: a RISKY write wears the "riskli yazım" readout (core/risky.ts decides), write cards
// offer the diff peek (▸ fark — the old content is read main-side), and the operator may lift the whole
// WO to full-auto from here ("Bu iş emri için hep otomatik") — which also answers the current ask.
// WO-0077: a parsed AskUserQuestion ask renders the QUESTION instead — see AskQuestionCard below.
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
  onAnswer,
}: {
  tool: string;
  input: Record<string, unknown>;
  reason?: string;
  /** In the architect plan flow a permission reads as "the architect wants to do X", not an alarm. */
  planContext?: boolean;
  onAllow: () => void;
  onDeny: () => void;
  /** WO-0031c: "Bu iş emri için hep otomatik" — persists full_auto AND allows this ask. Absent = the
   * surface hides it (already full_auto: the ask wouldn't exist). */
  onAlwaysAuto?: () => void;
  alwaysAutoBusy?: boolean;
  /** WO-0031c: the diff peek loader for write tools — returns capped diff structure (or null). */
  diffPeek?: (filePath: string, newContent: string) => Promise<{ lines: Array<{ op: 'add' | 'del' | 'ctx'; text: string }>; truncated: number } | null>;
  /** WO-0077: the structured ask's answer path. Absent = the card never parses and always renders
   * the binary form (a surface without a fold caller — the roadmap draft asks — stays binary). */
  onAnswer?: (question: AskQuestion, answer: AskAnswer) => void;
}) {
  const ask = onAnswer !== undefined ? parseAskRequest(tool, input) : undefined;
  if (ask !== undefined && onAnswer !== undefined) {
    return <AskQuestionCard ask={ask} reason={reason} planContext={planContext} onAnswer={onAnswer} />;
  }
  return (
    <BinaryAskCard
      tool={tool}
      input={input}
      reason={reason}
      planContext={planContext}
      onAllow={onAllow}
      onDeny={onDeny}
      onAlwaysAuto={onAlwaysAuto}
      alwaysAutoBusy={alwaysAutoBusy}
      diffPeek={diffPeek}
    />
  );
}

// The structured mode (WO-0077): the question renders AS THE QUESTION — header chip, question head,
// radio (single-select) / checkbox (multiSelect) option rows with dim descriptions, the "önerilen"
// badge on the option whose label carries the "(Recommended)" suffix (a label-suffix convention,
// parsed off for DISPLAY only — the label sent keeps it verbatim, WO-0076 a1), and a Diğer row
// whose free text IS the answer while non-empty (exclusive — v1 mixes nothing, WO-0077 contract 5).
// Cevapla exists only while an answer does (ADR-0001: an action whose evidence is unmet is absent;
// the ask card is the guarded form already — the order's explicit carve-out). Boş geç sends the
// bare allow (the dismissed arm), Reddet the deny (declined). The question/options text is MODEL
// DATA through props (ADR-0007's border) — only the card's fixed chrome is bundled copy.
function AskQuestionCard({
  ask,
  reason,
  planContext,
  onAnswer,
}: {
  ask: AskQuestion;
  reason?: string;
  planContext?: boolean;
  onAnswer: (question: AskQuestion, answer: AskAnswer) => void;
}) {
  const { UI } = useLabels();
  const [picked, setPicked] = useState<string[]>([]);
  const [otherText, setOtherText] = useState('');
  // WO-0077 review (major 1): radio groups are DOCUMENT-wide by name, and parallel ask cards are a
  // supported state (WorkOrderDetail maps every pending ask to a card). A shared name let card B's
  // picks deselect card A's DOM check while React's state diverged — each card owns its group.
  const groupId = useId();
  const other = otherText.trim();
  const answered: AskAnswer | undefined =
    other !== ''
      ? { kind: 'other', text: other }
      : picked.length > 0
        ? { kind: 'selection', labels: picked }
        : undefined;
  const pick = (label: string): void => {
    setOtherText(''); // exclusive: a picked option retires the free text
    setPicked((cur) =>
      ask.multiSelect ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label],
    );
  };
  return (
    <div className="mb-2 flex items-stretch overflow-hidden rounded-md border border-signal/40 bg-surface shadow-sm">
      <div className="lamp lamp-signal-breathe" />
      <div className="min-w-0 w-full px-3.5 py-3">
        <p className="readout flex flex-wrap items-center gap-1.5 text-signal">
          <FilePen className="h-3.5 w-3.5" aria-hidden="true" />
          {planContext ? UI.architectRequest : UI.permissionRequested}
        </p>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="rounded border border-hairline px-1.5 py-px font-mono text-[10px] text-inkdim">{ask.header}</span>
          <p className="text-sm text-ink">{ask.question}</p>
        </div>
        <div className="mt-1.5 flex flex-col">
          {ask.options.map((o, i) => (
            <label key={`${i}-${o.label}`} className="irow flex items-start gap-2 rounded-md px-1.5 py-1">
              <input
                type={ask.multiSelect ? 'checkbox' : 'radio'}
                name={groupId}
                checked={picked.includes(o.label)}
                onChange={() => pick(o.label)}
                className="mt-1 accent-signal"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink">
                  {askOptionDisplayLabel(o.label)}
                  {askOptionIsRecommended(o.label) ? (
                    <span className="rounded border border-signal/50 px-1.5 py-px text-[10px] text-signal">{UI.askRecommended}</span>
                  ) : null}
                </span>
                <span className="block text-[11.5px] text-inkdim">{o.description}</span>
              </span>
            </label>
          ))}
          <label className="irow flex items-center gap-2 rounded-md px-1.5 py-1">
            <span className="shrink-0 text-[13px] text-ink">{UI.askOther}</span>
            <input
              type="text"
              value={otherText}
              onChange={(e) => {
                setPicked([]); // exclusive: free text retires the selections
                setOtherText(e.target.value);
              }}
              placeholder={UI.askOtherPlaceholder}
              aria-label={UI.askOther}
              className="min-w-0 flex-1 rounded-md border border-hairline bg-bg px-2 py-1 text-[13px] text-ink placeholder:text-inkdim focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
            />
          </label>
        </div>
        {reason ? <p className="mt-1 text-xs text-inkdim">{reason}</p> : null}
        <div className="mt-2.5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onAnswer(ask, { kind: 'dismissed' })}>{UI.askSkip}</Button>
          <Button variant="ghost" size="sm" onClick={() => onAnswer(ask, { kind: 'declined', message: 'the operator declined to answer this question' })}>{UI.deny}</Button>
          {answered ? (
            <Button variant="primary" size="sm" onClick={() => onAnswer(ask, answered)}>{UI.askAnswer}</Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// The binary form — the pre-WO-0077 card, byte-for-byte. An unparsed ask (any tool, or a malformed
// payload) renders HERE: fail-open, the risky-ask path untouched (the WO-0077 gates).
function BinaryAskCard({
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
  planContext?: boolean;
  onAllow: () => void;
  onDeny: () => void;
  onAlwaysAuto?: () => void;
  alwaysAutoBusy?: boolean;
  diffPeek?: (filePath: string, newContent: string) => Promise<{ lines: Array<{ op: 'add' | 'del' | 'ctx'; text: string }>; truncated: number } | null>;
}) {
  const { permissionPrompt, UI } = useLabels();
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
