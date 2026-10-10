// screens/library.tsx — the Artifact'lar library (U-84 … U-90): every page across the operator's
// projects as a card grid, with Turkish-aware search, a kind control, a project select, the
// Yeni / Sabitler switch, pinning and opening a card in the page viewer. The screen draws the
// operator-approved prototype (docket-tasarim/artifactlar, 2026-10-11) with the app's own
// components and tokens. A page's title and project name are untrusted text and enter the DOM only
// as React text nodes; the thumbnails are decorative faux lines, never a rendering of the page.
// All lengths are rem (U-53/U-62; the only px-like value is the 1 px hairline border), radii come
// from the three tokens, and every sized text line carries an explicit leading because Tailwind's
// preflight puts line-height 1.5 on the root. No class or string names a vendor.
import { useEffect, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react';

import type { PageLibraryItemView } from '../../api/queries';
import { ActionButton } from '../components/action-button';
import { formatAge } from '../components/cockpit-format';
import { SegmentedControl } from '../components/segmented-control';
import { Skeleton, SkeletonReveal, SkeletonStyle, useSkeleton } from '../components/skeleton';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import {
  LIBRARY_CAP,
  libraryKindOptions,
  libraryPhase,
  libraryProjectOptions,
  type LibraryKind,
  type LibraryStore,
  type LibraryView,
} from '../stores/library';
import { commandResultKey, failureKey } from '../stores/results';
import { toastOutcome } from '../stores/toasts';

export interface LibraryScreenProps {
  readonly store: LibraryStore;
  readonly locale: Locale;
  /** The clock the cards' ages read against; the shell re-renders as the stores publish. */
  readonly now: number;
  /** A card opens its page in the viewer (U-87); ‹ Geri there returns here. */
  readonly onOpenPage: (id: string) => void;
  /** The skeleton's anti-flicker clock; tests inject one, the app keeps the wall clock. */
  readonly skeletonNow?: () => number;
}

/** What a key press on a card does (U-87): Enter and Space open it, nothing else is claimed. */
export const cardKeyAction = (key: string): 'open' | null => (key === 'Enter' || key === ' ' ? 'open' : null);

const KIND_LABEL: Readonly<Record<LibraryKind, LabelKey>> = {
  all: 'library.kind.all',
  html: 'library.kind.html',
  diagram: 'library.kind.diagram',
  markdown: 'library.kind.markdown',
  table: 'library.kind.table',
  report: 'library.kind.report',
  image: 'library.kind.image',
};

const KIND_NAME: Readonly<Record<PageLibraryItemView['kind'], LabelKey>> = {
  html: 'page.kind.html',
  markdown: 'page.kind.markdown',
  diagram: 'page.kind.diagram',
  table: 'page.kind.table',
  image: 'page.kind.image',
  report: 'page.kind.report',
};

const PROVENANCE_LABEL: Readonly<Record<PageLibraryItemView['provenance'], LabelKey>> = {
  docket_ai: 'library.provenance.docket_ai',
  agent_run: 'library.provenance.agent_run',
  operator: 'library.provenance.operator',
};

/** A keyboard ring in rem: the global sheet sets none, so each control names its own. */
const FOCUS =
  'focus-visible:outline-solid focus-visible:outline-[0.125rem] focus-visible:outline-offset-[0.125rem] focus-visible:outline-signal-soft';

const fill = (text: string, values: Readonly<Record<string, string | number>>): string =>
  Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), text);

const CHIP = 'inline-flex h-5 flex-none items-center rounded-full border px-2 font-mono text-[0.6875rem] leading-none whitespace-nowrap';

/** The prototype's faux page: a few grey bars on a white zone. Decorative — the page itself is
 *  never drawn in Docket's DOM. */
function FauxPage() {
  return (
    <div data-library-faux="" aria-hidden="true" className="w-[70%]">
      <i className="my-1 block h-2.5 w-[60%] rounded-control bg-[#e5e5e0]" />
      <i className="my-1 block h-2.5 rounded-control bg-[#e5e5e0]" />
      <i className="my-1 block h-2.5 w-[80%] rounded-control bg-[#e5e5e0]" />
      <i className="my-1 block h-3.5 w-[40%] rounded-control bg-[#191917]" />
    </div>
  );
}

function ApprovalChip({ entry, locale }: { readonly entry: PageLibraryItemView; readonly locale: Locale }) {
  if (entry.approval === 'pending') {
    return <span className={`${CHIP} border-signal-soft text-signal-soft`}>{t(locale, 'page.approval.pending')}</span>;
  }
  if (entry.approval === 'approved') {
    return <span className={`${CHIP} border-proceed text-proceed`}>{t(locale, 'library.approval.approved')}</span>;
  }
  if (entry.approval === 'rejected') {
    return <span className={`${CHIP} border-error text-error`}>{t(locale, 'page.approval.rejected')}</span>;
  }
  return null;
}

