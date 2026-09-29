// screens/shell.tsx — the app shell (U-10's window): on darwin a 40px drag bar runs across the
// top above everything (the native title strip is hidden there; the bar carries the traffic
// lights' lane, the signal accent and the wordmark), then a fixed 240px sidebar that is always
// open — the search field (⌘K focuses it), the Kokpit entry with the attention badge, the
// project → repo tree, the accounts frame (its own disclosure) and the foot's settings control —
// next to the content area that mounts the cockpit, a repo's board, a project's roadmap, a work
// order's detail, an account's view, or the settings. The detail and the account view open in
// place of the screen they were reached from (U-19): ‹ Geri returns to that screen with its
// scroll where the operator left it. The first-run wizard rides above it all as an overlay: the
// shell mounts it, the wizard store's `open` decides whether it shows at all (U-7). The badge
// mirrors the shell store: the cockpit's attention count, present only while attention exists —
// zero renders nothing, never a zero (U-10). Every user-visible string arrives through a label
// key (U-1).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { SidebarAccounts } from '../components/sidebar-accounts';
import { SidebarTree } from '../components/sidebar-tree';
import { TitleBar } from '../components/title-bar';
import { t, type Locale } from '../labels/t';
import type { AccountsFrameStore } from '../stores/accounts-frame';
import type { AccountViewStore } from '../stores/account-view';
import type { BoardStore } from '../stores/board';
import type { CockpitStore } from '../stores/cockpit';
import type { LocaleStore } from '../stores/locale';
import { treeSelection, type ProjectTreeStore, type TreePlace } from '../stores/project-tree';
import type { RoadmapStore } from '../stores/roadmap';
import type { SettingsStore } from '../stores/settings';
import type { ShellStore } from '../stores/shell';
import type { WizardStore } from '../stores/wizard';
import type { WorkOrderDetailStore } from '../stores/work-order-detail';
import { AccountViewScreen } from './account-view';
import { BoardScreen } from './board';
import { CockpitScreen } from './cockpit';
import { WorkOrderDetailScreen } from './detail';
import { RoadmapScreen } from './roadmap';
import { SettingsScreen } from './settings';
import { WizardScreen } from './wizard';

export interface ShellScreenProps {
  readonly shell: ShellStore;
  readonly tree: ProjectTreeStore;
  readonly accounts: AccountsFrameStore;
  readonly cockpit: CockpitStore;
  readonly board: BoardStore;
  readonly roadmap: RoadmapStore;
  readonly detail: WorkOrderDetailStore;
  readonly accountView: AccountViewStore;
  readonly settings: SettingsStore;
  readonly wizard: WizardStore;
  /** The locale store's handle for the settings screen's language control (U-9); the active
   *  bundle itself travels as `locale`, refreshed by the root's subscription. */
  readonly localeStore: LocaleStore;
  readonly locale: Locale;
  /** The machine's zone, for the account view's reset times; tests pass 'UTC'. */
  readonly timeZone: string;
}

/** Where the shell can be. Routes carry only ids; the screens load their own data. The roadmap
 *  route is the project row's and the board header's target; the page itself is its own screen. */
type ShellRoute =
  | { readonly name: 'cockpit' }
  | { readonly name: 'board'; readonly repo: string }
  | { readonly name: 'roadmap'; readonly project: string }
  | { readonly name: 'workOrder'; readonly id: string }
  | { readonly name: 'account'; readonly id: string }
  | { readonly name: 'settings' };

/** The label the detail's back row carries — it names the screen the detail was opened from
 *  (U-19). */
type BackKind = 'detail.back.board' | 'detail.back.cockpit' | 'detail.back.account' | 'detail.back.roadmap';

const NAV_BASE =
  'flex h-[34px] w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors';

/** The nav entry's standing: the current route reads raised with an inset signal bar, the rest
 *  stay quiet — the same grammar as the design's sidebar. */
const navClass = (current: boolean): string =>
  current
    ? `${NAV_BASE} bg-raised shadow-[inset_2px_0_0_0] shadow-signal text-ink`
    : `${NAV_BASE} text-ink hover:bg-raised`;

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-3.5 w-3.5 flex-none">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="block h-[15px] w-[15px]">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

/** The route as the tree reads it — a work order's detail and an account view keep the place
 *  they were opened from, so the tree's selection stays where the operator left it. */
