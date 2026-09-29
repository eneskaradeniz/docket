// screens/shell.tsx — the app shell (U-10's window): a fixed 240px sidebar that is always open —
// the search field (⌘K focuses it), the Kokpit entry with the attention badge, the project →
// repo tree, the accounts frame (its own disclosure) and the foot's settings control — next to
// the content area that mounts the cockpit, a repo's board, a project's roadmap, a work order's
// detail, an account's view, or the settings. The first-run wizard rides above it all as an
// overlay: the shell mounts it, the wizard store's `open` decides whether it shows at all (U-7).
// The badge mirrors the shell store: the cockpit's attention count, present only while attention
// exists — zero renders nothing, never a zero (U-10). Every user-visible string arrives through
// a label key (U-1).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { SidebarAccounts } from '../components/sidebar-accounts';
import { SidebarTree } from '../components/sidebar-tree';
import { t, type Locale } from '../labels/t';
import type { AccountsFrameStore } from '../stores/accounts-frame';
import type { BoardStore } from '../stores/board';
import type { CockpitStore } from '../stores/cockpit';
import type { LocaleStore } from '../stores/locale';
import { treeSelection, type ProjectTreeStore, type TreePlace } from '../stores/project-tree';
import type { RoadmapStore } from '../stores/roadmap';
import type { SettingsStore } from '../stores/settings';
import type { ShellStore } from '../stores/shell';
import type { WizardStore } from '../stores/wizard';
import type { WorkOrderDetailStore } from '../stores/work-order-detail';
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
  readonly settings: SettingsStore;
  readonly wizard: WizardStore;
  /** The locale store's handle for the settings screen's language control (U-9); the active
   *  bundle itself travels as `locale`, refreshed by the root's subscription. */
  readonly localeStore: LocaleStore;
  readonly locale: Locale;
}

/** Where the shell can be. Routes carry only ids; the screens load their own data. The roadmap
 *  route is the project row's target and the account route an account card's; until the account
 *  screen lands it renders the page title alone. */
type ShellRoute =
  | { readonly name: 'cockpit' }
  | { readonly name: 'board'; readonly repo: string }
  | { readonly name: 'roadmap'; readonly project: string }
  | { readonly name: 'workOrder'; readonly id: string }
  | { readonly name: 'account'; readonly id: string }
  | { readonly name: 'settings' };

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

const AccountTitle = ({ accounts, id }: { readonly accounts: AccountsFrameStore; readonly id: string }) => {
  const state = useSyncExternalStore(accounts.subscribe, accounts.state);
  const label = state.cards?.find((card) => card.id === id)?.label;
  return (
    <h1 className="max-w-[960px] truncate font-mono text-[15px] font-bold tracking-tight text-ink">
      {label ?? ''}
    </h1>
  );
};

export function ShellScreen({
  shell,
  tree,
  accounts,
  cockpit,
  board,
  roadmap,
  detail,
  settings,
  wizard,
  localeStore,
  locale,
}: ShellScreenProps) {
  const state = useSyncExternalStore(shell.subscribe, shell.state);
  const [route, setRoute] = useState<ShellRoute>({ name: 'cockpit' });
  // The place a work-order detail was opened from: the detail replaces the route but not the
  // tree's selection — the board that opened it stays selected, like the design's detay.
  const placeRef = useRef<TreePlace>({ kind: 'cockpit' });
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

  const badge = state.badge;
  const treeState = useSyncExternalStore(tree.subscribe, tree.state);
  const selection = treeSelection(
    treeState.tree,
    route.name === 'workOrder' || route.name === 'account' ? placeRef.current : placeOf(route),
  );
  const openWorkOrder = (id: string): void => setRoute({ name: 'workOrder', id });

  return (
    <div className="grid h-dvh grid-cols-[240px_minmax(0,1fr)] overflow-hidden bg-bg text-ink">
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
          onOpenAccount={(id) => setRoute({ name: 'account', id })}
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

      <main className="min-w-0 overflow-y-auto px-[22px] py-[18px]">
        {route.name === 'cockpit' ? (
          <CockpitScreen store={cockpit} locale={locale} onOpenWorkOrder={openWorkOrder} />
        ) : null}
        {route.name === 'board' ? (
          <BoardScreen store={board} repo={route.repo} locale={locale} onOpenWorkOrder={openWorkOrder} />
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
        {route.name === 'account' ? <AccountTitle accounts={accounts} id={route.id} /> : null}
        {route.name === 'workOrder' ? (
          <WorkOrderDetailScreen store={detail} workOrderId={route.id} locale={locale} />
        ) : null}
        {route.name === 'settings' ? <SettingsScreen store={settings} locale={locale} localeStore={localeStore} /> : null}
      </main>

      <WizardScreen store={wizard} locale={locale} />
    </div>
  );
}
