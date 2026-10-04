// stores/scan-phase.ts — the Hesaplar scan skeleton's timing as a pure function (U-52): the
// skeleton shows the moment a scan starts — arriving on the step or pressing "Yeniden tara" is
// never a blank beat — and, once shown, holds at least MOTION.scan.minShowMs, so a reply that
// races in cannot blink the placeholder away before the groups stagger in. Time is injected;
// the function never reads a clock itself.
import { MOTION } from '../components/motion';

/** What the caller should render now, and the stamp to feed back on the next call: the
 *  `shownSince` handed back is the moment the skeleton first showed (the caller keeps it until
 *  the phase hides, then passes null again). */
export interface ScanPhase {
  readonly visible: boolean;
  readonly shownSince: number | null;
}

/** The skeleton's standing at `now`. `scanningSince` is the moment the current scan began (null
 *  when no scan runs); `shownSince` is the stamp the previous call handed back (null when the
 *  skeleton is not up). Pure. */
export const scanPhase = (scanningSince: number | null, now: number, shownSince: number | null): ScanPhase => {
  const scanning = scanningSince !== null;
  const insideShow = shownSince !== null && now - shownSince < MOTION.scan.minShowMs;
  if (!scanning && !insideShow) return { visible: false, shownSince: null };
  return { visible: true, shownSince: shownSince ?? now };
};
