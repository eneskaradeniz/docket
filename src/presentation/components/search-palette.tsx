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
// only once text is typed, and folds away when it is cleared — unless the palette remembers
// searches: then the empty query lists them under a "Son aramalar" header, a row's choice fills
// the input and runs the query at once, a row's × walks that entry out, and Temizle empties the
// list into the same row-exit motion. A query is remembered only when a result is opened; the
// list itself is the pure history module's, persisted per viewer in local storage.
// The results settle behind a debounce: the input's text updates on every keystroke, but the
// rows recompute only after the last one has had its beat, so typing narrows the list in one
// step instead of flashing through every intermediate standing. The first typed character
// settles at once — with nothing settled yet there is no previous list to protect. Settling is
// a keyed row diff — rows that stay keep their place, rows that leave fold away, rows that
// arrive rise in — and the keyboard's highlight follows the rows on screen, never the ones
// still being computed. The no-results line belongs to its settled query alone: while a query
// is still settling the body keeps its standing, so typing never flashes "no results".
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { t, type Locale } from '../labels/t';
import {
  clearSearches,
  diffRows,
  EMPTY_HISTORY,
  focusRestoredOnClose,
  paletteBody,
  paletteRowId,
  readSearchHistory,
  recordSearch,
  removeSearch,
  settlesAtOnce,
  writeSearchHistory,
  type PaletteResult,
  type PaletteState,
  type SearchHistory,
} from '../stores/search-palette';
import { ACTIVE_CLASS } from './active-state';
import { MOTION, motionVars } from './motion';
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
const historyOptionId = (index: number): string => `docket-palette-history-${index}`;

/** A remembered query's clock — the history rows' own glyph, the shell icons' stroke grammar. */
const ClockIcon = () => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-3.5 w-3.5 flex-none text-inkdim"
  >
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5.2v2.9l2 1.4" />
  </svg>
);

/** The × beside a history row: quiet until the row is hovered or holds focus, quick once it
 *  shows — the highlight's own pace. */
const HISTORY_REMOVE_CLASS = [
  'grid h-6 w-6 flex-none place-items-center rounded-control text-[13px] leading-none text-inkdim',
  'opacity-0 transition-opacity duration-[var(--motion-highlight)] group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-ink motion-reduce:transition-none',
].join(' ');

// The motion numbers as custom properties on the overlay's root — the classes below consume
// them, the constants above own them.
const MOTION_STYLE = motionVars();

