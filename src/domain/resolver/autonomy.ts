// resolver/autonomy.ts — the widened autonomy chain read (R-151, D-10 chain widening #1225;
// the domain addendum of docs/v2/domain.md): work order > stage > flow > repo > project >
// global, walked by AUTONOMY_CHAIN_ORDER — never by array position. Pure: the same layers
// always answer the same value. `Level`/`LEVEL_ORDER` of the setting chain are NOT changed
// (R-130 stands); the two definition-origin slots join this chain only.
import type { AutonomyLevel } from '../shared';
import type { Level } from './resolve';

export type AutonomySource = Level | 'stage' | 'flow';

export const AUTONOMY_CHAIN_ORDER: readonly AutonomySource[] = [
  'workOrder',
  'stage',
  'flow',
  'repo',
  'project',
  'global',
  'builtin',
];

export interface AutonomyLayer {
  readonly source: AutonomySource;
  readonly value: AutonomyLevel | undefined;
}

export interface ResolvedAutonomy {
  readonly level: AutonomyLevel;
  readonly source: AutonomySource | 'ceiling';
}

/** Where each level sits on the manual→auto scale; the ceiling is the lowest rank among the
 *  defined ones (R-154). */
export const AUTONOMY_RANK: Readonly<Record<AutonomyLevel, number>> = {
  manual: 0,
  balanced: 1,
  auto: 2,
};

export function resolveAutonomy(layers: readonly AutonomyLayer[]): ResolvedAutonomy {
  for (const source of AUTONOMY_CHAIN_ORDER) {
    for (const layer of layers) {
      if (layer.source !== source || layer.value === undefined) continue;
      // `balanced` is not offered until the risk-rule table lands (D-10 4/5): the layer that set
      // it stays the source for display, the level in force is `manual`.
      if (layer.value === 'balanced') return { level: 'manual', source };
      return { level: layer.value, source };
    }
  }
  return { level: 'manual', source: 'builtin' };
}

/** The ceiling read (R-154): the effective ceiling is the minimum by AUTONOMY_RANK of the
 *  defined ones — a repo ceiling can tighten the global one, never loosen it. A level ranking
 *  above it answers the ceiling with `ceiling` as its source; R-167's balanced clause applies
 *  after the clamp exactly as before. */
export function clampAutonomy(
  resolved: ResolvedAutonomy,
  ceilings: readonly (AutonomyLevel | undefined)[],
): ResolvedAutonomy {
  const defined = ceilings.filter((ceiling): ceiling is AutonomyLevel => ceiling !== undefined);
  if (defined.length === 0) return resolved;
  const ceiling = defined.reduce((low, one) => (AUTONOMY_RANK[one] < AUTONOMY_RANK[low] ? one : low));
  if (AUTONOMY_RANK[resolved.level] <= AUTONOMY_RANK[ceiling]) return resolved;
  return { level: ceiling === 'balanced' ? 'manual' : ceiling, source: 'ceiling' };
}
