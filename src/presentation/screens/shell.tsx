// screens/shell.tsx — the app shell (U-10's window): on darwin a 40px drag bar runs across the
// top above everything (the native title strip is hidden there; the bar carries the traffic
// lights' lane, the signal accent, the wordmark, the two history chevrons — back and forward,
// the navigation history's own doors (U-25) — and, only while an update waits, the Update
// button at its right edge), then a fixed 240px sidebar that is always open — the four nav rows
// (Anasayfa with the attention badge, Ara with its ⌘K hint, Telefon, Ayarlar — U-24), the
// project → repo tree, and the accounts frame as the foot's only content — next to the content
// area that mounts the cockpit, a repo's board, a project's roadmap, a work order's detail, or
// an account's view. Every step between those places lands in the navigation history (U-25):
// back and forward — the bar's chevrons, ⌘[/⌘], the detail's ‹ Geri — walk it, each entry
// returning with its main column's scroll where the operator left it (U-19). The centered
// search palette rides over it all: it searches the tree's own names and opens
// what a tree row opens. The settings panel rides the same way: the nav's Telefon and Ayarlar
// rows and the screens' shortcuts open it over the current route, which stays underneath
// unchanged. The first-run wizard rides above everything: the shell mounts it, the wizard
// store's `open` decides whether it shows at all (U-35). The badge mirrors the shell store: the
// cockpit's attention count, present only while attention exists — zero renders nothing, never
// a zero (U-10). Every user-visible string arrives through a label key (U-1).
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from 'react';

import { SearchPalette } from '../components/search-palette';
import { SidebarAccounts } from '../components/sidebar-accounts';
import { SidebarNav } from '../components/sidebar-nav';
import { SidebarTree } from '../components/sidebar-tree';
import { TitleBar } from '../components/title-bar';
import { ToastHost } from '../components/toast-host';
import { t, type Locale } from '../labels/t';
import { unaddedRowTarget, type AccountsFrameStore } from '../stores/accounts-frame';
import { editInSettingsTarget, type AccountViewStore } from '../stores/account-view';
import type { BoardStore } from '../stores/board';
import type { CockpitStore } from '../stores/cockpit';
import type { LocaleStore } from '../stores/locale';
import {
  START_NAV_HISTORY,
  canBack,
  canForward,
  navHistoryReducer,
  type NavRoute,
} from '../stores/nav-history';
import { treeSelection, type ProjectTreeStore, type TreePlace } from '../stores/project-tree';
import type { RoadmapStore } from '../stores/roadmap';
import {
  CLOSED_PALETTE,
  paletteReducer,
  type PaletteOrigin,
  type PaletteResult,
} from '../stores/search-palette';
import type { SettingsStore } from '../stores/settings';
import type { AccountModelsStore } from '../stores/account-models';
import type { RolesStore } from '../stores/roles';
import type { ProviderMarksStore } from '../stores/provider-marks';
import {
  CLOSED_SETTINGS_PANEL,
  settingsPanelReducer,
  type CandidateDotStore,
  type SettingsOpenTarget,
  type SettingsPanelOrigin,
} from '../stores/settings-panel';
import type { CandidatesStore } from '../stores/candidates';
import type { ProvidersStore } from '../stores/providers';
import type { ShellStore } from '../stores/shell';
import { toast, toastStore } from '../stores/toasts';
import type { ThemeStore } from '../stores/theme';
import type { UpdateStore } from '../stores/update';
import type { NewProjectDone, NewProjectStore } from '../stores/new-project';
import type { WizardStore } from '../stores/wizard';
import type { WorkOrderDetailStore } from '../stores/work-order-detail';
import { AccountViewScreen } from './account-view';
import { BoardScreen } from './board';
import { CockpitScreen } from './cockpit';
import { WorkOrderDetailScreen } from './detail';
import { NewProjectScreen } from './new-project';
import { RoadmapScreen } from './roadmap';
import { SettingsPanel, type SettingsSection } from './settings';
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
  /** The settings panel's per-account model list and its spend-consent flow (P-40). */
  readonly models: AccountModelsStore;
  /** The Roller section's roles, chain and work styles (U-33). */
  readonly roles: RolesStore;
  /** The provider marks every account badge resolves from (loaded once, session-cached). */
  readonly marks: ProviderMarksStore;
  /** The app-update standing the title bar's button and the panel's Güncelleme section read. */
  readonly update: UpdateStore;
  readonly wizard: WizardStore;
  /** The Yeni proje page's machine (U-40). */
  readonly newProject: NewProjectStore;
  /** The locale store's handle for the settings screen's language control (U-9); the active
   *  bundle itself travels as `locale`, refreshed by the root's subscription. */
  readonly localeStore: LocaleStore;
  /** The theme preference the Görünüm section binds to (U-36); the root applies it to data-theme. */
  readonly themeStore: ThemeStore;
  /** Whether discovery holds an account not yet added — Hesaplar's amber dot (U-28). */
  readonly candidates: CandidateDotStore;
  /** The discovered accounts list Settings → Hesaplar renders (U-34). */
  readonly candidateList: CandidatesStore;
  /** The providers Settings → Sağlayıcılar renders (U-38). */
  readonly providerList: ProvidersStore;
  readonly locale: Locale;
  /** The machine's zone, for the account view's reset times; tests pass 'UTC'. */
  readonly timeZone: string;
}