const placeOf = (route: ShellRoute): TreePlace => {
  switch (route.name) {
    case 'cockpit':
      return { kind: 'cockpit' };
    case 'settings':
      return { kind: 'settings' };
    case 'roadmap':
      return { kind: 'roadmap', project: route.project };
    case 'board':
      return { kind: 'repo', repo: route.repo };
    case 'account':
    case 'workOrder':
      return { kind: 'cockpit' };
  }
};

/** The back row's label for a detail opened from a route (U-19). */
const backKindOf = (route: ShellRoute): BackKind => {
  switch (route.name) {
    case 'board':
      return 'detail.back.board';
    case 'roadmap':
      return 'detail.back.roadmap';
    case 'account':
      return 'detail.back.account';
    default:
      return 'detail.back.cockpit';
  }
};

export function ShellScreen({
  shell,
  tree,
  accounts,
  cockpit,
  board,
  roadmap,
  detail,
  accountView,
  settings,
  wizard,
  localeStore,
  locale,
  timeZone,
}: ShellScreenProps) {
  const state = useSyncExternalStore(shell.subscribe, shell.state);
  const [route, setRoute] = useState<ShellRoute>({ name: 'cockpit' });
  // The place a work-order detail was opened from: the detail replaces the route but not the
  // tree's selection — the board that opened it stays selected, like the design's detay.
  const placeRef = useRef<TreePlace>({ kind: 'cockpit' });
  // The route a detail or an account view replaces (U-19): ‹ Geri returns to it.
  const backRouteRef = useRef<ShellRoute>({ name: 'cockpit' });
  // The board's scroll, kept for the return from a detail opened on it (U-19).
  const boardScrollRef = useRef(0);
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void shell.load();
  }, [shell]);
  useEffect(() => {
    if (route.name !== 'workOrder' && route.name !== 'account') placeRef.current = placeOf(route);
  }, [route]);
  // ⌘K (or Ctrl+K) puts the caret in the sidebar's search field (U-15).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The board keeps its scroll across a detail round-trip: leaving a board for a detail or an
  // account view stamps it, returning restores it once the board has painted again (U-19).
  const prevRouteRef = useRef<ShellRoute>(route);
  useEffect(() => {
    const prev = prevRouteRef.current;
    prevRouteRef.current = route;
    if (prev.name === 'board' && (route.name === 'workOrder' || route.name === 'account')) {
      boardScrollRef.current = mainRef.current?.scrollTop ?? 0;
      return undefined;
    }
    if (prev.name !== 'board' && route.name === 'board') {
      const restore = boardScrollRef.current;
      const frame = requestAnimationFrame(() => {
        if (mainRef.current !== null) mainRef.current.scrollTop = restore;
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [route]);

  const badge = state.badge;
  const treeState = useSyncExternalStore(tree.subscribe, tree.state);
  const accountsState = useSyncExternalStore(accounts.subscribe, accounts.state);
  const selection = treeSelection(
    treeState.tree,
    route.name === 'workOrder' || route.name === 'account' ? placeRef.current : placeOf(route),
  );

  /** Opens a work order in place of the current screen (U-19): the current route becomes the
   *  back row's target, the tree's selection stays where it was. */
  const openWorkOrder = (id: string): void => {
    backRouteRef.current = route.name === 'workOrder' ? backRouteRef.current : route;
    setRoute({ name: 'workOrder', id });
  };
  /** Opens an account view in place; the cockpit or account card is where it returns to. */
  const openAccount = (id: string): void => {
    backRouteRef.current = route;
    setRoute({ name: 'account', id });
  };

  // The board header's roadmap shortcut exists only for a single-repo project (U-15): the tree
  // knows which project owns the repo and how many repos it has.
  const roadmapProjectOf = (repo: string): string | null => {
    const owner = treeState.tree.find((item) => item.repos.some((node) => node.repo === repo));
    return owner !== undefined && owner.repos.length === 1 ? owner.project : null;
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <TitleBar locale={locale} platform={navigator.platform} />
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] overflow-hidden">
        <nav
          aria-label={t(locale, 'shell.nav')}
          className="flex min-h-0 flex-col border-r border-hairline bg-surface px-2.5 pb-3 pt-3.5"
        >
          <div className="flex h-[30px] flex-none items-center gap-2 rounded-md border border-bord bg-raised px-2.5 text-xs text-inkdim focus-within:border-signal">
            <SearchIcon />
            <input
              ref={searchRef}
              type="text"
              aria-label={t(locale, 'shell.search.placeholder')}
              placeholder={t(locale, 'shell.search.placeholder')}
              className="h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-inkdim"
            />
            <span aria-hidden="true" className="flex-none font-mono text-[10.5px]">
              {t(locale, 'shell.search.kbd')}
            </span>
          </div>
  
          <div className="mt-2.5 flex flex-none flex-col gap-1">
            <button
              type="button"
              onClick={() => setRoute({ name: 'cockpit' })}
              className={navClass(route.name === 'cockpit')}
              aria-current={route.name === 'cockpit' ? 'page' : undefined}
            >
              <span>{t(locale, 'nav.cockpit')}</span>
              {badge !== null ? (
                <span
                  aria-label={t(locale, 'cockpit.section.attention')}
                  className="inline-flex h-[18px] min-w-5 flex-none items-center justify-center rounded-full border border-hairline px-1.5 font-mono text-[11px] text-inkdim"
                >
                  {badge.count}
                </span>
              ) : null}
            </button>
          </div>
  
          <SidebarTree
            store={tree}
            selection={selection}
            locale={locale}
            onOpenProject={(project) => setRoute({ name: 'roadmap', project })}
            onOpenRepo={(_project, repo) => setRoute({ name: 'board', repo })}
          />
  
          <SidebarAccounts
            store={accounts}
            locale={locale}
            activeAccountId={route.name === 'account' ? route.id : null}
            onOpenAccount={openAccount}
          />
  
          <div className="mt-2.5 flex flex-none items-center justify-end px-0.5">
            <button
              type="button"
              onClick={() => setRoute({ name: 'settings' })}
              aria-label={t(locale, 'nav.settings')}
              title={t(locale, 'nav.settings')}
              className={`grid h-8 w-8 flex-none place-items-center rounded-lg border border-bord ${
                route.name === 'settings' ? 'bg-raised text-ink' : 'text-inkdim hover:border-inkdim hover:text-ink'
              }`}
            >
              <GearIcon />
            </button>
          </div>
        </nav>
  
        <main ref={mainRef} className="@container min-w-0 overflow-y-auto px-[22px] py-[18px]">
          {route.name === 'cockpit' ? (
            <CockpitScreen
              store={cockpit}
              locale={locale}
              onOpenWorkOrder={openWorkOrder}
              onOpenProject={(project) => setRoute({ name: 'roadmap', project })}
              onOpenBoard={(repo) => setRoute({ name: 'board', repo })}
              accounts={accountsState.cards}
            />
          ) : null}
          {route.name === 'board' ? (
            <BoardScreen
              store={board}
              repo={route.repo}
              locale={locale}
              onOpenWorkOrder={openWorkOrder}
              roadmapProject={roadmapProjectOf(route.repo)}
              onOpenRoadmap={(project) => setRoute({ name: 'roadmap', project })}
              onOpenSettings={() => setRoute({ name: 'settings' })}
            />
          ) : null}
          {route.name === 'roadmap' ? (
            <RoadmapScreen
              store={roadmap}
              project={route.project}
              name={treeState.tree.find((item) => item.project === route.project)?.name ?? route.project}
              locale={locale}
              onOpenRepo={(repo) => setRoute({ name: 'board', repo })}
              onOpenWorkOrder={openWorkOrder}
            />
          ) : null}
          {route.name === 'account' ? (
            <AccountViewScreen
              store={accountView}
              accountId={route.id}
              locale={locale}
              timeZone={timeZone}
              onOpenWorkOrder={openWorkOrder}
              onOpenSettings={() => setRoute({ name: 'settings' })}
              onBack={() => setRoute(backRouteRef.current)}
            />
          ) : null}
          {route.name === 'workOrder' ? (
            <WorkOrderDetailScreen
              store={detail}
              workOrderId={route.id}
              locale={locale}
              backKey={backKindOf(backRouteRef.current)}
              onBack={() => setRoute(backRouteRef.current)}
            />
          ) : null}
          {route.name === 'settings' ? <SettingsScreen store={settings} locale={locale} localeStore={localeStore} /> : null}
        </main>
      </div>

      <WizardScreen store={wizard} locale={locale} />
    </div>
  );
}
