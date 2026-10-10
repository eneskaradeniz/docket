import { describe, expect, expectTypeOf, it } from 'vitest';
import type { RoleDef, RoleOverride } from '../definitions/index';
import type { AccountRoute } from '../quota/index';
import type { RoleSlug, ThinkingChoice, Tier } from '../shared/index';
import type { Layer, Level, Resolved, RoleBinding } from './resolve';
import { LEVEL_ORDER, applyRoleOverrides, resolve, resolveBinding } from './resolve';

const asRole = (id: string): RoleSlug => id as RoleSlug;
const asCapability = (id: string): RoleDef['capabilities'][number] => id as RoleDef['capabilities'][number];
const asAccount = (id: string): AccountRoute['accountId'] => id as AccountRoute['accountId'];

const BASE: RoleDef = {
  id: asRole('reviewer'),
  name: 'Reviewer',
  instructions: 'base instructions',
  writeScope: { kind: 'none' },
  capabilities: [asCapability('mcp-fs')],
  active: true,
};

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([items[i], ...p]);
  }
  return out;
}

describe('LEVEL_ORDER', () => {
  it('orders the chain most specific first: workOrder → repo → project → global → builtin', () => {
    expect(LEVEL_ORDER).toEqual(['workOrder', 'repo', 'project', 'global', 'builtin']);
    expectTypeOf<Level>().toEqualTypeOf<'workOrder' | 'repo' | 'project' | 'global' | 'builtin'>();
  });
});

describe('resolve', () => {
  it('R-10: ignores layers with undefined values and picks by LEVEL_ORDER, not array position', () => {
    // The most specific level is listed LAST; the most specific *defined* value still wins.
    const layers: Layer<string>[] = [
      { level: 'builtin', value: 'builtin-value' },
      { level: 'repo', value: undefined },
      { level: 'global', value: 'global-value' },
      { level: 'workOrder', value: 'work-order-value' },
    ];
    expect(resolve(layers)).toEqual({ value: 'work-order-value', from: 'workOrder' });
  });

  it('R-10: a defined less-specific layer wins when every more-specific layer is undefined', () => {
    const layers: Layer<string>[] = [
      { level: 'workOrder', value: undefined },
      { level: 'repo', value: undefined },
      { level: 'global', value: 'global-value' },
      { level: 'builtin', value: 'builtin-value' },
    ];
    expect(resolve(layers)).toEqual({ value: 'global-value', from: 'global' });
  });

  it('R-10: a builtin-only fallback is used when all specificity above it is undefined', () => {
    const layers: Layer<number>[] = [
      { level: 'workOrder', value: undefined },
      { level: 'repo', value: undefined },
      { level: 'global', value: undefined },
      { level: 'builtin', value: 7 },
    ];
    expect(resolve(layers)).toEqual({ value: 7, from: 'builtin' });
  });

  it('returns the same result for any permutation of the input layers (acceptance 1)', () => {
    const all: Layer<string>[] = [
      { level: 'repo', value: 'ws' },
      { level: 'builtin', value: 'b' },
      { level: 'workOrder', value: 'wo' },
      { level: 'global', value: 'g' },
    ];
    for (const p of permutations(all)) {
      expect(resolve(p)).toEqual({ value: 'wo', from: 'workOrder' });
    }
  });

  it('is permutation-invariant when undefined layers are mixed in', () => {
    const sparse: Layer<string>[] = [
      { level: 'repo', value: undefined },
      { level: 'builtin', value: 'b' },
      { level: 'workOrder', value: undefined },
      { level: 'global', value: 'g' },
    ];
    for (const p of permutations(sparse)) {
      expect(resolve(p)).toEqual({ value: 'g', from: 'global' });
    }
  });

  it('returns undefined for an empty layer list and for a list where every value is undefined', () => {
    expect(resolve<string>([])).toBeUndefined();
    expect(
      resolve<string>([
        { level: 'workOrder', value: undefined },
        { level: 'repo', value: undefined },
        { level: 'global', value: undefined },
        { level: 'builtin', value: undefined },
      ]),
    ).toBeUndefined();
  });

  it('resolves a single layer and reports its level as `from`', () => {
    expect(resolve([{ level: 'global', value: 'g' }])).toEqual({ value: 'g', from: 'global' });
  });

  it('keeps the first layer of equal specificity, deterministically', () => {
    const layers: Layer<string>[] = [
      { level: 'repo', value: 'first' },
      { level: 'repo', value: 'second' },
    ];
    expect(resolve(layers)).toEqual({ value: 'first', from: 'repo' });
  });

  it('does not mutate the input layers or reorder the array', () => {
    const layers: Layer<string>[] = [
      { level: 'global', value: 'g' },
      { level: 'workOrder', value: 'wo' },
    ];
    const snapshot = layers.map((l) => ({ ...l }));
    const result = resolve(layers);
    result?.value;
    expect(layers).toEqual(snapshot);
  });

  it('Resolved and Layer have the contract shapes', () => {
    expectTypeOf<Layer<number>>().toEqualTypeOf<{ readonly level: Level; readonly value: number | undefined }>();
    expectTypeOf<Resolved<number>>().toEqualTypeOf<{ readonly value: number; readonly from: Level }>();
  });
});

