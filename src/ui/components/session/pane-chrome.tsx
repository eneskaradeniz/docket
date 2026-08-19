// pane-chrome — the shared instrument chrome of the session panes (WO-0031b, slimmed in WO-0031c).
// Before this, statusColor()/phaseTone() were duplicated verbatim in the three panes — one home now:
// the lamp semantics (signal=needs you, info=running, proceed=done/ready, error=failed). The Faz B
// PaneHeader/CostReadout/ViewModeToggle are gone — cost/duration/status live in the strip, the view
// toggle is the global one in the strip, and the panes are instruments, not chrome.
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { SimplePhase } from '../../../core/runner';
import { cn } from '../../kit';
import { UI } from '../../data/labels';

// --- lamp semantics: one color per state, amber only for "seni bekliyor" ---
export type LampTone = 'idle' | 'signal' | 'run' | 'done' | 'error';

const PHASE_LAMP: Partial<Record<SimplePhase, LampTone>> = {
  ready: 'done',
  done: 'done',
  errored: 'error',
  asking_input: 'signal',
  asking_permission: 'signal',
  writing_decisions: 'run',
  running_command: 'run',
};

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

export function phaseDotClass(phase: SimplePhase): string {
  return lampClass(PHASE_LAMP[phase] ?? 'idle', phase === 'asking_permission');
}

// --- the SADE phase line: an instrument readout with the phase's lamp tone ---
export function PhaseLine({ phase, label }: { phase: SimplePhase; label: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', phaseDotClass(phase))} aria-hidden="true" />
      <p className="truncate text-[13px] text-inkdim">{label}</p>
    </div>
  );
}

// --- F7 (WO-0031f): the running-empty stream line — a session that started but wrote nothing yet
//     says so; a blank terminal answers nothing. Leaves with the first transcript entry. ---
export function StreamLine() {
  return (
    <p data-stream-line="" className="streamline">
      <span className="h-[5px] w-[5px] shrink-0 rounded-full lamp-run" aria-hidden="true" />
      {UI.streamOpened}
    </p>
  );
}

// --- the error row: calm, one line, iconed ---
export function PaneError({ message }: { message: string }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-error">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}

// --- the pane shell itself: one card, one instrument ---
export function PaneShell({ children, tone }: { children: ReactNode; tone: LampTone }) {
  return (
    <section className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface shadow-sm">
      <div className={cn('lamp', lampClass(tone))} />
      <div className="min-w-0 flex-1 flex-col p-3">{children}</div>
    </section>
  );
}
