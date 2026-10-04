// components/toast-host.tsx — the app's one toast surface (U-50): the shell mounts this host
// once and nothing else draws a toast. Every card slides in from the right, carries its type's
// glyph and colour (the amber signal token is the warn voice — the book has no separate warn),
// a close button labelled from the bundle, and a thin progress line that drains over the
// toast's own duration; hovering or focusing the card pauses both the line (CSS) and the
// self-dismiss timer (the store's hold). Announcements are polite, assertive for error.
import { useSyncExternalStore, type ReactNode } from 'react';

import { t, type Locale } from '../labels/t';
import type { ToastItem, ToastStore, ToastType } from '../stores/toasts';

/** The icon grammar every small shell glyph shares: currentColor strokes on a 16×16 field. */
const GLYPH_PROPS = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  className: 'mt-[1px] block h-4 w-4 flex-none',
} as const;

/** Each voice's glyph: a check, an information ring, a warning triangle, a crossed ring. */
const GLYPHS: Readonly<Record<ToastType, ReactNode>> = {
  success: (
    <svg {...GLYPH_PROPS}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  ),
  info: (
    <svg {...GLYPH_PROPS}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5v3.5" />
      <path d="M8 5.2v.2" />
    </svg>
  ),
  warn: (
    <svg {...GLYPH_PROPS}>
      <path d="M8 2.5L14 13H2z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.3v.2" />
    </svg>
  ),
  error: (
    <svg {...GLYPH_PROPS}>
      <circle cx="8" cy="8" r="6" />
      <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
    </svg>
  ),
};

/** Each voice's colour rides the existing tokens only (U-50): proceed, info, the amber signal
 *  for warn, error — as the glyph's ink, the drain line's fill and, for the two loud voices, the
 *  card's edge. */
const VOICE_INK: Readonly<Record<ToastType, string>> = {
  success: 'text-proceed',
  info: 'text-info',
  warn: 'text-signal',
  error: 'text-error',
};
const VOICE_LINE: Readonly<Record<ToastType, string>> = {
  success: 'bg-proceed',
  info: 'bg-info',
  warn: 'bg-signal',
  error: 'bg-error',
};
const VOICE_EDGE: Readonly<Record<ToastType, string>> = {
  success: 'border-bord',
  info: 'border-bord',
  warn: 'border-signal/45',
  error: 'border-error/45',
};

export interface ToastHostProps {
  /** The one toast service; the shell passes the app's own store. */
  readonly store: ToastStore;
  readonly locale: Locale;
}

function ToastCard({ item, store, locale }: { readonly item: ToastItem; readonly store: ToastStore; readonly locale: Locale }) {
  return (
    <div
      data-toast={item.type}
      role={item.type === 'error' ? 'alert' : 'status'}
      aria-live={item.type === 'error' ? 'assertive' : 'polite'}
      // The hold (U-50): a hover or a focus pauses the card's own timer; leaving resumes it.
      onMouseEnter={() => store.pause(item.id)}
      onMouseLeave={() => store.resume(item.id)}
      onFocus={() => store.pause(item.id)}
      onBlur={() => store.resume(item.id)}
      className={[
        'group pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-card border bg-raised px-3 pt-2.5 pb-[13px]',
        'text-[13px] text-ink shadow-2xl animate-[toast-in_220ms_ease-out] motion-reduce:animate-none',
        VOICE_EDGE[item.type],
      ].join(' ')}
    >
      <span aria-hidden="true" className={VOICE_INK[item.type]}>
        {GLYPHS[item.type]}
      </span>
      <span className="min-w-0 flex-1 break-words">{item.text}</span>
      <button
        type="button"
        onClick={() => store.close(item.id)}
        aria-label={t(locale, 'toast.close')}
        title={t(locale, 'toast.close')}
        className="-mr-1 -mt-1 grid h-[22px] w-[22px] flex-none place-items-center rounded-control text-inkdim hover:bg-band hover:text-ink"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="block h-[13px] w-[13px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
      {/* The thin progress line: it drains over the toast's own duration and pauses with the
          card under a hover or a focus, the same moments the store's timer pauses. */}
      <span
        aria-hidden="true"
        style={{ animationDuration: `${item.durationMs}ms` }}
        className={`absolute inset-x-0 bottom-0 h-0.5 origin-left animate-[toast-drain_linear_forwards] group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused] motion-reduce:animate-none ${VOICE_LINE[item.type]}`}
      />
    </div>
  );
}

export function ToastHost({ store, locale }: ToastHostProps) {
  const items = useSyncExternalStore(store.subscribe, store.state, store.state);
  if (items.length === 0) return null;
  return (
    // The one fixed stack: top right, sixteen pixels from the edges, over every overlay.
    <div data-toast-host className="pointer-events-none fixed top-4 right-4 z-[70] grid w-[min(380px,calc(100vw-32px))] gap-2">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} store={store} locale={locale} />
      ))}
    </div>
  );
}
