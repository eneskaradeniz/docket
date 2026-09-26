// The setting precedence chain: work order → workspace → global → built-in.
// Contract: docs/v2/domain.md section 3.
import type { RoleDef, RoleOverride } from '../definitions/index';
import type { AccountRoute } from '../quota/index';
import type { RoleSlug } from '../shared/index';

export type Level = 'workOrder' | 'workspace' | 'global' | 'builtin';

export const LEVEL_ORDER: readonly Level[] = ['workOrder', 'workspace', 'global', 'builtin'];

/** Lower rank = more specific. */
const LEVEL_RANK: Readonly<Record<Level, number>> = {
  workOrder: 0,
  workspace: 1,
  global: 2,
  builtin: 3,
};

export interface Layer<T> {
  readonly level: Level;
  readonly value: T | undefined;
}

export interface Resolved<T> {
  readonly value: T;
  readonly from: Level;
}

/** Most specific defined value wins, regardless of the input array's order. */
export function resolve<T>(layers: readonly Layer<T>[]): Resolved<T> | undefined {
  let best: Resolved<T> | undefined;
  for (const layer of layers) {
    if (layer.value === undefined) continue;
    if (best !== undefined && LEVEL_RANK[layer.level] >= LEVEL_RANK[best.from]) continue;
    best = { value: layer.value, from: layer.level };
  }
  return best;
}

/** Field-wise merge: overrides are applied in order least-specific → most-specific.
 *  `id` is identity and never overridden; an override naming another id is skipped whole.
 *  Always returns a fresh object — the base and the overrides are never mutated or aliased. */
export function applyRoleOverrides(base: RoleDef, overrides: readonly RoleOverride[]): RoleDef {
  let name = base.name;
  let instructions = base.instructions;
  let writeScope = base.writeScope;
  let capabilities = base.capabilities;
  let active = base.active;
  for (const override of overrides) {
    if (override.id !== base.id) continue;
    if (override.name !== undefined) name = override.name;
    if (override.instructions !== undefined) instructions = override.instructions;
    if (override.writeScope !== undefined) writeScope = override.writeScope;
    if (override.capabilities !== undefined) capabilities = override.capabilities;
    if (override.active !== undefined) active = override.active;
  }
  return { id: base.id, name, instructions, writeScope, capabilities, active };
}

/** Machine-local binding of a role to an ordered chain of accounts (first = preferred). */
export interface RoleBinding {
  readonly role: RoleSlug;
  readonly accounts: readonly AccountRoute[];
}

export function resolveBinding(layers: readonly Layer<RoleBinding>[]): Resolved<RoleBinding> | undefined {
  return resolve(layers);
}
