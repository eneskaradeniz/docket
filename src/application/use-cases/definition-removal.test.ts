import { describe, expect, it } from 'vitest';

import type { Actor, FlowPin, Slug, Ulid } from '../../domain/index';

const slugOf = <B extends string>(input: string): Slug<B> => input as Slug<B>;
const ulidOf = <B extends string>(input: string): Ulid<B> => input as Ulid<B>;
import {
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  type FakeDefinitionStore,
} from '../ports/fakes';
import type { AppDeps } from '../ports';
import { archiveDefinition, deleteDefinition, roleRemovalVerdict } from './definition-removal';
import { saveVersion } from './library';

const USER: Actor = { kind: 'user', id: 'operator' };
const PIN_STAGE = slugOf<'stage'>('implement');
const PIN_FLOW = slugOf<'flow'>('flow-a');
const PIN_ROLE = slugOf<'role'>('worker');
const PIN_WO = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FC0');
const PIN_PROJECT = slugOf<'project'>('atolye');
const PIN_REPO = slugOf<'repo'>('acme');

const roleBody = {
  id: 'worker',
  name: 'Worker',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' as const },
  capabilities: [],
  active: true,
};

const pinOf = (): FlowPin => ({
  flowId: PIN_FLOW,
  flowVersion: 1,
  stages: [
    {
      stage: { id: PIN_STAGE, name: 'Implement', role: PIN_ROLE, exit: [] },
      role: { ...roleBody, id: PIN_ROLE, writeScope: { kind: 'repo' as const } },
      roleVersion: 1,
      accounts: [],
      limitPolicy: 'wait_resume',
    },
  ],
});

interface Harness {
  readonly deps: AppDeps;
  readonly definitions: FakeDefinitionStore;
  readonly workOrders: AppDeps['workOrders'];
}

const makeHarness = (): Harness => {
  const clock = createFakeClock(1_000);
  const log = createFakeEventLog();
  const definitions = createFakeDefinitionStore();
  const deps = createFakeDeps({ clock, log, definitions, capabilities: createFakeCapabilityCatalog() });
  return { deps, definitions, workOrders: deps.workOrders };
};

describe('definition archive and delete (A-355)', () => {
  it('A-355: definitions.archive refuses a definition referenced by an active stage, listing the dependants', async () => {
    const h = makeHarness();
    await saveVersion(h.deps, { kind: 'roles', id: 'worker', body: roleBody, actor: USER });
    await h.deps.projects.save({ id: PIN_PROJECT, name: 'Atölye', repos: [PIN_REPO] });
    h.definitions.setRepoDef(PIN_REPO, {
      id: PIN_REPO,
      name: 'Acme',
      commandSets: {},
      docsRoot: 'docs',
      testGlobs: [],
      defaultLimitPolicy: 'wait_resume',
      flow: {
        flowId: PIN_FLOW,
        version: 1,
        stages: [{ id: PIN_STAGE, name: 'Implement', role: PIN_ROLE, exit: [] }],
        bindings: [{ stage: PIN_STAGE, role: { roleId: PIN_ROLE, version: 1 }, accounts: [] }],
      },
    });

    const verdict = await roleRemovalVerdict(h.deps, PIN_ROLE);
    expect(verdict.kind).toBe('blocked');

    const result = await archiveDefinition(h.deps, { kind: 'roles', id: 'worker', actor: USER });
    expect(result.ok).toBe(false);
    if (result.ok || typeof result.error === 'string') return;
    expect(result.error.code).toBe('blocked');
    expect(result.error.reasons.some((reason) => reason.kind === 'dependant')).toBe(true);
    expect(await h.definitions.listVersions('roles', 'worker')).toHaveLength(1);
  });

  it('A-355: definitions.archive archives an unreferenced one', async () => {
    const h = makeHarness();
    await saveVersion(h.deps, { kind: 'roles', id: 'worker', body: roleBody, actor: USER });
    h.definitions.seed({ kind: 'global' }, 'defs.json', JSON.stringify({
      roles: [roleBody],
      flows: [{ id: 'flow-a', name: 'Flow A', stages: [{ id: 'implement', name: 'Implement', role: 'worker', exit: [] }] }],
    }));
    await h.workOrders.create({
      id: PIN_WO,
      project: PIN_PROJECT,
      repo: PIN_REPO,
      flow: PIN_FLOW,
      title: 'Done',
      pin: pinOf(),
      createdAt: 900,
      createdBy: USER,
    });
    await h.workOrders.appendEvent(PIN_WO, { type: 'closed', at: 950, by: USER });

    const result = await archiveDefinition(h.deps, { kind: 'roles', id: 'worker', actor: USER });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.definitions.listIds('roles')).toEqual([]);
    expect((await h.definitions.listVersions('roles', 'worker'))[0]?.archived).toBe(true);
  });

  it('A-355: definitions.delete removes an unreferenced role', async () => {
    const h = makeHarness();
    await saveVersion(h.deps, { kind: 'roles', id: 'worker', body: roleBody, actor: USER });

    const result = await deleteDefinition(h.deps, { kind: 'roles', id: 'worker', actor: USER });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.definitions.listVersions('roles', 'worker')).toEqual([]);
  });
});
