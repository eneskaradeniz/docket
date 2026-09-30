// screens/shell.tsx — the app shell (U-10's window): on darwin a 40px drag bar runs across the
// top above everything (the native title strip is hidden there; the bar carries the traffic
// lights' lane, the signal accent, the wordmark and the bar's two buttons — Anasayfa, the
// cockpit's route with the attention badge, and Ara, the search palette's door), then a fixed
// 240px sidebar that is always open — the project → repo tree, the accounts frame (its own
// disclosure) and the foot's settings control — next to the content area that mounts the
// cockpit, a repo's board, a project's roadmap, a work order's detail, or an account's view.
// The detail and the account view open in place of the screen they were reached from (U-19):
// ‹ Geri returns to that screen with its scroll where the operator left it. The centered search
// palette rides over it all: it searches the tree's own names and opens what a tree row opens.
// The settings panel rides the same way: the gear and the screens' shortcuts open it over the
// current route, which stays underneath unchanged. The first-run wizard rides above everything:
// the shell mounts it, the wizard store's `open` decides whether it shows at all (U-7). The
// badge mirrors the shell store: the cockpit's attention count, present only while attention
// exists — zero renders nothing, never a zero (U-10). Every user-visible string arrives through
// a label key (U-1).
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';

import { ACTIVE_CLASS } from '../components/active-state';
import { SearchPalette } from '../components/search-palette';
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
import {
  CLOSED_PALETTE,
  paletteReducer,
  type PaletteOrigin,
  type PaletteResult,
} from '../stores/search-palette';
import type { SettingsStore } from '../stores/settings';
import {
  CLOSED_SETTINGS_PANEL,
  settingsPanelReducer,
  type SettingsPanelOrigin,
} from '../stores/settings-panel';
import type { ShellStore } from '../stores/shell';
import type { WizardStore } from '../stores/wizard';
import type { WorkOrderDetailStore } from '../stores/work-order-detail';
import { AccountViewScreen } from './account-view';
import { BoardScreen } from './board';
import { CockpitScreen } from './cockpit';
import { WorkOrderDetailScreen } from './detail';
import { RoadmapScreen } from './roadmap';
import { SettingsPanel } from './settings';
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
 *  route is the project row's and the board header's target; the page itself is its own screen.
 *  Settings is not a route: the panel overlays whichever route is current. */
type ShellRoute =
  | { readonly name: 'cockpit' }
  | { readonly name: 'board'; readonly repo: string }
  | { readonly name: 'roadmap'; readonly project: string }
  | { readonly name: 'workOrder'; readonly id: string }
  | { readonly name: 'account'; readonly id: string };

/** The label the detail's back row carries — it names the screen the detail was opened from
 *  (U-19). */
