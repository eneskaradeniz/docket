// pane-chrome — the shared instrument chrome of the session panes (WO-0031b, slimmed in WO-0031c →
// WO-0038: the SADE phase line died with the dual view — the header band's lamp spine carries the
// turn). One home for the lamp semantics (signal=needs you, info=running, proceed=done/ready,
// error=failed). Cost/duration/status live in the strip; the panes are instruments, not chrome.
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
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

// --- F7 (WO-0031f): the running-empty stream line — a session that started but wrote nothing yet
//     says so; a blank terminal answers nothing. Leaves with the first transcript entry. ---
export function StreamLine() {
  const { UI } = useLabels();
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
