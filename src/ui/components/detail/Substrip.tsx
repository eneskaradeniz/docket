// Substrip (WO-0031c / v4 → WO-0031f H-4) — the one line under the strip: WHOSE turn it is (left,
// tone-dotted, an aria-live polite announcement — audit B5), the CURRENT FOCUS (middle — the active
// step's aim, or the reviewed/report-read step's; data the app already holds, now written down), and
// the STEP SEGMENTS (adım N/T + filled cells) whenever a plan has steps. In DETAY the line is a
// FILLED BAND (v7 §1b treatment C — "üstü altı boş durmasın": sıra kimde · odak ne · ilerleme kaçta
// in one breath; the middle never sits empty while a focus exists). SADE keeps the calm line — the
// standing "esc geri" hint stays gone (hints are never standing text, ADR-0012 r5).
import type { TurnState } from '../../../core/derive';
import { useLabels } from '../../data/locale';
import { cn } from '../../kit';
import type { LampTone } from '../session/pane-chrome';
import { lampClass } from '../session/pane-chrome';
import { useViewMode } from '../../data/view-mode';

const TURN_TONE: Record<TurnState, LampTone> = {
  yours: 'signal',
  running: 'run',
  stopped: 'idle',
  retry: 'error',
  done: 'done',
};

// The band's turn label speaks in its state's color (v7 draws the yours state in signal).
const TURN_TEXT: Record<TurnState, string> = {
  yours: 'text-signal',
  running: 'text-ink',
  stopped: 'text-inkdim',
  retry: 'text-error',
  done: 'text-proceed',
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
  focus,
  segments,
  onJump,
}: {
  turn: TurnState;
  /** The current focus (H-4): the open report's step, the reviewed step, or the driven step's aim. */
  focus?: string;
  /** The step segments (adım N/T + filled cells); absent while no plan has steps. */
  segments?: { done: number; total: number; activeIdx?: number };
  /** The segments are a JUMP control (tur-2 A7): DETAY + the Akış surface + scroll to it. */
  onJump?: () => void;
}) {
  const { UI } = useLabels();
  // WO-0035: moved inside — the turn words read the hook's UI, so they re-localize with the locale.
  const TURN_LABEL: Record<TurnState, string> = {
    yours: UI.turnYours,
    running: UI.turnRunning,
    stopped: UI.turnStopped,
    retry: UI.turnRetry,
    done: UI.turnDone,
  };
  const { mode: viewMode } = useViewMode();
  const tone = TURN_TONE[turn];
  const band = viewMode === 'detail';

  const turnLine = (
    <p
      aria-live="polite"
      className={cn(
        'flex min-w-0 shrink-0 items-center gap-1.5',
        band ? 'subturn' : 'text-[12px] text-ink',
        TURN_TEXT[turn],
      )}
    >
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', lampClass(tone, tone === 'signal'))}
        aria-hidden="true"
      />
      <span className="truncate">{TURN_LABEL[turn]}</span>
    </p>
  );

  const segs =
    segments && segments.total > 0 ? (
      <button
        type="button"
        onClick={onJump}
        data-segments={segments.total}
        className="irow flex shrink-0 items-center gap-2 px-1.5 py-0.5"
      >
        <span className="flex gap-[3px]" aria-hidden="true">
          {Array.from({ length: segments.total }, (_, i) => i + 1).map((idx) => (
            <span
              key={idx}
              data-seg={idx}
              className={cn(
                'segcell h-3 w-[3px] rounded-[2px]',
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
    ) : null;

  if (band) {
    return (
      <div data-substrip="" data-substrip-band="" className="substrip-band">
        {turnLine}
        {focus ? (
          <p data-substrip-focus="" className="subfocus min-w-0 flex-1 truncate">
            {focus}
          </p>
        ) : (
          <span className="min-w-0 flex-1" aria-hidden="true" />
        )}
        {segs}
      </div>
    );
  }

  return (
    <div data-substrip="" className="flex items-center justify-between gap-3 border-b border-hairline/60 pb-1.5">
      {turnLine}
      {segs}
    </div>
  );
}
