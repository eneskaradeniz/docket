// Fixture identity constants. The branding constructors live in the shared
// src/adapters/ids.ts (also used by the SQLite store); re-exported here so existing
// fixture modules keep importing from './ids'.
import { rid, wid } from '../ids';

export { wid, rid, woid, tid } from '../ids';

export const WORKSPACES = {
  docket: wid('docket'),
  dateapp: wid('dateapp'),
} as const;

export const REPOS = {
  docketApp: rid('app'),
  dateappApi: rid('dateapp-api'),
  dateappMobile: rid('dateapp-mobile'),
  dateappDocs: rid('dateapp-docs'),
} as const;
