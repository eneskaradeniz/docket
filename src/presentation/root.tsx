// root.tsx — the renderer's mount point: it types the injected bridge, composes the shell's stores
// from that bridge alone, and mounts React into the page's root element. The bridge is the only
// api access here; every store takes its deps by injection, so composition stays the single place
// where the real sources are named.
import React from 'react';
import { createRoot } from 'react-dom/client';

import type { Api } from '../api/index';
import type { CockpitView } from '../api/queries';
import type { Actor } from '../domain/index';
import { ShellScreen } from './screens/shell';
import { createBoardStore } from './stores/board';
import { createCockpitStore } from './stores/cockpit';
import { createLocaleStore } from './stores/locale';
import { isQueryFailure } from './stores/results';
import { createShellStore, type ShellWorkspace } from './stores/shell';
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

/** The workspace switcher's entries. No api query enumerates workspaces (the same gap the wizard
 *  store's injected existence check hit), so until one lands the listing projects the distinct
 *  workspaces the cockpit reply already names — real data, no new api surface, and the injection
 *  point swaps to the real enumeration without touching the shell. */
const workspaceEntries = (api: DocketBridge) => async (): Promise<readonly ShellWorkspace[]> => {
  const view: unknown = await api.query({ type: 'cockpit' });
  if (isQueryFailure(view)) return [];
  const named = new Map<string, ShellWorkspace>();
  for (const item of (view as CockpitView).attention) {
    if (!named.has(item.workspace)) named.set(item.workspace, { id: item.workspace, label: item.workspace });
  }
  return [...named.values()];
};

const mount = document.getElementById('root');
if (mount !== null) {
  const api = bridge();
  const changes = api.subscribe;
  // The workspace registry below the api has no read that serves the detail screen's gate list
  // yet, so the loader reports unavailability and the detail shows its problem state for gates.
  const definitions = async () => null;
  const locale = createLocaleStore(window.localStorage);

  const cockpit = createCockpitStore({ api, changes, now: () => Date.now() });
  const board = createBoardStore({ api, changes, actor: USER });
  const detail = createWorkOrderDetailStore({ api, changes, actor: USER, definitions });
  const shell = createShellStore({ api, changes, workspaces: workspaceEntries(api) });

  createRoot(mount).render(
    <React.StrictMode>
      <ShellScreen shell={shell} cockpit={cockpit} board={board} detail={detail} locale={locale.current()} />
    </React.StrictMode>,
  );
}
