// connectors family barrel — one folder per connector beside this file; connector folders never
// import each other. The composition root reads this static list; a connector enters it only with
// its conformance suite green.
import type { ConnectorModule } from '../../application/index';

import { connector as githubConnector } from './github';

export const BUILTIN_CONNECTORS: readonly ConnectorModule[] = [githubConnector];

export * from './github';