/** Where the shell can be. Routes carry only ids; the screens load their own data. The roadmap
 *  route is the project row's and the board header's target; the page itself is its own screen.
 *  Settings is not a route: the panel overlays whichever route is current. The history records
 *  these routes and nothing else (U-25). */
type ShellRoute = NavRoute;

/** The label the detail's back row carries — it names the screen the detail was opened from
 *  (U-19). */
type BackKind = 'detail.back.board' | 'detail.back.cockpit' | 'detail.back.account' | 'detail.back.roadmap';

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
    case 'newProject':
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
  models,
  roles,
  marks,
  update,
  wizard,
  newProject,
  localeStore,
  themeStore,
  candidates,
  candidateList,
  providerList,
  locale,
  timeZone,
}: ShellScreenProps) {
  const state = useSyncExternalStore(shell.subscribe, shell.state);
  const updateState = useSyncExternalStore(update.subscribe, update.state);
  // Where the operator is and has been (U-25): the navigation history is the shell's one route
  // state — the current entry's route is what renders, and each entry remembers the main
  // column's scroll it was left at for the return.
  const [nav, dispatchNav] = useReducer(navHistoryReducer, START_NAV_HISTORY);
  const entry = nav.entries[nav.index];
  const route = entry.route;
  // The search palette's whole standing lives in the pure reducer; the shell only feeds it the
  // tree and routes what it opens (U-15). The settings panel's standing lives the same way —
  // open/close and the origin the close's focus rule reads, never a route.
  const [palette, dispatchPalette] = useReducer(paletteReducer, CLOSED_PALETTE);
  const [settingsPanel, dispatchSettingsPanel] = useReducer(settingsPanelReducer, CLOSED_SETTINGS_PANEL);
  // The panel's section lives in the same reducer: the nav's Telefon and Ayarlar rows name it on
  // open and read their current standing from it (U-24, U-28).
  const candidateDot = useSyncExternalStore(candidates.subscribe, candidates.dot);
  // The place a work-order detail was opened from: the detail replaces the route but not the
  // tree's selection — the board that opened it stays selected, like the design's detay.
  const placeRef = useRef<TreePlace>({ kind: 'cockpit' });
  // The direction the operator last moved (U-25): a vanished work order is skipped onward the
  // same way — a back that lands on it continues back, a forward continues forward.
  const lastMoveRef = useRef<'back' | 'forward'>('back');
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    void shell.load();
    // The bar's Update button reads the standing from startup, not from the panel's first open.
    void update.load();
    // The accounts frame's "n hesap eklenmedi" row reads the discovered list from startup.
    void candidateList.load();
  }, [shell, update, candidateList]);
  const unaddedCount = useSyncExternalStore(candidateList.subscribe, () => candidateList.state().rows.length);
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
  /** Opens the settings panel over the current route on a named section — the route stays where
   *  it is; the nav's rows name their own section, the screens' shortcuts open
   *  Hesaplar (U-28). */
  const openSettingsAt = useCallback((target: SettingsOpenTarget): void => {
    const origin: SettingsPanelOrigin = pointerOpenRef.current ? 'pointer' : 'keyboard';
    pointerOpenRef.current = false;
    dispatchSettingsPanel({ type: 'open', origin, ...target });
    // The dot reads the discovery's standing as the panel opens, so it is never stale.
    void candidates.load();
  }, [candidates]);
  const openSettings = useCallback((section: SettingsSection): void => openSettingsAt({ section }), [openSettingsAt]);
  // Every arrival — a push, a back, a forward — restores the current entry's scroll once the
  // main column has painted again (U-25): each screen returns where the operator left it, the
  // board exactly like the roadmap and the cockpit.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (mainRef.current !== null) mainRef.current.scrollTop = entry.scroll;
    });
    return () => cancelAnimationFrame(frame);
  }, [entry]);

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

  // The history's doors (U-25). What exists answers from the stores the shell already holds —
  // the tree for repos and projects, the frame's cards for accounts; the cockpit always is. A
  // work order cannot be known without loading it, so its entry stands until the detail itself
  // reports the work order gone; the effect below then walks the history on.
  const exists = useCallback(
    (candidate: NavRoute): boolean => {
      switch (candidate.name) {
        case 'cockpit':
          return true;
        case 'board':
          return treeState.tree.some((item) => item.repos.some((node) => node.repo === candidate.repo));
        case 'roadmap':
          return treeState.tree.some((item) => item.project === candidate.project);
        case 'account':
          return accountsState.cards?.some((card) => card.id === candidate.id) ?? false;
        case 'workOrder':
        case 'newProject':
          return true;
      }
    },
    [treeState.tree, accountsState.cards],
  );
  /** Moves the history — every move stamps the scroll of the screen being left into its entry. */
  const move = useCallback(
    (type: 'back' | 'forward'): void => {
      lastMoveRef.current = type;
      dispatchNav({ type, exists, scroll: mainRef.current?.scrollTop ?? 0 });
    },
    [exists],
  );
  const goBack = useCallback((): void => move('back'), [move]);
  const goForward = useCallback((): void => move('forward'), [move]);
  /** Opens a route as the history's next entry (U-25): the forward part gives way, the route
   *  already current adds nothing. */
  const navigate = useCallback((next: NavRoute): void => {
    lastMoveRef.current = 'back';
    dispatchNav({ type: 'push', route: next, scroll: mainRef.current?.scrollTop ?? 0 });
  }, []);
  // The Yeni proje page's success (U-40): its machine starts fresh, the new project's view opens
  // and the one toast (U-50) shows; no target (the tree does not list it) lands on the cockpit.
  // The setup finished (U-42): Anasayfa opens directly and the one toast says how many accounts are
  // ready. The wizard hands the result over once.
  const finished = wizardState.finished;
  useEffect(() => {
    if (finished === null) return;
    navigate({ name: 'cockpit' });
    toast({ type: 'success', text: t(locale, 'wizard.finished.toast').replace('{n}', String(finished.accounts)) });
    wizard.ackFinish();
  }, [finished, navigate, wizard, locale]);
  const finishNewProject = useCallback(
    (done: NewProjectDone): void => {
      newProject.reset();
      const target = done.target;
      navigate(target === null ? { name: 'cockpit' } : target.kind === 'roadmap' ? { name: 'roadmap', project: target.project } : { name: 'board', repo: target.repo });
      toast({ type: 'success', text: t(locale, done.toastKey) });
    },
    [newProject, navigate, locale],
  );
  /** Vazgeç: back where the page was opened from. */
  const cancelNewProject = useCallback((): void => {
    goBack();
  }, [goBack]);
  /** Opens the Yeni proje page with a fresh form. */
  const openNewProject = useCallback((): void => {
    newProject.reset();
    navigate({ name: 'newProject' });
  }, [newProject, navigate]);
  // ⌘[ and ⌘] ride the history (U-25) — ignored while an input, a textarea or something editable
  // holds focus, and while the palette, the settings panel or the wizard owns the screen: the
  // route underneath an overlay stays put. No other shortcut or menu claims these two keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || (event.key !== '[' && event.key !== ']')) return;
      if (palette.open || settingsPanel.open || wizardUp) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]') !== null
      ) {
        return;
      }
      event.preventDefault();
      if (event.key === '[') goBack();
      else goForward();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, goForward, palette.open, settingsPanel.open, wizardUp]);
  // A work order that no longer exists cannot be a destination (U-25): the detail's own failed
  // read is the signal, and the shell walks the history on in the direction it was moving —
  // silently, the way the tree's own dead entries are skipped.
  const detailProblem = useSyncExternalStore(detail.subscribe, () => detail.state().problem);
  useEffect(() => {
    if (route.name !== 'workOrder' || detailProblem !== 'not_found') return;
    move(lastMoveRef.current);
  }, [route, detailProblem, move]);

  /** Opens a work order in place of the current screen (U-19): the history records the step —
   *  ‹ Geri is the back — and the tree's selection stays where it was. */
  const openWorkOrder = (id: string): void => {
    navigate({ name: 'workOrder', id });
  };
  /** Opens an account view in place; the history records the step the same way. */
  const openAccount = (id: string): void => {
    navigate({ name: 'account', id });
  };

  /** Opens a palette result the way the tree's row does (U-15): the project is stamped as used,
   *  then the roadmap or the board mounts. */
  const openFromPalette = (result: PaletteResult): void => {
    dispatchPalette({ type: 'close' });
    tree.recordUse(result.project);
    if (result.kind === 'project') navigate({ name: 'roadmap', project: result.project });
    else navigate({ name: 'board', repo: result.repo });
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
        update={updateState.status}
        onApply={() => void update.apply()}
        canBack={canBack(nav)}
        canForward={canForward(nav)}
        onBack={goBack}
        onForward={goForward}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] overflow-hidden">
        <nav
          aria-label={t(locale, 'shell.nav')}
          className="flex min-h-0 flex-col border-r border-hairline bg-surface px-2.5 pb-3 pt-3.5"
        >
          <SidebarNav
            locale={locale}
            homeCurrent={route.name === 'cockpit'}
            searchCurrent={palette.open}
            settingsSection={settingsPanel.open ? settingsPanel.section : null}
            badge={badge}
            onHome={() => navigate({ name: 'cockpit' })}
            onSearch={openPalette}
            onPhone={() => openSettings('phone')}
            onSettings={() => openSettings('accounts')}
          />

          <SidebarTree
            store={tree}
            selection={selection}
            locale={locale}
            onOpenProject={(project) => navigate({ name: 'roadmap', project })}
            onOpenRepo={(_project, repo) => navigate({ name: 'board', repo })}
            onNewProject={openNewProject}
          />

          <SidebarAccounts
            store={accounts}
            marks={marks}
            locale={locale}
            activeAccountId={route.name === 'account' ? route.id : null}
            onOpenAccount={openAccount}
            unaddedCount={unaddedCount}
            onOpenUnadded={() => openSettingsAt(unaddedRowTarget())}
          />
        </nav>
  
        <main ref={mainRef} className="@container min-w-0 overflow-y-auto px-[22px] py-[18px]">
          {route.name === 'cockpit' ? (
            <CockpitScreen
              store={cockpit}
              marks={marks}
              locale={locale}
              onOpenWorkOrder={openWorkOrder}
              onOpenProject={(project) => navigate({ name: 'roadmap', project })}
              onOpenBoard={(repo) => navigate({ name: 'board', repo })}
              onNewProject={openNewProject}
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
              onOpenRoadmap={(project) => navigate({ name: 'roadmap', project })}
              onOpenSettings={() => openSettings('accounts')}
            />
          ) : null}
          {route.name === 'roadmap' ? (
            <RoadmapScreen
              store={roadmap}
              project={route.project}
              name={treeState.tree.find((item) => item.project === route.project)?.name ?? route.project}
              locale={locale}
              onOpenRepo={(repo) => navigate({ name: 'board', repo })}
              onOpenWorkOrder={openWorkOrder}
            />
          ) : null}
          {route.name === 'account' ? (
            <AccountViewScreen
              store={accountView}
              marks={marks}
              accountId={route.id}
              locale={locale}
              timeZone={timeZone}
              onOpenWorkOrder={openWorkOrder}
              reserve={accountsState.cards?.find((card) => card.id === route.id)?.reserve ?? null}
              onOpenSettings={() => openSettingsAt(editInSettingsTarget(route.id))}
              onBack={goBack}
            />
          ) : null}
          {route.name === 'newProject' ? (
            <NewProjectScreen store={newProject} locale={locale} onCancel={cancelNewProject} onDone={finishNewProject} />
          ) : null}
          {route.name === 'workOrder' ? (
            <WorkOrderDetailScreen
              store={detail}
              workOrderId={route.id}
              locale={locale}
              backKey={nav.index > 0 ? backKindOf(nav.entries[nav.index - 1].route) : null}
              onBack={goBack}
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
        section={settingsPanel.section}
        subPage={settingsPanel.subPage}
        tab={settingsPanel.tab}
        fineTune={settingsPanel.fineTune}
        onOpenTarget={openSettingsAt}
        onSection={(next) => dispatchSettingsPanel({ type: 'select', section: next })}
        onBack={() => dispatchSettingsPanel({ type: 'leaveSubPage' })}
        onEnterSubPage={(id) => dispatchSettingsPanel({ type: 'enterSubPage', id })}
        onEscape={() => dispatchSettingsPanel({ type: 'escape' })}
        candidateDot={candidateDot}
        candidates={candidateList}
        providers={providerList}
        themeStore={themeStore}
        onClose={() => dispatchSettingsPanel({ type: 'close' })}
        store={settings}
        models={models}
        roles={roles}
        marks={marks}
        update={update}
        locale={locale}
        localeStore={localeStore}
        onOpenAccount={(id) => {
          dispatchSettingsPanel({ type: 'close' });
          openAccount(id);
        }}
      />

      <WizardScreen store={wizard} locale={locale} localeStore={localeStore} themeStore={themeStore} marks={marks} />

      {/* The one toast surface (U-50), above every overlay the shell mounts. */}
      <ToastHost store={toastStore} locale={locale} />
    </div>
  );
}