const EMPTY_ROWS: readonly PaletteResult[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set<string>();
const EMPTY_RANKS: ReadonlyMap<string, number> = new Map<string, number>();

/** A row's life between two settled lists: it arrives, it stays, or it walks out. */
type RowStanding = 'entering' | 'staying' | 'leaving';

// The row's fold is its own leg — leaving rows close it, arriving rows open it — while the
// body's 0fr → 1fr track keeps covering the fold between "nothing typed" and "something typed".
const ROW_FOLD =
  'grid transition-[grid-template-rows] duration-[var(--motion-row-exit)] delay-[var(--row-delay)] [transition-timing-function:var(--motion-ease)] motion-reduce:transition-none';

// The row's paints ride one transition list: the fade and the rise at the results' own pace,
// the highlight's ground at its shorter one. Reduced motion keeps the fade only, flat and fast.
const ROW_PAINT =
  'transition-[opacity,translate,background-color,border-color] [transition-timing-function:var(--motion-ease)] delay-[var(--row-delay)] motion-reduce:transition-[opacity] motion-reduce:duration-[var(--motion-reduced)] motion-reduce:delay-0 motion-reduce:translate-y-0';

/** Entering rows rise one after another — the first six only; the rest arrive with the sixth. */
const staggerDelay = (rank: number): string =>
  `${Math.min(rank, MOTION.results.staggerRows - 1) * MOTION.results.staggerMs}ms`;

/** A row's paint: the keyboard's row carries the one active-state language, the rest stay quiet
 *  — the same grammar as the sidebar's rows, over a border every row reserves so the highlight
 *  never shifts the row's geometry when it lands. */
const rowClass = (selected: boolean, standing: RowStanding, hidden: boolean): string =>
  [
    selected
      ? `flex h-8 w-full items-center gap-2 rounded-control px-2.5 text-left text-[13px] text-ink ${ACTIVE_CLASS}`
      : 'flex h-8 w-full items-center gap-2 rounded-control border border-transparent px-2.5 text-left text-[13px] text-ink hover:bg-raised',
    ROW_PAINT,
    standing === 'leaving' ? 'duration-[var(--motion-row-exit)]' : 'duration-[var(--motion-results-fade)]',
    // A row that leaves only fades and folds — it does not rise on the way out.
    hidden ? 'opacity-0 translate-y-[var(--motion-row-rise)]' : 'opacity-100 translate-y-0',
  ].join(' ');

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

export function SearchPalette({ state, locale, onQuery, onMove, onOpen, onClose }: SearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Where focus stood before the palette opened — the palette gives it back on close, unless the
  // open was a pointer's: the reducer's origin decision (focusRestoredOnClose) settles that.
  const restoreRef = useRef<HTMLElement | null>(null);
  // The rows the palette is actually showing — the settled list, which lags the query by the
  // debounce, and the query that list answers (the body's keep decision reads it). Ghosts are
  // rows walking out; ranks stagger the rows walking in, and the hidden set holds the arriving
  // rows until their start state has painted.
  const [settled, setSettled] = useState<readonly PaletteResult[]>(EMPTY_ROWS);
  const [settledQuery, setSettledQuery] = useState('');
  const [ghosts, setGhosts] = useState<readonly PaletteResult[]>(EMPTY_ROWS);
  const [enteringRanks, setEnteringRanks] = useState<ReadonlyMap<string, number>>(EMPTY_RANKS);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(EMPTY_IDS);
  // The keyboard's row over the rows on screen. While the settled list is the live one this is
  // simply the reducer's selection; the ref freezes the last live row for the wait, so typing
  // does not yank the highlight before the new list lands.
  const liveSelectedRef = useRef(0);
  // Ghosts leave the DOM once their exit has surely ended; a new settle re-arms the timer.
  const ghostTimerRef = useRef(0);

  // The palette's own memory: the recent queries, most recent first, read once from the
  // operator's storage and rewritten on every change (the pure module owns every rule and every
  // tolerance). Rows the × or Temizle walks out become history ghosts; the keyboard's row over
  // the history lives here too — the query being empty, the reducer's own selection has nothing
  // to stand on.
  const [history, setHistory] = useState<SearchHistory>(() => readSearchHistory(window.localStorage));
  const [historySelected, setHistorySelected] = useState(0);
  const [historyGhosts, setHistoryGhosts] = useState<SearchHistory>(EMPTY_HISTORY);
  const historyGhostTimerRef = useRef(0);

  // The list follows the operator between sessions; the tolerant parse's normalization writes
  // back on mount, so a repaired value heals storage without anyone asking for it.
  useEffect(() => {
    writeSearchHistory(window.localStorage, history);
  }, [history]);

  // The overlay's life in the DOM outlives the open standing: `mounted` keeps it in the tree
  // through the exit transition, `entered` is the standing the CSS transitions chase. Mount
  // hidden, flip only after the hidden frame is painted — the browser needs a start state to
  // animate from.
  const [mounted, setMounted] = useState(state.open);
  const entered = usePaintedFlip(mounted && state.open);

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
    }
  }, [state.open]);

  // Safety net for the exit: if the end event never comes (transitions off elsewhere), the
  // overlay still leaves the DOM — after the longest close, so a real transition always wins.
  useEffect(() => {
    if (!mounted || state.open) return;
    const timer = window.setTimeout(() => setMounted(false), 400);
    return () => window.clearTimeout(timer);
  }, [mounted, state.open]);

  // The settling itself. The input never waits; the rows recompute only once the last
  // keystroke is 120ms behind, so fast typing reshapes the list once instead of per key —
  // except the first typed character, which settles at once (settlesAtOnce: with nothing
  // settled yet the debounce has nothing to protect). An emptied input (or a closed palette)
  // settles at once too — the body folds away on the clear, and nothing waits for a debounce
  // that has nothing to show.
  useEffect(() => {
    if (!state.open || state.query.trim() === '') {
      setSettled(EMPTY_ROWS);
      setSettledQuery('');
      setGhosts(EMPTY_ROWS);
      setEnteringRanks(EMPTY_RANKS);
      setHiddenIds(EMPTY_IDS);
      window.clearTimeout(ghostTimerRef.current);
      return;
    }
    // The settled list already is the live one — nothing to compute, and no timer to keep.
    if (settled === state.results) return;
    const timer = window.setTimeout(() => {
      const diff = diffRows(settled, state.results);
      setSettled(state.results);
      setSettledQuery(state.query);
      const nextIds = new Set(state.results.map(paletteRowId));
      setGhosts((current) => [
        ...current.filter((row) => !nextIds.has(paletteRowId(row))),
        ...diff.leaving,
      ]);
      window.clearTimeout(ghostTimerRef.current);
      ghostTimerRef.current = window.setTimeout(() => setGhosts(EMPTY_ROWS), MOTION.results.rowExitRemoveMs);
      const ranks = new Map<string, number>();
      diff.entering.forEach((row, rank) => ranks.set(paletteRowId(row), rank));
      setEnteringRanks(ranks);
      setHiddenIds(new Set(ranks.keys()));
    }, settlesAtOnce(settledQuery) ? 0 : MOTION.results.debounceMs);
    return () => window.clearTimeout(timer);
  }, [state.open, state.query, state.results, settled, settledQuery]);

  // Arriving rows mount folded and hidden; the flip waits for a painted frame so their rise
  // has a start state to chase — the same double frame the palette's own open rides.
  useEffect(() => {
    if (hiddenIds.size === 0) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setHiddenIds(EMPTY_IDS));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [hiddenIds]);

  const live = settled === state.results;
  const selection = live ? state.selected : liveSelectedRef.current;

  // The ref mirrors the keyboard's row only while the settled list is the live one — during
  // the wait it holds the row the operator last stood on, which is the row still on screen.
  useEffect(() => {
    if (live) liveSelectedRef.current = state.selected;
  }, [live, state.selected]);

  // Ghosts must never outlive the palette's own DOM — a stray timer fires into nothing.
  useEffect(() => () => window.clearTimeout(ghostTimerRef.current), []);
  // The same for the history's own ghosts; a new walk-out re-arms this timer.
  useEffect(() => () => window.clearTimeout(historyGhostTimerRef.current), []);

  // Each open starts its keyboard on the first history row — the recorded list itself survives
  // the close, only the standing row resets.
  useEffect(() => {
    if (state.open) setHistorySelected(0);
  }, [state.open]);

  // History ghosts belong to the history standing alone: typing switches the body to results,
  // and a row still folding out beneath arriving results would belong to neither list.
  useEffect(() => {
    if (state.query.trim() !== '') setHistoryGhosts(EMPTY_HISTORY);
  }, [state.query]);

  const body = paletteBody(state.query, settledQuery, settled.length);
  // The history standing: an empty query over a non-empty list. Its header outlives the rows
  // for as long as ghosts are still walking out, so Temizle keeps its label while the body
  // folds shut beneath it.
  const historyVisible = state.query.trim() === '' && history.length > 0;
  const historyHead = historyVisible || historyGhosts.length > 0;
  // The history rows rise in as one arrival — hidden until a painted frame, staggered by rank,
  // exactly the grammar the results rows enter with.
  const historyEntered = usePaintedFlip(historyVisible);
  // The keyboard's row over the history, clamped to a list the × may have shortened.
  const historyIndex = history.length === 0 ? 0 : Math.min(historySelected, history.length - 1);

  // The first typed character over an empty settled query lands within a tick (settlesAtOnce):
  // holding the body's standing across that tick keeps an open history from folding and
  // reopening when one of its rows is chosen, and lets a collapsed body start growing with the
  // first character itself.
  const firstCharacterInFlight =
    state.query.trim() !== '' && state.query !== settledQuery && settlesAtOnce(settledQuery);
  // `keep` holds the current standing through a settle: the settled rows stay on screen, and a
  // folded body (or one showing the line of a query it no longer answers) stays folded.
  const hasBody =
    historyHead ||
    firstCharacterInFlight ||
    (body === 'keep' ? settled.length > 0 : body !== 'none');

  // The keyboard's row must stay in view when the list outgrows its cap — over the history
  // while it stands, over the results otherwise.
  useEffect(() => {
    if (!state.open) return;
    const options = panelRef.current?.querySelectorAll('[role="option"]');
    const option = options?.[historyVisible ? historyIndex : selection];
    option?.scrollIntoView({ block: 'nearest' });
  }, [historyVisible, historyIndex, selection, state.open]);

  if (!mounted) return null;

  /** Ghost history rows leave the DOM past their exit's end — the fold always finishes first. */
  const armHistoryGhostTimer = (): void => {
    window.clearTimeout(historyGhostTimerRef.current);
    historyGhostTimerRef.current = window.setTimeout(() => setHistoryGhosts(EMPTY_HISTORY), MOTION.results.rowExitRemoveMs);
  };

  /** A history row's choice is a query, not an opening: the text lands in the input and runs at
   *  once (nothing was settled, so the first-character rule skips the debounce), and the
   *  keyboard stays in the input. */
  const chooseFromHistory = (entry: string): void => {
    onQuery(entry);
    inputRef.current?.focus();
  };

  /** The × beside a row: the entry leaves at once, its row walks out with the exit motion, and
   *  the keyboard's row returns home — focus never leaves the input's neighbourhood. */
  const removeEntry = (entry: string): void => {
    setHistory((current) => removeSearch(current, entry));
    setHistoryGhosts((current) => [...current, entry]);
    armHistoryGhostTimer();
    setHistorySelected(0);
    inputRef.current?.focus();
  };

  /** Temizle: every row walks out with the row-exit motion and the body then collapses to the
   *  input alone — no confirmation, the stakes are ten old queries. Focus stays in the input. */
  const clearHistory = (): void => {
    if (history.length > 0) {
      setHistoryGhosts((current) => [...history, ...current]);
      setHistory(clearSearches());
      setHistorySelected(0);
      armHistoryGhostTimer();
    }
    inputRef.current?.focus();
  };

  /** Opening a result is the one moment a query is remembered — the opening records it, never
   *  the typing; too short a query records nothing at all. */
  const openResult = (result: PaletteResult): void => {
    setHistory((current) => recordSearch(current, state.query));
    onOpen(result);
  };

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
      // The walk means nothing over a list that is about to be replaced — during the wait the
      // keys would move over rows nobody can see. Over the history the walk is always live:
      // its rows never settle, they stand.
      if (historyVisible) setHistorySelected((current) => (current + 1 + history.length) % history.length);
      else if (live) onMove(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (historyVisible) setHistorySelected((current) => (current - 1 + history.length) % history.length);
      else if (live) onMove(-1);
    } else if (event.key === 'Enter') {
      // Preventing the default keeps a focused row from firing its own click on top of this.
      // Over the history Enter runs the highlighted query; over results it opens the row on
      // screen, not the one still being computed.
      event.preventDefault();
      if (historyVisible) {
        const entry = history[historyIndex];
        if (entry !== undefined) chooseFromHistory(entry);
        return;
      }
      const chosen = settled[selection];
      if (chosen !== undefined) openResult(chosen);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      trapTab(event);
    }
  };

  /** One row in the settled list — folded while it arrives or leaves, open once it stands. */
  const renderRow = (result: PaletteResult, index: number, standing: RowStanding): React.ReactNode => {
    const id = paletteRowId(result);
    const rank = enteringRanks.get(id);
    const hidden = hiddenIds.has(id);
    const open = !hidden && standing !== 'leaving';
    // Ghosts sit below the settled rows and never take the highlight with them.
    const selected = standing !== 'leaving' && index === selection;
    const rowStyle: CSSProperties | undefined =
      standing === 'entering' && rank !== undefined ? ({ '--row-delay': staggerDelay(rank) } as CSSProperties) : undefined;
    return (
      <div key={id} className={[ROW_FOLD, open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'].join(' ')} style={rowStyle}>
        <div className="min-h-0 overflow-hidden">
          <button
            type="button"
            id={optionId(index)}
            role="option"
            aria-selected={selected}
            onClick={() => openResult(result)}
            className={rowClass(selected, standing, hidden)}
          >
            <span title={result.name} className="min-w-0 flex-1 truncate">
              {result.name}
            </span>
            <span className="flex-none font-mono text-[10.5px] uppercase tracking-[0.08em] text-inkdim">
              {t(locale, result.kind === 'project' ? 'palette.kind.project' : 'palette.kind.repo')}
            </span>
          </button>
        </div>
      </div>
    );
  };

  /** One remembered query: the results rows' own life and paint, its clock beside the text and
   *  its × riding the same row — quiet until the row is hovered or holds focus. */
  const renderHistoryRow = (entry: string, index: number, standing: RowStanding): React.ReactNode => {
    const open = historyEntered && standing !== 'leaving';
    const selected = standing !== 'leaving' && index === historyIndex;
    const rowStyle: CSSProperties | undefined =
      standing === 'entering' ? ({ '--row-delay': staggerDelay(index) } as CSSProperties) : undefined;
    return (
      <div
        key={`${standing}:${entry}`}
        className={[ROW_FOLD, open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'].join(' ')}
        style={rowStyle}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="group flex items-center gap-1 pr-1">
            <button
              type="button"
              id={historyOptionId(index)}
              role="option"
              aria-selected={selected}
              onClick={() => chooseFromHistory(entry)}
              className={rowClass(selected, standing, !open)}
            >
              <ClockIcon />
              <span title={entry} className="min-w-0 flex-1 truncate">
                {entry}
              </span>
            </button>
            <button
              type="button"
              aria-label={t(locale, 'palette.history.remove')}
              onClick={() => removeEntry(entry)}
              className={HISTORY_REMOVE_CLASS}
            >
              ×
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      data-search-scrim
      style={MOTION_STYLE}
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
        'transition-[opacity,backdrop-filter] [transition-timing-function:var(--motion-ease)]',
        entered
          ? 'opacity-100 backdrop-blur-md duration-[var(--motion-open-backdrop)]'
          : 'opacity-0 backdrop-blur-[0px] duration-[var(--motion-close)] delay-[var(--motion-close-backdrop-delay)]',
        // Reduced motion: a quick fade, no blur travel.
        'motion-reduce:transition-[opacity] motion-reduce:duration-[var(--motion-reduced)] motion-reduce:delay-0',
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
          'flex w-full max-w-[560px] flex-col overflow-hidden rounded-panel border border-bord bg-surface shadow-2xl',
          'transition-[opacity,translate,scale] [transition-timing-function:var(--motion-ease)]',
          entered
            ? 'opacity-100 translate-y-0 scale-100 duration-[var(--motion-open-panel)] delay-[var(--motion-open-panel-delay)]'
            : 'opacity-0 translate-y-[var(--motion-open-rise)] scale-[var(--motion-open-scale)] duration-[var(--motion-close)]',
          // Reduced motion: a quick fade, the panel rises and scales not at all.
          'motion-reduce:transition-[opacity] motion-reduce:duration-[var(--motion-reduced)] motion-reduce:delay-0 motion-reduce:translate-y-0 motion-reduce:scale-100',
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
            aria-activedescendant={
              historyVisible
                ? historyOptionId(historyIndex)
                : settled.length > 0
                  ? optionId(selection)
                  : undefined
            }
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
            typed and cleared character, and a collapsed track leaves no padding under the input.
            Inside, the rows' own folds carry every later reshape — the height follows the rows,
            so a narrowed list glides shut instead of snapping to size. */}
        <div
          data-search-body
          className={[
            'grid transition-[grid-template-rows] duration-[var(--motion-results)] [transition-timing-function:var(--motion-ease)]',
            'motion-reduce:transition-none',
            hasBody ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          ].join(' ')}
        >
          <div className="min-h-0 overflow-hidden">
            {/* The history's own head: the label on the left, Temizle on the right — kept
                through the walk-out so the fading rows keep their heading until the body
                closes over them. */}
            {historyHead ? (
              <div data-search-history className="flex items-center justify-between px-2.5 pb-0.5 pt-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-inkdim">
                  {t(locale, 'palette.history.title')}
                </span>
                <button
                  type="button"
                  onClick={clearHistory}
                  className="py-0.5 text-[11px] text-inkdim transition-colors duration-[var(--motion-highlight)] hover:text-ink motion-reduce:transition-none"
                >
                  {t(locale, 'palette.history.clear')}
                </button>
              </div>
            ) : null}
            <div
              id={LIST_ID}
              role="listbox"
              aria-label={t(locale, 'palette.title')}
              className={[
                'p-1.5 transition-opacity duration-[var(--motion-results-fade)] [transition-timing-function:var(--motion-ease)] motion-reduce:duration-[var(--motion-reduced)]',
                hasBody ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
            >
              {historyHead ? (
                <>
                  {history.map((entry, index) => renderHistoryRow(entry, index, 'entering'))}
                  {historyGhosts.map((entry, index) => renderHistoryRow(entry, history.length + index, 'leaving'))}
                </>
              ) : (
                <>
                  {settled.map((result, index) =>
                    renderRow(result, index, enteringRanks.has(paletteRowId(result)) ? 'entering' : 'staying'),
                  )}
                  {ghosts.map((result, index) => renderRow(result, settled.length + index, 'leaving'))}
                  {body === 'no-results' ? (
                    <p className="px-2.5 py-2 text-xs text-inkdim">{t(locale, 'palette.empty')}</p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
