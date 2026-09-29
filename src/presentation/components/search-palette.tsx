// components/search-palette.tsx — the centered search palette (U-15): a modal panel in the
// middle of the window over a blurred, dimmed scrim. The palette searches the sidebar tree's
// names (projects and repos) and opens what a tree row opens — a project result the roadmap, a
// repo result the board. The open/close standing, the results and the keyboard's selection all
// live in the pure reducer (stores/search-palette.ts); this component adds only the DOM: the
// input takes focus on open, focus is trapped while open and returned to where it was on close,
// ↑/↓ walk the rows, Enter opens the selected one, Esc or a click on the scrim closes.
import { useEffect, useRef } from 'react';

import { t, type Locale } from '../labels/t';
import type { PaletteResult, PaletteState } from '../stores/search-palette';
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

/** A row's standing: the keyboard's row reads raised with the inset signal bar, the rest stay
 *  quiet — the same grammar as the sidebar's rows. */
const rowClass = (selected: boolean): string =>
  selected
    ? 'flex h-8 w-full items-center gap-2 rounded-md bg-raised px-2.5 text-left text-[13px] text-ink shadow-[inset_2px_0_0_0] shadow-signal'
    : 'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-ink hover:bg-raised';

export function SearchPalette({ state, locale, onQuery, onMove, onOpen, onClose }: SearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Where focus stood before the palette opened — the palette gives it back on close.
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (state.open) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      inputRef.current?.focus();
    } else {
      restoreRef.current?.focus();
      restoreRef.current = null;
    }
  }, [state.open]);

  // The keyboard's row must stay in view when the list outgrows its cap.
  useEffect(() => {
    if (!state.open) return;
    const options = panelRef.current?.querySelectorAll('[role="option"]');
    const option = options?.[state.selected];
    option?.scrollIntoView({ block: 'nearest' });
  }, [state.selected, state.open]);

  if (!state.open) return null;

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
      className="fixed inset-0 z-40 grid place-items-center bg-bg/60 p-6 backdrop-blur-md"
    >
      <section
        ref={panelRef}
        data-search-palette
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'palette.title')}
        onKeyDown={onKeyDown}
        className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-bord bg-surface shadow-2xl"
      >
        <div className="flex h-11 flex-none items-center gap-2.5 border-b border-hairline px-3.5 text-inkdim">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
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

        <div id={LIST_ID} role="listbox" aria-label={t(locale, 'palette.title')} className="max-h-[320px] overflow-y-auto p-1.5">
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
          {state.query.trim() !== '' && state.results.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-inkdim">{t(locale, 'palette.empty')}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
