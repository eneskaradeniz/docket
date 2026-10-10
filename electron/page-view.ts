// page-view.ts — the thin Electron side of the isolated page view. Every decision (what a URL
// means, what may load or navigate, who may call, which options a view gets) lives in
// src/infrastructure/pages-view; this file only adapts real Electron objects to the structural
// slices that module speaks, and registers the scheme and the IPC channel.
import { WebContentsView, protocol, session } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

import type { PageFiles, PageRepo } from '../src/application/index';
import {
  PAGE_PARTITION,
  createPageResponder,
  createPageViewHost,
  installPageSession,
  registerPageScheme,
} from '../src/infrastructure/index';
import type {
  PageViewCaller,
  PageViewClosedReason,
  PageViewHandle,
  PageViewWindow,
  createPageViewTrace,
} from '../src/infrastructure/index';

/** The IPC channel the renderer's `window.docket.pageView` rides. */
export const PAGE_VIEW_CHANNEL = 'docket:page-view';
/** The push channel that tells the renderer its view went away on its own. */
export const PAGE_VIEW_CLOSED_CHANNEL = 'docket:page-view-closed';

/** Must run before the app is ready: a scheme cannot be privileged afterwards. */
export const registerPageSchemeWithElectron = (): void => registerPageScheme(protocol);

export interface ElectronPageViewDeps {
  /** The main window, or undefined when none is alive; only its top frame may drive the view. */
  readonly getWindow: () => BrowserWindow | undefined;
  readonly pages: Pick<PageRepo, 'get'>;
  readonly files: Pick<PageFiles, 'read'>;
  readonly onClosed: (reason: PageViewClosedReason) => void;
  /** Test launches only (the dev bridge's gate): records answered and cancelled requests. */
  readonly trace?: ReturnType<typeof createPageViewTrace>;
}

export const createElectronPageView = (deps: ElectronPageViewDeps) => {
  const pageSession = session.fromPartition(PAGE_PARTITION);
  const natives = new WeakMap<PageViewHandle, WebContentsView>();

  const host = createPageViewHost({
    createView: (options) => {
      const native = new WebContentsView({ webPreferences: { ...options.webPreferences } });
      const handle: PageViewHandle = {
        webContents: native.webContents,
        setBounds: (bounds) => native.setBounds({ ...bounds }),
      };
      natives.set(handle, native);
      return handle;
    },
    pages: deps.pages,
    window: (): PageViewWindow | undefined => {
      const win = deps.getWindow();
      if (win === undefined || win.isDestroyed()) return undefined;
      return {
        webContentsId: win.webContents.id,
        contentSize: () => {
          const [width = 0, height = 0] = win.getContentSize();
          return { width, height };
        },
        addView: (view) => {
          const native = natives.get(view);
          if (native !== undefined) win.contentView.addChildView(native);
        },
        removeView: (view) => {
          const native = natives.get(view);
          if (native !== undefined) win.contentView.removeChildView(native);
        },
      };
    },
    session: pageSession,
    onClosed: deps.onClosed,
  });

  installPageSession({
    session: pageSession,
    responder: createPageResponder({
      pages: deps.pages,
      files: deps.files,
      ...(deps.trace === undefined ? {} : { onServed: deps.trace.onServed }),
    }),
    currentPageId: () => host.currentPageId(),
    onBlocked: deps.trace?.onBlocked ?? (() => undefined),
  });

  return {
    host,
    /** The ipcMain handler: only the sender's identity is read here; the host decides. */
    handleIpc: (event: IpcMainInvokeEvent, payload: unknown) => {
      const frame = event.senderFrame;
      const caller: PageViewCaller = {
        webContentsId: event.sender.id,
        isMainFrame: frame !== null && frame.parent === null,
      };
      return host.handle(caller, payload);
    },
  };
};
