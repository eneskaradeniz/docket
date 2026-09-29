// components/search-palette.tsx — the centered search palette (U-15): a modal panel in the
// middle of the window over a blurred, dimmed scrim. The palette searches the sidebar tree's
// names (projects and repos) and opens what a tree row opens — a project result the roadmap, a
// repo result the board. The open/close standing, the results and the keyboard's selection all
// live in the pure reducer (stores/search-palette.ts); this component adds only the DOM: the
// input takes focus on open, focus is trapped while open, and on close the reducer's origin
// decision says whether focus returns to the opener or drops to the body — a pointer-opened
// palette must not leave its button wearing the keyboard's focus ring — ↑/↓ walk the rows,
// Enter opens the selected one, Esc or a click on the scrim closes.
// An empty query shows the input row alone — the body (rows or the no-results line) appears
// only once text is typed, and folds away when it is cleared.
import { useEffect, useRef, useState } from 'react';

import { t, type Locale } from '../labels/t';
import {
  focusRestoredOnClose,
  paletteBody,
  type PaletteResult,
  type PaletteState,
} from '../stores/search-palette';
import { ACTIVE_CLASS } from './active-state';
import { SearchIcon } from './title-bar';

export interface SearchPaletteProps {
  readonly state: PaletteState;
  readonly locale: Locale;
  /** Feeds the input's text to the reducer, which recomputes the results over the tree. */
  readonly onQuery: (value: string) => void;
  readonly onMove: (delta: -1 | 1) => void;
  /** Opens one result the way the tree's row does and closes the palette. */
  readonly onOpen: (result: PaletteResult) => void;
  readonly onClose: () => void;
}

const LIST_ID = 'docket-palette-options';
const optionId = (index: number): string => `docket-palette-option-${index}`;

/** A row's standing: the keyboard's row carries the one active-state language, the rest stay
 *  quiet — the same grammar as the sidebar's rows. */
const rowClass = (selected: boolean): string =>
  selected
    ? `flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-ink ${ACTIVE_CLASS}`
    : 'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-ink hover:bg-raised';

