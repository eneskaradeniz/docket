// use-cases/mcp-status.ts — Docket's own MCP standing for the menu row (A-361, A-362): the
// control's state plus the server's own tool-list constants (names only, never a running
// process) and the library roles whose current version opted out of Docket's tools (R-81). The
// view carries no secret, no token and no environment value — an opt-out stays the operator's
// per-role choice; nothing here reads or changes it.
import { err, ok, type Result } from '../../domain/index';

import type { AppDeps, McpListenerRestartError, McpListenerState } from '../ports';
import { DOCKET_TOOL_DEFINITIONS_BY_KIND } from '../services/docket-tools';

export interface McpStatusView {
  readonly state: 'running' | 'stopped';
  readonly reason?: 'no_endpoint' | 'listener_down' | 'script_missing';
  readonly tools: { readonly run: readonly string[]; readonly chat: readonly string[] };
  readonly rolesWithout: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Library roles whose current version sets `docketTools: false`: the ids the row's "N rolde
 *  kapalı" line counts. The latest version decides — a role that re-enabled itself drops out —
 *  and the built-in roles carry no opt-out, so the library is the whole set. */
export const rolesWithoutDocketTools = async (deps: Pick<AppDeps, 'definitions'>): Promise<readonly string[]> => {
  const optedOut: string[] = [];
  for (const id of await deps.definitions.listIds('roles')) {
    const history = await deps.definitions.listVersions('roles', id);
    const latest = history[history.length - 1];
    if (latest !== undefined && isRecord(latest.body) && latest.body['docketTools'] === false) optedOut.push(id);
  }
  return optedOut;
};

const viewOf = (standing: McpListenerState, rolesWithout: readonly string[]): McpStatusView => ({
  state: standing.state,
  ...(standing.state === 'stopped' ? { reason: standing.reason } : {}),
  tools: {
    run: DOCKET_TOOL_DEFINITIONS_BY_KIND.run.map((tool) => tool.name),
    chat: DOCKET_TOOL_DEFINITIONS_BY_KIND.chat.map((tool) => tool.name),
  },
  rolesWithout,
});

export const mcpStatusView = async (deps: Pick<AppDeps, 'mcpListener' | 'definitions'>): Promise<McpStatusView> =>
  viewOf(deps.mcpListener.status(), await rolesWithoutDocketTools(deps));

/** One restart, then the fresh status; each refusal keeps its typed error. */
export const restoreMcpListener = async (
  deps: Pick<AppDeps, 'mcpListener' | 'definitions'>,
): Promise<Result<McpStatusView, McpListenerRestartError>> => {
  const restarted = await deps.mcpListener.restart();
  if (!restarted.ok) return err(restarted.error);
  return ok(await mcpStatusView(deps));
};
