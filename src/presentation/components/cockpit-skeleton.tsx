// components/cockpit-skeleton.tsx — the cockpit's loading composition (U-26): grey shapes in
// the four sections' own layout. Every wrapper, padding and line-box height mirrors the ready
// screen's rows (the seed's standings: four attention rows, five running, five project cards,
// five closed), so the content's arrival moves nothing — the heights are the row containers'
// own, and the bars sit at the text line heights they stand in for. The rows mirror the ready
// screen's fill grids (U-55's auto-fill minimums); the sparse panel (U-56) is a standing the
// content itself decides, so the composition draws the fill world it loads into.
import { t, type Locale } from '../labels/t';
import { Skeleton, SkeletonStyle } from './skeleton';

/** A foldable section head as the ready screen renders it: the disclosure button's own padding
 *  around a chevron-sized and a title-sized block, then the count pill's round badge. */
const FoldHeadSkeleton = () => (
  <div className="flex min-w-0 items-center gap-2">
    <div className="-ml-1.5 flex items-center gap-1.5 px-1.5 py-0.5">
      <Skeleton radius="control" width="12px" height="12px" />
      <Skeleton radius="control" width="88px" height="20px" />
    </div>
    <Skeleton radius="full" width="20px" height="18px" />
  </div>
);

/** Senden bekleyenler's head is the one that never folds: a plain heading line and its pill. */
const PlainHeadSkeleton = () => (
  <div className="flex items-center gap-2">
    <Skeleton radius="control" width="104px" height="19px" />
    <Skeleton radius="full" width="20px" height="18px" />
  </div>
);

/** One attention row: the loud section's card wrapper with its lamp, title line, action button
 *  block and meta line — the ready row's own grid and paddings, sized to its 62px stance (the
 *  permission row grows its command band only once the ask resolves, after the swap). */
const AttentionRowSkeleton = () => (
  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-card border border-hairline bg-surface px-3.5 py-2.5">
    <Skeleton radius="full" width="8px" height="8px" className="mt-2 self-start" />
    <Skeleton radius="control" width="42%" height="19px" />
    <Skeleton radius="control" width="152px" height="21px" />
    <Skeleton radius="control" width="68%" height="17px" />
  </div>
);

/** One running row: the calm line's min-height carries it; the bars only fill the space. */
const RunningRowSkeleton = () => (
  <div className="flex min-h-12 w-full items-center gap-3 rounded-card border border-hairline bg-surface px-3">
    <Skeleton radius="control" width="16px" height="16px" />
    <Skeleton radius="control" width="56px" height="14px" />
    <Skeleton radius="control" width="34%" height="18px" />
    <Skeleton radius="control" width="72px" height="14px" className="ml-auto" />
    <Skeleton radius="control" width="44px" height="14px" />
  </div>
);

/** One project card: the card's own grid, gaps and paddings around its three lines. */
const ProjectCardSkeleton = () => (
  <div className="grid min-w-0 gap-2 rounded-card border border-hairline bg-surface px-3.5 py-2.5">
    <Skeleton radius="control" width="46%" height="23px" />
    <Skeleton radius="control" width="64px" height="24px" />
    <Skeleton radius="control" width="72%" height="18px" />
  </div>
);

/** One closed row inside the bordered list the ready screen shows. */
const ClosedRowSkeleton = () => (
  <div className="grid min-h-[2.3125rem] w-full items-center gap-3 px-3.5 [grid-template-columns:auto_minmax(0,1fr)_auto_auto_auto]">
    <Skeleton radius="control" width="52px" height="14px" />
    <Skeleton radius="control" width="30%" height="19px" />
    <Skeleton radius="control" width="120px" height="14px" className="ml-auto" />
    <Skeleton radius="control" width="44px" height="14px" />
  </div>
);

export function CockpitSkeleton({ locale }: { readonly locale: Locale }) {
  return (
    <div data-skeleton="" role="status" aria-label={t(locale, 'cockpit.loading')} aria-busy="true" className="grid gap-4">
      <SkeletonStyle />
      <section className="grid gap-2">
        <PlainHeadSkeleton />
        <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(21.25rem,1fr))]">
          {[0, 1, 2, 3].map((row) => (
            <li key={row}><AttentionRowSkeleton /></li>
          ))}
        </ul>
      </section>
      <section className="grid">
        <FoldHeadSkeleton />
        <div className="mt-2">
          <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(21.25rem,1fr))]">
            {[0, 1, 2, 3, 4].map((row) => (
              <li key={row}><RunningRowSkeleton /></li>
            ))}
          </ul>
        </div>
      </section>
      <section className="grid">
        <FoldHeadSkeleton />
        <div className="mt-2">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-2.5">
            {[0, 1, 2, 3, 4].map((card) => (
              <ProjectCardSkeleton key={card} />
            ))}
          </div>
        </div>
      </section>
      <section className="grid">
        <FoldHeadSkeleton />
        <div className="mt-2">
          <div className="grid divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface">
            {[0, 1, 2, 3, 4].map((row) => (
              <ClosedRowSkeleton key={row} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
