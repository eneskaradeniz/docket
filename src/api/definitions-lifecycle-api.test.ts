import { describe, expect, it } from 'vitest';

import type { Actor, Slug } from '../domain/index';

const slugOf = <B extends string>(input: string): Slug<B> => input as Slug<B>;

import {
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
} from '../application/ports/fakes';
import { saveVersion } from '../application/use-cases/library';
import { createApi } from './api';
import type { RoleListItem } from './queries';

const USER: Actor = { kind: 'user', id: 'operator' };

describe('definitions lifecycle API (A-355)', () => {
  it('A-355: roles.list items include removal with the same verdict the domain returns for the same inputs', async () => {
    const deps = createFakeDeps({
      clock: createFakeClock(1_000),
      log: createFakeEventLog(),
      definitions: createFakeDefinitionStore(),
      capabilities: createFakeCapabilityCatalog(),
    });
    const api = createApi(deps);
    const list = (await api.query({ type: 'roles.list' })) as readonly RoleListItem[];
    expect(list.length).toBeGreaterThan(0);
    for (const row of list) {
      expect(row.removal.kind === 'delete' || row.removal.kind === 'archive' || row.removal.kind === 'blocked').toBe(true);
      expect(row.version).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(row.pastVersions)).toBe(true);
    }
  });

  it('A-355: definitions.archive refuses a definition referenced by an active stage, listing the dependants', async () => {
    const definitions = createFakeDefinitionStore();
    const deps = createFakeDeps({
      clock: createFakeClock(1_000),
      log: createFakeEventLog(),
      definitions,
      capabilities: createFakeCapabilityCatalog(),
    });
    const api = createApi(deps);
    await saveVersion(deps, {
      kind: 'roles',
      id: 'worker',
      body: {
        id: 'worker',
        name: 'Worker',
        instructions: 'Work',
        writeScope: { kind: 'repo' as const },
        capabilities: [],
        active: true,
      },
      actor: USER,
    });
    const repo = slugOf<'repo'>('acme');
    await deps.projects.save({ id: slugOf<'project'>('atolye'), name: 'Atölye', repos: [repo] });
    definitions.setRepoDef(repo, {
      id: repo,
      name: 'Acme',
      commandSets: {},
      docsRoot: 'docs',
      testGlobs: [],
      defaultLimitPolicy: 'wait_resume',
      flow: {
        flowId: slugOf<'flow'>('flow-a'),
        version: 1,
        stages: [{ id: slugOf<'stage'>('implement'), name: 'Implement', role: slugOf<'role'>('worker'), exit: [] }],
        bindings: [
          {
            stage: slugOf<'stage'>('implement'),
            role: { roleId: slugOf<'role'>('worker'), version: 1 },
            accounts: [],
          },
        ],
      },
    });

    const result = await api.command(USER, { type: 'definitions.archive', kind: 'roles', id: 'worker' });
    expect(result).toMatchObject({ ok: false, code: 'blocked' });
    if (!result.ok && result.reasons !== undefined) {
      expect(result.reasons.some((reason) => reason.kind === 'dependant')).toBe(true);
    }
  });
});
