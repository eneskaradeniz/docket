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
//                       paragraphs again. Collapsible — and NOTHING opens itself (operator ruling
//                       2026-08-23, reversing WO-0037's live-edge auto-open: "sadece çalışan şey
//                       gözüksün; çıktıyı kullanıcı isterse tıklasın"): history closed, the live
//                       edge closed, output strictly on click. The right-edge dot slot carries the
//                       quiet states — blue breathing while the tool runs, a steady red dot on a
//                       FAILED-and-still-closed block (a silent failure stays visible, never loud).
//                       Expanding scrolls the block into view (block:'nearest' — you see what you
//                       opened); collapsing never scrolls.
//   system / note     — centered mono caps, the session's punctuation.
//   code              — the ONE other volumetric element (CodeBlock: borderless recess).
//
// Live behavior (live + compact only): bottom-pin (a user within 48px of the bottom rides along;
// one who scrolled up is never dragged back — a ▾ chip restores the bottom), a ▾ chip that retires
// the moment content shrinks back into full view (a collapsed tool block — no scroll event fires
// for that, a ResizeObserver on the content column watches the geometry), and a 400ms proceed
// wash on a TRUE append only (the appended tail GROUP; a resume seed 0→N stays calm). `archived`
// is static: no pin, no pulse, tool blocks collapsed. The list is capped at the last 800
// entries (head line says what fell off); windowing is a recorded debt.
//
// Run-verified, not unit-tested (ADR-0006: React components are verified by running them).

/** The turn's role bar — the .rlamp grammar, vertical (signal/info/proceed per role). */
const ROLE_BAR: Record<SessionRole, string> = {
  architect: 'before:bg-signal',
  implementer: 'before:bg-info',
  verifier: 'before:bg-proceed',
};

/** Tool FAMILY — the label column's hue answers "what kind of thing" (operator 2026-08-24:
 *  "renkler belli olmuyor"). exec = a command ran · write = the repo changed · remote = it left
 *  the machine; reads/search/unknown ride the quiet inkdim track (the noise floor — coloring the
 *  majority rows would BE the rainbow). Kind, state and role stay three disjoint hue sets. */
const TOOL_FAMILY: Record<string, string> = {
  Bash: 'text-exec',
  Write: 'text-write',
  Edit: 'text-write',
  MultiEdit: 'text-write',
  NotebookEdit: 'text-write',
  NotebookEditNew: 'text-write',
  Read: 'text-inkdim',
  Grep: 'text-inkdim',
  Glob: 'text-inkdim',
  WebFetch: 'text-remote',
  WebSearch: 'text-remote',
  Task: 'text-remote',
  ExitPlanMode: 'text-inkdim',
};

/** One rendered group — the grouping IS the design: consecutive assistant entries share a turn,
 *  and a tool_result merges into the call it answers (the pair is one instrument block). */
