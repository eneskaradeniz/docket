// pane-chrome — the shared instrument chrome of the three session panes (WO-0031b). Before this,
// statusColor()/phaseTone() were duplicated verbatim in SessionPane/StepPane/ReviewPane — a tone change
// touched three files. One home now: the lamp semantics (signal=needs you, info=running,
// proceed=done/ready, error=failed) and the readout voice live here.
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { LiveSessionStatus, SimplePhase } from '../../../core/runner';
import { LIVE_STATUS_LABELS } from '../../data/labels';
import { Segmented } from '../../kit';
import { cn } from '../../kit';

// --- lamp semantics: one color per state, amber only for "seni bekliyor" ---
export type LampTone = 'idle' | 'signal' | 'run' | 'done' | 'error';

const STATUS_LAMP: Record<LiveSessionStatus, LampTone> = {
  idle: 'idle',
  running: 'run',
  stopped_asking: 'signal',
  plan_ready: 'signal',
  done: 'done',
  error: 'error',
};

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

export function statusDotClass(status: LiveSessionStatus): string {
  return lampClass(STATUS_LAMP[status], status === 'stopped_asking');
}

export function phaseDotClass(phase: SimplePhase): string {
  return lampClass(PHASE_LAMP[phase] ?? 'idle', phase === 'asking_permission');
}

// --- the pane header: readout title · status lamp+label · right slot (Segmented, cost, buttons) ---
export function PaneHeader({
  title,
  status,
  right,
}: {
  title: string;
  status: LiveSessionStatus;
  right?: ReactNode;
}) {
  return (
    <header className="mb-2 flex items-center gap-2.5">
      <h2 className="readout truncate">{title}</h2>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(status))} aria-hidden="true" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-inkdim">
          {LIVE_STATUS_LABELS[status]}
        </span>
      </span>
      {right ? <span className="ml-auto flex shrink-0 items-center gap-2">{right}</span> : null}
    </header>
  );
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

// --- the SADE/DETAY toggle ---
export function ViewModeToggle({
  value,
  onValueChange,
}: {
  value: 'sade' | 'detail';
  onValueChange: (v: 'sade' | 'detail') => void;
}) {
  return (
    <Segmented
      size="sm"
      value={value}
      onValueChange={onValueChange}
      options={[
        { value: 'sade', label: 'SADE' },
        { value: 'detail', label: 'DETAY' },
      ]}
    />
  );
}

// --- the mono cost/duration line (7b/7c values) ---
export function CostReadout({ cost, duration }: { cost?: string; duration?: string }) {
  if (!cost && !duration) return null;
  return (
    <span className="font-mono text-[11px] whitespace-nowrap text-inkdim">
      {cost}
      {cost && duration ? ' · ' : ''}
      {duration ? `⏱ ${duration}` : ''}
    </span>
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
