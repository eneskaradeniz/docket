// github connector folder barrel — the module's whole public surface. The adapters take the
// runner directly; the module wiring hands them the context's commands view of it, which is the
// whole machine surface this connector is allowed to touch.
import type { ConnectorModule } from '../../../application/index';

import { ghConnectorReadiness } from './cli';
import { createGhForge } from './github';
import { createGhTracker } from './github-tracker';
import { githubManifest } from './manifest';

/** The github connector: both ports over the gh CLI, ready exactly when the CLI is logged in. */
export const connector: ConnectorModule = {
  manifest: githubManifest,
  createForge: (repo, context) => createGhForge(repo, context.commands),
  createTracker: (repoPath, context) => createGhTracker(repoPath, context.commands),
  probe: (context, cwd) => ghConnectorReadiness(context.commands, cwd),
};

export * from './github';
export * from './github-tracker';
export * from './cli';
export * from './manifest';
