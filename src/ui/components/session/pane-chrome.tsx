// pane-chrome — the shared instrument chrome of the session panes (WO-0031b, slimmed in WO-0031c →
// WO-0038: the SADE phase line died with the dual view — the header band's lamp spine carries the
// turn). One home for the lamp semantics (signal=needs you, info=running, proceed=done/ready,
// error=failed). Cost/duration/status live in the strip; the panes are instruments, not chrome.
// WO-0044: also the home of the activity-line machine and the döküm chip — ONE grammar for all
// three live surfaces (SessionPane · StepPane · ReviewPane); the step/review panes had neither.
import { useState, useRef, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, X } from 'lucide-react';
import { openAgentTasks, staleMinutes, STALE_AFTER_MIN, type LiveSessionState } from '../../../core/runner';
import type { SteerNote, TranscriptLine } from '../../../core/types';
import { Input, cn } from '../../kit';
import { useLabels } from '../../data/locale';
import { GUTTER_AGENT } from '../../data/labels';

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
//     just the role name (no noise).
//     WO-0046: the staleness line — after STALE_AFTER_MIN with no liveness proof (an entry or a
//     fresh context reading; probe c1 showed long thinking streams NO entries while healthy), the
//     line carries the REASON, superseding both the Düşünüyor fallback and an active tool verb (a
//     verb is a motion claim the silence can no longer verify). `stale` tells the pane to drop the
//     live-dots — the reason line is not motion. Gated on the FOLD's 'running', never the handle's:
//     an ask held parks the fold at stopped_asking and the asking verb names why it waits — a
//     staleness accusation there would blame the operator. The plan-closing moment (plan_ready +
//     running) keeps precedence: it is the wind-down, not a wait.
//     WO-0055: RUNNING AGENTS sit between the silence and the tool verb — at the moment a
//     subagent starts, the newest unmatched tool_use IS the delegation call ("Devrediyor",
//     strictly less information than a count), and while agents run an unrelated parent tool
//     call would otherwise overwrite the agent line. Backgrounded shell tasks produce no agent
//     rows (the adapter's discriminator), so they can never inflate the count. ---
export function usePaneActivity(state: LiveSessionState, running: boolean, now?: number): { show: boolean; line: string; stale: boolean } {
  const { LIVE_STATUS_LABELS, UI, toolVerb } = useLabels();
  const staleMins = running && state.status === 'running' && now !== undefined ? staleMinutes(state, now) : undefined;
  let line: string;
  let stale = false;
  if (state.status === 'plan_ready' && running) {
    line = UI.planClosing;
  } else if (staleMins !== undefined && staleMins >= STALE_AFTER_MIN) {
    stale = true;
    line = UI.staleLine(staleMins);
  } else if (running) {
    const agents = openAgentTasks(state.entries);
    if (agents.length > 0) {
      line = UI.agentRunningLine(agents.length);
    } else {
      const matched = new Set(state.entries.flatMap((e) => (e.speaker === 'tool_result' && e.callId ? [e.callId] : [])));
      const pending = [...state.entries]
        .reverse()
        .find((e): e is Extract<TranscriptLine, { speaker: 'tool_use' }> => e.speaker === 'tool_use' && e.callId !== undefined && !matched.has(e.callId));
      line = pending ? toolVerb(pending.tool) : UI.actThinking;
    }
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
  return { show: running || state.status !== 'idle' || state.entries.length > 0, line, stale };
}

// --- WO-0055 rev 2: the live AGENT STRIP — one row per RUNNING agent task, visible with the
//     döküm chip CLOSED (the count line said how many; this says WHO and HOW LONG — the
//     operator's rev-2 ruling "her koşan ajan için bir satır: görev + süre"). Elapsed derives
//     from the task row's own `at` (the only clock that survives a restart). Absent when no
//     agent runs (ADR-0001). Consumed by all four panes beside PaneWarnline. ---
export function PaneAgentStrip({ state, now }: { state: LiveSessionState; now?: number }) {
  const { UI } = useLabels();
  const agents = openAgentTasks(state.entries);
  if (agents.length === 0) return null;
  return (
    <div data-agent-strip="" className="mb-1 flex flex-col gap-0.5">
      {agents.map((a) => {
        const startedMs = a.at !== undefined ? Date.parse(a.at) : NaN;
        const elapsed = !Number.isNaN(startedMs) && now !== undefined ? UI.formatDuration(Math.max(0, now - startedMs)) : undefined;
        return (
          <div key={a.taskId} className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.04em] text-inkdim">
            <span className="shrink-0 text-remote" aria-hidden="true">{GUTTER_AGENT}</span>
            <span className="min-w-0 truncate normal-case text-ink">{a.description ?? UI.agentTaskLabel}</span>
            {elapsed !== undefined ? <span className="ml-auto shrink-0 tabular-nums">{elapsed}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

// --- WO-0046: the shared costline. Cost in the card's own vocabulary (`formatCost`: $ · in→out —
//     the live token parity the order asks), the live elapsed, and the context readout beside
//     them (operator ruling 2026-08-26: text, the costline's mono/sönük language, no motion).
//     The readout renders only while the stream is open and only once the drive REPORTED one —
//     absent, never zero. One component for the three surfaces (the per-pane string builds were
//     verbatim copies). ---
export function PaneCostline({ state, running, liveStart, now }: {
  state: LiveSessionState;
  running: boolean;
  liveStart?: number;
  now?: number;
}) {
  const { formatCost, UI } = useLabels();
  const costPart = [
    state.cost.usd > 0 ? formatCost(state.cost) : undefined,
    running && liveStart && now ? UI.formatDuration(Math.max(0, now - liveStart)) : undefined,
  ]
    .filter((x): x is string => x !== undefined)
    .join(' · ');
  const contextPart =
    state.context && running ? UI.contextReadout(state.context.percentage, state.context.usedTokens, state.context.maxTokens) : undefined;
  return (
    <>
      {contextPart ? (
        <span data-context-readout={contextPart} className="shrink-0 font-mono text-[10.5px] text-inkdim">
          {contextPart}
        </span>
      ) : null}
      {costPart ? <span className="shrink-0 font-mono text-[10.5px] text-inkdim">{costPart}</span> : null}
    </>
  );
}

// --- WO-0053: the limit warn line. The provider's OWN warning signal (`allowed_warning`, the
//     fold's `limitWindows.status === 'warning'`) — never a locally invented threshold (karar 3);
//     no signal or an unavailable windows surface renders NOTHING. WHILE A DRIVE RUNS only
//     (review finding 6 — a warning folded mid-leg must not linger on the pane after the leg
//     ends; frame 02 says "while a drive runs"). The costline's voice (mono, dim, the
//     utilization figure in signal) with a leading triangle — text, never a fill bar
//     (ADR-0012). `blocked` never renders here: the drive dies and the LimitCard takes over. ---
export function PaneWarnline({ state, running }: { state: LiveSessionState; running: boolean }) {
  const { UI } = useLabels();
  if (!running || state.limitWindows?.status !== 'warning') return null;
  const windows = state.limitWindows.windows;
  // The line speaks the FULLEST window the provider warned over (the merged set may hold
  // several; the highest utilization is the honest subject of the warning).
  const subject = windows.slice().sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1))[0];
  if (!subject) return null;
  return (
    <p data-limit-warn="" className="flex items-center gap-1.5 font-mono text-[10.5px] text-inkdim">
      <AlertTriangle className="h-3 w-3 shrink-0 text-signal" aria-hidden="true" />
      {UI.limitWarnLine(
        UI.limitWindowLabel(subject.window),
        subject.utilization,
        subject.resetAt !== null ? UI.limitClock(subject.resetAt) : null,
      )}
    </p>
  );
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

// --- WO-0045: the steer composer + pending list — ONE grammar for the three live surfaces, right
//     under the header row. The composer is a TRANSIENT surface (ADR-0001): present only while the
//     drive is live (running or stopped_asking — a note queued now applies after the ask resolves);
//     the pending list stays while notes remain, STOPPED included (AC4: Durdur persists them
//     visibly). ⏎ sends (the objection-card idiom); sending NEVER interrupts (steer ⊥ stop). ---
export function PaneSteerBar({
  live,
  pendingNotes,
  onSend,
  onRetract,
}: {
  live: boolean;
  pendingNotes: SteerNote[];
  /** Resolves false when the transport refused (boot window, post-final-result drain, a
   *  capability-less CLI) — the bar KEEPS the draft and states why; input never vanishes silently. */
  onSend: (note: string) => Promise<boolean> | boolean;
  onRetract: (noteId: string) => void;
}) {
  const { UI } = useLabels();
  const [draft, setDraft] = useState('');
  const [refused, setRefused] = useState(false);
  if (!live && pendingNotes.length === 0) return null;
  const send = (): void => {
    const t = draft.trim();
    if (!t) return;
    setRefused(false);
    void Promise.resolve(onSend(t)).then((ok) => {
      if (ok) setDraft('');
      else setRefused(true); // the note did NOT queue — keep the operator's words in hand
    });
  };
  return (
    <div className="mt-2 flex flex-col gap-1" data-steer-bar="">
      {live ? (
        <Input
          aria-label={UI.steerPlaceholder}
          data-steer-input=""
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (refused) setRefused(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={UI.steerPlaceholder}
          className="h-7 font-sans text-[12.5px]"
        />
      ) : null}
      {refused ? <p className="text-xs text-error">{UI.steerRefused}</p> : null}
      {pendingNotes.length > 0 ? (
        <ul data-steer-pending={pendingNotes.length} aria-label={UI.steerPendingTitle} className="flex flex-col gap-1">
          {pendingNotes.map((n) => (
            // Best-effort by SDK contract (probe s5/s5b): a retract that arrives too late leaves
            // the row — delivery removes it instead. The row is the honest queue, not a promise.
            <li key={n.id} className="flex items-center gap-2 rounded border border-hairline px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{n.text}</span>
              <button
                type="button"
                data-steer-retract={n.id}
                onClick={() => onRetract(n.id)}
                aria-label={UI.steerRetract}
                className="ibtn h-5 w-5 shrink-0"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
