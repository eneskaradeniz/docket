// capability-import.test.ts — A-93: per-identity import outcomes (imported / already_present /
// rejected with a reason); one rejected identity never blocks the others. R-67's collision arm
// lives here too: the `-2`/`-3` suffixes in the order the identities are carried. A-95: every
// imported capability appends one `capability.imported` audit entry; nothing else writes one.
import { describe, expect, it } from 'vitest';

import type { AccountId, Actor, CapabilityCandidate, CapabilitySlug } from '../../domain/index';
import type { AccountRecord } from '../ports/account-repo';
import type { AppDeps } from '../ports/deps';
import type { EventLog } from '../ports/event-log';
import { createFakeAccountRepo } from '../ports/fakes/fake-account-repo';
import { createFakeCapabilityDiscovery } from '../ports/fakes/fake-capability-discovery';
import { createFakeClock } from '../ports/fakes/fake-clock';
import { createFakeDefinitionStore } from '../ports/fakes/fake-definition-store';
import { createFakeEventLog } from '../ports/fakes/fake-event-log';
import { createFakeIdGen } from '../ports/fakes/fake-id-gen';

import { importCapabilities } from './capability-import';

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const ACCT_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AccountId;
const DIR_A = '/users/op/.claude-work';

const record = (over: Partial<AccountRecord> = {}): AccountRecord => ({
  id: ACCT_A,
  provider: 'claude-code',
  label: 'Work',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  identityDir: DIR_A,
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
  readonly log: ReturnType<typeof createFakeEventLog>;
}

const harnessOf = (accounts: readonly AccountRecord[], finds: readonly CapabilityCandidate[]): Harness => {
  const accountRepo = createFakeAccountRepo();
  const discovery = createFakeCapabilityDiscovery();
  const definitions = createFakeDefinitionStore();
  for (const r of accounts) void accountRepo.save(r);
  discovery.seed(DIR_A, finds);
  const log = createFakeEventLog();
  return {
    deps: {
      accounts: accountRepo,
      capabilityDiscovery: discovery,
      definitions,
      clock: createFakeClock(),
      ids: createFakeIdGen('capability-import-test'),
      log,
    } as unknown as AppDeps,
    discovery,
    definitions,
    log,
  };
};

describe('importCapabilities', () => {
  it('A-93: imports a candidate, writes the target, and the second call of the same identity is already_present with no new write', async () => {
    const h = harnessOf([record()], [find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` })]);
    const first = await importCapabilities(h.deps, { identities: ['context:CLAUDE.md'], actor: USER });
    expect(first).toEqual([{ identity: 'context:CLAUDE.md', status: 'imported', id: 'claude-md' }]);
    expect(h.definitions.readFile({ kind: 'global' }, 'capabilities/claude-md.yaml')).toBeDefined();

    const second = await importCapabilities(h.deps, { identities: ['context:CLAUDE.md'], actor: USER });
    expect(second).toEqual([{ identity: 'context:CLAUDE.md', status: 'already_present', id: 'claude-md' }]);
  });

  it('A-93: an mcp candidate lands with empty args and env — only name and command travel', async () => {
    const h = harnessOf([record()], [
      find({ kind: 'mcp', name: 'Db Tools', command: 'npx db', identity: 'mcp:Db Tools|npx db' }),
    ]);
    const results = await importCapabilities(h.deps, { identities: ['mcp:Db Tools|npx db'], actor: USER });
    expect(results).toEqual([{ identity: 'mcp:Db Tools|npx db', status: 'imported', id: 'db-tools' }]);
    const file = await h.definitions.readFile({ kind: 'global' }, 'capabilities/db-tools.yaml');
    expect(JSON.parse(file?.content ?? '{}')).toEqual({
      kind: 'mcp', id: 'db-tools', name: 'Db Tools', command: 'npx db', args: [], env: {},
    });
  });

  it('A-93: per-identity results — one rejection never blocks the others', async () => {
    const h = harnessOf([record()], [
      find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` }),
      find({ kind: 'mcp', name: 'no-command-server', identity: 'mcp:no-command-server|' }), // missing_command
      find({ kind: 'skill', name: 'no-path', identity: 'skill:no-path' }), // missing_path
    ]);
    const results = await importCapabilities(h.deps, {
      identities: ['skill:no-path', 'context:CLAUDE.md', 'mcp:no-command-server|', 'context:absent'],
      actor: USER,
    });
    expect(results).toEqual([
      { identity: 'skill:no-path', status: 'rejected', reason: 'missing_path' },
      { identity: 'context:CLAUDE.md', status: 'imported', id: 'claude-md' },
      { identity: 'mcp:no-command-server|', status: 'rejected', reason: 'missing_command' },
      { identity: 'context:absent', status: 'rejected', reason: 'not_found' },
    ]);
    // The importable one landed although its neighbours were rejected.
    expect(await h.definitions.readFile({ kind: 'global' }, 'capabilities/claude-md.yaml')).toBeDefined();
  });

  it('A-93: id_taken — a target that exists with a different identity is refused, never overwritten', async () => {
    const h = harnessOf([record()], [find({ kind: 'mcp', name: 'db', command: 'npx db', identity: 'mcp:db|npx db' })]);
    h.definitions.seed({ kind: 'global' }, 'capabilities/db.yaml', JSON.stringify({
      kind: 'mcp', id: 'db', name: 'Other Db', command: 'other', args: [], env: {},
    }));
    const results = await importCapabilities(h.deps, { identities: ['mcp:db|npx db'], actor: USER });
    expect(results).toEqual([{ identity: 'mcp:db|npx db', status: 'rejected', reason: 'id_taken' }]);
    const file = await h.definitions.readFile({ kind: 'global' }, 'capabilities/db.yaml');
    expect(JSON.parse(file?.content ?? '{}').name).toBe('Other Db');
  });

  it('A-93: invalid_name — a name that derives to the empty slug, and invalid_definition — a store that refuses the candidate', async () => {
    const h = harnessOf([record()], [
      find({ name: '...', identity: 'context:...' }),
      find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` }),
    ]);
    // A seeded global file that cannot parse makes every candidate's validateCandidate fail.
    h.definitions.seed({ kind: 'global' }, 'capabilities/polluter.yaml', 'not json or yaml mapping [');
    const results = await importCapabilities(h.deps, { identities: ['context:...', 'context:CLAUDE.md'], actor: USER });
    expect(results).toEqual([
      { identity: 'context:...', status: 'rejected', reason: 'invalid_name' },
      { identity: 'context:CLAUDE.md', status: 'rejected', reason: 'invalid_definition' },
    ]);
  });

  it('R-67: two identities of one call whose names derive to the same slug take base and -2, in carried order', async () => {
    const h = harnessOf([record()], [
      find({ kind: 'skill', name: 'Alpha!', path: 'skills/alpha.md', identity: 'skill:Alpha!' }),
      find({ kind: 'context', name: 'alpha', path: 'alpha.md', identity: 'context:alpha' }),
      find({ kind: 'context', name: 'ALPHA', path: 'alpha2.md', identity: 'context:ALPHA' }),
    ]);
    const results = await importCapabilities(h.deps, {
      identities: ['skill:Alpha!', 'context:alpha', 'context:ALPHA'],
      actor: USER,
    });
    expect(results.map((r) => ('id' in r ? r.id : r.reason))).toEqual(['alpha', 'alpha-2', 'alpha-3']);
    expect(results.every((r) => r.status === 'imported')).toBe(true);
    expect(await h.definitions.readFile({ kind: 'global' }, 'capabilities/alpha.yaml')).toBeDefined();
    expect(await h.definitions.readFile({ kind: 'global' }, 'capabilities/alpha-2.yaml')).toBeDefined();
    expect(await h.definitions.readFile({ kind: 'global' }, 'capabilities/alpha-3.yaml')).toBeDefined();
  });

  it('R-67: the suffix cut keeps the whole id within the 63-character law', async () => {
    const long = 'a'.repeat(70);
    const upper = long.toUpperCase();
    const h = harnessOf([record()], [
      find({ kind: 'skill', name: long, path: 'a.md', identity: `skill:${long}` }),
      // Upper-case ASCII lower-cases onto the same derived base as the first.
      find({ kind: 'context', name: upper, path: 'b.md', identity: `context:${upper}` }),
      find({ kind: 'context', name: `A${long}`, path: 'c.md', identity: `context:A${long}` }),
    ]);
    const results = await importCapabilities(h.deps, {
      identities: [`skill:${long}`, `context:${upper}`, `context:A${long}`],
      actor: USER,
    });
    const ids = results.filter((r) => r.status === 'imported').map((r) => (r as { id: string }).id);
    expect(ids).toEqual(['a'.repeat(63), `${'a'.repeat(61)}-2`, `${'a'.repeat(61)}-3`]);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(63);
  });

  it('A-93: a repeated identity echoes its first outcome and writes nothing twice', async () => {
    const h = harnessOf([record()], [find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` })]);
    const results = await importCapabilities(h.deps, {
      identities: ['context:CLAUDE.md', 'context:CLAUDE.md'],
      actor: USER,
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ status: 'imported', id: 'claude-md' });
  });

  it('A-93: a no-op call (everything already imported) is ok with no store write', async () => {
    const h = harnessOf([record()], [find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` })]);
    await importCapabilities(h.deps, { identities: ['context:CLAUDE.md'], actor: USER });
    const before = await h.definitions.readFile({ kind: 'global' }, 'capabilities/claude-md.yaml');
    const results = await importCapabilities(h.deps, { identities: ['context:CLAUDE.md'], actor: USER });
    expect(results).toEqual([{ identity: 'context:CLAUDE.md', status: 'already_present', id: 'claude-md' }]);
    const after = await h.definitions.readFile({ kind: 'global' }, 'capabilities/claude-md.yaml');
    expect(after?.hash).toBe(before?.hash);
  });

  it('A-93: the write survives across the merge — the same capability in two accounts imports once', async () => {
    const accountRepo = createFakeAccountRepo();
    const discovery = createFakeCapabilityDiscovery();
    const definitions = createFakeDefinitionStore();
    const ACCT_B = '01ARZ3NDEKTSV4RRFFQ69G5FAW' as AccountId;
    const DIR_B = '/users/op/.claude-lab';
    void accountRepo.save(record());
    void accountRepo.save(record({ id: ACCT_B, label: 'Lab', identityDir: DIR_B }));
    discovery.seed(DIR_A, [find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` })]);
    discovery.seed(DIR_B, [find({ name: 'CLAUDE.md', path: `${DIR_B}/CLAUDE.md` })]);
    const deps = {
      accounts: accountRepo,
      capabilityDiscovery: discovery,
      definitions,
      clock: createFakeClock(),
      ids: createFakeIdGen('capability-import-test'),
      log: createFakeEventLog(),
    } as unknown as AppDeps;

    const results = await importCapabilities(deps, { identities: ['context:CLAUDE.md'], actor: USER });
    expect(results).toEqual([{ identity: 'context:CLAUDE.md', status: 'imported', id: 'claude-md' }]);
    expect(await definitions.readFile({ kind: 'global' }, 'capabilities/claude-md.yaml')).toBeDefined();
  });

  it('A-95: an imported capability appends one capability.imported entry — subject the stored slug, detail kind and identity', async () => {
    const h = harnessOf([record()], [
      find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` }),
      find({ kind: 'mcp', name: 'Db Tools', command: 'npx db', identity: 'mcp:Db Tools|npx db' }),
    ]);
    const results = await importCapabilities(h.deps, {
      identities: ['context:CLAUDE.md', 'mcp:Db Tools|npx db'],
      actor: USER,
    });
    expect(results.map((r) => r.status)).toEqual(['imported', 'imported']);

    const entries = h.log.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actor: USER,
      action: 'capability.imported',
      subject: { kind: 'capability', id: 'claude-md' },
      detail: { kind: 'context', identity: 'context:CLAUDE.md' },
    });
    expect(entries[1]).toMatchObject({
      actor: USER,
      action: 'capability.imported',
      subject: { kind: 'capability', id: 'db-tools' },
      detail: { kind: 'mcp', identity: 'mcp:Db Tools|npx db' },
    });
    // The stored slug is the subject, so a listing from the definition finds the entry.
    const listed = await h.deps.log.list({ kind: 'capability', id: 'db-tools' as CapabilitySlug }, 10);
    expect(listed).toHaveLength(1);
    expect(listed[0].subject).toEqual({ kind: 'capability', id: 'db-tools' });
  });

  it('A-95: already_present and rejected write no audit entry, and a repeated identity audits once', async () => {
    const h = harnessOf([record()], [
      find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` }),
      find({ kind: 'mcp', name: 'no-command-server', identity: 'mcp:no-command-server|' }), // missing_command
    ]);
    const first = await importCapabilities(h.deps, {
      identities: ['context:CLAUDE.md', 'context:CLAUDE.md', 'mcp:no-command-server|'],
      actor: USER,
    });
    expect(first.map((r) => r.status)).toEqual(['imported', 'imported', 'rejected']);
    expect(h.log.entries()).toHaveLength(1); // the echo and the rejection append nothing

    const second = await importCapabilities(h.deps, { identities: ['context:CLAUDE.md'], actor: USER });
    expect(second).toEqual([{ identity: 'context:CLAUDE.md', status: 'already_present', id: 'claude-md' }]);
    expect(h.log.entries()).toHaveLength(1); // already_present appends nothing either
  });

  it('A-95: an audit append failure does not fail or roll back the import', async () => {
    const h = harnessOf([record()], [find({ name: 'CLAUDE.md', path: `${DIR_A}/CLAUDE.md` })]);
    const failing: EventLog = {
      append: async () => {
        throw new Error('audit store gone');
      },
      list: async () => [],
    };
    const deps = { ...h.deps, log: failing } as AppDeps;

    const results = await importCapabilities(deps, { identities: ['context:CLAUDE.md'], actor: USER });
    expect(results).toEqual([{ identity: 'context:CLAUDE.md', status: 'imported', id: 'claude-md' }]);
    expect(h.definitions.readFile({ kind: 'global' }, 'capabilities/claude-md.yaml')).toBeDefined();
  });
});