/** "Project · İE-code", either half alone when the other is absent (a page of no work order). */
const whereOf = (entry: PageLibraryItemView): string =>
  [entry.project?.name, entry.workOrder?.code].filter((part): part is string => part !== undefined).join(' · ');

function LibraryCard({
  entry,
  locale,
  now,
  onOpen,
  onPin,
}: {
  readonly entry: PageLibraryItemView;
  readonly locale: Locale;
  readonly now: number;
  readonly onOpen: (id: string) => void;
  readonly onPin: (entry: PageLibraryItemView) => void;
}) {
  const where = whereOf(entry);
  const age = fill(t(locale, 'page.header.version'), { n: entry.latestVersion, age: formatAge(locale, Math.max(0, now - entry.updatedAt)) });
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    // A key pressed on the pin button belongs to the button, never to the card around it.
    if (event.target !== event.currentTarget) return;
    if (cardKeyAction(event.key) === 'open') {
      event.preventDefault();
      onOpen(entry.id);
    }
  };
  const pin = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onPin(entry);
  };
  return (
    <li className="min-w-0">
      <div
        role="button"
        tabIndex={0}
        data-library-card={entry.id}
        onClick={() => onOpen(entry.id)}
        onKeyDown={onKey}
        className={`grid h-full grid-rows-[auto_1fr] overflow-hidden rounded-card border border-hairline bg-surface text-left hover:border-bord hover:bg-band ${FOCUS}`}
      >
        <div
          data-library-thumb=""
          className={`relative grid h-[7.5rem] place-items-center overflow-hidden border-b border-hairline ${entry.kind === 'html' ? 'bg-white' : 'bg-band'}`}
        >
          {entry.kind === 'html' ? (
            <FauxPage />
          ) : (
            <span className="font-mono text-[0.6875rem] leading-none text-inkdim">{t(locale, KIND_NAME[entry.kind])}</span>
          )}
          <button
            type="button"
            data-library-pin=""
            aria-pressed={entry.pinned}
            aria-label={t(locale, entry.pinned ? 'library.unpin' : 'library.pin')}
            onClick={pin}
            onKeyDown={(event) => event.stopPropagation()}
            className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-control bg-surface/80 text-[0.875rem] leading-none hover:text-ink ${entry.pinned ? 'text-signal-soft' : 'text-inkdim'} ${FOCUS}`}
          >
            {entry.pinned ? '★' : '☆'}
          </button>
        </div>
        <div className="grid content-start gap-1 px-4 py-3">
          <span data-library-row="title" className="block truncate text-[0.875rem] font-semibold leading-[1.25rem] text-ink" title={entry.title}>
            {entry.title}
          </span>
          <span data-library-row="where" className="flex h-5 items-center gap-2 text-[0.75rem] leading-[1rem] text-inkdim">
            <span className={`${CHIP} border-bord text-inkdim`}>{t(locale, KIND_NAME[entry.kind])}</span>
            <span className="min-w-0 truncate" title={where === '' ? undefined : where}>
              {where}
            </span>
          </span>
          <span data-library-row="age" className="flex h-5 items-center gap-2 text-[0.75rem] leading-[1rem] text-inkdim">
            <span className="min-w-0 truncate" title={age}>
              {age}
            </span>
            <ApprovalChip entry={entry} locale={locale} />
          </span>
          <span data-library-row="provenance" className="block h-4 truncate text-[0.75rem] leading-[1rem] text-inkdim">
            {t(locale, PROVENANCE_LABEL[entry.provenance])}
          </span>
        </div>
      </div>
    </li>
  );
}

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4';

/** The loading composition: the grid's own columns with cards whose blocks mirror the real card's
 *  rows, so the content's arrival moves nothing. */
function LibrarySkeleton({ locale }: { readonly locale: Locale }) {
  return (
    <div data-library-skeleton="" role="status" aria-label={t(locale, 'library.loading')} className={GRID}>
      <SkeletonStyle />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="grid grid-rows-[auto_1fr] overflow-hidden rounded-card border border-hairline bg-surface">
          <Skeleton radius="control" height="7.5rem" />
          <div className="grid content-start gap-1 px-4 py-3">
            <Skeleton radius="control" width="62%" height="1.25rem" />
            <Skeleton radius="control" width="48%" height="1.25rem" />
            <Skeleton radius="control" width="70%" height="1.25rem" />
            <Skeleton radius="control" width="40%" height="1rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LibraryScreen({ store, locale, now, onOpenPage, skeletonNow }: LibraryScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  // The screen opening starts the poll; leaving it stops it, and the filters stay for the return.
  useEffect(() => store.open(), [store]);
  const phase = libraryPhase(state);
  // Only a first load (no list yet) can show a skeleton, and only past its delay (U-26).
  const { skeleton, reveal } = useSkeleton(phase === 'loading', skeletonNow ?? (() => Date.now()));

  const pin = (entry: PageLibraryItemView): void => {
    const next = !entry.pinned;
    void store.pin(entry.id, next).then((result) => {
      // The toast tells what the api confirmed: a refusal has already rolled the card back.
      toastOutcome(locale, {
        result,
        labelKey: result.ok ? (next ? 'library.toast.pinned' : 'library.toast.unpinned') : commandResultKey('page.pin', result),
      });
    });
  };

  const kinds = libraryKindOptions(state.all, state.filters.kind);
  const projects = libraryProjectOptions(state.all);
  const views: readonly LibraryView[] = ['new', 'pinned'];

  return (
    <div data-library-screen="" className="grid gap-4">
      <header>
        <h1 className="text-[1.25rem] font-bold leading-[1.75rem] tracking-[-0.01em] text-ink">{t(locale, 'nav.library')}</h1>
      </header>

      <div data-library-bar="" className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          data-library-search=""
          value={state.filters.q}
          placeholder={t(locale, 'library.search.placeholder')}
          aria-label={t(locale, 'library.search.placeholder')}
          onChange={(event) => store.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && state.filters.q !== '') {
              event.preventDefault();
              store.clearQuery();
            }
          }}
          className={`h-8 min-w-[14rem] flex-1 rounded-control border border-bord bg-raised px-3 text-[0.8125rem] leading-[1.25rem] text-ink placeholder:text-inkdim ${FOCUS}`}
        />
        <span data-library-kind="">
          <SegmentedControl
            label={t(locale, 'library.kind.label')}
            value={state.filters.kind}
            options={kinds.map((kind) => ({ id: kind, text: t(locale, KIND_LABEL[kind]) }))}
            onPick={(kind) => store.setKind(kind)}
          />
        </span>
        <select
          data-library-project=""
          aria-label={t(locale, 'library.project.label')}
          value={state.filters.project}
          onChange={(event) => store.setProject(event.target.value)}
          className={`h-8 rounded-control border border-bord bg-raised px-3 text-[0.8125rem] leading-[1.25rem] text-ink ${FOCUS}`}
        >
          <option value="">{t(locale, 'library.project.all')}</option>
          {projects.map((project) => (
            <option key={project.slug} value={project.slug}>
              {project.name}
            </option>
          ))}
        </select>
        <span data-library-view="">
          <SegmentedControl
            label={t(locale, 'library.view.label')}
            value={state.filters.view}
            options={views.map((view) => ({ id: view, text: t(locale, view === 'new' ? 'library.view.new' : 'library.view.pinned') }))}
            onPick={(view) => store.setView(view)}
          />
        </span>
      </div>

      {phase === 'loading' && skeleton ? <LibrarySkeleton locale={locale} /> : null}

      {phase === 'error' ? (
        <div
          role="alert"
          data-library-error=""
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-error/55 bg-surface px-4 py-3"
        >
          <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-error" />
          <p className="grid min-w-0 gap-1 text-[0.8125rem] leading-[1.25rem] text-ink">
            {t(locale, 'library.error.title')}
            <small className="text-[0.75rem] leading-[1rem] text-inkdim">{state.failed === null ? '' : t(locale, failureKey(state.failed))}</small>
          </p>
          <span className="ml-auto">
            <ActionButton variant="neutral" onClick={() => void store.retry()}>
              {t(locale, 'action.retry')}
            </ActionButton>
          </span>
        </div>
      ) : null}

      {phase === 'empty' || phase === 'filtered-empty' ? (
        <div
          data-library-empty={phase}
          className="rounded-card border border-dashed border-bord px-4 py-8 text-center text-[0.875rem] leading-[1.25rem] text-inkdim"
        >
          <b className="mb-1 block font-semibold text-ink">{t(locale, phase === 'empty' ? 'library.empty.title' : 'library.filtered.title')}</b>
          {t(locale, phase === 'empty' ? 'library.empty.body' : 'library.filtered.body')}
        </div>
      ) : null}

      {phase === 'ready' ? (
        <SkeletonReveal active={reveal}>
          <ul role="list" data-library-grid="" aria-label={t(locale, 'library.region')} className={GRID}>
            {state.items.map((entry) => (
              <LibraryCard key={entry.id} entry={entry} locale={locale} now={now} onOpen={onOpenPage} onPin={pin} />
            ))}
          </ul>
          {state.capped ? (
            <p data-library-cap="" className="mt-4 text-[0.75rem] leading-[1rem] text-inkdim">
              {fill(t(locale, 'library.cap'), { n: LIBRARY_CAP })}
            </p>
          ) : null}
        </SkeletonReveal>
      ) : null}
    </div>
  );
}
