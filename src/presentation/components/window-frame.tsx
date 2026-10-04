// components/window-frame.tsx — the Window (U-41): the one frame of the setup wizard and of
// Settings. 880×580, a 200px left column and a content column of head · scrolling body · an
// optional footer band. The footer never leaves the window — the body scrolls — and a footer that
// is absent takes no space. The left column holds the brand and whatever the host puts there (the
// wizard's steps, Settings' menu). Purely presentational; every string arrives resolved.
import type { ReactNode, Ref } from 'react';

export interface WindowFrameProps {
  /** The window's accessible name. */
  readonly label: string;
  /** The brand line at the top of the left column. */
  readonly brand: string;
  /** The left column below the brand: steps or menu. */
  readonly rail: ReactNode;
  /** A quiet note pinned to the bottom of the left column. */
  readonly railNote?: string;
  /** The head: title, one sentence, and anything at its right edge. */
  readonly head: ReactNode;
  /** The scrolling body. */
  readonly children: ReactNode;
  /** The footer band; absent = no band and no reserved space. */
  readonly footer?: ReactNode;
  /** The host's own classes (an enter/exit transition) and handlers on the frame. */
  readonly className?: string;
  readonly frameRef?: Ref<HTMLElement>;
  readonly onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export function BrandMark({ name }: { readonly name: string }) {
  return (
    <div className="flex items-center gap-2.5 px-1.5 font-bold tracking-[-0.01em] text-ink">
      <span aria-hidden="true" className="relative block h-[18px] w-[18px] flex-none rounded-control bg-signal">
        <span className="absolute inset-x-1 inset-y-[5px] border-y-2 border-signal-ink" />
      </span>
      {name}
    </div>
  );
}

export function WindowFrame({ label, brand, rail, railNote, head, children, footer, className = '', frameRef, onKeyDown }: WindowFrameProps) {
  return (
    <section
      ref={frameRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-window=""
      className={`relative grid h-[580px] max-h-full w-[880px] max-w-full grid-cols-[200px_minmax(0,1fr)] overflow-hidden rounded-panel border border-bord bg-surface shadow-2xl outline-none ${className}`}
    >
      <nav aria-label={label} className="flex flex-col gap-[18px] overflow-y-auto border-r border-hairline bg-band px-3.5 pb-4 pt-[22px]">
        <BrandMark name={brand} />
        {rail}
        {railNote !== undefined ? <p className="mt-auto px-1.5 text-[12px] leading-[1.45] text-inkdim">{railNote}</p> : null}
      </nav>
      <div className={`grid min-h-0 min-w-0 overflow-hidden ${footer === undefined ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)_auto]'}`}>
        <header className="px-8 pb-3.5 pt-[26px]">{head}</header>
        <div data-window-body="" className="min-h-0 overflow-y-auto px-8 pb-5 pt-1.5">
          {children}
        </div>
        {footer !== undefined ? (
          <footer data-window-footer="" className="flex items-center gap-2 border-t border-hairline bg-surface px-8 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </section>
  );
}

/** The head's title and the one sentence under it. */
export function WindowTitle({ title, lead }: { readonly title: string; readonly lead?: string }) {
  return (
    <div className="min-w-0">
      <h1 className="text-[22px] font-bold leading-[1.2] tracking-[-0.015em] text-ink">{title}</h1>
      {lead !== undefined ? <p className="mt-1.5 max-w-[60ch] text-[14px] text-inkdim">{lead}</p> : null}
    </div>
  );
}