type ChatGroup =
  | { kind: 'turn'; texts: string[] }
  | { kind: 'tool'; tool: string; detail?: string; callId?: string; result?: { summary: string; isError: boolean } }
  | { kind: 'result'; summary: string; isError: boolean; orphan?: boolean }
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
        'relative pl-6 before:absolute before:bottom-0.5 before:left-1.5 before:top-0.5 before:w-[3px] before:rounded-full before:content-[""]',
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
  pulse,
  className,
}: {
  tool: string;
  detail?: string;
  result?: { summary: string; isError: boolean };
  pulse: boolean;
  className?: string;
}) {
  const { TOOL_LABELS, toolLabel, UI } = useLabels();
  // An unknown tool's NAME rides the detail slot as DATA (mono, honest) — "Araç çağrısı" alone
  // answered nothing (operator, 2026-08-23: "ne araç çağrısı belli değil bu nedir?").
  const knownTool = TOOL_LABELS[tool] !== undefined;
  // 2026-08-23 ruling: purely user-driven — no autoOpen, no touched/userOpen duality. The output
  // opens on click and ONLY on click, identically in live/compact/archived.
  const [open, setOpen] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    // You see what you opened (operator, 2026-08-23): 'nearest' = zero motion when already in
    // view, the minimal shift otherwise; a block taller than the column top-aligns so reading
    // starts at the command. Collapsing never scrolls. Instant by construction (no smooth JS).
    if (next) requestAnimationFrame(() => blockRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  const header = (
    <>
      {/* 2026-08-23 (WO-0039/C): grid anatomy [▸][label 7rem][—][detail][›] — the FIXED label
          column puts the dash on ONE x for every row ("Komut çalıştır" vs "Dosya oku" used to
          start it at different offsets), and the closed row is a SINGLE clamped line. Open: the
          full command still wraps in the detail cell (the long form, 2026-08-22 ruling). */}
      <span className="grid min-w-0 flex-1 grid-cols-[12px_7rem_12px_1fr] items-center gap-1.5">
        <span className="shrink-0 text-[10px] text-inkdim" aria-hidden="true">{GUTTER_TOOL}</span>
        <span className={cn('min-w-0 truncate font-medium', TOOL_FAMILY[tool] ?? 'text-inkdim')}>{toolLabel(tool)}</span>
        <span className="shrink-0 text-inkdim" aria-hidden="true">{detail || !knownTool ? '—' : ''}</span>
        <span className={cn('min-w-0 text-ink', open ? 'whitespace-normal break-words' : 'truncate')}>
          {!knownTool ? tool + (detail ? ` · ${detail}` : '') : detail}
        </span>
      </span>
      <span className="shrink-0 text-inkdim" aria-hidden="true">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </span>
      {/* Only the RUNNING mark stays a dot; a FAILURE tints the whole block below (operator,
          2026-08-23: the 5px red dot was invisible — "o sohbet balonu kırmızı olabilir"). */}
      {!result ? <span className="h-[5px] w-[5px] shrink-0 rounded-full lamp-run" aria-hidden="true" /> : null}
    </>
  );

  return (
    <div
      ref={blockRef}
      data-chat-entry="tool_use"
      {...(pulse ? { 'data-live': '1' } : {})}
      className={cn('rounded-md', result?.isError ? 'bg-error/15 ring-1 ring-inset ring-error/40' : 'bg-raised/40', className)}
    >
      <button
        type="button"
        className="irow flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left font-mono text-[11px] leading-relaxed"
        aria-expanded={open}
        aria-label={UI.toolOutputAria}
        onClick={toggle}
      >
        {header}
      </button>
      {open && !result ? (
        <div className="px-2.5 pb-2 font-mono text-[11px] leading-relaxed text-inkdim">{UI.toolNoResult}</div>
      ) : null}
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

  // The scroll handler covers POSITION changes; a ResizeObserver on the CONTENT column covers the
  // GEOMETRY changes no scroll event ever reports (operator repro 2026-08-25): collapsing a tool
  // block above the reading position shrinks scrollHeight without touching scrollTop — the browser
  // clamps nothing, fires nothing, and the ▾ chip floated over a column already fully visible.
  // Only the shrink-to-fit transition needs a case: growth rides the pin effect while pinned, and
  // an unpinned reader already has the chip up.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || !scrollable) return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < PIN_MARGIN) {
        pinnedRef.current = true;
        setShowJump(false);
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [scrollable]);

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
          out.push({ kind: 'tool', tool: line.tool, detail: line.detail, callId: line.callId });
          break;
        case 'tool_result': {
          // The result merges into the call it answers — ONE instrument block per pair, paired by
          // callId (2026-08-23 §5): adjacency pairing broke on parallel calls (the agent fires
          // c1..c4, results stream back interleaved) and produced orphan headerless result walls.
          // Fallback for pre-callId persisted rows: FIFO — the OLDEST call still awaiting a
          // result takes it (the agent's completion order tracks call order closely enough).
          const byId = line.callId !== undefined
            ? [...out].reverse().find((g) => g.kind === 'tool' && g.callId === line.callId && !g.result)
            : undefined;
          const fifo = byId ?? out.find((g) => g.kind === 'tool' && !g.result);
          const target = byId ?? fifo;
          if (target && target.kind === 'tool') {
            target.result = { summary: line.summary, isError: line.isError };
          } else if (/^User has (approved|rejected) your plan/.test(line.summary)) {
            // The SDK's plan-mode CLOSURE pseudo-result — a tool_result whose callId belongs to
            // NO tool call (verified in the wild, 2026-08-23): the harness ACCEPTED the agent's
            // plan submission ("User has approved your plan…"). It is NOT the operator's Docket
            // approval (that records its own plan_approved event) — the line speaks PROPOSAL
            // language ("Mimar planını sundu"), the session's punctuation, never an orphan row.
            out.push({
              kind: 'sys',
              text: line.summary.startsWith('User has approved') ? UI.planApprovedNote : UI.planRejectedNote,
            });
          } else if (/^Plan submitted\./.test(line.summary)) {
            // WO-0039 stabilization (2026-08-23): the PLAN GATE's denial echo — Docket's own
            // "Plan submitted. STOP…" message comes back as the ExitPlanMode call's tool_result,
            // and that call renders as plan_ready (never a tool_use row), so the result is an
            // orphan. It is the submission's punctuation, the approved-classifier's twin: the
            // session says "Mimar planını sundu", not "→ sonuç — eşleşen çağrı yok".
            out.push({ kind: 'sys', text: UI.planApprovedNote });
          } else {
            // A true orphan (restart mid-tool): ONE clamped honest row, never a headerless wall.
            out.push({ kind: 'result', summary: line.summary, isError: line.isError, orphan: true });
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
      ? 'min-h-[220px] max-h-[340px]' // 2026-08-23 operator tune: the LEDGER's height — one expansion height console-wide
      : variant === 'compact'
        ? 'min-h-[120px] max-h-56'
        : 'max-h-[340px]';

  return (
    // 2026-08-23 (WO-0039/C): min-h-0 flex-1 — WITHOUT it this root broke the pane's cap chain:
    // the column grew past PaneShell's max-height and overflow-hidden CLIPPED the lower half
    // (probe: 994px content in a 478px pane). With it the internal scroll engages and the pane
    // header stays pinned by construction.
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        data-chat=""
        role="log"
        aria-label={UI.chatAria}
        ref={scrollRef}
        onScroll={scrollable ? onScroll : undefined}
        className={cn(
          'chat overflow-y-auto px-3 py-2.5',
          // The reading variants carry their own terminal-like box; ARCHIVED is the session card's
          // terminal WELL — frameless sides (the card is the frame), a top hairline parting it from
          // the header/summary, tool blocks collapsed (terminal-on-demand, operator 2026-08-22).
          variant === 'archived'
            ? 'border-t border-hairline bg-bg'
            : 'rounded-md border border-hairline bg-bg',
          heights,
        )}
      >
        {/* The content column — one wrapper so its OWN size is observable (the ResizeObserver above
            rides it; the scroller's box is capped by max-height and tracks content only while
            under it). The CSS measure (index.css `.chat-col > *`) addresses its children. */}
        <div ref={contentRef} className="chat-col flex flex-col">
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
                return <ToolPair key={i} className={top} tool={g.tool} detail={g.detail} result={g.result} pulse={pulse} />;
              case 'result':
                return (
                  <ResultRow
                    key={i}
                    className={top}
                    summary={g.orphan ? UI.orphanResult : g.summary}
                    isError={g.isError}
                    pulse={pulse}
                  />
                );
              case 'sys':
                return <SysRow key={i} className={top} text={g.text} pulse={pulse} />;
            }
          })}
        </div>
      </div>
      {showJump ? (
        // 2026-08-23 redesign: a 28px circular icon button — solid raised ground + hairline so it
        // survives over text (the old transparent text chip vanished over lines); the word pair
        // lives in the label/aria, not on the face. Shows only when the COLUMN's own scroll is
        // off-bottom (live/compact) — the SADE activity line carries the tail elsewhere.
        <button
          type="button"
          data-chat-jump=""
          aria-label={UI.chatJumpLatest}
          title={UI.chatJumpLatest}
          onClick={jump}
          className="ibtn absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-full border border-hairline bg-raised shadow-md"
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
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
