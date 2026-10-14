// project-spend-api.test.ts — A-388: project.spend answers billing from the project's active
// accounts; totalUsd, perRepo and cap stay as before.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type AccountId, type ProjectSlug, type RoleSlug, type Ulid } from '../domain/index';
import { createFakeDeps, createFakeModelCatalog } from '../application/ports/fakes';
import { createApi } from './api';
import type { ProjectSpendView } from './queries';

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};
const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const PROJECT: ProjectSlug = slugOf<'project'>('alpha');
const REPO = slugOf<'repo'>('main');
const ROLE: RoleSlug = slugOf<'role'>('worker');
const INCLUDED: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const PAID: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const OTHER: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA3');

const spend = async (deps: ReturnType<typeof createFakeDeps>): Promise<ProjectSpendView> =>
  (await createApi(deps).query({ type: 'project.spend', project: 'alpha' })) as ProjectSpendView;

describe('project.spend query', () => {
  it('A-388: billing is included when every active account is included, with and without a cap', async () => {
    const deps = createFakeDeps();
    await deps.projects.save({ id: PROJECT, name: 'Alpha', repos: [REPO], budget: { amountUsd: 50, warnPercent: 80 } });
    await deps.accounts.save({ id: INCLUDED, provider: 'acme', label: 'Plan', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] });
    await deps.bindings.save({ level: 'global' }, { role: ROLE, accounts: [{ accountId: INCLUDED }] });
    await deps.accounts.recordSpend({ project: PROJECT, repo: REPO, accountId: INCLUDED, workOrderId: ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAA'), at: 1, usd: 3 });

    const view = await spend(deps);
    expect(view.billing).toBe('included');
    expect(view.totalUsd).toBe(3);
    expect(view.cap).toEqual({ amountUsd: 50, warnPercent: 80 });
    expect(view.perRepo).toEqual([{ repo: 'main', usd: 3 }]);

    const noCap = createFakeDeps();
    await noCap.projects.save({ id: PROJECT, name: 'Alpha', repos: [REPO] });
    await noCap.accounts.save({ id: INCLUDED, provider: 'acme', label: 'Plan', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] });
    await noCap.bindings.save({ level: 'global' }, { role: ROLE, accounts: [{ accountId: INCLUDED }] });
    const bare = await spend(noCap);
    expect(bare.billing).toBe('included');
    expect(bare.cap).toBeUndefined();
  });

  it('A-388: billing is pay_per_use when every active account bills per use', async () => {
    const deps = createFakeDeps({
      modelCatalog: createFakeModelCatalog({
        [PAID]: [{ id: 'atlas-max', source: 'live', thinking: { kind: 'none' }, billing: 'metered', isDefault: true, contextWindow: null }],
      }),
    });
    await deps.projects.save({ id: PROJECT, name: 'Alpha', repos: [REPO] });
    await deps.accounts.save({ id: PAID, provider: 'acme', label: 'Key', authMode: 'api_key', limitPolicy: 'wait_resume', caps: [] });
    await deps.bindings.save({ level: 'project', project: PROJECT }, { role: ROLE, accounts: [{ accountId: PAID }] });
    expect((await spend(deps)).billing).toBe('pay_per_use');
  });

  it('A-388: billing is mixed when active accounts differ', async () => {
    const deps = createFakeDeps({
      modelCatalog: createFakeModelCatalog({
        [PAID]: [{ id: 'atlas-max', source: 'live', thinking: { kind: 'none' }, billing: 'metered', isDefault: true, contextWindow: null }],
      }),
    });
    await deps.projects.save({ id: PROJECT, name: 'Alpha', repos: [REPO] });
    await deps.accounts.save({ id: INCLUDED, provider: 'acme', label: 'Plan', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] });
    await deps.accounts.save({ id: PAID, provider: 'acme', label: 'Key', authMode: 'api_key', limitPolicy: 'wait_resume', caps: [] });
    await deps.bindings.save(
      { level: 'repo', repo: REPO },
      { role: ROLE, accounts: [{ accountId: INCLUDED }, { accountId: PAID }] },
    );
    expect((await spend(deps)).billing).toBe('mixed');
  });

  it('A-388: billing is none when the project has no active account', async () => {
    const deps = createFakeDeps();
    await deps.projects.save({ id: PROJECT, name: 'Alpha', repos: [REPO] });
    await deps.bindings.save({ level: 'global' }, { role: ROLE, accounts: [{ accountId: OTHER }] });
    expect((await spend(deps)).billing).toBe('none');
  });
});
