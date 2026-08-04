// Test-data builders for the named invariant cases + edges (AC10). Test-only brand casts;
// production construction stays in the adapter. Six-state coverage uses the fixture adapter.
import type {
  RepoId,
  SessionRef,
  Track,
  TrackId,
  WorkOrder,
  WorkOrderId,
  WorkspaceId,
} from '../types';

const woid = (s: string): WorkOrderId => s as WorkOrderId;
const wid = (s: string): WorkspaceId => s as WorkspaceId;
const rid = (s: string): RepoId => s as RepoId;
const tid = (s: string): TrackId => s as TrackId;

export function aTrack(over: Partial<Omit<Track, 'id' | 'repo'>> & { id: string; repo: string }): Track {
  const { id, repo, ...rest } = over;
  return {
    id: tid(id),
    repo: rid(repo),
    dependsOn: [],
    stage: 'implementation',
    ci: { kind: 'run', state: 'running', checks: [] },
    ...rest,
  };
}

export function aSession(over: Partial<SessionRef> & { role: SessionRef['role'] }): SessionRef {
  return { transcript: [], ...over } as SessionRef;
}

export function aWorkOrder(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: woid('WO-T'),
    title: 'Test work order',
    workspace: wid('docket'),
    mode: 'plan',
    stage: 'implementation',
    tracks: [],
    sessions: [],
    gateInputs: { planApproved: true },
    cost: { tokensIn: 0, tokensOut: 0, usd: 0 },
    sources: [],
    ...over,
  } as WorkOrder;
}
