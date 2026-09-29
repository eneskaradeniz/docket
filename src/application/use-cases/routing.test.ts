import { describe, expect, it } from 'vitest';

import type { AccountRoute, RoleBinding, RoleOverride } from '../../domain/index';
import { parseSlug, parseUlid, type AccountId, type RoleSlug, type WorkOrderId, type RepoSlug } from '../../domain/index';

import type { AccountRecord } from '../ports/account-repo';
import type { BindingScope } from '../ports/binding-repo';
import { createFakeAccountRepo } from '../ports/fakes/fake-account-repo';
import { createFakeBindingRepo } from '../ports/fakes/fake-binding-repo';
import { createFakeDefinitionStore } from '../ports/fakes/fake-definition-store';

import { resolveRoute } from './routing';

const slugOf = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const ulidOf = <B extends string>(s: string) => {
  const parsed = parseUlid<B>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const REPO: RepoSlug = slugOf<'repo'>('acme');
const WO: WorkOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FBV');

const A1: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const A2: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const A3: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAX');
const A4: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAY');
const A5: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAZ'); // never in the repo

const IMPLEMENTER: RoleSlug = slugOf<'role'>('implementer');
const REVIEWER: RoleSlug = slugOf<'role'>('reviewer');
const RETIRED: RoleSlug = slugOf<'role'>('retired');

const GLOBAL: BindingScope = { level: 'global' };
const REPO_SCOPE: BindingScope = { level: 'repo', repo: REPO };
const WORK_ORDER: BindingScope = { level: 'workOrder', workOrderId: WO };

const rolesFile = JSON.stringify({
  roles: [
    {
      id: 'implementer',
      name: 'Implementer',
      instructions: 'implement the task',
      writeScope: { kind: 'repo' },
      capabilities: [],
      active: true,
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      instructions: 'review the change',
      writeScope: { kind: 'none' },
      capabilities: [],
      active: true,
    },
    {
      id: 'retired',
      name: 'Retired',
      instructions: 'gone',
      writeScope: { kind: 'none' },
      capabilities: [],
      active: false,
    },
  ],
});

const flowFile = JSON.stringify({
  flows: [
    {
      id: 'standard',
      name: 'Standard',
      stages: [{ id: 'implement', name: 'Implement', role: 'implementer', exit: [] }],
    },
  ],
});

const repoFile = (overrides: readonly RoleOverride[]): string =>
  JSON.stringify({
    repo: {
      id: 'acme',
      name: 'Acme',
      repos: [],
      flows: ['standard'],
      defaultFlow: 'standard',
      commandSets: {},
      roleOverrides: overrides,
      docsRoot: 'docs',
      testGlobs: [],
    },
  });

const OVERRIDES: readonly RoleOverride[] = [
  { id: IMPLEMENTER, name: 'Acme Implementer', instructions: 'acme instructions' },
];

const route = (accountId: AccountId, model?: string): AccountRoute =>
  model === undefined ? { accountId } : { accountId, model };

const binding = (role: RoleSlug, accounts: readonly AccountRoute[]): RoleBinding => ({ role, accounts });

const account = (id: AccountId): AccountRecord => ({
  id,
  provider: 'provider-x',
  label: `account ${id}`,
  authMode: 'subscription',
  limitPolicy: 'ask',
  caps: [],
});

interface Harness {
  readonly definitions: ReturnType<typeof createFakeDefinitionStore>;
  readonly bindings: ReturnType<typeof createFakeBindingRepo>;
  readonly accounts: ReturnType<typeof createFakeAccountRepo>;
}

/** Valid definitions for `acme`; pass repo overrides to also seed the repo definition. */
const harness = async (options: {
  readonly overrides?: readonly RoleOverride[];
  readonly accountIds?: readonly AccountId[];
} = {}): Promise<Harness> => {
  const definitions = createFakeDefinitionStore();
  const bindings = createFakeBindingRepo();
  const accounts = createFakeAccountRepo();

  definitions.seed({ kind: 'global' }, 'roles/main.json', rolesFile);
  definitions.seed({ kind: 'global' }, 'flows/standard.json', flowFile);
  if (options.overrides !== undefined) {
    definitions.seed({ kind: 'repo', repo: REPO }, 'repo/acme.json', repoFile(options.overrides));
  }
  for (const id of options.accountIds ?? [A1, A2, A3, A4]) await accounts.save(account(id));

  return { definitions, bindings, accounts };
};

const call = (h: Harness, role: RoleSlug) =>
  resolveRoute(
    { definitions: h.definitions, bindings: h.bindings, accounts: h.accounts },
    { repo: REPO, workOrderId: WO, role },
  );

const expectErr = (result: Awaited<ReturnType<typeof resolveRoute>>, code: string): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBe(code);
};

