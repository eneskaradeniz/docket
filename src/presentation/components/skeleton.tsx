// components/skeleton.tsx — the loading skeleton primitive (U-26): a grey placeholder block in
// the raised tone, its only motion a shimmer crest sweeping left→right. Everything the loading
// compositions share lives here — the sweep's style sheet, the anti-flicker hook that decides
// through the pure skeletonPhase, and the rise-and-fade the real content enters with — so each
// screen only mirrors its own layout with blocks.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { skeletonPhase } from '../stores/skeleton-phase';
import { MOTION } from './motion';

/** The sweep's period: one crest crosses every block each 1.4s, ease-in-out, forever. */
export const SHIMMER_PERIOD_MS = 1400;

/** The sweep's own style sheet, mounted once per composition (`<SkeletonStyle/>`): the crest is
 *  a wide gradient whose background slides exactly one tile per period, so the loop is seamless,
 *  and prefers-reduced-motion freezes it into a static placeholder — no animation at all. */
export const SKELETON_STYLE_CSS = `\
[data-skeleton-block] {
  background-image: linear-gradient(100deg, var(--raised) 32%, color-mix(in srgb, var(--raised) 80%, #fff) 50%, var(--raised) 68%);
  background-size: 200% 100%;
  animation: docket-skeleton-sweep ${SHIMMER_PERIOD_MS}ms ease-in-out infinite;
}
@keyframes docket-skeleton-sweep {
  from { background-position: 0% 0; }
  to { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  [data-skeleton-block] { animation: none; }
}`;

/** One `<style>` element with the sweep; a composition mounts it beside its blocks. */
export function SkeletonStyle() {
  return <style>{SKELETON_STYLE_CSS}</style>;
}

export interface SkeletonProps {
  /** The block's width as a CSS length; blocks fill their track by default. */
  readonly width?: string;
  /** The block's height as a CSS length; the compositions pass the line boxes they mirror. */
  readonly height?: string;
  /** U-23: a skeleton is a control-sized or card-sized block — a round badge shape for count
   *  pills, the one place `rounded-full` is allowed beside those two. */
  readonly radius?: 'control' | 'card' | 'full';
  readonly className?: string;
}

/** One grey block. `aria-hidden`: the holder speaks for the loading standing, never the shapes. */
export function Skeleton({ width = '100%', height, radius = 'card', className = '' }: SkeletonProps) {
  const style: CSSProperties = { width, ...(height === undefined ? {} : { height }) };
  return (
    <div
      data-skeleton-block=""
      aria-hidden="true"
      className={`bg-raised ${radius === 'card' ? 'rounded-card' : radius === 'control' ? 'rounded-control' : 'rounded-full'} ${className}`}
      style={style}
    />
  );
}

/** The anti-flicker timing for one loading surface (U-26), decided only through the pure
 *  `skeletonPhase`: `skeleton` says the composition is up (past the delay, or inside its minimum
 *  show), `reveal` says a skeleton preceded the content that is about to mount, so it should
 *  enter with the rise instead of appearing at once. `now` is injected. */
export function useSkeleton(loading: boolean, now: () => number): Readonly<{ skeleton: boolean; reveal: boolean }> {
  // The load's start lives in a ref: the store flips `loading`, the clock walks on between
  // renders, and the stamp must survive them both.
  const loadStart = useRef<number | null>(null);
  const [shownSince, setShownSince] = useState<number | null>(null);
  const [appeared, setAppeared] = useState(false);
  const [, setTick] = useState(0);

  if (loading) {
    if (loadStart.current === null) loadStart.current = now();
  } else if (shownSince === null) {
    // A load that never showed a skeleton ends the cycle; the next one stamps afresh.
    loadStart.current = null;
  }

  const phase = skeletonPhase(loading ? loadStart.current : null, now(), shownSince);
  // The derived-state pattern: adopt the stamp the phase hands back the moment it first shows,
  // and forget it once the phase hides, so the next cycle starts clean.
  if (phase.visible && shownSince === null) setShownSince(phase.shownSince);
  if (!phase.visible && shownSince !== null) setShownSince(null);
  if (phase.visible && !appeared) setAppeared(true);

  // One timer at the next boundary — the delay's end while waiting, the minimum show's end
  // while the tail holds the skeleton over arrived content. No boundary pending, no timer.
  useEffect(() => {
    const start = loadStart.current;
    const wait =
      loading && !phase.visible && start !== null
        ? MOTION.skeleton.delayMs - (now() - start)
        : !loading && phase.visible && shownSince !== null
          ? MOTION.skeleton.minShowMs - (now() - shownSince)
          : null;
    if (wait === null) return undefined;
    const timer = window.setTimeout(() => setTick((tick) => tick + 1), Math.max(0, wait) + 1);
    return () => window.clearTimeout(timer);
  });

  return { skeleton: phase.visible, reveal: appeared };
}

const REVEAL_EASE = MOTION.open.easing;

/** The content that replaces a shown skeleton enters with the row motion's own numbers — the
 *  rise and fade the search palette's rows use — played once on mount; reduced motion skips it.
 *  Inactive (no skeleton preceded, a fast load) the children mount as they are. */
export function SkeletonReveal({
  children,
  className = '',
  active = true,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly active?: boolean;
}) {
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const frame = requestAnimationFrame(() => setUp(true));
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const ms = `${MOTION.results.fadeMs}ms ${REVEAL_EASE}`;
  const style: CSSProperties = {
    transition: `opacity ${ms}, translate ${ms}`,
    ...(up ? { opacity: 1, translate: '0px 0px' } : { opacity: 0, translate: `0px ${MOTION.results.risePx}px` }),
  };
  return (
    <div className={`motion-reduce:translate-y-0 motion-reduce:transition-none ${className}`} style={style}>
      {children}
    </div>
  );
}
