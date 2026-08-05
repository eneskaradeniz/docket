// Branding constructors — the single shared site that constructs branded IDs (ADR-0003
// rule 1: project-specific strings live in adapters, never in core or ui). Shared by the
// fixture adapter and the SQLite store adapter so both re-brand strings read from their
// respective sources in one place.
import type { RepoId, TrackId, WorkOrderId, WorkspaceId } from '../core/types';

export const wid = (id: string): WorkspaceId => id as WorkspaceId;
export const rid = (id: string): RepoId => id as RepoId;
export const woid = (id: string): WorkOrderId => id as WorkOrderId;
export const tid = (id: string): TrackId => id as TrackId;
