// Substrip (WO-0031c / v4) — the one line under the strip: WHOSE turn it is (left, tone-dotted, an
// aria-live polite announcement — audit B5: the "Sıra sende" flip must reach screen readers, not just
// eyes) and the keyboard hint (right). The text comes from deriveTurnState via labels; this component
// only maps tone → lamp class.
import type { TurnState } from '../../../core/derive';
import { UI } from '../../data/labels';
import { cn } from '../../kit';
import type { LampTone } from '../session/pane-chrome';
import { lampClass } from '../session/pane-chrome';

const TURN_LABEL: Record<TurnState, string> = {
  yours: UI.turnYours,
  running: UI.turnRunning,
  stopped: UI.turnStopped,
  retry: UI.turnRetry,
};

const TURN_TONE: Record<TurnState, LampTone> = {
  yours: 'signal',
  running: 'run',
  stopped: 'idle',
  retry: 'error',
};

export function turnGlowClass(turn: TurnState, phaseDone: boolean): string {
  if (phaseDone) return 'glow-done';
  switch (turn) {
    case 'yours':
      return 'glow-signal';
    case 'running':
      return 'glow-run';
    case 'retry':
      return 'glow-error';
    case 'stopped':
      return ''; // the wash is removed while stopped (v4: "signal removed when stopped")
  }
}

export function Substrip({ turn }: { turn: TurnState }) {
  const tone = TURN_TONE[turn];
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline/60 pb-1.5">
      <p aria-live="polite" className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink">
        <span
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', lampClass(tone, tone === 'signal'))}
          aria-hidden="true"
        />
        <span className="truncate">{TURN_LABEL[turn]}</span>
      </p>
      <span className="readout shrink-0">{UI.hintEscBack}</span>
    </div>
  );
}
