// DriveControls (WO-0039) — the dead rail's PROCESS-CONTROL half, reborn in the live pane's header
// row. The bottom bar is gone; Durdur lives where the session lives (StepPane's spine row header,
// SessionPane / ReviewPane headers). Rules carried verbatim from the v4 rail: while running ONLY
// Durdur (no filler line — the always-visible header band already says Çalışıyor); the wind-down
// locks into Durduruluyor… and 5s stuck arms Zorla kes; a stopped drive carries the honest message +
// ▶ Sürdür (which is ⏎'s target whenever it renders). DOSSIER DECISIONS (Onayla / İtiraz / Düzenle /
// Plan iste) never live here — they are the plan section's decision band and the empty-state card.
import { Square } from 'lucide-react';
import { Button } from '../../kit';
import { useLabels } from '../../data/locale';
import { EnterMark } from '../EnterMark';

/** The active drive's process-control bundle — computed by the controller and passed down to
 *  whichever pane renders the drive (through StepList for the driven step's row). */
export interface DriveState {
  running: boolean;
  stopping: boolean;
  forceArmed: boolean;
  stopped: boolean;
  /** A Sürdür is offered (the `stopped` wind-down, or an interrupted 'active' step at restart). */
  resumable: boolean;
  /** Whether ▶ Sürdür carries the ONE ⏎ badge — the controller's decision row outranks it when
   *  both render (Onayla on a stopped re-plan is the fresher intent). */
  enter: boolean;
  onStop: () => void;
  onForceKill: () => void;
  onResume: () => void;
}

export function DriveControls({ drive }: { drive: DriveState }) {
  const { UI } = useLabels();
  let buttons;
  if (drive.stopping) {
    buttons = (
      <>
        {drive.forceArmed ? (
          <Button variant="danger" size="sm" onClick={drive.onForceKill}>
            {UI.driveForceKill}
          </Button>
        ) : null}
        {/* Durduruluyor… is a state READOUT, not an action — secondary + busy + locked, never
            danger ("consistent-ifying" it would make a locked control shout red forever). */}
        <Button variant="secondary" size="sm" busy locked>
          {UI.driveStopping}
        </Button>
      </>
    );
  } else if (drive.running) {
    // 2026-08-23 operator ruling: Durdur is DANGER — the machine's E-stop. It renders alone in
    // the pane header (never ⏎'s target), and Zorla kes only arms after the 5s wind-down stall,
    // so the two reds are mutually exclusive states: red = stop the machine, both grades.
    // Same-day polish round: size xs + a leading stop glyph — the readout owns the header row.
    buttons = (
      <Button variant="danger" size="xs" onClick={drive.onStop}>
        <Square className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
        {UI.interrupt}
      </Button>
    );
  } else if (drive.resumable) {
    buttons = (
      <Button variant="primary" size="sm" onClick={drive.onResume}>
        {UI.driveResume}
        {drive.enter ? <EnterMark /> : null}
      </Button>
    );
  } else {
    return null;
  }
  return (
    <div data-drive-controls="" className="flex shrink-0 items-center gap-2.5">
      {drive.stopped ? <span className="text-[11.5px] text-inkdim">{UI.driveStoppedMsg}</span> : null}
      <div className="flex shrink-0 items-center gap-2">{buttons}</div>
    </div>
  );
}
