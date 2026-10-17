// The gh CLI readiness probe (the connector's `probe`): which of the two things a CLI connector
// can be missing it is — the binary, or the login. Probed, never assumed; a missing or
// unauthenticated CLI answers its state without logging.
import type { CommandRunner, ConnectorReadiness } from '../../../application/index';

const PROBE_TIMEOUT_MS = 15_000;

export const ghConnectorReadiness = async (runner: CommandRunner, cwd: string): Promise<ConnectorReadiness> => {
  const present = await runner.run(cwd, 'gh --version', PROBE_TIMEOUT_MS);
  if (present.exitCode !== 0) return 'needs_cli';
  const authenticated = await runner.run(cwd, 'gh auth status', PROBE_TIMEOUT_MS);
  return authenticated.exitCode === 0 ? 'ready' : 'needs_account';
};

/** The boolean view of the readiness the pre-registry resolvers still consume; the registry
 *  rewrite replaces them and this alias with it. */
export const isGhCliAuthenticated = async (runner: CommandRunner, cwd: string): Promise<boolean> =>
  (await ghConnectorReadiness(runner, cwd)) === 'ready';
