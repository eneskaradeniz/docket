// preload.ts — the renderer's only bridge to the core. Exactly one surface crosses the context
// bridge (`window.docket`) with the api's three members: commands and queries ride ipcRenderer
// .invoke; events ride one channel and are forwarded to the listener, so no ipcRenderer or Node
// object ever reaches the renderer. Built as CommonJS: a sandboxed preload runs without an ESM
// context, so the bundler emits a .cjs file.
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type { Actor } from '../src/domain/index';
import type { Api, CommandResult, UiEvent } from '../src/api/index';

/** `Pick<Api>` keeps the bridge exactly the transport-free contract — the same shape a later HTTP
 *  transport would serve. `CommandResult` is named here only because invoke's return is untyped. */
export type DocketBridge = Pick<Api, 'command' | 'query' | 'subscribe'>;

const bridge: DocketBridge = {
  command: (actor: Actor, command: Parameters<Api['command']>[1]): Promise<CommandResult> =>
    ipcRenderer.invoke('docket:command', actor, command),

  query: (query: Parameters<Api['query']>[0]): Promise<unknown> =>
    ipcRenderer.invoke('docket:query', query),

  subscribe: (listener: (event: UiEvent) => void): (() => void) => {
    const forward = (_event: IpcRendererEvent, event: UiEvent): void => {
      listener(event);
    };
    ipcRenderer.on('docket:event', forward);
    // The unsubscribe must actually drop the IPC listener — a leak here would deliver every
    // future event to a store that no longer exists.
    return () => {
      ipcRenderer.removeListener('docket:event', forward);
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
