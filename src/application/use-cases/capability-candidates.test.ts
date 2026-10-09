// capability-candidates.test.ts — A-90 … A-92: the scan mapping, the merge/sort/cap/cut view,
// and the target-wise `imported` flag. Driven through the fakes, whose discovery port carries
// the adapter's semantics (I-45): no identityDir → nothing, a broken directory → empty, sources
// forced to the scanning account.
import { describe, expect, it } from 'vitest';

import type { AccountId, CapabilityCandidate } from '../../domain/index';
import type { AccountRecord } from '../ports/account-repo';
import type { AppDeps } from '../ports/deps';
import { createFakeAccountRepo } from '../ports/fakes/fake-account-repo';
import { createFakeCapabilityDiscovery } from '../ports/fakes/fake-capability-discovery';
import { createFakeDefinitionStore } from '../ports/fakes/fake-definition-store';

import {
  CAPABILITY_CANDIDATES_MAX,
  CAPABILITY_DESCRIPTION_MAX,
  capabilityCandidates,
} from './capability-candidates';

const ACCT_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AccountId;
const ACCT_B = '01ARZ3NDEKTSV4RRFFQ69G5FAW' as AccountId;
const DIR_A = '/users/op/.claude-work';
const DIR_B = '/users/op/.claude-lab';

const record = (over: Partial<AccountRecord>): AccountRecord => ({
  id: ACCT_A,
  provider: 'claude-code',
  label: 'Work',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  ...over,
});

const find = (over: Partial<CapabilityCandidate> & { readonly name: string }): CapabilityCandidate => ({
  identity: `x:${over.name}`,
  kind: 'context',
  sources: [ACCT_A],
  ...over,
});

interface Harness {
  readonly deps: AppDeps;
  readonly discovery: ReturnType<typeof createFakeCapabilityDiscovery>;
  readonly definitions: ReturnType<typeof createFakeDefinitionStore>;
}

const harnessOf = (accounts: readonly AccountRecord[], seeded?: (fake: Harness['discovery']) => void): Harness => {
  const accountRepo = createFakeAccountRepo();
  const discovery = createFakeCapabilityDiscovery();
  const definitions = createFakeDefinitionStore();
  for (const r of accounts) void accountRepo.save(r);
  seeded?.(discovery);
  return {
    deps: { accounts: accountRepo, capabilityDiscovery: discovery, definitions } as unknown as AppDeps,
    discovery,
    definitions,
  };
};