export function SearchPalette({ state, locale, onQuery, onMove, onOpen, onClose }: SearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Where focus stood before the palette opened — the palette gives it back on close, unless the
  // open was a pointer's: the reducer's origin decision (focusRestoredOnClose) settles that.
  const restoreRef = useRef<HTMLElement | null>(null);
  // The overlay's life in the DOM outlives the open standing: `mounted` keeps it in the tree
  // through the exit transition, `entered` is the standing the CSS transitions chase. Mount
  // hidden, flip only after the hidden frame is painted — the browser needs a start state to
  // animate from.
  const [mounted, setMounted] = useState(state.open);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (state.open) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (restoreRef.current !== null) {
      // A pointer-opened palette blurs its opener — focus falls to the body, and the button
      // keeps no keyboard-style ring it never earned.
      if (focusRestoredOnClose(state.origin)) restoreRef.current.focus();
      else restoreRef.current.blur();
      restoreRef.current = null;
    }
  }, [state.open]);

  // The input takes focus only once the overlay is in the DOM — `mounted` lags the open
  // standing by one render, so an effect on `state.open` alone would find an empty ref.
  useEffect(() => {
    if (state.open && mounted) inputRef.current?.focus();
  }, [state.open, mounted]);

  useEffect(() => {
    if (state.open) {
      setMounted(true);
    } else {
      setEntered(false);
    }
  }, [state.open]);

  useEffect(() => {
    if (!mounted || !state.open) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [mounted, state.open]);

  // Safety net for the exit: if the end event never comes (transitions off elsewhere), the
  // overlay still leaves the DOM — after the longest close, so a real transition always wins.
  useEffect(() => {
    if (!mounted || state.open) return;
    const timer = window.setTimeout(() => setMounted(false), 400);
    return () => window.clearTimeout(timer);
  }, [mounted, state.open]);

  const body = paletteBody(state.query, state.results.length);
  const hasBody = body !== 'none';

  // The keyboard's row must stay in view when the list outgrows its cap.
  useEffect(() => {
    if (!state.open) return;
    const options = panelRef.current?.querySelectorAll('[role="option"]');
    const option = options?.[state.selected];
    option?.scrollIntoView({ block: 'nearest' });
  }, [state.selected, state.open]);

  if (!mounted) return null;

  /** Traps Tab inside the panel: the input and the rows are the only stops, wrapping both ways. */
  const trapTab = (event: React.KeyboardEvent<HTMLElement>): void => {
    event.preventDefault();
    const panel = panelRef.current;
    if (panel === null) return;
    const stops = [...panel.querySelectorAll<HTMLElement>('input, button')];
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
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMove(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(-1);
    } else if (event.key === 'Enter') {
      // Preventing the default keeps a focused row from firing its own click on top of this.
      event.preventDefault();
      const result = state.results[state.selected];
      if (result !== undefined) onOpen(result);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      trapTab(event);
    }
  };

  return (
    <div
      data-search-scrim
      // A press that begins on the scrim itself (never on the panel it wraps) closes.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onTransitionEnd={(event) => {
        // The scrim's own fade ends last on close (the panel leaves first) — that is the
        // moment the overlay's life in the DOM is over.
        if (!state.open && event.target === event.currentTarget && event.propertyName === 'opacity') {
          setMounted(false);
        }
      }}
      className={[
        'fixed inset-0 z-40 grid place-items-center bg-bg/60 p-6',
        'transition-[opacity,backdrop-filter] ease-out',
        entered
          ? 'opacity-100 backdrop-blur-md duration-[200ms]'
          : 'opacity-0 backdrop-blur-[0px] duration-[140ms] delay-[40ms]',
        // Reduced motion: a quick fade, no blur travel.
        'motion-reduce:transition-[opacity] motion-reduce:duration-[80ms] motion-reduce:delay-0',
      ].join(' ')}
    >
      <section
        ref={panelRef}
        data-search-palette
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'palette.title')}
        onKeyDown={onKeyDown}
        className={[
          'flex w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-bord bg-surface shadow-2xl',
          'transition-[opacity,translate,scale] ease-out',
          entered
            ? 'opacity-100 translate-y-0 scale-100 duration-[220ms] delay-[40ms]'
            : 'opacity-0 translate-y-2 scale-[0.98] duration-[140ms]',
          // Reduced motion: a quick fade, the panel rises and scales not at all.
          'motion-reduce:transition-[opacity] motion-reduce:duration-[80ms] motion-reduce:delay-0 motion-reduce:translate-y-0 motion-reduce:scale-100',
        ].join(' ')}
      >
        <div
          className={[
            'flex h-11 flex-none items-center gap-2.5 px-3.5 text-inkdim',
            hasBody ? 'border-b border-hairline' : '',
          ].join(' ')}
        >
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={hasBody}
            aria-controls={LIST_ID}
            aria-activedescendant={state.results.length > 0 ? optionId(state.selected) : undefined}
            aria-label={t(locale, 'palette.placeholder')}
            placeholder={t(locale, 'palette.placeholder')}
            value={state.query}
            onChange={(event) => onQuery(event.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-inkdim"
          />
          <span aria-hidden="true" className="flex-none font-mono text-[10.5px]">
            {t(locale, 'palette.kbd.esc')}
          </span>
        </div>

        {/* The body's height rides a 0fr → 1fr grid track: it grows and folds with the first
            typed and cleared character, and a collapsed track leaves no padding under the input. */}
        <div
          data-search-body
          className={[
            'grid transition-[grid-template-rows] duration-[180ms] ease-out',
            'motion-reduce:transition-none',
            hasBody ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          ].join(' ')}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              id={LIST_ID}
              role="listbox"
              aria-label={t(locale, 'palette.title')}
              className={[
                'p-1.5 transition-opacity duration-[180ms] ease-out motion-reduce:duration-[80ms]',
                hasBody ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
            >
              {state.results.map((result, index) => (
                <button
                  key={`${result.kind}:${result.kind === 'project' ? result.project : result.repo}`}
                  type="button"
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === state.selected}
                  onClick={() => onOpen(result)}
                  className={rowClass(index === state.selected)}
                >
                  <span title={result.name} className="min-w-0 flex-1 truncate">
                    {result.name}
                  </span>
                  <span className="flex-none font-mono text-[10.5px] uppercase tracking-[0.08em] text-inkdim">
                    {t(locale, result.kind === 'project' ? 'palette.kind.project' : 'palette.kind.repo')}
                  </span>
                </button>
              ))}
              {body === 'no-results' ? (
                <p className="px-2.5 py-2 text-xs text-inkdim">{t(locale, 'palette.empty')}</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
