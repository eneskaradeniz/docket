// pane-chrome — the shared instrument chrome of the session panes (WO-0031b, slimmed in WO-0031c →
// WO-0038: the SADE phase line died with the dual view — the header band's lamp spine carries the
// turn). One home for the lamp semantics (signal=needs you, info=running, proceed=done/ready,
// error=failed). Cost/duration/status live in the strip; the panes are instruments, not chrome.
// WO-0044: also the home of the activity-line machine and the döküm chip — ONE grammar for all
// three live surfaces (SessionPane · StepPane · ReviewPane); the step/review panes had neither.
import { useState, useRef, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { LiveSessionState } from '../../../core/runner';
import type { TranscriptLine } from '../../../core/types';
import { cn } from '../../kit';
import { useLabels } from '../../data/locale';

// --- lamp semantics: one color per state, amber only for "seni bekliyor" ---
export type LampTone = 'idle' | 'signal' | 'run' | 'done' | 'error';

export function lampClass(tone: LampTone, breathe = false): string {
  switch (tone) {
    case 'signal':
      return breathe ? 'lamp-signal-breathe' : 'lamp-signal';
    case 'run':
      return 'lamp-run';
    case 'done':
      return 'lamp-done';
    case 'error':
      return 'lamp-error';
    default:
      return 'lamp-idle';
  }
}

// --- F7 (WO-0031f) → WO-0044: the StreamLine component is DEAD — the empty-run window's honest
//     state is the header's activity line ("Düşünüyor···", the operator's 2026-08-23 two-then-one
//     ruling), reached by SessionPane then, and by StepPane/ReviewPane with the shared grammar. ---

// --- the error row: calm, one line, iconed ---
export function PaneError({ message }: { message: string }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-error">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}

// --- the activity-line machine (2026-08-23 canlı panel revizyonu §3, lifted here by WO-0044): the
//     line is a STATE, never content — running says the newest UNMATCHED tool's progressive verb
//     (callId-matched) or "Düşünüyor"; the fold's own state words freeze the rest (Seni bekliyor /
//     Bitti / Durduruldu / Hata). `show` says whether there is anything to say at all: a live or
//     booting drive, a stopped-asking moment, or an ended-but-recorded fold; a bare idle pane is
//     just the role name (no noise). ---
export function usePaneActivity(state: LiveSessionState, running: boolean): { show: boolean; line: string } {
  const { LIVE_STATUS_LABELS, UI, toolVerb } = useLabels();
  let line: string;
  if (state.status === 'plan_ready' && running) {
    line = UI.planClosing;
  } else if (running) {
    const matched = new Set(state.entries.flatMap((e) => (e.speaker === 'tool_result' && e.callId ? [e.callId] : [])));
    const pending = [...state.entries]
      .reverse()
      .find((e): e is Extract<TranscriptLine, { speaker: 'tool_use' }> => e.speaker === 'tool_use' && e.callId !== undefined && !matched.has(e.callId));
    line = pending ? toolVerb(pending.tool) : UI.actThinking;
  } else if (state.status === 'stopped_asking') {
    line = LIVE_STATUS_LABELS.stopped_asking;
  } else if (state.status === 'done') {
    line = LIVE_STATUS_LABELS.done;
  } else if (state.status === 'stopped') {
    line = LIVE_STATUS_LABELS.stopped; // an intentional Durdur, frozen
  } else if (state.status === 'error') {
    line = LIVE_STATUS_LABELS.error;
  } else {
    line = UI.actThinking;
  }
  return { show: running || state.status !== 'idle' || state.entries.length > 0, line };
}

// --- the döküm chip: the ONE show/hide of every live surface (the session card's aç/kapa grammar,
//     in verb form — WO-0039 rev-2). Rendering it is the pane's decision (only when a stream
//     exists); what it looks like and what it says lives here, once. ---
export function PaneLogChip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { UI } = useLabels();
  return (
    <button
      type="button"
      data-pane-log-toggle=""
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        'ichip flex h-6 shrink-0 items-center gap-1 rounded px-2 font-mono text-[10px] uppercase tracking-wider',
        open ? 'ichip-on' : '',
      )}
    >
      {open ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
      {open ? UI.transcriptClose : UI.transcriptOpen}
    </button>
  );
}

// --- the chip's open state + the scroll contract: opening brings the pane's HEADER row to reading
//     position (you see what you opened — the same ruling the session cards and doc rows took);
//     closing never scrolls. Default CLOSED: the pane stays calm, the stream is one click away
//     (operator, 2026-08-23 — now reaching every surface, WO-0044). ---
export function usePaneLog() {
  const [logOpen, setLogOpen] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  const toggleLog = (): void => {
    const next = !logOpen;
    setLogOpen(next);
    if (next) requestAnimationFrame(() => headRef.current?.scrollIntoView({ block: 'start' }));
  };
  return { logOpen, toggleLog, headRef };
}

// --- the pane shell itself: one card, one instrument ---
export function PaneShell({ children, tone }: { children: ReactNode; tone: LampTone }) {
  return (
    // 2026-08-23 (§4 → same-day operator tune): the pane is viewport-BOUNDED (an outer safety
    // cap only — the full-height fill felt cavernous) and the open transcript caps at the LEDGER's
    // height (see ChatLog's live variant) — one expansion height console-wide. The min-h-0 chain
    // keeps the header pinned while the column scrolls inside; the page stays THE scroller.
    <section
      id="live-pane"
      className="flex max-h-[calc(100dvh-140px)] items-stretch overflow-hidden rounded-md border border-hairline bg-surface shadow-sm"
    >
      <div className={cn('lamp', lampClass(tone))} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">{children}</div>
    </section>
  );
}
