// github connector folder barrel — the module's whole public surface. The forge wiring under
// infrastructure/forge/ builds these same adapters until the connector registry replaces it.
import type { ConnectorModule } from '../../../application/index';

import { isGhCliAuthenticated } from './cli';
import { createGhForge } from './github';
import { createGhTracker } from './github-tracker';
import { githubManifest } from './manifest';

/** The github connector: both ports over the gh CLI, ready exactly when the CLI is logged in. */
export const connector: ConnectorModule = {
  manifest: githubManifest,
  createForge: createGhForge,
  createTracker: createGhTracker,
  probe: isGhCliAuthenticated,
};

export * from './github';
export * from './github-tracker';
export * from './cli';
export * from './manifest';
