// ports/mcp-listener-control.ts — Docket's own MCP listener as the composition that starts it
// sees it (A-380, A-381): one pure read of the standing, one repair action. The Electron
// composition implements this around the listener it already starts; the port itself starts
// nothing, and neither member ever reads or returns a secret or a token value.
import { err, type Result } from '../../domain/index';

export type McpListenerState =
  | { readonly state: 'running' }
  | { readonly state: 'stopped'; readonly reason: 'no_endpoint' | 'listener_down' | 'script_missing' };

/** Why a restart refused — the stopped reasons in restart vocabulary. */
export type McpListenerRestartError = 'endpoint_unavailable' | 'listener_failed' | 'script_missing';

export interface McpListenerControl {
  status(): McpListenerState;
  restart(): Promise<Result<McpListenerState, McpListenerRestartError>>;
}

/** The standing of a shell that runs no endpoint at all: every read says so, every restart
 *  refuses with its own word. A composition that starts no listener hands this to the bundle
 *  instead of `undefined`, so the status view always answers. */
export const createNoEndpointMcpListenerControl = (): McpListenerControl => ({
  status: (): McpListenerState => ({ state: 'stopped', reason: 'no_endpoint' }),
  restart: (): Promise<Result<McpListenerState, McpListenerRestartError>> => Promise.resolve(err('endpoint_unavailable')),
});