type BackKind = 'detail.back.board' | 'detail.back.cockpit' | 'detail.back.account' | 'detail.back.roadmap';

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
  // The search palette's whole standing lives in the pure reducer; the shell only feeds it the
  // tree and routes what it opens (U-15). The settings panel's standing lives the same way —
  // open/close and the origin the close's focus rule reads, never a route.
  const [palette, dispatchPalette] = useReducer(paletteReducer, CLOSED_PALETTE);
  const [settingsPanel, dispatchSettingsPanel] = useReducer(settingsPanelReducer, CLOSED_SETTINGS_PANEL);
  // The place a work-order detail was opened from: the detail replaces the route but not the
  // tree's selection — the board that opened it stays selected, like the design's detay.
  const placeRef = useRef<TreePlace>({ kind: 'cockpit' });
  // The route a detail or an account view replaces (U-19): ‹ Geri returns to it.
  const backRouteRef = useRef<ShellRoute>({ name: 'cockpit' });
  // The board's scroll, kept for the return from a detail opened on it (U-19).
  const boardScrollRef = useRef(0);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    void shell.load();
  }, [shell]);
  useEffect(() => {
    if (route.name !== 'workOrder' && route.name !== 'account') placeRef.current = placeOf(route);
  }, [route]);
  const wizardState = useSyncExternalStore(wizard.subscribe, wizard.state);
  // The wizard owns the screen and the focus while it is up: the palette stays away, or it would
  // open beneath the wizard's overlay and steal its focus. The settings panel owns the same
  // standing while it is open.
  const wizardUp = wizardState.visible && !wizardState.checking;
  const openPalette = useCallback(
    (origin: PaletteOrigin): void => {
      if (wizardUp || settingsPanel.open) return;
      dispatchPalette({ type: 'open', origin });
    },
    [wizardUp, settingsPanel.open],
  );
  // ⌘K (or Ctrl+K) opens the search palette (U-15) — the same door the title bar's Ara button is.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openPalette('keyboard');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette]);
  // The panel's three doors — the gear, the board header's shortcut, the account view's link —
  // share the palette's one origin rule (a pointer-opened panel does not hand focus back on
  // close). Two of the doors live in screens the shell does not own, so the pointer stamp is
  // read here, on the window: a pointer press marks the next click a pointer's, any key press
  // unmarks it, and the open reads the mark once.
  const pointerOpenRef = useRef(false);
  useEffect(() => {
    const onPointerDown = (): void => {
      pointerOpenRef.current = true;
    };
    const onKeyDown = (): void => {
      pointerOpenRef.current = false;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
  /** Opens the settings panel over the current route — the route stays where it is. */
  const openSettings = useCallback((): void => {
    const origin: SettingsPanelOrigin = pointerOpenRef.current ? 'pointer' : 'keyboard';
    pointerOpenRef.current = false;
    dispatchSettingsPanel({ type: 'open', origin });
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
  // A tree that loads or refreshes under an open palette must re-derive its results: the query
  // alone would keep the results of the tree it was typed over. Only the tree's identity is a
  // trigger — the palette's own fields are read as they stand in this render, so a keystroke
  // still dispatches exactly once, from the input's own change.
  useEffect(() => {
    if (!palette.open) return;
    dispatchPalette({ type: 'query', value: palette.query, tree: treeState.tree });
  }, [treeState.tree]);
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

  /** Opens a palette result the way the tree's row does (U-15): the project is stamped as used,
   *  then the roadmap or the board mounts. */
  const openFromPalette = (result: PaletteResult): void => {
    dispatchPalette({ type: 'close' });
    tree.recordUse(result.project);
    if (result.kind === 'project') setRoute({ name: 'roadmap', project: result.project });
    else setRoute({ name: 'board', repo: result.repo });
  };

  // The board header's roadmap shortcut exists only for a single-repo project (U-15): the tree
  // knows which project owns the repo and how many repos it has.
  const roadmapProjectOf = (repo: string): string | null => {
    const owner = treeState.tree.find((item) => item.repos.some((node) => node.repo === repo));
    return owner !== undefined && owner.repos.length === 1 ? owner.project : null;
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <TitleBar
        locale={locale}
        platform={navigator.platform}
        homeCurrent={route.name === 'cockpit'}
        searchCurrent={palette.open}
        badge={badge}
        onHome={() => setRoute({ name: 'cockpit' })}
        onSearch={openPalette}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] overflow-hidden">
        <nav
          aria-label={t(locale, 'shell.nav')}
          className="flex min-h-0 flex-col border-r border-hairline bg-surface px-2.5 pb-3 pt-3.5"
        >
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
              onClick={openSettings}
              aria-label={t(locale, 'nav.settings')}
              title={t(locale, 'nav.settings')}
              className={`grid h-8 w-8 flex-none place-items-center rounded-control border ${
                settingsPanel.open
                  ? `text-ink ${ACTIVE_CLASS}`
                  : 'border-bord text-inkdim hover:border-inkdim hover:text-ink'
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
              onOpenSettings={openSettings}
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
              onOpenSettings={openSettings}
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
        </main>
      </div>

      <SearchPalette
        state={palette}
        locale={locale}
        onQuery={(value) => dispatchPalette({ type: 'query', value, tree: treeState.tree })}
        onMove={(delta) => dispatchPalette({ type: 'move', delta })}
        onOpen={openFromPalette}
        onClose={() => dispatchPalette({ type: 'close' })}
      />

      <SettingsPanel
        open={settingsPanel.open}
        origin={settingsPanel.origin}
        onClose={() => dispatchSettingsPanel({ type: 'close' })}
        store={settings}
        locale={locale}
        localeStore={localeStore}
      />

      <WizardScreen store={wizard} locale={locale} />
    </div>
  );
}
