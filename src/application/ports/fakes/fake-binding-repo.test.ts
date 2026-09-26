import { describe, expect, it } from 'vitest';

import type { RoleBinding } from '../../../domain/index';
import { parseSlug, parseUlid, type WorkOrderId, type WorkspaceSlug } from '../../../domain/index';

import type { BindingScope } from '../binding-repo';

import { createFakeBindingRepo } from './fake-binding-repo';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const U3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';

const slugOf = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const woIdOf = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const WS: WorkspaceSlug = slugOf<'workspace'>('acme');
const ROLE = slugOf<'role'>('implementer');
const GLOBAL: BindingScope = { level: 'global' };
const WORKSPACE: BindingScope = { level: 'workspace', workspace: WS };
const WORK_ORDER: BindingScope = { level: 'workOrder', workOrderId: woIdOf(U1) };

const routeFor = (s: string): RoleBinding => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return { role: ROLE, accounts: [{ accountId: parsed.value }] };
};

describe('createFakeBindingRepo', () => {
  it('saves and returns a binding per scope and role', async () => {
    const repo = createFakeBindingRepo();
    const saved = routeFor(U1);
    await repo.save(WORKSPACE, saved);

    expect(await repo.get(WORKSPACE, ROLE)).toEqual(saved);
  });

  it('keeps the three scope levels independent for the same role', async () => {
    const repo = createFakeBindingRepo();
    const global = routeFor(U1);
    const workspace = routeFor(U2);
    const workOrder = routeFor(U3);
    await repo.save(GLOBAL, global);
    await repo.save(WORKSPACE, workspace);
    await repo.save(WORK_ORDER, workOrder);

    expect(await repo.get(GLOBAL, ROLE)).toEqual(global);
    expect(await repo.get(WORKSPACE, ROLE)).toEqual(workspace);
    expect(await repo.get(WORK_ORDER, ROLE)).toEqual(workOrder);
  });

  it('get of an unsaved role is undefined', async () => {
    const repo = createFakeBindingRepo();
    expect(await repo.get(GLOBAL, slugOf<'role'>('reviewer'))).toBeUndefined();
  });

  it('saving the same scope and role again replaces the binding', async () => {
    const repo = createFakeBindingRepo();
    await repo.save(GLOBAL, routeFor(U1));
    const replacement = routeFor(U2);
    await repo.save(GLOBAL, replacement);

    expect(await repo.get(GLOBAL, ROLE)).toEqual(replacement);
  });
});
