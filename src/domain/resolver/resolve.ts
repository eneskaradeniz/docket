// The setting precedence chain: work order → repo → project → global → built-in.
// Contract: docs/v2/domain.md section 3.
import type { RoleDef, RoleOverride, StageDef } from '../definitions/index';
import type { AccountRoute } from '../quota/index';
import type { RoleSlug, ThinkingChoice, Tier } from '../shared/index';

export type Level = 'workOrder' | 'repo' | 'project' | 'global' | 'builtin';

export const LEVEL_ORDER: readonly Level[] = ['workOrder', 'repo', 'project', 'global', 'builtin'];

/** Lower rank = more specific. */
const LEVEL_RANK: Readonly<Record<Level, number>> = {
  workOrder: 0,
  repo: 1,
  project: 2,
  global: 3,
  builtin: 4,
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
  readonly thinking?: ThinkingChoice; // absent → { level: 'balanced' }
  readonly tier?: Tier; // for unpinned routes of the chain; absent → the CLI's own default model
}

export function resolveBinding(layers: readonly Layer<RoleBinding>[]): Resolved<RoleBinding> | undefined {
  return resolve(layers);
}

/** What a stage run asks for: the stage's own setting wins over the binding's. */
export interface StageRouting {
  readonly tier?: Tier;
  readonly thinking?: ThinkingChoice;
}

export function stageRouting(stage: StageDef, binding: RoleBinding): StageRouting {
  const tier = stage.tier ?? binding.tier;
  const thinking = stage.thinking ?? binding.thinking;
  return {
    ...(tier !== undefined ? { tier } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
  };
}

/** One chain entry with the provider definition id of its account (data, never a vendor name in code). */
export interface ChainEntry {
  readonly route: AccountRoute;
  readonly provider: string;
}

/** Accounts on another provider than the one that wrote the reviewed work move to the front, so a
 *  review is a second opinion; `sameProvider` tells the caller no such account exists. */
export function orderForReview(
  chain: readonly ChainEntry[],
  reviewedProvider: string | undefined,
): { readonly chain: readonly ChainEntry[]; readonly sameProvider: boolean } {
  if (reviewedProvider === undefined) return { chain: [...chain], sameProvider: false };
  const others = chain.filter((entry) => entry.provider !== reviewedProvider);
  const same = chain.filter((entry) => entry.provider === reviewedProvider);
  const ordered = [...others, ...same];
  return { chain: ordered, sameProvider: ordered[0]?.provider === reviewedProvider };
}
