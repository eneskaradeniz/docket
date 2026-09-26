// use-cases/proposals.ts — the only path by which configuration changes: a proposal is created
// against the target file's current hash and decided by a user, with every staleness check the
// ports can answer. The domain decides; this layer only gathers evidence and writes results back.
import type { Actor, ProposalId, Result } from '../../domain/index';
import { decideProposal, err, ok } from '../../domain/index';

import type { AppDeps, DefinitionScope, ProposalRecord } from '../ports';

export type ProposeError = 'no_change';

export async function createProposal(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'proposals' | 'definitions'>,
  input: {
    readonly scope: DefinitionScope;
    readonly target: string;
    readonly after: string;
    readonly summary: string;
    readonly author: Actor;
  },
): Promise<Result<ProposalId, ProposeError>> {
  const file = await deps.definitions.readFile(input.scope, input.target);
  const before = file?.content ?? '';
  const baseHash = file?.hash ?? '';
  if (input.after === before) return err('no_change');

  const id = deps.ids.next<'proposal'>();
  const createdAt = deps.clock.now();
  await deps.proposals.save({
    id,
    author: input.author,
    createdAt,
    target: input.target,
    baseHash,
    before,
    after: input.after,
    summary: input.summary,
    status: 'pending',
    scope: input.scope,
  });
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: createdAt,
    actor: input.author,
    action: 'proposal.created',
    subject: { kind: 'proposal', id },
    detail: { target: input.target },
  });
  return ok(id);
}

export type ApplyError = 'not_found' | 'not_pending' | 'stale' | 'self_approval' | 'invalid_after';

export async function decideProposalUseCase(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'proposals' | 'definitions'>,
  input: {
    readonly id: ProposalId;
    readonly decision: 'approved' | 'rejected';
    readonly actor: Actor;
  },
): Promise<Result<ProposalRecord, ApplyError>> {
  const proposal = await deps.proposals.get(input.id);
  if (proposal === undefined) return err('not_found');

  const file = await deps.definitions.readFile(proposal.scope, proposal.target);
  const currentHash = file?.hash ?? '';

  if (input.decision === 'approved') {
    const candidate = await deps.definitions.validateCandidate(proposal.scope, proposal.target, proposal.after);
    if (!candidate.ok) return err('invalid_after');
  }

  const now = deps.clock.now();
  const decided = decideProposal(proposal, input.decision, input.actor, currentHash, now);
  if (!decided.ok) {
    // Only staleness leaves a mark: a proposal decided against a file that moved is saved as
    // stale so nobody re-decides a zombie. Every other refusal changes nothing.
    if (decided.error.code === 'stale') await deps.proposals.save({ ...proposal, status: 'stale' });
    return err(decided.error.code);
  }

  if (input.decision === 'approved') {
    const written = await deps.definitions.writeFile(proposal.scope, proposal.target, proposal.after, proposal.baseHash);
    // The file moved between the read and the write; the write guard is the last line of defence.
    if (!written.ok) {
      await deps.proposals.save({ ...proposal, status: 'stale' });
      return err('stale');
    }
  }

  const record: ProposalRecord = { ...decided.value, scope: proposal.scope };
  await deps.proposals.save(record);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: now,
    actor: input.actor,
    action: 'proposal.decided',
    subject: { kind: 'proposal', id: input.id },
    detail: { decision: input.decision },
  });
  return ok(record);
}
