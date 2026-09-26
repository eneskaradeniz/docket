import { describe, expect, it } from 'vitest';
import { decideProposal, type Proposal } from './proposal';
import type { Actor, ProposalId, RoleSlug, RunId } from '../shared';

const USER: Actor = { kind: 'user', id: 'u-1' };
const AGENT: Actor = {
  kind: 'agent',
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' as RunId,
  role: 'developer' as RoleSlug,
};
const SYSTEM: Actor = { kind: 'system', component: 'proposal-sweeper' };

const NOW = 2_000;
const HASH = 'hash-1';
const CHANGED_HASH = 'hash-2';

const baseProposal = (): Proposal => ({
  id: '01BX5ZZKBKACTAV9WEVGEMMVRZ' as ProposalId,
  author: AGENT,
  createdAt: 1_000,
  target: 'flows/odoo.yaml',
  baseHash: HASH,
  before: 'before text',
  after: 'after text',
  summary: 'raise the retry limit',
  status: 'pending',
});

describe('decideProposal', () => {
  it('R-36: a pending proposal can be approved', () => {
    const result = decideProposal(baseProposal(), 'approved', USER, HASH, NOW);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ status: 'approved', decidedBy: USER, decidedAt: NOW }),
    });
  });

  it('R-36: a pending proposal can be rejected', () => {
    const result = decideProposal(baseProposal(), 'rejected', USER, HASH, NOW);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ status: 'rejected', decidedBy: USER, decidedAt: NOW }),
    });
  });

  it('R-36: an already approved proposal is not_pending', () => {
    const approved = { ...baseProposal(), status: 'approved' as const, decidedBy: USER, decidedAt: NOW };
    expect(decideProposal(approved, 'approved', USER, HASH, NOW)).toEqual({
      ok: false,
      error: { code: 'not_pending' },
    });
  });

  it('R-36: an already rejected proposal is not_pending', () => {
    const rejected = { ...baseProposal(), status: 'rejected' as const, decidedBy: USER, decidedAt: NOW };
    expect(decideProposal(rejected, 'rejected', USER, CHANGED_HASH, NOW)).toEqual({
      ok: false,
      error: { code: 'not_pending' },
    });
  });

  it('R-36: a proposal the caller marked stale is not_pending', () => {
    const stale = { ...baseProposal(), status: 'stale' as const };
    expect(decideProposal(stale, 'approved', USER, CHANGED_HASH, NOW)).toEqual({
      ok: false,
      error: { code: 'not_pending' },
    });
  });

  it('R-37: approving when the file hash still matches the base hash is ok', () => {
    const result = decideProposal(baseProposal(), 'approved', USER, HASH, NOW);
    expect(result.ok).toBe(true);
  });

  it('R-37: approving when the file changed since the proposal is stale', () => {
    expect(decideProposal(baseProposal(), 'approved', USER, CHANGED_HASH, NOW)).toEqual({
      ok: false,
      error: { code: 'stale' },
    });
  });

  it('R-37: rejecting a proposal whose file changed is allowed', () => {
    const result = decideProposal(baseProposal(), 'rejected', USER, CHANGED_HASH, NOW);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ status: 'rejected', decidedBy: USER, decidedAt: NOW }),
    });
  });

  it('R-37: rejecting a proposal whose file is unchanged is allowed', () => {
    const result = decideProposal(baseProposal(), 'rejected', USER, HASH, NOW);
    expect(result.ok).toBe(true);
  });

  it('R-37: the hash comparison is exact string equality', () => {
    expect(decideProposal(baseProposal(), 'approved', USER, `${HASH} `, NOW)).toEqual({
      ok: false,
      error: { code: 'stale' },
    });
    expect(decideProposal(baseProposal(), 'approved', USER, HASH.toUpperCase(), NOW)).toEqual({
      ok: false,
      error: { code: 'stale' },
    });
  });

  it('R-38: an agent actor can never approve', () => {
    expect(decideProposal(baseProposal(), 'approved', AGENT, HASH, NOW)).toEqual({
      ok: false,
      error: { code: 'self_approval' },
    });
  });

  it('R-38: only user actors approve — a system actor cannot approve either', () => {
    expect(decideProposal(baseProposal(), 'approved', SYSTEM, HASH, NOW)).toEqual({
      ok: false,
      error: { code: 'self_approval' },
    });
  });

  it('R-38: a user actor can approve', () => {
    expect(decideProposal(baseProposal(), 'approved', USER, HASH, NOW).ok).toBe(true);
  });

  it('R-38: an agent actor may reject a proposal', () => {
    const result = decideProposal(baseProposal(), 'rejected', AGENT, HASH, NOW);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ status: 'rejected', decidedBy: AGENT, decidedAt: NOW }),
    });
  });

  it('R-38: self_approval is reported before stale when an agent approves a changed file', () => {
    expect(decideProposal(baseProposal(), 'approved', AGENT, CHANGED_HASH, NOW)).toEqual({
      ok: false,
      error: { code: 'self_approval' },
    });
  });

  it('R-36: not_pending is reported before actor and hash checks', () => {
    const rejected = { ...baseProposal(), status: 'rejected' as const, decidedBy: USER, decidedAt: NOW };
    expect(decideProposal(rejected, 'approved', AGENT, CHANGED_HASH, NOW)).toEqual({
      ok: false,
      error: { code: 'not_pending' },
    });
  });

  it('records the deciding actor and the passed-in time on approval', () => {
    const by: Actor = { kind: 'user', id: 'u-42', label: 'Enes' };
    const result = decideProposal(baseProposal(), 'approved', by, HASH, 5_000);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ status: 'approved', decidedBy: by, decidedAt: 5_000 }),
    });
  });

  it('records the deciding actor and the passed-in time on rejection', () => {
    const result = decideProposal(baseProposal(), 'rejected', AGENT, CHANGED_HASH, 7_500);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ status: 'rejected', decidedBy: AGENT, decidedAt: 7_500 }),
    });
  });

  it('keeps every other field of the proposal', () => {
    const result = decideProposal(baseProposal(), 'approved', USER, HASH, NOW);
    expect(result).toEqual({
      ok: true,
      value: {
        id: '01BX5ZZKBKACTAV9WEVGEMMVRZ' as ProposalId,
        author: AGENT,
        createdAt: 1_000,
        target: 'flows/odoo.yaml',
        baseHash: HASH,
        before: 'before text',
        after: 'after text',
        summary: 'raise the retry limit',
        status: 'approved',
        decidedBy: USER,
        decidedAt: NOW,
      },
    });
  });

  it('does not mutate the input proposal', () => {
    const p = baseProposal();
    const snapshot = { ...p };
    decideProposal(p, 'approved', USER, HASH, NOW);
    decideProposal(p, 'rejected', AGENT, CHANGED_HASH, NOW);
    expect(p).toEqual(snapshot);
    expect(p.status).toBe('pending');
    expect(p.decidedBy).toBeUndefined();
    expect(p.decidedAt).toBeUndefined();
  });
});
