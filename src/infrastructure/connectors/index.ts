// connectors family barrel — one folder per connector beside this file; connector folders never
// import each other. The composition root reads this static list; a connector enters it only with
// its conformance suite green.
import type { ConnectorId } from '../../domain/index';
import type { ConnectorModule } from '../../application/index';

import { connector as githubConnector, githubManifest } from './github';

export const BUILTIN_CONNECTORS: readonly ConnectorModule[] = [githubConnector];

// What the app shipped enabled before the registry existed — the default set while the settings
// key is absent, so arrival of the registry changes no behaviour.
export const DEFAULT_ENABLED_CONNECTORS: readonly ConnectorId[] = [githubManifest.id];

export * from './context';

export * from './github';
