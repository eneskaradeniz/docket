// stores/scan-phase.test.ts — the Hesaplar scan skeleton's timing (U-52) as a pure function: the
// skeleton is up the moment a scan starts (arriving on the step is never a blank beat showing 0)
// and, once shown, holds at least MOTION.scan.minShowMs — a reply that races in must not blink
// the placeholder away before the groups can stagger in.
import { describe, expect, it } from 'vitest';

import { MOTION } from '../components/motion';
import { scanPhase } from './scan-phase';

describe('scanPhase (U-52)', () => {
  it('U-52: the skeleton is up the moment a scan starts — arriving on the step or pressing "Yeniden tara" is never a blank beat', () => {
    expect(scanPhase(1_000, 1_000, null)).toStrictEqual({ visible: true, shownSince: 1_000 });
  });

  it('U-52: the skeleton stays at least 400 ms — a reply that races in holds the placeholder over it', () => {
    expect(MOTION.scan.minShowMs).toBe(400);
    // The read answered at 200 ms; the hold runs the full 400 ms from the first show.
    expect(scanPhase(null, 1_399, 1_000)).toStrictEqual({ visible: true, shownSince: 1_000 });
    expect(scanPhase(null, 1_400, 1_000)).toStrictEqual({ visible: false, shownSince: null });
  });

  it('U-52: with no scan running and no hold left, the skeleton is gone — the groups stand on their own', () => {
    expect(scanPhase(null, 5_000, null)).toStrictEqual({ visible: false, shownSince: null });
  });
});
