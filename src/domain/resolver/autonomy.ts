// resolver/autonomy.ts — the autonomy chain read (R-167, D-10; the domain addendum of
// docs/v2/domain.md): work order > repo > project > global, the LEVEL_ORDER the role chain
// already uses. Pure: the same layers always answer the same value.
import type { AutonomyLevel } from '../shared';
import { resolve } from './resolve';
import type { Layer, Level } from './resolve';

export interface ResolvedAutonomy {
  readonly level: AutonomyLevel;
  readonly source: Level;
}

export function resolveAutonomy(layers: readonly Layer<AutonomyLevel>[]): ResolvedAutonomy {
  const first = resolve(layers);
  if (first === undefined) return { level: 'manual', source: 'builtin' };
  // `balanced` is not offered until the risk-rule table lands (D-10 4/5): the layer that set it
  // stays the source for display, the level in force is `manual`.
  if (first.value === 'balanced') return { level: 'manual', source: first.from };
  return { level: first.value, source: first.from };
}