describe('applyRoleOverrides', () => {
  it('R-81: docketTools survives the merge, an override replaces it, and an unset one stays absent', () => {
    expect(applyRoleOverrides({ ...BASE, docketTools: false }, []).docketTools).toBe(false);
    expect(applyRoleOverrides(BASE, [{ id: BASE.id, docketTools: false }]).docketTools).toBe(false);
    expect('docketTools' in applyRoleOverrides(BASE, [])).toBe(false);
  });

  it('R-11: never changes id; an override with a different id is ignored entirely', () => {
    const result = applyRoleOverrides(BASE, [
      { id: asRole('coder'), name: 'Hijacked', instructions: 'other' },
    ]);
    expect(result.id).toBe(asRole('reviewer'));
    expect(result.name).toBe('Reviewer');
    expect(result.instructions).toBe('base instructions');
  });

  it('R-11: an override with a matching id still keeps the base id', () => {
    const result = applyRoleOverrides(BASE, [{ id: asRole('reviewer'), name: 'Renamed' }]);
    expect(result.id).toBe(asRole('reviewer'));
    expect(result.name).toBe('Renamed');
  });

  it('applies overrides least-specific → most-specific: workOrder wins per field over repo (acceptance 2)', () => {
    const repoOverride: RoleOverride = {
      id: asRole('reviewer'),
      name: 'Repo Name',
      instructions: 'repo instructions',
    };
    const workOrderOverride: RoleOverride = {
      id: asRole('reviewer'),
      name: 'WorkOrder Name',
    };
    const result = applyRoleOverrides(BASE, [repoOverride, workOrderOverride]);
    expect(result.id).toBe(asRole('reviewer'));
    expect(result.name).toBe('WorkOrder Name');
    expect(result.instructions).toBe('repo instructions');
    // untouched fields keep the base values
    expect(result.writeScope).toEqual({ kind: 'none' });
    expect(result.active).toBe(true);
  });

  it('a later override wins per field; untouched fields are kept from the base', () => {
    const first: RoleOverride = { id: asRole('reviewer'), active: false, writeScope: { kind: 'docs' } };
    const second: RoleOverride = { id: asRole('reviewer'), active: true };
    const result = applyRoleOverrides(BASE, [first, second]);
    expect(result.active).toBe(true);
    expect(result.writeScope).toEqual({ kind: 'docs' });
    expect(result.name).toBe('Reviewer');
    expect(result.instructions).toBe('base instructions');
  });

  it('replaces a whole field value instead of deep-merging it', () => {
    const result = applyRoleOverrides(BASE, [
      { id: asRole('reviewer'), writeScope: { kind: 'paths', globs: ['src/**'] } },
    ]);
    expect(result.writeScope).toEqual({ kind: 'paths', globs: ['src/**'] });
  });

  it('returns a structurally equal role with no overrides, as a new object', () => {
    const result = applyRoleOverrides(BASE, []);
    expect(result).toEqual(BASE);
    expect(result).not.toBe(BASE);
  });

  it('does not mutate the base role or the override objects', () => {
    const base: RoleDef = { ...BASE, capabilities: [...BASE.capabilities] };
    const override: RoleOverride = { id: asRole('reviewer'), name: 'Renamed' };
    const overrideSnapshot = { ...override };
    applyRoleOverrides(base, [override]);
    expect(base).toEqual(BASE);
    expect(override).toEqual(overrideSnapshot);
  });

  it('ignores explicit undefined fields in an override instead of clobbering the base', () => {
    const result = applyRoleOverrides(BASE, [
      { id: asRole('reviewer'), name: undefined, active: false },
    ]);
    expect(result.name).toBe('Reviewer');
    expect(result.active).toBe(false);
  });
});

describe('resolveBinding', () => {
  const binding = (role: string, accounts: readonly string[]): RoleBinding => ({
    role: asRole(role),
    accounts: accounts.map((accountId) => ({ accountId: asAccount(accountId) })),
  });

  it('resolves the machine-local binding by LEVEL_ORDER and ignores undefined layers (R-10 semantics)', () => {
    const layers: Layer<RoleBinding>[] = [
      { level: 'builtin', value: binding('reviewer', ['acc-1']) },
      { level: 'repo', value: undefined },
      { level: 'workOrder', value: binding('coder', ['acc-2', 'acc-3']) },
    ];
    expect(resolveBinding(layers)).toEqual({
      value: binding('coder', ['acc-2', 'acc-3']),
      from: 'workOrder',
    });
  });

  it('falls through undefined layers to the most specific defined binding', () => {
    const layers: Layer<RoleBinding>[] = [
      { level: 'workOrder', value: undefined },
      { level: 'repo', value: binding('reviewer', ['acc-9']) },
      { level: 'builtin', value: undefined },
    ];
    expect(resolveBinding(layers)).toEqual({ value: binding('reviewer', ['acc-9']), from: 'repo' });
  });

  it('returns undefined for an empty list and is permutation-invariant', () => {
    expect(resolveBinding([])).toBeUndefined();
    const layers: Layer<RoleBinding>[] = [
      { level: 'builtin', value: binding('reviewer', ['acc-1']) },
      { level: 'global', value: binding('coder', ['acc-2']) },
    ];
    for (const p of permutations(layers)) {
      expect(resolveBinding(p)).toEqual({ value: binding('coder', ['acc-2']), from: 'global' });
    }
  });

  it('RoleBinding has the contract shape with AccountRoute from quota', () => {
    expectTypeOf<RoleBinding>().toEqualTypeOf<{
      readonly role: RoleSlug;
      readonly accounts: readonly AccountRoute[];
      readonly thinking?: ThinkingChoice;
      readonly tier?: Tier;
    }>();
    expectTypeOf(resolveBinding([])).toEqualTypeOf<Resolved<RoleBinding> | undefined>();
  });
});
