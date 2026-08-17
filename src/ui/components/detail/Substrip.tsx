// Substrip (WO-0031c / v4) — the one line under the strip: WHOSE turn it is (left, tone-dotted, an
// aria-live polite announcement — audit B5: the "Sıra sende" flip must reach screen readers, not just
// eyes). WO-0031d: the right slot is the STEP SEGMENTS (adım N/T + filled cells) whenever a plan has
// steps — the standing "esc geri" hint is gone (hints are never standing text, ADR-0012 r5).
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
  done: UI.turnDone,
};

const TURN_TONE: Record<TurnState, LampTone> = {
  yours: 'signal',
  running: 'run',
  stopped: 'idle',
  retry: 'error',
  done: 'done',
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
    case 'done':
      return 'glow-done'; // unreachable via turn (phaseDone covers it) — the classifier is terminal-safe
  }
}

export function Substrip({
  turn,
  segments,
  onJump,
}: {
  turn: TurnState;
  /** The step segments (adım N/T + filled cells); absent while no plan has steps. */
  segments?: { done: number; total: number; activeIdx?: number };
  /** The segments are a JUMP control (tur-2 A7): DETAY + the Adımlar section + scroll to it. */
  onJump?: () => void;
}) {
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
      {segments && segments.total > 0 ? (
        <button
          type="button"
          onClick={onJump}
          data-segments={segments.total}
          className="irow flex shrink-0 items-center gap-2 px-1.5 py-0.5"
        >
          <span className="flex gap-1" aria-hidden="true">
            {Array.from({ length: segments.total }, (_, i) => i + 1).map((idx) => (
              <span
                key={idx}
                data-seg={idx}
                className={cn(
                  'h-1 w-3 rounded-sm',
                  segments.activeIdx === idx
                    ? 'bg-info'
                    : idx <= segments.done
                      ? 'bg-proceed'
                      : 'bg-hairline',
                )}
              />
            ))}
          </span>
          <span className="readout">{UI.stepSegments(segments.done, segments.total)}</span>
        </button>
      ) : null}
    </div>
  );
}
