// components/accounts-scanning.tsx — the one scanning surface the wizard's Hesaplar step and
// Settings → Hesaplar share (U-52). While a scan runs, the toolbar reads its screen's own word
// with an em-dash count and a disabled "Taranıyor…" button carrying a spinning icon; the note
// line and the thin indeterminate progress line sit under it; six skeleton assistant groups —
// mark, dimmed name, one or two shimmering rows about the real size — hold the list's place.
// Discovery reports no number, so nothing here ever shows one. The skeleton holds at least
// MOTION.scan.minShowMs, then the body mounts with the reveal handed down: each group enters
// with the scan motion, staggered in order by the list itself. The container carries aria-busy
// while scanning and the end speaks "n hesap bulundu" politely. Under prefers-reduced-motion
// there is no shimmer or rise — a static dim skeleton and an immediate swap.
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { scanPhase } from '../stores/scan-phase';
import { ActionButton } from './action-button';
import { MOTION } from './motion';
import { Skeleton, SkeletonStyle } from './skeleton';

/** The scan's own motions: the groups' entrance (160 ms fade with an 8 px rise, `backwards`
 *  holding each one faded below until its staggered turn) and the button's spinner. The
 *  reduced-motion standings play none of it — the groups land at once, the shapes stand dim. */
export const SCAN_STYLE_CSS = `\
[data-scan-group-in] {
  animation: docket-scan-group-in ${MOTION.scan.fadeMs}ms ease-out backwards;
}
@keyframes docket-scan-group-in {
  from { opacity: 0; transform: translateY(${MOTION.scan.risePx}px); }
  to { opacity: 1; transform: translateY(0); }
}
[data-scan-spin] {
  animation: docket-scan-spin 0.8s linear infinite;
}
@keyframes docket-scan-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  [data-scan-group-in], [data-scan-spin] { animation: none; }
}`;

/** One `<style>` element with the scan's motions, mounted once beside the surface. */
export function ScanStyle() {
  return <style>{SCAN_STYLE_CSS}</style>;
}

/** The line the scan's end speaks — its own count, never a percentage or a running total. Pure. */
export const scanDoneLine = (locale: Locale, accounts: number): string => t(locale, 'candidates.scan.done').replace('{n}', String(accounts));

/** The scan's anti-flicker standing, decided only through the pure `scanPhase`: `skeleton` says
 *  the placeholder is up (the scan runs, or its minimum show holds it over arrived rows) and
 *  `reveal` says a skeleton preceded the body about to mount, so it should stagger in. `now` is
 *  injected, as in the loading skeletons' hook. */
export function useScan(scanning: boolean, now: () => number): Readonly<{ skeleton: boolean; reveal: boolean }> {
  // The scan's start lives in a ref: the store flips `scanning`, the clock walks on between
  // renders, and the stamp must survive them both.
  const scanStart = useRef<number | null>(null);
  const [shownSince, setShownSince] = useState<number | null>(null);
  const [appeared, setAppeared] = useState(false);
  const [, setTick] = useState(0);

  if (scanning) {
    if (scanStart.current === null) scanStart.current = now();
  } else if (shownSince === null) {
    // A scan that never showed its skeleton ends the cycle; the next one stamps afresh.
    scanStart.current = null;
  }

  const phase = scanPhase(scanning ? scanStart.current : null, now(), shownSince);
  // The derived-state pattern: adopt the stamp the phase hands back the moment it first shows,
  // and forget it once the phase hides, so the next cycle starts clean.
  if (phase.visible && shownSince === null) setShownSince(phase.shownSince);
  if (!phase.visible && shownSince !== null) setShownSince(null);
  if (phase.visible && !appeared) setAppeared(true);

  // One timer at the hold's end, while the tail keeps the skeleton over arrived rows; no
  // boundary pending, no timer — the scan's own end re-renders through the store.
  useEffect(() => {
    const wait = !scanning && phase.visible && shownSince !== null ? MOTION.scan.minShowMs - (now() - shownSince) : null;
    if (wait === null) return undefined;
    const timer = window.setTimeout(() => setTick((tick) => tick + 1), Math.max(0, wait) + 1);
    return () => window.clearTimeout(timer);
  });

  return { skeleton: phase.visible, reveal: appeared };
}

/** One skeleton row: the two text lines and the status pill, at the real row's own height. */
const SkeletonRow = () => (
  <li data-scan-skeleton-row="" className="border-t border-hairline first:border-t-0">
    <div className="flex min-h-[56px] items-center gap-3 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <Skeleton width="36%" height="12px" radius="control" />
        <Skeleton width="58%" height="10px" radius="control" className="mt-2" />
      </div>
      <Skeleton width="86px" height="12px" radius="control" className="flex-none" />
    </div>
  </li>
);

