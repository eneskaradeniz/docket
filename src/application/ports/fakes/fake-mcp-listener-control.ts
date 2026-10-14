// In-memory McpListenerControl — the standing a test scripts, plus what the repair did. A
// restart on a running listener is the no-op the real control answers: it returns the standing
// without counting, so "a second call after success" stays observable as one restart.
import { err, ok, type Result } from '../../../domain/index';

import type { McpListenerControl, McpListenerRestartError, McpListenerState } from '../mcp-listener-control';

export interface FakeMcpListenerControl extends McpListenerControl {
  /** Replaces the standing the reads answer with. */
  set(state: McpListenerState): void;
  /** Makes every restart refuse with this error; the standing stays as scripted. */
  failWith(error: McpListenerRestartError): void;
  /** Real restart attempts: a refused one counts, a no-op on a running listener does not. */
  restarts(): number;
}

export const createFakeMcpListenerControl = (initial: McpListenerState = { state: 'running' }): FakeMcpListenerControl => {
  let standing = initial;
  let failure: McpListenerRestartError | undefined;
  let restarts = 0;
  return {
    status: (): McpListenerState => standing,
    restart: (): Promise<Result<McpListenerState, McpListenerRestartError>> => {
      if (standing.state === 'running') return Promise.resolve(ok(standing));
      if (failure !== undefined) return Promise.resolve(err(failure));
      restarts += 1;
      standing = { state: 'running' };
      return Promise.resolve(ok(standing));
    },
    set: (state: McpListenerState): void => {
      standing = state;
    },
    failWith: (error: McpListenerRestartError): void => {
      failure = error;
    },
    restarts: (): number => restarts,
  };
};