describe('capabilityCandidates', () => {
  it('A-90: scans the store accounts; an account without identityDir yields nothing', async () => {
    const h = harnessOf([
      record({ id: ACCT_A, identityDir: DIR_A }),
      record({ id: ACCT_B, label: 'Endpoint', authMode: 'api_key', identityDir: undefined }),
    ]);
    h.discovery.seed(DIR_A, [find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` })]);
    const view = await capabilityCandidates(h.deps);
    expect(view.candidates).toHaveLength(1);
    expect(view.candidates[0]).toMatchObject({ name: 'CLAUDE.md', sources: [ACCT_A] });
    // A-90's mapping: every store account reached the port, the endpoint one included.
    expect(h.discovery.scans().at(-1)?.map((a) => a.id)).toEqual([ACCT_A, ACCT_B]);
  });

  it('A-90: a broken config directory is an empty find, never an error surface', async () => {
    const h = harnessOf([record({ identityDir: DIR_A })], (fake) => {
      fake.breakDir(DIR_A);
    });
    const view = await capabilityCandidates(h.deps);
    expect(view).toEqual({ candidates: [], truncated: false });
  });

  it('A-91: the same identity in two adopted accounts is one candidate with both sources, in identity order', async () => {
    const h = harnessOf(
      [record({ id: ACCT_A, identityDir: DIR_A }), record({ id: ACCT_B, label: 'Lab', identityDir: DIR_B })],
      (fake) => {
        fake.seed(DIR_A, [find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md`, description: 'Work rules' })]);
        fake.seed(DIR_B, [find({ name: 'CLAUDE.md', path: `${DIR_B}/CLAUDE.md`, description: 'Lab rules' })]);
      },
    );
    const view = await capabilityCandidates(h.deps);
    expect(view.candidates).toHaveLength(1);
    expect(view.candidates[0]).toMatchObject({
      identity: 'context:CLAUDE.md',
      sources: [ACCT_A, ACCT_B],
      // R-63: the lexicographically smallest account backs the conflicting value.
      description: 'Work rules',
    });
  });

  it('A-91: caps at CAPABILITY_CANDIDATES_MAX with truncated, sorts by identity, cuts the description to its code-point cap', async () => {
    const many: CapabilityCandidate[] = [];
    for (let n = 0; n < CAPABILITY_CANDIDATES_MAX + 5; n += 1) {
      many.push(find({ name: `file-${n}`, identity: `context:file-${n}`, description: 'd'.repeat(CAPABILITY_DESCRIPTION_MAX + 10) }));
    }
    // Reverse insertion order: the view's order is the identity's, not the scan's.
    const h = harnessOf([record({ identityDir: DIR_A })], (fake) => {
      fake.seed(DIR_A, [...many].reverse());
    });
    const view = await capabilityCandidates(h.deps);
    expect(view.truncated).toBe(true);
    expect(view.candidates).toHaveLength(CAPABILITY_CANDIDATES_MAX);
    const identities = view.candidates.map((c) => c.identity);
    expect(identities).toEqual([...identities].sort());
    for (const candidate of view.candidates) {
      expect(candidate.description?.length).toBe(CAPABILITY_DESCRIPTION_MAX);
    }
  });

  it('A-91: the description cut is by code points, not UTF-16 units', async () => {
    const emoji = '🙂'.repeat(CAPABILITY_DESCRIPTION_MAX + 5); // 2 UTF-16 units per code point
    const h = harnessOf([record({ identityDir: DIR_A })], (fake) => {
      fake.seed(DIR_A, [find({ name: 'CLAUDE.md', description: emoji })]);
    });
    const view = await capabilityCandidates(h.deps);
    expect([...(view.candidates[0].description ?? '')]).toHaveLength(CAPABILITY_DESCRIPTION_MAX);
  });

  it('A-92: imported is target-wise — an equal identity at the derived id is true; missing, unparseable or different is false', async () => {
    const definitions = createFakeDefinitionStore();
    // context:CLAUDE.md imported as capabilities/claude-md.yaml
    definitions.seed({ kind: 'global' }, 'capabilities/claude-md.yaml', JSON.stringify({
      kind: 'context', id: 'claude-md', name: 'CLAUDE.md', path: '/users/op/.claude-work/CLAUDE.md',
    }));
    // Same slug, somebody else's file.
    definitions.seed({ kind: 'global' }, 'capabilities/db.yaml', JSON.stringify({
      kind: 'mcp', id: 'db', name: 'Other Db', command: 'other', args: [], env: {},
    }));
    // Unparseable at its target.
    definitions.seed({ kind: 'global' }, 'capabilities/broken.yaml', 'not a mapping at all: [');
    const accountRepo = createFakeAccountRepo();
    void accountRepo.save(record({ identityDir: DIR_A }));
    const discovery = createFakeCapabilityDiscovery();
    discovery.seed(DIR_A, [
      find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` }),
      find({ kind: 'mcp', name: 'db', command: 'npx db', identity: 'mcp:db|npx db' }),
      find({ kind: 'mcp', name: 'broken', command: 'x', identity: 'mcp:broken|x' }),
      find({ kind: 'skill', name: 'never-imported', path: 'skills/x.md', identity: 'skill:never-imported' }),
    ]);
    const deps = { accounts: accountRepo, capabilityDiscovery: discovery, definitions } as unknown as AppDeps;

    const view = await capabilityCandidates(deps);
    const importedOf = (identity: string): boolean | undefined =>
      view.candidates.find((c) => c.identity === identity)?.imported;
    expect(importedOf('context:CLAUDE.md')).toBe(true); // exists, parses, identity equal
    expect(importedOf('mcp:db|npx db')).toBe(false); // different identity at the target
    expect(importedOf('mcp:broken|x')).toBe(false); // unparseable
    expect(importedOf('skill:never-imported')).toBe(false); // missing target
  });

  it('A-92: the stored-file read understands the real store\'s flat YAML too, not only JSON', async () => {
    const definitions = createFakeDefinitionStore();
    definitions.seed({ kind: 'global' }, 'capabilities/claude-md.yaml', [
      'kind: context',
      'id: claude-md',
      'name: CLAUDE.md',
      `path: ${DIR_A}/CLAUDE.md`,
    ].join('\n'));
    const accountRepo = createFakeAccountRepo();
    void accountRepo.save(record({ identityDir: DIR_A }));
    const discovery = createFakeCapabilityDiscovery();
    discovery.seed(DIR_A, [find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` })]);
    const deps = { accounts: accountRepo, capabilityDiscovery: discovery, definitions } as unknown as AppDeps;

    const view = await capabilityCandidates(deps);
    expect(view.candidates[0].imported).toBe(true);
  });

  it('A-94 base: an empty account store answers empty, never an error', async () => {
    const h = harnessOf([]);
    expect(await capabilityCandidates(h.deps)).toEqual({ candidates: [], truncated: false });
  });
});