/** One skeleton assistant group: the mark box and the dimmed name in its head, one or two
 *  placeholder rows — about the size of the real group it holds the place of. */
const SkeletonGroup = ({ rows }: { readonly rows: number }) => (
  <section data-scan-skeleton-group="" className="overflow-hidden rounded-card border border-hairline bg-surface">
    <div className="flex items-center gap-2.5 border-b border-hairline bg-band px-3.5 py-2.5">
      <Skeleton width="26px" height="26px" radius="control" className="flex-none" />
      <Skeleton width="96px" height="14px" radius="control" />
      <Skeleton width="64px" height="11px" radius="control" className="ml-auto" />
    </div>
    <ul className="m-0 list-none p-0">
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </ul>
  </section>
);

/** The scanning body: the two section shells the real list splits into (U-45) — three groups of
 *  two rows in the open one, three of one row behind the closed failed shell — six groups about
 *  the size of the real ones. The holder is aria-hidden: the container's busy standing speaks,
 *  never the shapes. */
const ScanSkeleton = () => (
  <div aria-hidden="true" className="grid gap-2.5">
    <div data-scan-skeleton-section="found" className="grid gap-2.5">
      <Skeleton width="190px" height="14px" radius="control" className="mx-2 my-[7px]" />
      <div className="grid gap-2.5">
        <SkeletonGroup rows={2} />
        <SkeletonGroup rows={2} />
        <SkeletonGroup rows={2} />
      </div>
    </div>
    <div data-scan-skeleton-section="failed" className="grid gap-2.5">
      <Skeleton width="190px" height="14px" radius="control" className="mx-2 my-[7px]" />
      <div hidden={true} className="grid gap-2.5">
        <SkeletonGroup rows={1} />
        <SkeletonGroup rows={1} />
        <SkeletonGroup rows={1} />
      </div>
    </div>
  </div>
);

export interface AccountsScanningProps {
  readonly locale: Locale;
  /** The toolbar's own leading word — Taranan in the wizard, Eklenenler in Settings. */
  readonly titleKey: LabelKey;
  /** The scan in flight — the store's loading standing. */
  readonly scanning: boolean;
  readonly onRescan: () => void;
  /** The counts the toolbar reads once the scan has answered. */
  readonly totals: Readonly<{ readonly accounts: number; readonly assistants: number }>;
  readonly now: () => number;
  /** The finished body, told whether a scan's skeleton preceded it (U-52's staggered reveal). */
  readonly children: (reveal: boolean) => ReactNode;
}

export function AccountsScanning({ locale, titleKey, scanning, onRescan, totals, now, children }: AccountsScanningProps) {
  const { skeleton, reveal } = useScan(scanning, now);
  // The end line speaks once per scan: a new skeleton clears the old line, the hold's end sets
  // it, and a quiet re-render never repeats it.
  const [said, setSaid] = useState<string | null>(null);
  if (skeleton) {
    if (said !== null) setSaid(null);
  } else if (reveal && !scanning && said === null) {
    setSaid(scanDoneLine(locale, totals.accounts));
  }
  return (
    <div data-accounts-scan="" aria-busy={skeleton ? true : undefined}>
      <ScanStyle />
      <SkeletonStyle />
      <div className="mb-3 flex items-center gap-2.5">
        <span className="font-bold text-ink">
          {t(locale, titleKey)}{' '}
          <span className="font-medium text-inkdim">
            {skeleton ? '· —' : `· ${t(locale, 'accountGroups.counts').replace('{accounts}', String(totals.accounts)).replace('{assistants}', String(totals.assistants))}`}
          </span>
        </span>
        <span className="ml-auto">
          {skeleton ? (
            <ActionButton disabled onClick={onRescan}>
              <i data-scan-spin="" aria-hidden="true" className="inline-block h-[15px] w-[15px] flex-none rounded-full border-2 border-ink/30 border-t-ink" />
              <span>{t(locale, 'candidates.status.scanning')}</span>
            </ActionButton>
          ) : (
            <ActionButton onClick={onRescan}>{t(locale, 'candidates.rescan')}</ActionButton>
          )}
        </span>
      </div>
      {skeleton ? (
        <>
          <p className="mb-2 text-[13px] text-inkdim">{t(locale, 'candidates.scan.title')}</p>
          <div className="-mt-1.5 mb-2.5 h-0.5 overflow-hidden rounded-full bg-hairline" role="progressbar" aria-label={t(locale, 'candidates.scan.title')}>
            <i className="block h-full w-[30%] animate-[scan_1s_linear_infinite] bg-signal motion-reduce:animate-none" />
          </div>
          <ScanSkeleton />
        </>
      ) : (
        children(reveal)
      )}
      <span role="status" aria-live="polite" className="sr-only">{said ?? ''}</span>
    </div>
  );
}
