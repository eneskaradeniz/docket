// root.tsx — the renderer's mount point: it types the injected bridge, composes the shell's stores
// from that bridge alone, and mounts React into the page's root element. The bridge is the only
// api access here; every store takes its deps by injection, so composition stays the single place
// where the real sources are named.
import React, { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import type { Api } from '../api/index';
import type { Actor } from '../domain/index';
import { ErrorBoundary } from './components/error-boundary';
import { ShellScreen, type ShellScreenProps } from './screens/shell';
import { StorageOpenErrorScreen } from './screens/storage-open-error';
import { parseStorageOpenBoot, storageOpenCopy } from './storage-open-error';
import { createAccountsFrameStore } from './stores/accounts-frame';
import { createAccountModelsStore } from './stores/account-models';
import { createRolesStore } from './stores/roles';
import { createAccountViewStore } from './stores/account-view';
import { createBoardStore } from './stores/board';
import { createChatStore } from './stores/chat-store';
import { createCockpitStore } from './stores/cockpit';
import { createLivePaneStore } from './stores/live-pane';
import { createLibraryStore } from './stores/library';
import { createProposalsStore } from './stores/proposals';
import { createLocaleStore, type LocaleStore } from './stores/locale';
import { createProjectTreeStore } from './stores/project-tree';
import { createRoadmapStore } from './stores/roadmap';
import { createCandidatesStore } from './stores/candidates';
import { createProvidersStore } from './stores/providers';
import { createConnectorsStore } from './stores/connectors';
import { createSettingsStore } from './stores/settings';
import { createCandidateDotStore } from './stores/settings-panel';
import { createShellStore } from './stores/shell';
import { createThemeStore, mediaSchemeSource } from './stores/theme';
import { toast } from './stores/toasts';
import { t } from './labels/t';
import { fill } from './components/chat-style';
import { createProviderMarksStore } from './stores/provider-marks';
import { createUpdateStore } from './stores/update';
import { createQuitPromptStore, type QuitPromptStore } from './stores/quit-prompt';
import { QuitDialog } from './components/quit-dialog';
import { createProjectBundleStore, type ProjectBundleStore } from './stores/project-bundle';
import { ProjectBundleDialog } from './components/project-bundle-dialog';
import { createNewProjectStore } from './stores/new-project';
import { createWizardStore } from './stores/wizard';
import { createPageListStore, createPageViewHost, createPageViewerStore, type PageViewPort } from './stores/page-viewer';
import { createWorkOrderDetailStore } from './stores/work-order-detail';

export type PickFoldersOptions = {
  readonly multiple?: boolean;
};

export type PickFoldersResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly paths: readonly string[]; readonly truncated?: true };

/** Exactly the surface the preload exposes under `window.docket` — the api's members, reached
 *  only through their types; no bridge implementation ever lives in this layer. */
export type DocketBridge = Pick<Api, 'command' | 'query' | 'subscribe'> & {
  readonly pageView: PageViewPort;
  readonly pickFolders: (options?: PickFoldersOptions) => Promise<PickFoldersResult>;
};

/**
 * The bridge handle, read off the window with a local cast rather than a global Window
 * augmentation: the v1 renderer still carries its own `window.docket` declaration in this
 * program, and two augmentations of the same property cannot coexist. The augmentation moves
 * here once the v1 renderer's declaration is removed with its code.
 */
export const bridge = (): DocketBridge => {
  const injected = (window as unknown as { readonly docket?: DocketBridge }).docket;
  if (injected === undefined) {
    throw new Error('window.docket is missing — the preload bridge did not run');
  }
  return injected;
};

/** Every screen command travels as the machine's single local user. */
const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

/** The root component: it subscribes to the locale store, so a selection in the settings' language
 *  control re-renders the shell with the swapped bundle — the flip stays in memory, never a
 *  reload (U-9). */
function App({ localeStore, quit, projectBundle, ...screens }: Omit<ShellScreenProps, 'locale'> & { readonly localeStore: LocaleStore; readonly quit: QuitPromptStore; readonly projectBundle: ProjectBundleStore }) {
  const locale = useSyncExternalStore(localeStore.subscribe, localeStore.current);
  // The document's language follows the locale (A10): assistive tech must hear the UI's language,
  // and the Turkish suffixes (ı İ ş ğ) must reach the mono voice through the right locale.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <>
      <ShellScreen {...screens} localeStore={localeStore} locale={locale} />
      {/* The quit confirmation (U-294): a modal in this window, raised by the shell's request. */}
      <QuitDialog store={quit} locale={locale} />
      {/* The project bundle export/import confirmation dialog (U-296). */}
      <ProjectBundleDialog store={projectBundle} locale={locale} />
    </>
  );
}

