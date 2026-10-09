// components/cockpit-skeleton.tsx — the cockpit's loading composition (U-26): grey shapes in
// the four sections' own layout, mirroring the standing the audit's slow walk loads — the seed's
// three open gates, three runs (two stages and the queued one), five project cards, five closes —
// at the default window, where the fill grids (U-55's auto-fill minimums) take two columns: three
// rows of attention cards make two lines, three running rows two, five project cards three. Every
// wrapper, padding and line-box height mirrors the ready screen's rows, so the content's arrival
// moves nothing: the block heights are the text lines' own boxes (the sans face's 1.366 and the
// mono face's 1.3 normal line-height factors — 14 px → 19.12, 13 → 17.76, 12 → 16.39,
// 11.5 mono → 14.95). The sparse panel (U-56) is a standing the content itself decides, so the
// composition draws the fill world it loads into.
import { t, type Locale } from '../labels/t';
import { Skeleton, SkeletonStyle } from './skeleton';

/** A foldable section head as the ready screen renders it: the disclosure button's own padding
 *  around a chevron-sized and a title-sized block (the 13 px line's own 17.76 px box), then the
 *  count pill's round badge. */
const FoldHeadSkeleton = () => (
  <div className="flex min-w-0 items-center gap-2">
    <div className="-ml-1.5 flex items-center gap-1.5 px-1.5 py-0.5">
      <Skeleton radius="control" width="12px" height="12px" />
      <Skeleton radius="control" width="88px" height="17.76px" />
    </div>
    <Skeleton radius="full" width="20px" height="18px" />
  </div>
);

/** Senden bekleyenler's head is the one that never folds: a plain heading line and its pill. */
const PlainHeadSkeleton = () => (
  <div className="flex items-center gap-2">
    <Skeleton radius="control" width="104px" height="18px" />
    <Skeleton radius="full" width="20px" height="18px" />
  </div>
);

/** One attention row: the loud section's card wrapper with its lamp, title line, action button
 *  block and meta line — the ready row's own grid and paddings. The lamp and the button block
 *  span both rows as the ready row's do, so the rows keep the text lines' own heights; the
 *  permission row grows its command band only once the ask resolves, after the swap. */
const AttentionRowSkeleton = () => (
  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-card border border-hairline bg-surface px-3.5 py-2.5">
    <Skeleton radius="full" width="8px" height="8px" className="row-span-2 mt-2 self-start" />
    <Skeleton radius="control" width="42%" height="19.12px" />
    <Skeleton radius="control" width="152px" height="21px" className="row-span-2" />
    <Skeleton radius="control" width="68%" height="14.95px" />
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

/** One project card: the card's own grid, gaps and paddings around its three lines — the 14 px
 *  title line, the leading-none 22 px number line, the 12 px foot line. */
const ProjectCardSkeleton = () => (
  <div className="grid min-w-0 gap-2 rounded-card border border-hairline bg-surface px-3.5 py-2.5">
    <Skeleton radius="control" width="46%" height="19.12px" />
    <Skeleton radius="control" width="64px" height="22px" />
    <Skeleton radius="control" width="72%" height="16.39px" />
  </div>
);

/** One closed row inside the bordered list the ready screen shows — the list's own 2.25 rem row
 *  stance. */
const ClosedRowSkeleton = () => (
  <div className="grid min-h-9 w-full items-center gap-3 px-3.5 [grid-template-columns:auto_minmax(0,1fr)_auto_auto_auto]">
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
          {[0, 1, 2].map((row) => (
            <li key={row}><AttentionRowSkeleton /></li>
          ))}
        </ul>
      </section>
      <section className="grid">
        <FoldHeadSkeleton />
        <div className="mt-2">
          <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(21.25rem,1fr))]">
            {[0, 1, 2].map((row) => (
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