describe('resolveRoute', () => {
  it('A-10: a work-order-level binding beats repo and global', async () => {
    const h = await harness();
    await h.bindings.save(GLOBAL, binding(IMPLEMENTER, [route(A1)]));
    await h.bindings.save(REPO_SCOPE, binding(IMPLEMENTER, [route(A2)]));
    await h.bindings.save(WORK_ORDER, binding(IMPLEMENTER, [route(A3), route(A4)]));

    const result = await call(h, IMPLEMENTER);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.chain).toEqual([route(A3), route(A4)]);
  });

  it('A-10: a repo-level binding beats global', async () => {
    const h = await harness();
    await h.bindings.save(GLOBAL, binding(IMPLEMENTER, [route(A1)]));
    await h.bindings.save(REPO_SCOPE, binding(IMPLEMENTER, [route(A2)]));

    const result = await call(h, IMPLEMENTER);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.chain).toEqual([route(A2)]);
  });

  it('A-10: the global binding is used when neither the work order nor the repo has one', async () => {
    const h = await harness();
    await h.bindings.save(GLOBAL, binding(IMPLEMENTER, [route(A1)]));

    const result = await call(h, IMPLEMENTER);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.chain).toEqual([route(A1)]);
  });

  it('A-10: the role comes back with the repo overrides applied', async () => {
    const h = await harness({ overrides: OVERRIDES });
    await h.bindings.save(GLOBAL, binding(IMPLEMENTER, [route(A1)]));

    const result = await call(h, IMPLEMENTER);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('route must resolve');
    expect(result.value.role).toEqual({
      id: IMPLEMENTER,
      name: 'Acme Implementer',
      instructions: 'acme instructions',
      writeScope: { kind: 'repo' },
      capabilities: [],
      active: true,
    });
    expect(result.value.chain).toEqual([route(A1)]);
  });

  it('A-10: an unknown role is rejected with unknown_role', async () => {
    const h = await harness();

    expectErr(await call(h, slugOf<'role'>('ghost')), 'unknown_role');
  });

  it('A-10: an inactive role is rejected with unknown_role', async () => {
    const h = await harness();

    expectErr(await call(h, RETIRED), 'unknown_role');
  });

  it('A-10: a repo override that deactivates the role is rejected with unknown_role', async () => {
    const h = await harness({ overrides: [{ id: REVIEWER, active: false }] });

    expectErr(await call(h, REVIEWER), 'unknown_role');
  });

  it('A-10: no binding at any level is rejected with no_binding', async () => {
    const h = await harness();

    expectErr(await call(h, IMPLEMENTER), 'no_binding');
  });

  it('A-10: the role is resolved first, so an unknown role wins over a missing binding', async () => {
    const h = await harness();

    expectErr(await call(h, slugOf<'role'>('ghost')), 'unknown_role');
  });

  it('A-10: accounts missing from AccountRepo are dropped from the chain in order', async () => {
    const h = await harness({ accountIds: [A3, A4] });
    await h.bindings.save(WORK_ORDER, binding(IMPLEMENTER, [route(A5), route(A3), route(A4)]));

    const result = await call(h, IMPLEMENTER);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.chain).toEqual([route(A3), route(A4)]);
  });

  it('A-10: a chain that filters down to nothing is rejected with no_account', async () => {
    const h = await harness({ accountIds: [] });
    await h.bindings.save(GLOBAL, binding(IMPLEMENTER, [route(A5)]));

    expectErr(await call(h, IMPLEMENTER), 'no_account');
  });

  it('A-10: a binding with an empty chain is rejected with no_account', async () => {
    const h = await harness();
    await h.bindings.save(GLOBAL, binding(IMPLEMENTER, []));

    expectErr(await call(h, IMPLEMENTER), 'no_account');
  });

  it('A-10: a route keeps its model preference through the filter', async () => {
    const h = await harness({ accountIds: [A3] });
    await h.bindings.save(WORK_ORDER, binding(IMPLEMENTER, [route(A3, 'model-x'), route(A5)]));

    const result = await call(h, IMPLEMENTER);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.chain).toEqual([route(A3, 'model-x')]);
  });

  it('A-10: definitions that cannot be loaded leave the role unknown', async () => {
    const h = await harness({ accountIds: [A1] });
    h.definitions.seed({ kind: 'global' }, 'broken.json', 'not-json{');
    await h.bindings.save(GLOBAL, binding(IMPLEMENTER, [route(A1)]));

    expectErr(await call(h, IMPLEMENTER), 'unknown_role');
  });

  it('A-10: resolving mutates neither the repos nor the stored binding', async () => {
    const h = await harness({ accountIds: [A1] });
    const stored = binding(IMPLEMENTER, [route(A1), route(A5)]);
    await h.bindings.save(GLOBAL, stored);

    const result = await call(h, IMPLEMENTER);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.chain).not.toBe(stored.accounts);
    expect(await h.bindings.get(GLOBAL, IMPLEMENTER)).toEqual(stored);
  });
});
