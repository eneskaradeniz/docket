// use-cases/proposal-views.ts — the read side of proposals: the list rows and one proposal with
// its line diff. Pure reads: nothing here decides, saves or audits, and proposal text is returned
// unchanged and never logged.
import type { Actor, DiffLine, ProposalId, ProposalStatus } from '../../domain/index';
import { diffLines } from '../../domain/index';

import type { AppDeps, ProposalRecord } from '../ports';

export interface ProposalListItem {
  readonly id: string;
  readonly summary: string;
  readonly target: string;
  readonly scopeKind: 'global' | 'project' | 'repo';
  readonly scopeId?: string;
  readonly status: ProposalStatus;
  readonly author: { readonly kind: Actor['kind']; readonly label: string };
  readonly createdAt: number;
  readonly decidedAt?: number;
  readonly decidedBy?: string;
}

export interface ProposalDetailView extends ProposalListItem {
  readonly before: string;
  readonly after: string;
  readonly lines: readonly DiffLine[];
  readonly truncated: boolean;
  /** A pending proposal whose target file no longer has the hash it was proposed against. */
  readonly currentlyStale: boolean;
}

const labelOf = (actor: Actor): string => {
  switch (actor.kind) {
    case 'user':
      return actor.label ?? actor.id;
    case 'agent':
      return actor.role;
    case 'system':
      return actor.component;
  }
};

const itemOf = (record: ProposalRecord): ProposalListItem => ({
  id: record.id,
  summary: record.summary,
  target: record.target,
  scopeKind: record.scope.kind,
  ...(record.scope.kind === 'project' ? { scopeId: record.scope.project } : {}),
  ...(record.scope.kind === 'repo' ? { scopeId: record.scope.repo } : {}),
  status: record.status,
  author: { kind: record.author.kind, label: labelOf(record.author) },
  createdAt: record.createdAt,
  ...(record.decidedAt === undefined ? {} : { decidedAt: record.decidedAt }),
  ...(record.decidedBy === undefined ? {} : { decidedBy: labelOf(record.decidedBy) }),
});

/** Newest first; without a filter the pending ones lead. The id breaks ties so the order is total. */
export async function listProposals(
  deps: Pick<AppDeps, 'proposals'>,
  input: { readonly status?: ProposalStatus },
): Promise<readonly ProposalListItem[]> {
  const records = await deps.proposals.list(input.status === undefined ? {} : { status: input.status });
  const rank = (r: ProposalRecord): number => (input.status === undefined && r.status === 'pending' ? 0 : 1);
  return [...records]
    .sort((x, y) => rank(x) - rank(y) || y.createdAt - x.createdAt || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0))
    .map(itemOf);
}

/** undefined = no such proposal. */
export async function proposalDetail(
  deps: Pick<AppDeps, 'proposals' | 'definitions'>,
  id: ProposalId,
): Promise<ProposalDetailView | undefined> {
  const record = await deps.proposals.get(id);
  if (record === undefined) return undefined;
  const diff = diffLines(record.before, record.after);
  let currentlyStale = false;
  if (record.status === 'pending') {
    const file = await deps.definitions.readFile(record.scope, record.target);
    currentlyStale = (file?.hash ?? '') !== record.baseHash;
  }
  return {
    ...itemOf(record),
    before: record.before,
    after: record.after,
    lines: diff.lines,
    truncated: diff.truncated,
    currentlyStale,
  };
}
