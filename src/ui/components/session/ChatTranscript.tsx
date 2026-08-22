import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TranscriptLine } from '../../../core/runner';
import type { SessionRole } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { GUTTER_RESULT, GUTTER_TOOL } from '../../data/labels';
import { cn } from '../../kit';
import { MarkdownBody } from '../detail/MarkdownBody';

// ChatTranscript — the session transcript as a RAILLED READING COLUMN (WO-0037; operator picked
// the "Ray" direction on the 2026-08-22 mockup tour, after rejecting boxed bubbles as too heavy
// for terminal-style reading). The grammar gives the terminal back its DNA while keeping what it
// never had (markdown, colored code, turn grouping):
//
//   ONE outer box     — the column is a single terminal-like frame; ZERO boxes inside it.
//   ONE text edge     — every content line starts at x=24px; structure lives in a 24px left gutter.
//   turn = the atom   — consecutive assistant entries merge into one section carrying a 3px role
//                       bar (the vertical .rlamp: architect signal / implementer info / verifier
//                       proceed) down its full length — a document turn never loses its owner.
//   tool call = BLOCK — a full-width recessed volume (the agent-console reading the operator asked
//                       for, 2026-08-22): header line = the command (bright, single-line clamp),
//                       body = its output, dim mono — a command and its echo can never blur into
//                       paragraphs again. Collapsible: history sits CLOSED (one line — density),
//                       the LIVE-EDGE block opens itself; a run without a result yet carries a
//                       breathing dot. The ARCHIVED ledger never collapses — a record hides nothing.
//   system / note     — centered mono caps, the session's punctuation.
//   code              — the ONE other volumetric element (CodeBlock: borderless recess).
//
// Live behavior (live + compact only): bottom-pin (a user within 48px of the bottom rides along;
// one who scrolled up is never dragged back — a ▾ chip restores the bottom), and a 400ms proceed
// wash on a TRUE append only (the appended tail GROUP; a resume seed 0→N stays calm). `archived`
// is static: no pin, no pulse — the Kayıt ledger expansion. The list is capped at the last 800
// entries (head line says what fell off); windowing is a recorded debt.
//
// Run-verified, not unit-tested (ADR-0006: React components are verified by running them).

/** The turn's role bar — the .rlamp grammar, vertical (signal/info/proceed per role). */
const ROLE_BAR: Record<SessionRole, string> = {
  architect: 'before:bg-signal',
  implementer: 'before:bg-info',
  verifier: 'before:bg-proceed',
};

/** One rendered group — the grouping IS the design: consecutive assistant entries share a turn,
 *  and a tool_result merges into the call it answers (the pair is one instrument block). */
type ChatGroup =
  | { kind: 'turn'; texts: string[] }
  | { kind: 'tool'; tool: string; detail?: string; result?: { summary: string; isError: boolean } }
  | { kind: 'result'; summary: string; isError: boolean }
  | { kind: 'sys'; text: string };

/** Top margin per group kind — the spacing rhythm that makes turns read as turns (Gestalt
 *  proximity): turn 10px · tool block 8px · orphan result 2px · sys 8px. First group: none. */
const GROUP_TOP: Record<ChatGroup['kind'], string> = {
  turn: 'mt-2.5',
  tool: 'mt-2',
  result: 'mt-0.5',
  sys: 'mt-2',
};

const ChatTurn = memo(function ChatTurn({
  texts,
  role,
  pulse,
  className,
}: {
  texts: string[];
  role: SessionRole;
  /** The wash rides the appended tail TEXT, not the whole turn — a long document turn must not flash. */
  pulse: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'relative max-w-[60ch] pl-6 before:absolute before:bottom-0.5 before:left-1.5 before:top-0.5 before:w-[3px] before:rounded-full before:content-[""]',
        ROLE_BAR[role],
        className,
      )}
    >
      {texts.map((text, i) => (
        <div key={i} data-chat-entry="assistant" {...(pulse && i === texts.length - 1 ? { 'data-live': '1' } : {})} className={i > 0 ? 'mt-1' : undefined}>
          <MarkdownBody content={text} stream />
        </div>
      ))}
    </section>
  );
});

