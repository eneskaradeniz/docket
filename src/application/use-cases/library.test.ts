// use-cases/library.test.ts — rules A-327 and A-343 from docs/v2/application.md (Phase 7
// addendum): library edits become new immutable versions through `saveVersion`, the one use
// case behind `appendVersion`. Driven over the in-memory fakes.
import { describe, expect, it } from 'vitest';

import type { Actor, RoleDef, RoleSlug, VersionRecord } from '../../domain/index';
import { parseSlug } from '../../domain/index';

import type { FakeDefinitionStore } from '../ports/fakes';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeEventLog,
  createFakeIdGen,
  type FakeEventLog,
} from '../ports/fakes';

import { saveVersion } from './library';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };

const slugOf = (input: string): RoleSlug => {
  const parsed = parseSlug<'role'>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ROLE: RoleSlug = slugOf('dev');

const roleBody = (over: Partial<RoleDef> = {}): RoleDef => ({
  id: ROLE,
  name: 'Developer',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
  ...over,
});

interface Harness {
  readonly definitions: FakeDefinitionStore;
  readonly log: FakeEventLog;
  readonly deps: Parameters<typeof saveVersion>[0];
}

const createHarness = (): Harness => {
  const clock = createFakeClock(1_000);
  const ids = createFakeIdGen('library-test');
  const log = createFakeEventLog();
  const definitions = createFakeDefinitionStore();
  return { definitions, log, deps: { clock, ids, log, definitions } };
};

describe('saveVersion', () => {
  it('A-327: a library edit creates the next version through appendVersion, keeping previous records immutable', async () => {
    const h = createHarness();

    const first = await saveVersion(h.deps, { kind: 'roles', id: 'dev', body: roleBody(), actor: ACTOR });
    const second = await saveVersion(h.deps, {
      kind: 'roles',
      id: 'dev',
      body: roleBody({ instructions: 'Do the work, carefully.' }),
      actor: ACTOR,
    });

    expect(first).toMatchObject({ ok: true, value: { version: 1 } });
    expect(second).toMatchObject({ ok: true, value: { version: 2 } });

    const history = await h.definitions.listVersions('roles', 'dev');
    expect(history).toHaveLength(2);
    // R-129 through the port: the recorded v1 body is exactly what was written, unchanged by v2.
    expect(history[0]).toEqual({
      definitionId: 'dev',
      version: 1,
      body: roleBody(),
      recordedAt: 1_000,
      archived: false,
    } satisfies VersionRecord<unknown>);
    expect(history[1].body).toEqual(roleBody({ instructions: 'Do the work, carefully.' }));
    // An unknown id still answers the empty history, in version order.
    expect(await h.definitions.listVersions('roles', 'unknown')).toEqual([]);
  });

  it('A-343: an invalid body answers definitions_invalid and writes nothing — no version, no audit', async () => {
    const h = createHarness();

    const refused = await saveVersion(h.deps, {
      kind: 'roles',
      id: 'dev',
      // Not a role: no instructions, no write scope, a wrong-typed id.
      body: { id: 'dev', name: 'Developer', instructions: 42 },
      actor: ACTOR,
    });

    expect(refused).toEqual({ ok: false, error: 'definitions_invalid' });
    expect(await h.definitions.listVersions('roles', 'dev')).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-343: a concurrent append answers stale, and one library.version_created audit lands per success', async () => {
    const h = createHarness();

    h.definitions.failNextAppendStale();
    const stale = await saveVersion(h.deps, { kind: 'roles', id: 'dev', body: roleBody(), actor: ACTOR });
    expect(stale).toEqual({ ok: false, error: 'stale' });
    expect(await h.definitions.listVersions('roles', 'dev')).toEqual([]);
    // The refused append writes no audit entry either.
    expect(h.log.entries()).toEqual([]);

    const saved = await saveVersion(h.deps, { kind: 'roles', id: 'dev', body: roleBody(), actor: ACTOR });
    expect(saved).toMatchObject({ ok: true, value: { version: 1 } });

    const audit = h.log.entries();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      at: 1_000,
      actor: ACTOR,
      action: 'library.version_created',
      subject: { kind: 'definition', id: 'dev' },
      detail: { kind: 'roles', id: 'dev', version: 1 },
    });
  });
});
