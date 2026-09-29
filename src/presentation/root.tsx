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
import { createAccountViewStore } from './stores/account-view';
import { createBoardStore } from './stores/board';
import { createCockpitStore } from './stores/cockpit';
import { createLivePaneStore } from './stores/live-pane';
import { createLocaleStore, type LocaleStore } from './stores/locale';
import { createProjectTreeStore } from './stores/project-tree';
import { isQueryFailure } from './stores/results';
import { createSettingsStore } from './stores/settings';
import { createShellStore } from './stores/shell';
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

/** The wizard's source probe rides the board read, the one read that loads definitions: a
 *  non-failure reply proves the entered repo's definitions were found and parsed, which is
 *  the whole question; every failure (a malformed slug, unreadable definitions) answers false —
 *  fail-closed. No api query probes a source path directly yet; the injection point swaps when one
 *  lands, without touching the wizard store. */
const sourceReachable = (api: DocketBridge) => async (source: string): Promise<boolean> => {
  const reply: unknown = await api.query({ type: 'repo.board', repo: source });
  return !isQueryFailure(reply);
};

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
  // The meters' reset times render in the machine's zone; tests pass 'UTC' instead.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const cockpit = createCockpitStore({ api, changes, now: () => Date.now(), actor: USER });
  const board = createBoardStore({ api, changes, actor: USER, persistence: window.localStorage });
  // The live pane has no run at composition time — the detail store attaches it to the active
  // run of whichever work order loads.
  const pane = createLivePaneStore({ api, changes, actor: USER });
  const detail = createWorkOrderDetailStore({ api, changes, actor: USER, pane });
  const settings = createSettingsStore({ api, changes, actor: USER, locale: locale.current, timeZone });
  const wizard = createWizardStore({
    api,
    actor: USER,
    sourceReachable: sourceReachable(api),
  });
  const shell = createShellStore({ api, changes });
  // The sidebar's tree (U-15) and accounts frame (U-16) mirror their queries; the sort choice
  // persists where the locale choice does.
  const tree = createProjectTreeStore({ api, changes, now: () => Date.now(), persistence: window.localStorage });
  const accountsFrame = createAccountsFrameStore({ api, changes });
  // The account view (U-20) shares the shell's coarse events and the machine's clock.
  const accountView = createAccountViewStore({ api, changes, now: () => Date.now() });
  void tree.load();
  void accountsFrame.load();
  // The first-run machine's entry point: it shows the wizard only when no project exists (U-7).
  void wizard.open();

  createRoot(mount).render(
    <React.StrictMode>
      <ErrorBoundary locale={locale.current}>
        <App
          localeStore={locale}
          shell={shell}
          tree={tree}
          accounts={accountsFrame}
          cockpit={cockpit}
          board={board}
          detail={detail}
          accountView={accountView}
          settings={settings}
          wizard={wizard}
          timeZone={timeZone}
        />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