const ToolPair = memo(function ToolPair({
  tool,
  detail,
  result,
  autoOpen,
  pulse,
  className,
}: {
  tool: string;
  detail?: string;
  result?: { summary: string; isError: boolean };
  /** The live-edge block opens itself until the operator decides otherwise (touched wins after). */
  autoOpen: boolean;
  pulse: boolean;
  className?: string;
}) {
  const { toolLabel, UI } = useLabels();
  const [touched, setTouched] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const open = touched ? userOpen : autoOpen;

  const header = (
    <>
      <span className="shrink-0 text-[10px] text-info" aria-hidden="true">{GUTTER_TOOL}</span>
      {/* Closed: one clamped line + ellipsis (density). Open: the FULL command wraps — the operator
          asked for the long form on expand (2026-08-22), not the same ellipsis again. */}
      <span className={cn('min-w-0 flex-1', open ? 'whitespace-normal break-words' : 'truncate')}>
        <span className="font-medium text-info">{toolLabel(tool)}</span>
        {/* Operator review (2026-08-22): the COMMAND is the action — bright ink; its OUTPUT echoes
            one step dimmer beneath. Same block, different weight. */}
        {detail ? <span className="text-ink"> — {detail}</span> : null}
      </span>
      <span className="shrink-0 text-inkdim" aria-hidden="true">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </span>
      {!result ? (
        <span className="h-[5px] w-[5px] shrink-0 rounded-full lamp-run" aria-hidden="true" />
      ) : null}
    </>
  );

  return (
    <div
      data-chat-entry="tool_use"
      {...(pulse ? { 'data-live': '1' } : {})}
      className={cn('rounded-md bg-raised/40', className)}
    >
      <button
        type="button"
        className="irow flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left font-mono text-[11px] leading-relaxed"
        aria-expanded={open}
        aria-label={UI.toolOutputAria}
        onClick={() => {
          setTouched(true);
          setUserOpen(!open);
        }}
      >
        {header}
      </button>
      {open && result ? (
        <div
          data-chat-entry="tool_result"
          {...(pulse ? { 'data-live': '1' } : {})}
          className={cn(
            'whitespace-pre-wrap break-words px-2.5 pb-2 font-mono text-[11px] leading-relaxed',
            result.isError ? 'text-error' : 'text-inkdim',
          )}
        >
          → {result.summary}
        </div>
      ) : null}
    </div>
  );
});

const ResultRow = memo(function ResultRow({
  summary,
  isError,
  pulse,
  className,
}: {
  summary: string;
  isError: boolean;
  pulse: boolean;
  className?: string;
}) {
  return (
    <div
      data-chat-entry="tool_result"
      {...(pulse ? { 'data-live': '1' } : {})}
      className={cn('grid grid-cols-[16px_1fr] gap-2 font-mono text-[11px] leading-relaxed', className)}
    >
      <span className="text-[10px] leading-[1.65] text-inkdim" aria-hidden="true">{GUTTER_RESULT}</span>
      <div className={cn('min-w-0', isError ? 'text-error' : 'text-inkdim')}>→ {summary}</div>
    </div>
  );
});

const SysRow = memo(function SysRow({ text, pulse, className }: { text: string; pulse: boolean; className?: string }) {
  return (
    <div
      data-chat-entry="sys"
      {...(pulse ? { 'data-live': '1' } : {})}
      className={cn('text-center font-mono text-[10px] font-medium uppercase leading-[1.4] tracking-[0.08em] text-inkdim', className)}
    >
      {text}
    </div>
  );
});

/** The last 800 entries render; older ones fall off with a head line (windowing is a recorded debt). */
const HEAD_CAP = 800;
/** Within this distance of the bottom the user counts as pinned and rides along with appends. */
const PIN_MARGIN = 48;

