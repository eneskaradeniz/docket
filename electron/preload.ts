// preload.ts — the renderer's only bridge to the core. Exactly one surface crosses the context
// bridge (`window.docket`) with the api's three members plus the page view's calls and its closed notice:
// commands, queries and page-view calls ride ipcRenderer.invoke; events ride one channel and are
// forwarded to the listener, so no ipcRenderer or Node object ever reaches the renderer. Built as CommonJS: a sandboxed preload runs without an ESM
// context, so the bundler emits a .cjs file.
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type { Actor } from '../src/domain/index';
import type { Api, CommandResult, UiEvent } from '../src/api/index';

/** `Pick<Api>` keeps the bridge exactly the transport-free contract — the same shape a later HTTP
 *  transport would serve. `CommandResult` is named here only because invoke's return is untyped. */
export type DocketBridge = Pick<Api, 'command' | 'query' | 'subscribe'> & { readonly pageView: PageViewBridge };

export interface PageViewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PageViewReply =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'invalid' | 'not_found' | 'forbidden' };

/** The page view's whole surface: place one isolated view over the window, move it, remove it. The
 *  main process validates every field again; each call here carries only its own named fields. */
export interface PageViewBridge {
  open(request: { readonly pageId: string; readonly version: number; readonly bounds: PageViewBounds }): Promise<PageViewReply>;
  setBounds(request: { readonly bounds: PageViewBounds }): Promise<PageViewReply>;
  close(): Promise<PageViewReply>;
  /** Fires when the main process tore the view down on its own (the page's process died or hung).
   *  The listener gets no argument: the notice is only a signal, nothing from the page reaches it. */
  onClosed(listener: () => void): () => void;
}

/** Every live subscriber, fanned out by the ONE channel listener below. The renderer's stores
 *  subscribe for the whole session and never unsubscribe, so a listener per subscriber would grow
 *  with the store count and trip the EventEmitter limit as a console warning. */
const subscribers = new Set<(event: UiEvent) => void>();

/** The view-closed notice's subscribers, behind one listener for the same reason. */
const closedListeners = new Set<() => void>();
ipcRenderer.on('docket:page-view-closed', (): void => {
  for (const listener of [...closedListeners]) listener();
});

ipcRenderer.on('docket:event', (_event: IpcRendererEvent, event: UiEvent): void => {
  // A copy: a subscriber may unsubscribe inside its own dispatch, and the rest still receive it.
  for (const subscriber of [...subscribers]) subscriber(event);
});

const bridge: DocketBridge = {
  command: (actor: Actor, command: Parameters<Api['command']>[1]): Promise<CommandResult> =>
    ipcRenderer.invoke('docket:command', actor, command),

  query: (query: Parameters<Api['query']>[0]): Promise<unknown> =>
    ipcRenderer.invoke('docket:query', query),

  pageView: {
    open: ({ pageId, version, bounds }) => ipcRenderer.invoke('docket:page-view', { op: 'open', pageId, version, bounds }),
    setBounds: ({ bounds }) => ipcRenderer.invoke('docket:page-view', { op: 'setBounds', bounds }),
    close: () => ipcRenderer.invoke('docket:page-view', { op: 'close' }),
    onClosed: (listener) => {
      closedListeners.add(listener);
      return () => {
        closedListeners.delete(listener);
      };
    },
  },

  subscribe: (listener: (event: UiEvent) => void): (() => void) => {
    subscribers.add(listener);
    // The unsubscribe must actually drop its subscriber — a leak here would deliver every future
    // event to a store that no longer exists.
    return () => {
      subscribers.delete(listener);
    };
  },
};

contextBridge.exposeInMainWorld('docket', bridge);

/** The dev bridge's thin window: one invoke and nothing else. It is exposed in every build on
 *  purpose — with no gated handler behind it the invoke simply rejects, so a test session in a
 *  real (non-test) launch learns the bridge is absent instead of finding a silent undefined. */
export interface DocketDevBridge {
  call(op: string, args?: unknown): Promise<{ readonly truncated: boolean; readonly payload: string }>;
}

const devBridge: DocketDevBridge = {
  call: (op, args) => ipcRenderer.invoke('docket:dev', op, args),
};

contextBridge.exposeInMainWorld('docketDev', devBridge);