const mount = document.getElementById('root');
if (mount !== null) {
  const storageBoot = parseStorageOpenBoot(window.location.search);
  if (storageBoot !== null) {
    const locale = createLocaleStore(window.localStorage);
    const theme = createThemeStore(window.localStorage, mediaSchemeSource(window));
    const applyTheme = (): void => {
      document.documentElement.dataset.theme = theme.resolved();
    };
    applyTheme();
    theme.subscribe(applyTheme);
    const copy = storageOpenCopy(locale.current(), storageBoot);
    createRoot(mount).render(
      <React.StrictMode>
        <StorageOpenErrorScreen copy={copy} />
      </React.StrictMode>,
    );
  } else {
  const api = bridge();
  const changes = api.subscribe;
  const locale = createLocaleStore(window.localStorage);
  // The theme (U-36) lands on the root's data-theme before the first paint and follows the store.
  const theme = createThemeStore(window.localStorage, mediaSchemeSource(window));
  const applyTheme = (): void => {
    document.documentElement.dataset.theme = theme.resolved();
  };
  applyTheme();
  theme.subscribe(applyTheme);
  const candidates = createCandidateDotStore(api);
  // The machine scans (accounts, providers) live in these two stores for the whole session: the
  // shell starts the first one in the background, the accounts scan seeds the providers one with
  // the discovery it already read, and only "Yeniden tara" or an accounts change reads again.
  const providerList = createProvidersStore({ api, now: () => Date.now() });
  // The Entegrasyonlar rows (U-356): one read per session, manifest data plus the registry's
  // switch state; the panel's sections and the tracker-link label read the same rows.
  const connectorsList = createConnectorsStore({ api, actor: USER });
  // The list under Hesaplar → Eklenmemiş; an adoption re-reads the dot.
  const candidateList = createCandidatesStore({
    api,
    actor: USER,
    changes,
    now: () => Date.now(),
    onProviders: (facts) => providerList.seed(facts),
    onAdopted: () => void candidates.load(),
  });
  // The meters' reset times render in the machine's zone; tests pass 'UTC' instead.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const cockpit = createCockpitStore({ api, changes, now: () => Date.now(), actor: USER, persistence: window.localStorage });
  const board = createBoardStore({ api, changes, actor: USER, persistence: window.localStorage });
  // The live pane has no run at composition time — the detail store attaches it to the active
  // run of whichever work order loads.
  const pane = createLivePaneStore({ api, changes, actor: USER });
  const detail = createWorkOrderDetailStore({ api, changes, actor: USER, pane });
  // The Sayfalar section's list and the page screen (U-75); one host drives the app's one native
  // page view from whichever page screen is mounted (U-76).
  const pageList = createPageListStore({ api, changes });
  const pageViewer = createPageViewerStore({ api, changes, actor: USER });
  const pageHost = createPageViewHost({
    port: api.pageView,
    frame: (callback) => {
      const handle = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(handle);
    },
  });
  // The Artifact'lar library (U-84 … U-89): the screen's store, also the sidebar row's count.
  const library = createLibraryStore({ api, changes, actor: USER });
  // Docket AI's chat (U-101): its toasts ride the one toast service in the active locale.
  const chat = createChatStore({
    api,
    changes,
    actor: USER,
    now: () => Date.now(),
    notify: ({ type, key, values }) => toast({ type, text: fill(t(locale.current(), key), values ?? {}) }),
  });
  // The Öneriler screen (U-136 … U-146): re-reads on open, on window focus and after its commands.
  const proposals = createProposalsStore({
    api,
    actor: USER,
    focus: (listener) => {
      window.addEventListener('focus', listener);
      return () => window.removeEventListener('focus', listener);
    },
  });
  const settings = createSettingsStore({ api, changes, actor: USER, locale: locale.current, timeZone });
  // The settings panel's per-account model list and its spend-consent flow (P-40).
  const accountModels = createAccountModelsStore({ api, changes, actor: USER });
  // The Roller section: roles.list with the stored bindings (U-33).
  const roles = createRolesStore({ api, changes, actor: USER, now: () => Date.now() });
  const shell = createShellStore({ api, changes });
  // The app's own newer version — the title bar's button and the panel's Güncelleme section.
  const update = createUpdateStore({ api, changes, actor: USER });
  // Subscribes at once: the shell's quit request may arrive any time after load.
  const quit = createQuitPromptStore({ api, changes, actor: USER });
  const projectBundle = createProjectBundleStore({ api, actor: USER });
  // The sidebar's tree (U-15) and accounts frame (U-16) mirror their queries; the sort choice
  // persists where the locale choice does.
  const tree = createProjectTreeStore({ api, changes, now: () => Date.now(), persistence: window.localStorage });
  // The wizard re-reads its lists on `accounts.changed`; the sidebar tree needs nothing from it.
  const wizard = createWizardStore({ api, actor: USER, changes });
  // The Yeni proje page (U-40) reloads the tree the same way: a creation appends no event. Its
  // Docket AI thread reads the setup surface's own push events (setup.read.ask, the turn events).
  const newProject = createNewProjectStore({
    api,
    actor: USER,
    changes,
    reloadTree: () => tree.load(),
    pickFolders: (options) => bridge().pickFolders(options),
  });
  const accountsFrame = createAccountsFrameStore({ api, changes });
  // The provider marks every account badge reads: one query, kept for the session (A-41).
  const marks = createProviderMarksStore({ api });
  // The account view (U-20) shares the shell's coarse events and the machine's clock.
  const accountView = createAccountViewStore({ api, changes, now: () => Date.now() });
  const roadmap = createRoadmapStore({ api, changes });
  void tree.load();
  void accountsFrame.load();
  void marks.load();
  // The first-run machine's entry point: it shows the wizard only when no project exists (U-35).
  void wizard.open();

  createRoot(mount).render(
    <React.StrictMode>
      <ErrorBoundary locale={locale.current}>
        <App
          localeStore={locale}
          quit={quit}
          projectBundle={projectBundle}
          themeStore={theme}
          candidates={candidates}
          candidateList={candidateList}
          providerList={providerList}
          connectorsList={connectorsList}
          shell={shell}
          tree={tree}
          accounts={accountsFrame}
          cockpit={cockpit}
          board={board}
          roadmap={roadmap}
          detail={detail}
          pageList={pageList}
          pageViewer={pageViewer}
          pageHost={pageHost}
          library={library}
          chat={chat}
          proposals={proposals}
          accountView={accountView}
          settings={settings}
          models={accountModels}
          roles={roles}
          marks={marks}
          update={update}
          wizard={wizard}
          newProject={newProject}
          timeZone={timeZone}
        />
      </ErrorBoundary>
    </React.StrictMode>,
  );
  }
}
