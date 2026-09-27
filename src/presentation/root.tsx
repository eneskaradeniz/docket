// root.tsx — the renderer's mount point: it types the injected bridge, composes the shell's stores
// from that bridge alone, and mounts React into the page's root element. The bridge is the only
// api access here; every store takes its deps by injection, so composition stays the single place
// where the real sources are named.
import React from 'react';
import { createRoot } from 'react-dom/client';

import type { Api } from '../api/index';
import type { WorkspaceListItem } from '../api/queries';
import type { Actor } from '../domain/index';
import { ShellScreen } from './screens/shell';
import { createBoardStore } from './stores/board';
import { createCockpitStore } from './stores/cockpit';
import { createLivePaneStore } from './stores/live-pane';
import { createLocaleStore } from './stores/locale';
import { isQueryFailure } from './stores/results';
import { createSettingsStore } from './stores/settings';
import { createShellStore, type ShellWorkspace } from './stores/shell';
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

/** The workspace switcher's entries: every workspace the machine knows, read off `workspaces.list`.
 *  The labels are the slugs — the registry holds no display copy. A failed read empties the
 *  listing the same way the cockpit projection did; the shell's own load failure keeps whatever it
 *  showed before. */
const workspaceEntries = (api: DocketBridge) => async (): Promise<readonly ShellWorkspace[]> => {
  const reply: unknown = await api.query({ type: 'workspaces.list' });
  if (isQueryFailure(reply)) return [];
  return (reply as readonly WorkspaceListItem[]).map((row) => ({ id: row.id, label: row.id }));
};

/** The wizard's workspace-existence check: `workspaces.list` is the machine's registry, so any
 *  known workspace counts — including one whose work orders are all calm — and a dismissed wizard
 *  stays gone across relaunches. A failed read still answers false: an unverifiable existence must
 *  never suppress the first-run setup (fail-closed). */
const workspaceExists = (api: DocketBridge) => async (): Promise<boolean> => {
  const reply: unknown = await api.query({ type: 'workspaces.list' });
  if (isQueryFailure(reply)) return false;
  return (reply as readonly WorkspaceListItem[]).length > 0;
};

/** The wizard's source probe rides the board read, the one read that loads definitions: a
 *  non-failure reply proves the entered workspace's definitions were found and parsed, which is
 *  the whole question; every failure (a malformed slug, unreadable definitions) answers false —
 *  fail-closed. No api query probes a source path directly yet; the injection point swaps when one
 *  lands, without touching the wizard store. */
const sourceReachable = (api: DocketBridge) => async (source: string): Promise<boolean> => {
  const reply: unknown = await api.query({ type: 'workspace.board', workspace: source });
  return !isQueryFailure(reply);
};

const mount = document.getElementById('root');
if (mount !== null) {
  const api = bridge();
  const changes = api.subscribe;
  const locale = createLocaleStore(window.localStorage);
  // The meters' reset times render in the machine's zone; tests pass 'UTC' instead.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const cockpit = createCockpitStore({ api, changes, now: () => Date.now() });
  const board = createBoardStore({ api, changes, actor: USER });
  // The live pane has no run at composition time — the detail store attaches it to the active
  // run of whichever work order loads.
  const pane = createLivePaneStore({ api, changes, actor: USER });
  const detail = createWorkOrderDetailStore({ api, changes, actor: USER, pane });
  const settings = createSettingsStore({ api, changes, actor: USER, locale: locale.current, timeZone });
  const wizard = createWizardStore({
    api,
    actor: USER,
    sourceReachable: sourceReachable(api),
    workspaceExists: workspaceExists(api),
  });
  const shell = createShellStore({ api, changes, workspaces: workspaceEntries(api) });
  // The first-run machine's entry point: it shows the wizard only when no workspace exists (U-7).
  void wizard.open();

  createRoot(mount).render(
    <React.StrictMode>
      <ShellScreen
        shell={shell}
        cockpit={cockpit}
        board={board}
        detail={detail}
        settings={settings}
        wizard={wizard}
        locale={locale.current()}
      />
    </React.StrictMode>,
  );
}
