// Branding constructors + shared identities. The adapter is the only place that constructs
// branded IDs (ADR-0003 rule 1: project-specific strings live here, never in core or ui).
import type { RepoId, TrackId, WorkOrderId, WorkspaceId } from '../../core/types';

export const wid = (id: string): WorkspaceId => id as WorkspaceId;
export const rid = (id: string): RepoId => id as RepoId;
export const woid = (id: string): WorkOrderId => id as WorkOrderId;
export const tid = (id: string): TrackId => id as TrackId;

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
