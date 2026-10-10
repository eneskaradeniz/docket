// api/proposal-queries.test.ts — the read side of proposals: proposals.list and proposal.detail
// (A-128 … A-131). Seeded through the fakes and the real createProposal use case; only the
// queries go through the api.
import { describe, expect, it } from 'vitest';

import type { Actor, ProposalStatus, Slug, Ulid } from '../domain/index';
import { parseSlug, parseUlid } from '../domain/index';

import type { AppDeps, DefinitionScope } from '../application';
import { createProposal } from '../application';
import { createFakeDefinitionStore, createFakeDeps, type FakeDefinitionStore } from '../application/ports/fakes';

import { createApi } from './api';
import type { ProposalDetailView, ProposalListItem } from './queries';

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};
const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const SCOPE: DefinitionScope = { kind: 'repo', repo: slugOf<'repo'>('acme') };
const AGENT: Actor = { kind: 'agent', runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FE1'), role: slugOf<'role'>('worker') };
const USER: Actor = { kind: 'user', id: 'u-1', label: 'Enes' };

interface Harness {
  readonly deps: AppDeps;
  readonly definitions: FakeDefinitionStore;
}

const harness = (): Harness => {
  const definitions = createFakeDefinitionStore();
  return { deps: createFakeDeps({ definitions }), definitions };
};

const propose = async (h: Harness, target: string, after: string, summary: string): Promise<string> => {
  const res = await createProposal(h.deps, { scope: SCOPE, target, after, summary, author: AGENT });
  if (!res.ok) throw new Error('fixture proposal must be created');
  return res.value;
};

const getRecord = async (h: Harness, id: string) => {
  const record = await h.deps.proposals.get(ulidOf<'proposal'>(id));
  if (record === undefined) throw new Error('fixture proposal must exist');
  return record;
};

/** Saves a proposal with fixed fields, for ordering and filter cases that need exact times. */
const save = async (
  h: Harness,
  id: string,
  status: ProposalStatus,
  createdAt: number,
  scope: DefinitionScope = SCOPE,
): Promise<void> => {
  await h.deps.proposals.save({
    id: ulidOf<'proposal'>(id),
    author: AGENT,
    createdAt,
    target: 'a.yaml',
    baseHash: 'h',
    before: 'old',
    after: 'new',
    summary: `s-${id.slice(-2)}`,
    status,
    scope,
  });
};

const IDS = {
  a: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
  b: '01ARZ3NDEKTSV4RRFFQ69G5FA2',
  c: '01ARZ3NDEKTSV4RRFFQ69G5FA3',
  d: '01ARZ3NDEKTSV4RRFFQ69G5FA4',
};

describe('proposals.list', () => {
  it('A-128: without a filter pending comes first, then newest first; a status filter keeps newest first', async () => {
    const h = harness();
    await save(h, IDS.a, 'approved', 4_000);
    await save(h, IDS.b, 'pending', 1_000);
    await save(h, IDS.c, 'pending', 3_000);
    await save(h, IDS.d, 'rejected', 5_000);
    const api = createApi(h.deps);

    const all = (await api.query({ type: 'proposals.list' })) as readonly ProposalListItem[];
    expect(all.map((p) => p.id)).toEqual([IDS.c, IDS.b, IDS.d, IDS.a]);

    const pending = (await api.query({ type: 'proposals.list', status: 'pending' })) as readonly ProposalListItem[];
    expect(pending.map((p) => p.id)).toEqual([IDS.c, IDS.b]);
    const none = (await api.query({ type: 'proposals.list', status: 'stale' })) as readonly ProposalListItem[];
    expect(none).toEqual([]);
  });

  it('A-129: a list item carries id, summary, target, scope, status, author and decision labels, never before or after', async () => {
    const h = harness();
    await h.deps.proposals.save({
      id: ulidOf<'proposal'>(IDS.a),
      author: USER,
      createdAt: 1_000,
      target: 'a.yaml',
      baseHash: 'h',
      before: 'old',
      after: 'new',
      summary: 'Tune it',
      status: 'approved',
      decidedBy: { kind: 'system', component: 'sweeper' },
      decidedAt: 2_000,
      scope: { kind: 'project', project: slugOf<'project'>('atolye') },
    });
    await save(h, IDS.b, 'pending', 500, { kind: 'global' });
    const api = createApi(h.deps);
    const list = (await api.query({ type: 'proposals.list' })) as readonly ProposalListItem[];

    expect(list[1]).toEqual({
      id: IDS.a,
      summary: 'Tune it',
      target: 'a.yaml',
      scopeKind: 'project',
      scopeId: 'atolye',
      status: 'approved',
      author: { kind: 'user', label: 'Enes' },
      createdAt: 1_000,
      decidedAt: 2_000,
      decidedBy: 'sweeper',
    });
    expect(list[0]).not.toHaveProperty('scopeId');
    expect(list[0]).not.toHaveProperty('decidedBy');
    expect(list[0]).toMatchObject({ scopeKind: 'global', author: { kind: 'agent', label: 'worker' } });
    for (const item of list) {
      expect(item).not.toHaveProperty('before');
      expect(item).not.toHaveProperty('after');
    }
  });
});

describe('proposal.detail', () => {
  it('A-130: detail adds before, after, the line diff and truncated, and is not stale while the file stands', async () => {
    const h = harness();
    h.definitions.seed(SCOPE, 'flows.yaml', 'a\nb\nc\n');
    const id = await propose(h, 'flows.yaml', 'a\nx\nc\n', 'Swap b');
    const api = createApi(h.deps);

    const detail = (await api.query({ type: 'proposal.detail', id })) as ProposalDetailView;
    expect(detail).toMatchObject({
      id,
      summary: 'Swap b',
      target: 'flows.yaml',
      status: 'pending',
      before: 'a\nb\nc\n',
      after: 'a\nx\nc\n',
      truncated: false,
      currentlyStale: false,
    });
    expect(detail.lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('A-130: currentlyStale is true only for a pending proposal whose file hash moved', async () => {
    const h = harness();
    h.definitions.seed(SCOPE, 'flows.yaml', 'a\n');
    const pending = await propose(h, 'flows.yaml', 'b\n', 'Change a');
    h.definitions.seed(SCOPE, 'other.yaml', 'x\n');
    const decided = await propose(h, 'other.yaml', 'y\n', 'Change x');
    await h.deps.proposals.save({ ...(await getRecord(h, decided)), status: 'rejected' });
    h.definitions.seed(SCOPE, 'flows.yaml', 'edited\n');
    h.definitions.seed(SCOPE, 'other.yaml', 'edited\n');
    const api = createApi(h.deps);

    expect(((await api.query({ type: 'proposal.detail', id: pending })) as ProposalDetailView).currentlyStale).toBe(true);
    expect(((await api.query({ type: 'proposal.detail', id: decided })) as ProposalDetailView).currentlyStale).toBe(false);
    // The query decides nothing: the stored status stays pending.
    expect((await getRecord(h, pending)).status).toBe('pending');
  });

  it('A-130: a diff beyond the line limit is truncated to one block per side', async () => {
    const h = harness();
    const big = Array.from({ length: 5_001 }, (_, i) => `l${i}`).join('\n');
    h.definitions.seed(SCOPE, 'big.yaml', big);
    const id = await propose(h, 'big.yaml', 'small', 'Shrink');
    const detail = (await createApi(h.deps).query({ type: 'proposal.detail', id })) as ProposalDetailView;
    expect(detail.truncated).toBe(true);
    expect(detail.lines).toEqual([
      { kind: 'remove', text: big },
      { kind: 'add', text: 'small' },
    ]);
  });

  it('A-131: an unknown id answers not_found and a malformed id answers invalid_id', async () => {
    const h = harness();
    const api = createApi(h.deps);
    expect(await api.query({ type: 'proposal.detail', id: IDS.a })).toEqual({ ok: false, code: 'not_found' });
    expect(await api.query({ type: 'proposal.detail', id: 'nope' })).toEqual({ ok: false, code: 'invalid_id' });
  });

  it('A-131 scenario: two proposals, one stale after a file edit — list pending, stale detail shows the diff', async () => {
    const h = harness();
    h.definitions.seed(SCOPE, 'one.yaml', 'k: 1\nm: 2\n');
    h.definitions.seed(SCOPE, 'two.yaml', 'z: 1\n');
    const first = await propose(h, 'one.yaml', 'k: 1\nm: 3\n', 'Raise m');
    const second = await propose(h, 'two.yaml', 'z: 2\n', 'Raise z');
    h.definitions.seed(SCOPE, 'one.yaml', 'k: 9\nm: 2\n');
    const api = createApi(h.deps);

    const list = (await api.query({ type: 'proposals.list', status: 'pending' })) as readonly ProposalListItem[];
    expect(list.map((p) => p.id).sort()).toEqual([first, second].sort());

    const detail = (await api.query({ type: 'proposal.detail', id: first })) as ProposalDetailView;
    expect(detail.currentlyStale).toBe(true);
    expect(detail.lines).toEqual([
      { kind: 'same', text: 'k: 1' },
      { kind: 'remove', text: 'm: 2' },
      { kind: 'add', text: 'm: 3' },
    ]);
    expect(((await api.query({ type: 'proposal.detail', id: second })) as ProposalDetailView).currentlyStale).toBe(false);
  });
});
