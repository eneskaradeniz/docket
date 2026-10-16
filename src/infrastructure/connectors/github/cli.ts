// The gh CLI readiness probe (the connector's `probe`): present and logged in, or not ready.
// Probed, never assumed — a missing or unauthenticated CLI answers false without logging.
import type { CommandRunner } from '../../../application/index';

const PROBE_TIMEOUT_MS = 15_000;

export const isGhCliAuthenticated = async (runner: CommandRunner, cwd: string): Promise<boolean> => {
  const present = await runner.run(cwd, 'gh --version', PROBE_TIMEOUT_MS);
  if (present.exitCode !== 0) return false;
  const authenticated = await runner.run(cwd, 'gh auth status', PROBE_TIMEOUT_MS);
  return authenticated.exitCode === 0;
};
