// proposals use cases — rules A-11 (createProposal) and A-12 (decideProposalUseCase) from
// docs/v2/application.md, driven over the in-memory port fakes.
import { describe, expect, it } from 'vitest';

import { isUlid, parseSlug, parseUlid, type Actor, type RunId, type Slug, type Ulid } from '../../domain/index';

import type { AppDeps, DefinitionScope, DefinitionStore } from '../ports';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeProposalRepo,
  repoFlowOf,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeProposalRepo,
} from '../ports/fakes';

import { createProposal, decideProposalUseCase } from './proposals';

// --- fixtures ---------------------------------------------------------------------------------------

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const REPO_SCOPE: DefinitionScope = { kind: 'repo', repo: slugOf<'repo'>('acme') };
const TARGET = 'repos/acme/repo.yaml';
const ABSENT_TARGET = 'repos/ghost/repo.yaml';
const RUN_ID: RunId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA1');

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: RUN_ID, role: slugOf<'role'>('reviewer') };

const STANDARD_FLOW_DEF = {
  id: 'standard',
  name: 'Standard',
  stages: [{ id: 'plan', name: 'Plan', role: null, exit: [] }],
};

/** A bare repo definition body — the file a repo-scope proposal edits. */
const rolesFile = (name: string): string =>
  JSON.stringify({
    id: 'acme',
    name,
    flow: repoFlowOf(STANDARD_FLOW_DEF),
    defaultLimitPolicy: 'wait_resume',
    commandSets: {},
    docsRoot: 'docs',
    testGlobs: [],
  });

/** Syntactically JSON, semantically broken: the repo misses required fields. */
const INVALID_CANDIDATE = JSON.stringify({ id: 'acme', name: 'Broken' });

interface Harness {
  readonly deps: AppDeps;
  readonly clock: ReturnType<typeof createFakeClock>;
  readonly definitions: FakeDefinitionStore;
  readonly proposals: FakeProposalRepo;
  readonly log: FakeEventLog;
}

/** The minimal library a repo.yaml candidate validates against. */
const STANDARD_FLOW = JSON.stringify(STANDARD_FLOW_DEF);

const makeHarness = (): Harness => {
  const clock = createFakeClock(1_000);
  const definitions = createFakeDefinitionStore();
  definitions.seed('library/flows/standard/v1.yaml', STANDARD_FLOW);
  const proposals = createFakeProposalRepo();
  const log = createFakeEventLog();
  const deps = createFakeDeps({ clock, definitions, proposals, log });
  return { deps, clock, definitions, proposals, log };
};

const propose = (h: Harness, after: string, target: string = TARGET) =>
  createProposal(h.deps, { scope: REPO_SCOPE, target, after, summary: 'Rename the repo', author: USER });

const idOf = async (h: Harness, after: string, target: string = TARGET): Promise<Ulid<'proposal'>> => {
  const proposed = await propose(h, after, target);
  if (!proposed.ok) throw new Error('fixture proposal must be created');
  return proposed.value;
};

/** The store every other method still hits; only readFile reports the captured hash. */
const readingHash =
  (base: FakeDefinitionStore, hash: string): DefinitionStore => ({
    ...base,
    readFile: async (targetOrScope: string | DefinitionScope, maybeTarget?: string) => {
      const file = typeof targetOrScope === 'string'
        ? await base.readFile(targetOrScope)
        : await base.readFile(targetOrScope, maybeTarget!);
      return file === undefined ? undefined : { content: file.content, hash };
    },
  });

// --- createProposal ---------------------------------------------------------------------------------

describe('createProposal', () => {
  it('A-11: stores a pending proposal with the current file as baseHash and audits proposal.created', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const after = rolesFile('Implementer v2');
    const current = await h.definitions.readFile(TARGET);
    if (current === undefined) throw new Error('fixture file must be seeded');

    const result = await propose(h, after);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('createProposal must succeed');
    expect(isUlid(result.value)).toBe(true);
    await expect(h.proposals.get(result.value)).resolves.toEqual({
      id: result.value,
      author: USER,
      createdAt: 1_000,
      target: TARGET,
      baseHash: current.hash,
      before: rolesFile('Implementer'),
      after,
      summary: 'Rename the repo',
      status: 'pending',
      scope: REPO_SCOPE,
    });
    expect(h.log.entries()).toHaveLength(1);
    const [audit] = h.log.entries();
    expect(audit).toMatchObject({
      at: 1_000,
      actor: USER,
      action: 'proposal.created',
      subject: { kind: 'proposal', id: result.value },
    });
    expect(isUlid(audit.id)).toBe(true);
  });

  it('A-11: a target that does not exist yet is proposed against hash "" and empty before', async () => {
    const h = makeHarness();

    const result = await propose(h, rolesFile('New role'), ABSENT_TARGET);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('createProposal must succeed');
    const stored = await h.proposals.get(result.value);
    expect(stored?.baseHash).toBe('');
    expect(stored?.before).toBe('');
    expect(stored?.status).toBe('pending');
  });

  it('A-11: after === before → no_change, nothing stored, nothing audited', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));

    const result = await propose(h, rolesFile('Implementer'));

    expect(result).toEqual({ ok: false, error: 'no_change' });
    await expect(h.proposals.list({})).resolves.toHaveLength(0);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-11: an empty after against an absent target is no_change too', async () => {
    const h = makeHarness();

    const result = await propose(h, '', ABSENT_TARGET);

    expect(result).toEqual({ ok: false, error: 'no_change' });
    await expect(h.proposals.list({})).resolves.toHaveLength(0);
  });
});

