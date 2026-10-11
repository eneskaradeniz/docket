// components/panel-overlay.tsx — the overlay a Window (components/window-frame.tsx) stands in: a
// scrim that blurs what is behind it, the frame easing in and out, focus moving in on open, Tab
// trapped while open, Esc and a press on the scrim closing, and focus returning to the opener on a
// keyboard-opened close only (the palette's one rule). Reduced motion is a quick fade. The host
// owns what is inside — the rail, the head, the body and the footer arrive as slots.
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { focusRestoredOnClose, type PaletteOrigin } from '../stores/search-palette';
import { MOTION, motionVars } from './motion';
import { WindowFrame } from './window-frame';

export interface PanelOverlayProps {
  readonly open: boolean;
  readonly origin: PaletteOrigin;
  readonly label: string;
  readonly brand: string;
  readonly rail: ReactNode;
  readonly head: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  /** The `data-*` names the frame and the scrim are known by to the e2e walks. */
  readonly dataMark: string;
  readonly scrimMark: string;
  /** Esc and a press on the scrim. */
  readonly onClose: () => void;
}

/** Flips to true only once `active` has survived a painted frame — the browser needs the
 *  hidden start state on screen before a transition has something to chase. */
function usePaintedFlip(active: boolean): boolean {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    if (!active) {
      setFlipped(false);
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setFlipped(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [active]);
  return flipped;
}

// The same motion numbers and classes the settings panel and the palette animate with.
const MOTION_STYLE = motionVars();

export function PanelOverlay({ open, origin, label, brand, rail, head, footer, children, dataMark, scrimMark, onClose }: PanelOverlayProps) {
  const panelRef = useRef<HTMLElement>(null);
  // Where focus stood before the panel opened — given back on close unless the open was a pointer's.
  const restoreRef = useRef<HTMLElement | null>(null);
  // The overlay's life in the DOM outlives the open standing: `mounted` keeps it through the exit
  // transition, `entered` is the standing the CSS transitions chase.
  const [mounted, setMounted] = useState(open);
  const entered = usePaintedFlip(mounted && open);

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (restoreRef.current !== null) {
      if (focusRestoredOnClose(origin)) restoreRef.current.focus();
      else restoreRef.current.blur();
      restoreRef.current = null;
    }
    // The origin is read only on the close that follows the open that stamped it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus moves in once the overlay is in the DOM — unless a field inside already took it.
  useEffect(() => {
    const panel = panelRef.current;
    if (open && mounted && panel !== null && !panel.contains(document.activeElement)) panel.focus();
  }, [open, mounted]);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Safety net for the exit: if the end event never comes, the overlay still leaves the DOM.
  useEffect(() => {
    if (!mounted || open) return;
    const timer = window.setTimeout(() => setMounted(false), MOTION.close.panelMs + MOTION.close.backdropDelayMs + 120);
    return () => window.clearTimeout(timer);
  }, [mounted, open]);

  if (!mounted) return null;

  /** Traps Tab inside the panel, wrapping both ways. */
  const trapTab = (event: React.KeyboardEvent<HTMLElement>): void => {
    event.preventDefault();
    const panel = panelRef.current;
    if (panel === null) return;
    const stops = [...panel.querySelectorAll<HTMLElement>('input, button:not([disabled]), select, textarea, [tabindex="0"]')];
    if (stops.length === 0) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = active === null ? -1 : stops.indexOf(active);
    const next =
      current === -1
        ? stops[event.shiftKey ? stops.length - 1 : 0]
        : stops[(current + (event.shiftKey ? -1 : 1) + stops.length) % stops.length];
    next?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      trapTab(event);
    }
  };

  return (
    <div
      {...{ [scrimMark]: '' }}
      style={MOTION_STYLE}
      // A press that begins on the scrim itself (never on the panel it wraps) closes.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onTransitionEnd={(event) => {
        // The scrim's own fade ends last on close — the moment the overlay's life in the DOM is over.
        if (!open && event.target === event.currentTarget && event.propertyName === 'opacity') setMounted(false);
      }}
      className={[
        // Definite grid tracks, so the window's max-height clamp binds at the minimum window.
        'fixed inset-0 z-40 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center bg-bg/60 p-8',
        'transition-[opacity,backdrop-filter] [transition-timing-function:var(--motion-ease)]',
        entered
          ? 'opacity-100 backdrop-blur-md duration-[var(--motion-open-backdrop)]'
          : 'opacity-0 backdrop-blur-[0px] duration-[var(--motion-close)] delay-[var(--motion-close-backdrop-delay)]',
        'motion-reduce:transition-[opacity] motion-reduce:duration-[var(--motion-reduced)] motion-reduce:delay-0',
      ].join(' ')}
    >
      <WindowFrame
        frameRef={panelRef}
        label={label}
        brand={brand}
        rail={rail}
        head={head}
        footer={footer}
        onKeyDown={onKeyDown}
        dataMark={dataMark}
        className={[
          'transition-[opacity,translate,scale] [transition-timing-function:var(--motion-ease)]',
          entered
            ? 'opacity-100 translate-y-0 scale-100 duration-[var(--motion-open-panel)] delay-[var(--motion-open-panel-delay)]'
            : 'opacity-0 translate-y-[var(--motion-open-rise)] scale-[var(--motion-open-scale)] duration-[var(--motion-close)]',
          'motion-reduce:transition-[opacity] motion-reduce:duration-[var(--motion-reduced)] motion-reduce:delay-0 motion-reduce:translate-y-0 motion-reduce:scale-100',
        ].join(' ')}
      >
        {children}
      </WindowFrame>
    </div>
  );
}
