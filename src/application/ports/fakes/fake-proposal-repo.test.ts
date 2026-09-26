import { describe, expect, it } from 'vitest';

import type { Actor } from '../../../domain/index';
import { parseUlid, type ProposalId } from '../../../domain/index';

import type { ProposalRecord } from '../proposal-repo';
import type { DefinitionScope } from '../definition-store';

import { createFakeProposalRepo } from './fake-proposal-repo';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const U3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';

const proposalIdOf = (s: string): ProposalId => {
  const parsed = parseUlid<'proposal'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const AUTHOR: Actor = { kind: 'user', id: 'u1' };
const SCOPE: DefinitionScope = { kind: 'global' };

const record = (id: string, status: ProposalRecord['status']): ProposalRecord => ({
  id: proposalIdOf(id),
  author: AUTHOR,
  createdAt: 1,
  target: 'roles/implementer.json',
  baseHash: 'h0',
  before: 'a',
  after: 'b',
  summary: 'change',
  status,
  scope: SCOPE,
});

describe('createFakeProposalRepo', () => {
  it('save upserts by id and get round-trips the record', async () => {
    const repo = createFakeProposalRepo();
    await repo.save(record(U1, 'pending'));
    await repo.save(record(U2, 'pending'));
    await repo.save(record(U1, 'approved'));

    expect(await repo.get(proposalIdOf(U1))).toEqual(record(U1, 'approved'));
    expect(await repo.get(proposalIdOf(U3))).toBeUndefined();
  });

  it('list filters by status and returns a copy', async () => {
    const repo = createFakeProposalRepo();
    await repo.save(record(U1, 'pending'));
    await repo.save(record(U2, 'approved'));
    await repo.save(record(U3, 'pending'));

    expect((await repo.list({})).map((p) => p.id)).toEqual([proposalIdOf(U1), proposalIdOf(U2), proposalIdOf(U3)]);
    expect((await repo.list({ status: 'pending' })).map((p) => p.id)).toEqual([proposalIdOf(U1), proposalIdOf(U3)]);
    expect((await repo.list({ status: 'approved' })).map((p) => p.id)).toEqual([proposalIdOf(U2)]);

    const first = await repo.list({});
    const second = await repo.list({});
    expect(first).not.toBe(second);
    (first as ProposalRecord[]).push(record(U2, 'rejected'));
    expect(await repo.list({})).toHaveLength(3);
  });
});
