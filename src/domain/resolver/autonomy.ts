// resolver/autonomy.ts — the widened autonomy chain read (R-151, D-10 chain widening;
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
      // R-157, clause 1 — defence in depth: a definition-origin layer can never resolve `auto`,
      // whatever path fed the walk; the layer reads as absent and the walk goes on. A user-set
      // source's `auto` passes through (R-151's narrowed clause); `manual`/`balanced` from a
      // definition pass through too — a definition may restrict, never loosen.
      if (layer.value === 'auto' && (source === 'flow' || source === 'stage')) continue;
      return { level: layer.value, source };
    }
  }
  return { level: 'manual', source: 'builtin' };
}

/** The ceiling read (R-154): the effective ceiling is the minimum by AUTONOMY_RANK of the
 *  defined ones — a repo ceiling can tighten the global one, never loosen it. A level ranking
 *  above it answers the ceiling with `ceiling` as its source. R-157, clause 2: the balanced
 *  demotion is applied here — once, after the clamp, the source preserved (including
 *  `'ceiling'`) — so no composition ever leaves a balanced level in force. */
export function clampAutonomy(
  resolved: ResolvedAutonomy,
  ceilings: readonly (AutonomyLevel | undefined)[],
): ResolvedAutonomy {
  let level = resolved.level;
  let source: ResolvedAutonomy['source'] = resolved.source;
  const defined = ceilings.filter((ceiling): ceiling is AutonomyLevel => ceiling !== undefined);
  if (defined.length > 0) {
    const ceiling = defined.reduce((low, one) => (AUTONOMY_RANK[one] < AUTONOMY_RANK[low] ? one : low));
    if (AUTONOMY_RANK[level] > AUTONOMY_RANK[ceiling]) {
      level = ceiling;
      source = 'ceiling';
    }
  }
  if (level === 'balanced') return { level: 'manual', source };
  return { level, source };
}
