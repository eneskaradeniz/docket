import { err, ok, type Actor, type EpochMs, type ProposalId, type Result } from '../shared';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'stale';

export interface Proposal {
  readonly id: ProposalId;
  readonly author: Actor;
  readonly createdAt: EpochMs;
  readonly target: string; // definition file path relative to its root, e.g. "flows/odoo.yaml"
  readonly baseHash: string; // hash of the file when proposed (computed outside the domain)
  readonly before: string;
  readonly after: string;
  readonly summary: string;
  readonly status: ProposalStatus;
  readonly decidedBy?: Actor;
  readonly decidedAt?: EpochMs;
}

export type ProposalError = { readonly code: 'not_pending' | 'stale' | 'self_approval' };

/**
 * The only path by which AI changes configuration: a pending proposal decided by a user, never
 * against a file that changed since it was proposed. Checks are ordered so the fault reported is
 * the first one hit: a proposal that is no longer pending is never decidable, approval is
 * reserved to user actors, and approval against a changed file is stale.
 */
export function decideProposal(
  p: Proposal,
  decision: 'approved' | 'rejected',
  by: Actor,
  currentHash: string,
  now: EpochMs,
): Result<Proposal, ProposalError> {
  if (p.status !== 'pending') return err({ code: 'not_pending' });
  if (decision === 'approved') {
    if (by.kind !== 'user') return err({ code: 'self_approval' });
    if (currentHash !== p.baseHash) return err({ code: 'stale' });
  }
  return ok({
    id: p.id,
    author: p.author,
    createdAt: p.createdAt,
    target: p.target,
    baseHash: p.baseHash,
    before: p.before,
    after: p.after,
    summary: p.summary,
    status: decision,
    decidedBy: by,
    decidedAt: now,
  });
}