function ChatLog({
  entries,
  role,
  variant,
}: {
  entries: TranscriptLine[];
  role: SessionRole;
  variant: 'live' | 'compact' | 'archived';
}) {
  const { UI } = useLabels();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  // The PREVIOUS length lives in a ref that this render reads and the effect below writes — so
  // `appended`/`reseed` describe the transition that produced THIS render.
  const prevLenRef = useRef(entries.length);
  const appended = entries.length > prevLenRef.current;
  const reseed = entries.length < prevLenRef.current;
  useEffect(() => {
    prevLenRef.current = entries.length;
  }, [entries.length]);

  const scrollable = variant === 'live' || variant === 'compact';
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollable) return;
    // Instant, never smooth — reduced-motion safe by construction (.flow-scroll stays the only
    // smooth-scroll route). A reseed (fresh drive / role switch) always lands at the bottom; a
    // live append only while pinned.
    if (reseed || pinnedRef.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_MARGIN;
    pinnedRef.current = atBottom;
    setShowJump((was) => (was === !atBottom ? was : !atBottom));
  };

  const [showJump, setShowJump] = useState(false);

  const jump = (): void => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJump(false);
  };

  const head = Math.max(0, entries.length - HEAD_CAP);
  const visible = useMemo(() => (head > 0 ? entries.slice(head) : entries), [entries, head]);
  const groups = useMemo<ChatGroup[]>(() => {
    const out: ChatGroup[] = [];
    for (const line of visible) {
      switch (line.speaker) {
        case 'assistant': {
          const last = out[out.length - 1];
          if (last?.kind === 'turn') last.texts.push(line.text);
          else out.push({ kind: 'turn', texts: [line.text] });
          break;
        }
        case 'tool_use':
          out.push({ kind: 'tool', tool: line.tool, detail: line.detail });
          break;
        case 'tool_result': {
          // The result merges into the call it answers — one instrument block per pair. An orphan
          // result (no preceding call this window) keeps its own gutter row.
          const last = out[out.length - 1];
          if (last?.kind === 'tool' && !last.result) {
            last.result = { summary: line.summary, isError: line.isError };
          } else {
            out.push({ kind: 'result', summary: line.summary, isError: line.isError });
          }
          break;
        }
        case 'system':
        case 'note':
          out.push({
            kind: 'sys',
            text: line.speaker === 'note' ? UI.noteFor(line.kind, line.detail) : line.text,
          });
          break;
      }
    }
    return out;
    // UI rides the dep list: noteFor re-localizes a live column on a locale switch (TD-040's close).
  }, [visible, UI]);
  // The pulse rides the appended tail GROUP — only on the reading variants (live/compact), only
  // when the list already had content this mount (the resume seed 0→N stays calm); CSS owns the
  // animation and its reduced-motion kill.
  const pulseIndex = scrollable && appended && prevLenRef.current > 0 ? groups.length - 1 : -1;

  const heights =
    variant === 'live'
      ? 'min-h-[220px] max-h-[520px]'
      : variant === 'compact'
        ? 'min-h-[120px] max-h-56'
        : 'max-h-[340px]';

  return (
    <div className="relative flex flex-col">
      <div
        data-chat=""
        role="log"
        aria-label={UI.chatAria}
        ref={scrollRef}
        onScroll={scrollable ? onScroll : undefined}
        className={cn(
          'chat flex flex-col overflow-y-auto px-3 py-2.5',
          // The reading variants carry their own terminal-like box; ARCHIVED is the session card's
          // terminal WELL — frameless sides (the card is the frame), a top hairline parting it from
          // the header/summary, tool blocks collapsed (terminal-on-demand, operator 2026-08-22).
          variant === 'archived'
            ? 'border-t border-hairline bg-bg'
            : 'rounded-md border border-hairline bg-bg',
          heights,
        )}
      >
        {head > 0 ? (
          <div className="text-center font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-inkdim">
            {UI.chatOlderLines(head)}
          </div>
        ) : null}
        {groups.map((g, i) => {
          const pulse = i === pulseIndex;
          // The head line counts as a first child — the rhythm starts right after it.
          const top = i > 0 || head > 0 ? GROUP_TOP[g.kind] : undefined;
          switch (g.kind) {
            case 'turn':
              return <ChatTurn key={i} className={top} texts={g.texts} role={role} pulse={pulse} />;
            case 'tool':
              return (
                <ToolPair
                  key={i}
                  className={top}
                  tool={g.tool}
                  detail={g.detail}
                  result={g.result}
                  autoOpen={scrollable && i === groups.length - 1}
                  pulse={pulse}
                />
              );
            case 'result':
              return <ResultRow key={i} className={top} summary={g.summary} isError={g.isError} pulse={pulse} />;
            case 'sys':
              return <SysRow key={i} className={top} text={g.text} pulse={pulse} />;
          }
        })}
      </div>
      {showJump ? (
        <button
          type="button"
          data-chat-jump=""
          className="ichip absolute bottom-4 right-4 rounded px-1.5 py-px font-mono text-[10px] uppercase tracking-wider"
          onClick={jump}
        >
          {UI.chatJumpLatest}
        </button>
      ) : null}
    </div>
  );
}

export function ChatTranscript({
  entries,
  role,
  variant = 'live',
  /** Changes when the stream should reset (a fresh drive / a role-tab switch) — the panes feed the
   *  provider session id. A wholesale entries swap with no key change is also caught (length shrink). */
  resetKey,
}: {
  entries: TranscriptLine[];
  role: SessionRole;
  /** live = the reading column · compact = the step spine's inline form · archived = the static
   *  ledger expansion (never collapses). */
  variant?: 'live' | 'compact' | 'archived';
  resetKey?: string;
}) {
  // The key remounts the whole column on a stream reset — memo caches, the pin state and the
  // prev-length ref must not survive a replaced transcript.
  return <ChatLog key={resetKey ?? ''} entries={entries} role={role} variant={variant} />;
}
