import type { Workspace } from '../../core/types';
import { REPOS, WORKSPACES } from './ids';

export const workspaces: Workspace[] = [
  {
    id: WORKSPACES.docket,
    label: 'Docket',
    repos: [REPOS.docketApp],
    decisionStore: REPOS.docketApp,
  },
  {
    id: WORKSPACES.dateapp,
    label: 'DateApp',
    repos: [REPOS.dateappApi, REPOS.dateappMobile, REPOS.dateappDocs],
    decisionStore: REPOS.dateappDocs,
  },
];
