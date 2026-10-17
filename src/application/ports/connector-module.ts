// The connector module contract (the connector addendum): one self-contained module per
// integration, described by its manifest and reaching the machine only through the context the
// registry hands it — no module receives a raw port, Node or Electron object. The registry
// injects the list; the application never imports a connector.
import type { ConnectorManifest } from '../../domain/index';

import type { ConnectorContext, ConnectorReadiness } from './connector-context';
import type { Forge } from './forge';
import type { IssueTracker } from './issue-tracker';

/** A shipped integration. `createCi`/`createDeploy` join the shape with their own ports — none
 *  exists yet, so the type promises only what a module can implement today. */
export interface ConnectorModule {
  readonly manifest: ConnectorManifest;
  /** The Forge for one local checkout; present iff the manifest provides 'forge'. */
  readonly createForge?: (repo: string, context: ConnectorContext) => Promise<Forge>;
  /** The IssueTracker for one local checkout; present iff the manifest provides 'tracker'. */
  readonly createTracker?: (repoPath: string, context: ConnectorContext) => IssueTracker;
  /** Readiness before first use: the declared CLI present and authenticated, probed not assumed. */
  readonly probe: (context: ConnectorContext, cwd: string) => Promise<ConnectorReadiness>;
}
