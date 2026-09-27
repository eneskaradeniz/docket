// root.tsx — the renderer's mount point, nothing more: it types the injected bridge and mounts
// React into the page's root element. Screens, navigation and routing arrive with their own
// issues; until then the root renders a bare themed surface so a mounted shell is visible
// without carrying any copy of its own.
import React from 'react';
import { createRoot } from 'react-dom/client';

import type { Api } from '../api/index';

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

const mount = document.getElementById('root');
if (mount !== null) {
  createRoot(mount).render(
    <React.StrictMode>
      <div className="min-h-dvh bg-bg text-ink" />
    </React.StrictMode>,
  );
}
