// root.tsx — the renderer's mount point: it types the injected bridge, composes the shell's stores
// from that bridge alone, and mounts React into the page's root element. The bridge is the only
// api access here; every store takes its deps by injection, so composition stays the single place
// where the real sources are named.
import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import type { Api } from '../api/index';
import type { Actor } from '../domain/index';
import { ErrorBoundary } from './components/error-boundary';
import { ShellScreen, type ShellScreenProps } from './screens/shell';
import { createAccountsFrameStore } from './stores/accounts-frame';
import { createAccountModelsStore } from './stores/account-models';
import { createRolesStore } from './stores/roles';
import { createAccountViewStore } from './stores/account-view';
import { createBoardStore } from './stores/board';
import { createCockpitStore } from './stores/cockpit';
import { createLivePaneStore } from './stores/live-pane';
import { createLocaleStore, type LocaleStore } from './stores/locale';
import { createProjectTreeStore } from './stores/project-tree';
import { createRoadmapStore } from './stores/roadmap';
import { createCandidatesStore } from './stores/candidates';
import { createProvidersStore } from './stores/providers';
import { createSettingsStore } from './stores/settings';
import { createCandidateDotStore } from './stores/settings-panel';
import { createShellStore } from './stores/shell';
import { createThemeStore, mediaSchemeSource } from './stores/theme';
import { createProviderMarksStore } from './stores/provider-marks';
import { createUpdateStore } from './stores/update';
import { createWizardStore } from './stores/wizard';
import { createWorkOrderDetailStore } from './stores/work-order-detail';

/** Exactly the surface the preload exposes under `window.docket` — the api's members, reached
 *  only through their types; no bridge implementation ever lives in this layer. */
export type DocketBridge = Pick<Api, 'command' | 'query' | 'subscribe'>;

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
function App({ localeStore, ...screens }: Omit<ShellScreenProps, 'locale'> & { readonly localeStore: LocaleStore }) {
  const locale = useSyncExternalStore(localeStore.subscribe, localeStore.current);
  return <ShellScreen {...screens} localeStore={localeStore} locale={locale} />;
}

const mount = document.getElementById('root');
if (mount !== null) {
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
  // The list under Hesaplar → Eklenmemiş; an adoption re-reads the dot.
  const candidateList = createCandidatesStore({ api, actor: USER, onAdopted: () => void candidates.load() });
  const providerList = createProvidersStore({ api });
  // The meters' reset times render in the machine's zone; tests pass 'UTC' instead.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const cockpit = createCockpitStore({ api, changes, now: () => Date.now(), actor: USER, persistence: window.localStorage });
  const board = createBoardStore({ api, changes, actor: USER, persistence: window.localStorage });
  // The live pane has no run at composition time — the detail store attaches it to the active
  // run of whichever work order loads.
  const pane = createLivePaneStore({ api, changes, actor: USER });
  const detail = createWorkOrderDetailStore({ api, changes, actor: USER, pane });
  const settings = createSettingsStore({ api, changes, actor: USER, locale: locale.current, timeZone });
  // The settings panel's per-account model list and its spend-consent flow (P-40).
  const accountModels = createAccountModelsStore({ api, changes, actor: USER });
  // The Roller section: roles.list with the stored bindings (U-33).
  const roles = createRolesStore({ api, changes, actor: USER, now: () => Date.now() });
  const shell = createShellStore({ api, changes });
  // The app's own newer version — the title bar's button and the panel's Güncelleme section.
  const update = createUpdateStore({ api, changes, actor: USER });
  // The sidebar's tree (U-15) and accounts frame (U-16) mirror their queries; the sort choice
  // persists where the locale choice does.
  const tree = createProjectTreeStore({ api, changes, now: () => Date.now(), persistence: window.localStorage });
  // The wizard's attach appends no work-order event, so it reloads the tree itself.
  const wizard = createWizardStore({ api, actor: USER, reloadTree: () => tree.load() });
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
          themeStore={theme}
          candidates={candidates}
          candidateList={candidateList}
          providerList={providerList}
          shell={shell}
          tree={tree}
          accounts={accountsFrame}
          cockpit={cockpit}
          board={board}
          roadmap={roadmap}
          detail={detail}
          accountView={accountView}
          settings={settings}
          models={accountModels}
          roles={roles}
          marks={marks}
          update={update}
          wizard={wizard}
          timeZone={timeZone}
        />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
