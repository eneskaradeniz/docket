// mcp/endpoint.ts — how the app launches its own MCP child. The CLI of a run starts the child
// itself from the run's isolated config; the command is the app's own executable switched to
// plain-Node mode (Electron's documented ELECTRON_RUN_AS_NODE), the script is the build's output
// beside the main bundle.
import { resolve } from 'node:path';

import type { McpEndpoint } from '../../application/index';

import { mcpSocketPath } from './ipc';

export const MCP_SCRIPT_NAME = 'docket-mcp.cjs';

/** The built child script, next to the main bundle (`dist-electron/` in dev and in the package). */
export const mcpScriptPath = (mainDir: string): string => resolve(mainDir, MCP_SCRIPT_NAME);

export function createMcpEndpoint(input: {
  readonly dataDir: string;
  readonly platform: string;
  /** `process.execPath` of the app. */
  readonly execPath: string;
  /** The directory of the main bundle. */
  readonly mainDir: string;
}): McpEndpoint {
  return {
    socketPath: mcpSocketPath(input.dataDir, input.platform),
    command: input.execPath,
    args: [mcpScriptPath(input.mainDir)],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}
