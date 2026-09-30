// components/board-skeleton.tsx — the board's loading composition (U-26), in the standing the
// repo kept: the Kanban track's own filled height with a few column lanes (header over card
// blocks), or the Liste table's bordered box with its column header, stage group bars and rows.
// Both borrow the ready views' own container classes, so the board's height never moves when the
// content lands.
import { t, type Locale } from '../labels/t';
import type { BoardViewMode } from '../stores/board';
import { Skeleton, SkeletonStyle } from './skeleton';

/** One Kanban lane: the 40px header band over a scrolling column of card blocks. */
const ColumnSkeleton = ({ cards }: { readonly cards: number }) => (
  <section className="flex min-w-[264px] max-w-[320px] flex-[1_1_280px] flex-col">
    <div className="flex h-10 flex-none items-center gap-2 rounded-panel border border-bord bg-band pl-3 pr-2">
      <Skeleton radius="control" width="72px" height="15px" />
      <Skeleton radius="full" width="32px" height="20px" className="ml-auto" />
      <Skeleton radius="control" width="24px" height="24px" />
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-2">
      {[0, 1, 2].slice(0, cards).map((card) => (
        <div key={card} className="flex min-h-[72px] w-full flex-col gap-2 rounded-card border border-bord bg-surface p-3">
          <Skeleton radius="control" width="56px" height="16px" />
          <Skeleton radius="control" width="82%" height="20px" />
          <Skeleton radius="control" width="40%" height="17px" />
        </div>
      ))}
    </div>
  </section>
);

/** One Liste row on the table's own four-column grid. */
const ListRowSkeleton = () => (
  <div className="grid min-h-12 w-full items-center gap-4 px-4 py-2 [grid-template-columns:20px_72px_minmax(0,1fr)_184px]">
    <Skeleton radius="full" width="8px" height="8px" />
    <Skeleton radius="control" width="52px" height="15px" />
    <Skeleton radius="control" width="38%" height="20px" />
    <Skeleton radius="control" width="88px" height="17px" />
  </div>
);

export function BoardSkeleton({ mode, locale }: { readonly mode: BoardViewMode; readonly locale: Locale }) {
  return (
    <div
      data-skeleton=""
      role="status"
      aria-label={t(locale, 'board.loading')}
      aria-busy="true"
      className="relative flex min-h-[360px] min-w-0 flex-1"
    >
      <SkeletonStyle />
      {mode === 'liste' ? (
        <div className="flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-bord bg-band">
          <div className="grid h-9 items-center gap-4 border-b border-hairline px-4 [grid-template-columns:20px_72px_minmax(0,1fr)_184px]">
            <Skeleton radius="control" width="52px" height="14px" />
            <Skeleton radius="control" width="64px" height="14px" />
            <Skeleton radius="control" width="40%" height="14px" className="justify-self-end" />
          </div>
          {[0, 1].map((group) => (
            <section key={group}>
              <div className="flex h-10 w-full items-center gap-2 border-y border-bord px-4">
                <Skeleton radius="control" width="12px" height="14px" />
                <Skeleton radius="control" width="88px" height="17px" />
                <Skeleton radius="full" width="24px" height="20px" />
              </div>
              <ListRowSkeleton />
              <ListRowSkeleton />
            </section>
          ))}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-stretch gap-3 overflow-x-auto pb-2">
          <ColumnSkeleton cards={3} />
          <ColumnSkeleton cards={2} />
          <ColumnSkeleton cards={2} />
          <ColumnSkeleton cards={3} />
        </div>
      )}
    </div>
  );
}
