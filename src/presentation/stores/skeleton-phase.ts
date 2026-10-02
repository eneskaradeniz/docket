// stores/skeleton-phase.ts — the loading skeletons' anti-flicker rule as a pure function
// (U-26): a skeleton appears only when a load outlives `MOTION.skeleton.delayMs`, and once
// shown it holds at least `MOTION.skeleton.minShowMs` — a reply that races in must not blink
// the placeholder away. Time is injected; the function never reads a clock itself.
import { MOTION } from '../components/motion';

/** What the caller should render now, and the stamp to feed back on the next call: the
 *  `shownSince` handed back is the moment the skeleton first showed (the caller keeps it until
 *  the phase hides, then passes null again). */
export interface SkeletonPhase {
  readonly visible: boolean;
  readonly shownSince: number | null;
}

/** The skeleton's standing at `now`. `loadingSince` is the moment the current load began (null
 *  when nothing is loading); `shownSince` is the stamp the previous call handed back (null when
 *  the skeleton is not up). Pure. */
export const skeletonPhase = (loadingSince: number | null, now: number, shownSince: number | null): SkeletonPhase => {
  const pastDelay = loadingSince !== null && now - loadingSince >= MOTION.skeleton.delayMs;
  const insideShow = shownSince !== null && now - shownSince < MOTION.skeleton.minShowMs;
  if (!pastDelay && !insideShow) return { visible: false, shownSince: null };
  return { visible: true, shownSince: shownSince ?? now };
};