// --- decideProposalUseCase --------------------------------------------------------------------------

describe('decideProposalUseCase', () => {
  it('A-12: approving a valid candidate writes the file, decides the proposal, and audits proposal.decided', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const after = rolesFile('Implementer v2');
    const id = await idOf(h, after);
    const baseHash = (await h.definitions.readFile(TARGET))?.hash;
    h.clock.advance(50);

    const result = await decideProposalUseCase(h.deps, { id, decision: 'approved', actor: USER });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('decideProposalUseCase must succeed');
    expect(result.value).toEqual({
      id,
      author: USER,
      createdAt: 1_000,
      target: TARGET,
      baseHash,
      before: rolesFile('Implementer'),
      after,
      summary: 'Rename the repo',
      status: 'approved',
      decidedBy: USER,
      decidedAt: 1_050,
      scope: REPO_SCOPE,
    });
    await expect(h.proposals.get(id)).resolves.toEqual(result.value);
    const written = await h.definitions.readFile(TARGET);
    expect(written?.content).toBe(after);
    expect(written?.hash).not.toBe(baseHash);
    expect(h.log.entries()).toHaveLength(2);
    const [, decided] = h.log.entries();
    expect(decided).toMatchObject({
      at: 1_050,
      actor: USER,
      action: 'proposal.decided',
      subject: { kind: 'proposal', id },
      detail: { decision: 'approved' },
    });
    expect(isUlid(decided.id)).toBe(true);
  });

  it('A-12: rejecting never touches files and skips candidate validation', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const baseHash = (await h.definitions.readFile(TARGET))?.hash;
    const id = await idOf(h, INVALID_CANDIDATE);
    h.clock.advance(50);

    const result = await decideProposalUseCase(h.deps, { id, decision: 'rejected', actor: USER });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('rejecting an invalid candidate must succeed');
    expect(result.value.status).toBe('rejected');
    expect(result.value.decidedBy).toEqual(USER);
    const file = await h.definitions.readFile(TARGET);
    expect(file?.content).toBe(rolesFile('Implementer'));
    expect(file?.hash).toBe(baseHash);
    const [, decided] = h.log.entries();
    expect(decided).toMatchObject({ action: 'proposal.decided', detail: { decision: 'rejected' } });
  });

  it('A-12: a file changed after proposing → stale, the proposal saved as stale, the file untouched', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const id = await idOf(h, rolesFile('Implementer v2'));
    const changedExternally = rolesFile('Changed elsewhere');
    h.definitions.seed(TARGET, changedExternally);

    const result = await decideProposalUseCase(h.deps, { id, decision: 'approved', actor: USER });

    expect(result).toEqual({ ok: false, error: 'stale' });
    const stored = await h.proposals.get(id);
    expect(stored?.status).toBe('stale');
    const file = await h.definitions.readFile(TARGET);
    expect(file?.content).toBe(changedExternally);
    expect(h.log.entries()).toHaveLength(1); // created only: a refused decision audits nothing
  });

  it('A-12: rejection succeeds even when the file changed after proposing', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const id = await idOf(h, rolesFile('Implementer v2'));
    h.definitions.seed(TARGET, rolesFile('Changed elsewhere'));

    const result = await decideProposalUseCase(h.deps, { id, decision: 'rejected', actor: USER });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('rejection ignores staleness');
    expect(result.value.status).toBe('rejected');
  });

  it('A-12: an invalid candidate on approval → invalid_after and the proposal stays pending', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const id = await idOf(h, INVALID_CANDIDATE);

    const result = await decideProposalUseCase(h.deps, { id, decision: 'approved', actor: USER });

    expect(result).toEqual({ ok: false, error: 'invalid_after' });
    const stored = await h.proposals.get(id);
    expect(stored?.status).toBe('pending');
    expect(stored?.decidedBy).toBeUndefined();
    const file = await h.definitions.readFile(TARGET);
    expect(file?.content).toBe(rolesFile('Implementer'));
    expect(h.log.entries()).toHaveLength(1);
  });

  it('A-12: an agent approving → self_approval and the proposal is left as it was', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const id = await idOf(h, rolesFile('Implementer v2'));

    const result = await decideProposalUseCase(h.deps, { id, decision: 'approved', actor: AGENT });

    expect(result).toEqual({ ok: false, error: 'self_approval' });
    const stored = await h.proposals.get(id);
    expect(stored?.status).toBe('pending');
    const file = await h.definitions.readFile(TARGET);
    expect(file?.content).toBe(rolesFile('Implementer'));
    expect(h.log.entries()).toHaveLength(1);
  });

  it('A-12: an unknown id → not_found', async () => {
    const h = makeHarness();

    const result = await decideProposalUseCase(h.deps, { id: ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA9'), decision: 'approved', actor: USER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('A-12: deciding an already decided proposal → not_pending, whatever the file says', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const id = await idOf(h, rolesFile('Implementer v2'));
    const first = await decideProposalUseCase(h.deps, { id, decision: 'approved', actor: USER });
    if (!first.ok) throw new Error('first decision must succeed');
    h.definitions.seed(TARGET, rolesFile('Changed afterwards'));

    const second = await decideProposalUseCase(h.deps, { id, decision: 'rejected', actor: USER });

    expect(second).toEqual({ ok: false, error: 'not_pending' });
    await expect(h.proposals.get(id)).resolves.toEqual(first.value);
  });

  it('A-12: validation runs before the domain decision — an agent approving an invalid candidate gets invalid_after', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const id = await idOf(h, INVALID_CANDIDATE);

    const result = await decideProposalUseCase(h.deps, { id, decision: 'approved', actor: AGENT });

    expect(result).toEqual({ ok: false, error: 'invalid_after' });
  });

  it('A-12: self_approval wins over staleness — an agent approving a changed file is still self_approval', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const id = await idOf(h, rolesFile('Implementer v2'));
    h.definitions.seed(TARGET, rolesFile('Changed elsewhere'));

    const result = await decideProposalUseCase(h.deps, { id, decision: 'approved', actor: AGENT });

    expect(result).toEqual({ ok: false, error: 'self_approval' });
    const stored = await h.proposals.get(id);
    expect(stored?.status).toBe('pending'); // not even marked stale: the refusal changed nothing
  });

  it('A-12: a write that loses the hash race → stale saved and the file untouched', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));
    const id = await idOf(h, rolesFile('Implementer v2'));
    const baseHash = (await h.definitions.readFile(TARGET))?.hash;
    // The file moves after the proposal but readFile keeps reporting the proposal's hash, so the
    // domain agrees and only writeFile's own guard catches the change.
    h.definitions.seed(TARGET, rolesFile('Changed elsewhere'));
    const deps: AppDeps = { ...h.deps, definitions: readingHash(h.definitions, baseHash ?? '') };

    const result = await decideProposalUseCase(deps, { id, decision: 'approved', actor: USER });

    expect(result).toEqual({ ok: false, error: 'stale' });
    const stored = await h.proposals.get(id);
    expect(stored?.status).toBe('stale');
    const file = await h.definitions.readFile(TARGET);
    expect(file?.content).toBe(rolesFile('Changed elsewhere'));
    expect(h.log.entries()).toHaveLength(1);
  });

  it('A-408: decideProposalUseCase refuses any candidate carrying autonomy with invalid_after', async () => {
    const h = makeHarness();
    h.definitions.seed(TARGET, rolesFile('Implementer'));

    // Candidate carrying autonomy
    const candidateWithAutonomy = JSON.stringify({
      ...JSON.parse(rolesFile('Implementer v2')),
      autonomy: 'auto',
    });
    const id = await idOf(h, candidateWithAutonomy);

    const result = await decideProposalUseCase(h.deps, { id, decision: 'approved', actor: USER });
    expect(result).toEqual({ ok: false, error: 'invalid_after' });

    // Proposal stays pending and file stays untouched
    const stored = await h.proposals.get(id);
    expect(stored?.status).toBe('pending');
    const file = await h.definitions.readFile(TARGET);
    expect(file?.content).toBe(rolesFile('Implementer'));
  });
});
